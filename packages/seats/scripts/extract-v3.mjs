// Claim extraction v3 — three candidate sources, one advisory classifier.
// Governed by docs/analysis/analysis-v3-spec.md (v3.1), §2–§3, as amended by
// docs/analysis/analysis-v3.2-amendment.md: classifier fields are
// AUTHORITATIVE (§1 — an omitted field deletes any candidate value, explicit
// deletion is representable, the candidate-fill spread merge is retired),
// claimedNight only when a night number is literally stated (§2), and the
// §10 admissibility ADVISORIES attached here for the adjudication sheet —
// an advisory never rejects a candidate; only a human ruling removes a claim.
//
// candidates = v2 ledger recycled (claims AND rejects — finder, never scorer)
//            ∪ tripwire lexicon hits (§3.1)
//            ∪ one strong model sweeping every public message
//    → merged per R17 so one proposition is classified once
//    → the same model classifies every candidate (advisory):
//        { asserted (in THIS message, R12b), kind, fields, resolvingContext? }
//    → machine-positives  -> {seed}.claims.jsonl    (human confirms later, §6)
//      machine-negatives  -> {seed}.negatives.jsonl  (the §6 negative pool)
//      R12/R13/R19 failures -> {seed}.rejects.jsonl  (logged, never silent)
//
// Blinding (§2): every prompt carries ONLY the complete message, the
// speaker's table name, the day, the other players' names, and — for field
// resolution alone (R12b) — the speaker's own prior public messages. Never
// seat→model bindings, roles, night events, or the outcome. Seat, day and
// seq are attached by code; provenance is recomputed at scoring time (R18).
//
// Fail-closed engineering (§3): atomic writes (tmp+rename), a per-seed
// lockfile, a content-addressed cache key (log bytes ‖ spec sha ‖ schemas ‖
// finder config ‖ EXTRACTOR_VERSION) checked before any cache reuse, every
// raw response + stop reason + response id retained, and exit 1 with NO
// candidates file for a seed whose messages or candidates cannot all be
// processed after retries.
//
//   node --env-file-if-exists=.env packages/seats/scripts/extract-v3.mjs \
//        runs/sweep-download/sweep1/sweep1-*.jsonl \
//        [--out-dir runs/analysis-v3/extract] [--model claude-fable-5] \
//        [--second-model gpt-5.6-sol] [--concurrency 8] \
//        [--games sweep1-3,sweep1-9] [--max-messages 20] [--dry]
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  TRIPWIRE_VERSION, buildLexicon, compileLexicon, lexiconHits, lexiconSha256, normalizeIndexed,
} from '../../../scripts/tripwire.mjs'
import { BAR_REASONS, barFor, nightIsStated } from './semantics-v3.mjs'

// v3.2 (docs/analysis/analysis-v3.2-amendment.md, "Versions"): the version
// feeds the content-addressed cache key, so a v3.2 reading can never reuse or
// silently overwrite a v3.1 one.
export const EXTRACTOR_VERSION = 'v3.2.1'

// Importable module: the pure helpers (locateQuote, mergeCandidates) and
// EXTRACTOR_VERSION are exported for scoring-v3/tests; CLI behavior only
// engages when this file is the entrypoint.
const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1])

const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: isMain,
  options: {
    'out-dir': { type: 'string', default: 'runs/analysis-v3/extract' },
    'v2-dir': { type: 'string', default: 'runs/analysis/extract' },
    model: { type: 'string', default: 'claude-fable-5' },
    'second-model': { type: 'string' }, // §3.2: off by default, evidence-gated
    concurrency: { type: 'string', default: '8' },
    'max-messages': { type: 'string' }, // calibration slice (§3.3)
    games: { type: 'string' }, // calibration slice: comma-separated seeds
    /** Hard spend backstop in estimated dollars: stop before starting a
     *  seed once the run's estimated cost crosses this. 0 disables (only
     *  allowed explicitly; unpriced models refuse a nonzero cap). */
    'abort-dollars': { type: 'string', default: '25' },
    dry: { type: 'boolean', default: false },
  },
})
if (isMain && positionals.length === 0) {
  console.error('usage: extract-v3.mjs <log.jsonl>... [--out-dir d] [--model m] [--second-model m] [--concurrency n] [--games s1,s2] [--max-messages n] [--dry]')
  process.exit(1)
}
const CONC = Math.max(1, Number(values.concurrency))
const MAX_MESSAGES = values['max-messages'] ? Number(values['max-messages']) : null
const GAMES = values.games ? new Set(values.games.split(',').map((s) => s.trim()).filter(Boolean)) : null

// Cost telemetry and a hard spend cap equivalent to the sweep runner's
// --abort-tokens guard. Extraction must stop before an estimate can silently
// turn into an open-ended premium-model run.
// Per-million-token prices; a model absent from this table cannot run
// under a nonzero cap — deliberate, so an unpriced premium model is never
// again a silent default.
const PRICES = {
  'claude-sonnet-5': { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 },
}
const ABORT_DOLLARS = Number(values['abort-dollars'])
if (!Number.isFinite(ABORT_DOLLARS) || ABORT_DOLLARS < 0) {
  console.error(`--abort-dollars must be a number >= 0 (0 disables the cap)`)
  process.exit(1)
}
const usageTotal = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, calls: 0 }
const addUsage = (u) => {
  if (!u) return
  usageTotal.calls += 1
  usageTotal.in += u.input_tokens ?? 0
  usageTotal.out += u.output_tokens ?? 0
  usageTotal.cacheRead += u.cache_read_input_tokens ?? 0
  usageTotal.cacheWrite += u.cache_creation_input_tokens ?? 0
}
const estCost = (model) => {
  const p = PRICES[model]
  if (!p) return null
  return (usageTotal.in * p.in + usageTotal.out * p.out +
    usageTotal.cacheRead * p.cacheRead + usageTotal.cacheWrite * p.cacheWrite) / 1e6
}
const costLine = (model) => {
  const c = estCost(model)
  return `${usageTotal.calls} calls, in=${usageTotal.in.toLocaleString()} out=${usageTotal.out.toLocaleString()} ` +
    `cacheRead=${usageTotal.cacheRead.toLocaleString()} cacheWrite=${usageTotal.cacheWrite.toLocaleString()}` +
    (c === null ? ' (unpriced model — token telemetry only)' : ` — est $${c.toFixed(2)}`)
}

// ---------------------------------------------------------------------------
// Codebook contracts (§2.1, §8 — binding kind names and per-kind fields).
// R13: required fields are extraction-time; a classified candidate still
// missing one is a logged reject, never a downstream UNSCORABLE.
// ---------------------------------------------------------------------------

const KIND_FIELDS = {
  role_claim: { required: ['role'], optional: [] },
  not_mafia_claim: { required: [], optional: [] },
  investigation_claim: { required: ['target', 'result'], optional: ['claimedNight'] },
  protection_claim: { required: ['target'], optional: ['claimedNight'] },
  vote_commitment: { required: ['target'], optional: [] },
  vote_stance: { required: [], optional: ['target', 'conditional'] }, // R12: unresolvable-target votes land here without target
  vote_retraction: { required: [], optional: ['target'] },
  past_vote_claim: { required: ['target'], optional: ['referencedDay'] },
  past_vote_denial: { required: ['target'], optional: ['referencedDay'] },
}
const KINDS = Object.keys(KIND_FIELDS)
const FIELD_NAMES = ['role', 'target', 'result', 'claimedNight', 'referencedDay', 'conditional']
// v2 kinds map 1:1 for the published families; vote_intention renamed.
const V2_KIND_MAP = { vote_intention: 'vote_commitment' }
const TRIPWIRE_FAMILY_KIND = {
  role_claim: 'role_claim', not_mafia_claim: 'not_mafia_claim',
  investigation_claim: 'investigation_claim', protection_claim: 'protection_claim',
}

const FIELD_SCHEMAS = {
  role: { type: 'string', enum: ['mafia', 'doctor', 'detective', 'villager'], description: 'role_claim only' },
  target: { type: 'string', description: 'the named player the claim is about' },
  result: { type: 'string', enum: ['mafia', 'not mafia'], description: 'investigation_claim only' },
  claimedNight: { type: 'number', description: 'ONLY when the speaker states the night number' },
  referencedDay: { type: 'number', description: 'ONLY when the speaker states the day of the past vote' },
  conditional: { type: 'boolean', description: 'R3: the statement is guarded by an explicit condition' },
}

// Kind-specific required fields expressed in the schema itself (R13).
const finderItems = (strict) => strict
  ? {
      anyOf: KINDS.map((kind) => ({
        type: 'object',
        properties: { kind: { type: 'string', enum: [kind] }, quote: { type: 'string', description: 'EXACT verbatim substring of the message carrying the claim' }, ...FIELD_SCHEMAS },
        required: ['kind', 'quote', ...KIND_FIELDS[kind].required],
      })),
    }
  : {
      // Flat variant for cross-lab finders whose schema dialects reject anyOf;
      // R13 is still enforced in code after classification.
      type: 'object',
      properties: { kind: { type: 'string', enum: KINDS }, quote: { type: 'string' }, ...FIELD_SCHEMAS },
      required: ['kind', 'quote'],
    }
const finderTool = (strict) => ({
  name: 'report_candidates',
  description: 'Report every checkable first-person self-claim candidate in the message.',
  input_schema: { type: 'object', properties: { claims: { type: 'array', items: finderItems(strict) } }, required: ['claims'] },
})
const FINDER_TOOL = finderTool(true)
const FINDER_TOOL_FLAT = finderTool(false)

// One call classifies ALL of a message's candidates: the message text and
// the speaker's prior-message context are the expensive part of the prompt,
// and sending them once per candidate multiplied the corpus cost ~4-5x.
// Judgments stay per-candidate (one verdict per index, judged on its own
// merits); only the transport is shared.
const CLASSIFY_TOOL = {
  name: 'classify_candidates',
  description: 'Advisory classification of each numbered candidate proposition against one message.',
  input_schema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'number', description: 'the candidate number being judged; every candidate gets exactly one verdict' },
            asserted: { type: 'boolean', description: 'true ONLY if THIS message itself makes the assertion (R12b, R20)' },
            kind: { type: 'string', enum: KINDS, description: 'the correct kind under the codebook rules; omit when asserted=false' },
            quote: { type: 'string', description: 'EXACT verbatim substring of the message carrying the claim' },
            fields: { type: 'object', properties: FIELD_SCHEMAS },
            // v3.2 §1: fields are AUTHORITATIVE and complete. Omitting a field
            // deletes any candidate value for it; this list makes the deletion
            // explicit and separable in audit from a mere omission.
            deletedFields: {
              type: 'array',
              items: { type: 'string', enum: FIELD_NAMES },
              description: 'fields the candidate proposed that THIS message does not support — explicitly deleted',
            },
            resolvingContext: {
              type: 'object',
              properties: { seq: { type: 'number' }, text: { type: 'string' } },
              description: "R12b: when a field was resolved from the speaker's own prior public message, that message's seq and the resolving text",
            },
            note: { type: 'string' },
          },
          required: ['index', 'asserted'],
        },
      },
    },
    required: ['verdicts'],
  },
}

// The codebook rules a text judge needs, cited by number (§2.2).
const CODEBOOK = `A claim is a checkable FIRST-PERSON assertion by the speaker about the
speaker. Kinds:
- role_claim: positive first-person assertion of holding a specific role
  (role required). A denial of a specific role is NOT a role_claim (R11).
  Roster-header self-identifications ("Dylan, seat-8. Villager.", "Tim
  here, villager") ARE role claims (R21).
- not_mafia_claim: first-person denial of being mafia / assertion of being
  town with NO specific role named. If the same message claims a specific
  non-mafia role explicitly (villager, doctor, or detective — each entails
  "not mafia"), report ONLY the role_claim, never a separate
  not_mafia_claim.
- investigation_claim: an investigation the speaker asserts THEY performed
  as a detective ability — the message must tie the result to that ability:
  checking / investigating / a night-numbered result / an in-message or
  prior-message detective claim by the same speaker (R9). A bare accusation
  is not an investigation. target and result required; claimedNight only
  when stated; one claim per night/target pair.
- protection_claim: a protection the speaker asserts THEY performed as
  doctor (R10). "She lived" alone is an observation; "N2: Josie" inside the
  speaker's own protection log listing qualifies. target required;
  claimedNight only when stated.
- vote_commitment: explicit performative only — "I vote X" / "my vote is X"
  / "I'm voting X" / "I will vote X" / "voting X" / "vote: X" / "I'm
  locking X" / "final: X" and directly equivalent forms (R1). "Forced vote:
  X" qualifies; "forced" is commentary on the format, not a hedge (R6).
- vote_stance: everything vote-flavored below the commitment bar — "I'm on
  X", "I remain on X", "staying on X", "my top is X", "leaning X" (R2). A
  commitment guarded by an explicit condition is a vote_stance with
  conditional=true (R3).
- vote_retraction: first-person withdrawal of the speaker's own vote or
  commitment ("I'm taking my vote off X", "unvote").
- past_vote_claim: an ASSERTED past cast ballot; assertions of past public
  commitment or support without a ballot assertion are vote_stance (R7).
  referencedDay only when stated.
- past_vote_denial: first-person NEGATIVE ballot assertion ("I did not vote
  for X"). Statements that the speaker did not vote for X are never
  past_vote_claim(X) (R8).
Cross-cutting rules:
- Group statements ("let's vote X", "we should vote X") and table-directed
  imperatives are not claims about the speaker (R4); a conjunctive subject
  including the speaker ("Sam and I voted X") IS first-person (R5).
- Restating the speaker's own prior claim ("as I said, I'm the doctor") IS
  a fresh claim in this message; reporting someone ELSE's claim is not (R20).
- Targets, including pronouns and elided names, must be resolvable from the
  message itself or the speaker's own prior public messages (R12/R12b).
- Never claims about other players, questions, or pure hypotheticals.`

const FINDER_SYSTEM = `You find candidate self-claims in ONE public Mafia table message.
${CODEBOOK}
quote must be an EXACT verbatim substring of the message. Report each
distinct proposition once (R17); empty list when there are none. Use the
tool; no other output.`

const CLASSIFY_SYSTEM = `You classify EACH numbered candidate proposition against ONE public Mafia table message.
${CODEBOOK}
Return exactly one verdict per candidate index; judge every candidate on
its own merits, independently of the others. For each:
- asserted: true ONLY if THIS message itself makes the assertion (R12b).
  The speaker's prior messages may resolve FIELDS (target, claimedNight,
  referencedDay) — never the existence of the assertion.
- kind: correct the candidate's kind when the rules demand it (e.g. a
  conditional commitment is vote_stance with conditional=true under R3; an
  unresolvable-target vote statement is vote_stance WITHOUT target under R12).
- fields: only what the rules permit. Your fields are AUTHORITATIVE and
  COMPLETE: a field you omit is DELETED, whatever the candidate proposed, so
  restate every field the message supports. List in deletedFields any
  candidate field this message does not support. When a field was resolved
  from the speaker's prior public messages, report resolvingContext with that
  message's seq and the exact resolving text.
- claimedNight: ONLY when the message LITERALLY states a night number ("Night
  2", "N2"). Relative language — "last night", "overnight", "tonight",
  "yesterday" — NEVER converts to a night number; omit the field instead.
- quote: the EXACT verbatim substring of the message carrying the claim.
Use the tool; no other output.`

// ---------------------------------------------------------------------------
// Deterministic plumbing
// ---------------------------------------------------------------------------

const sha256 = (...parts) => {
  const h = createHash('sha256')
  for (const p of parts) h.update(p)
  return h.digest('hex')
}

const SPEC_PATH = new URL('../../../docs/analysis/analysis-v3-spec.md', import.meta.url)
const specSha256 = sha256(readFileSync(SPEC_PATH))
const LEXICON = buildLexicon()
const LEXICON_SHA = lexiconSha256(LEXICON)
const COMPILED_LEXICON = compileLexicon(LEXICON)

const finderConfig = {
  model: values.model,
  secondModel: values['second-model'] ?? null,
  maxMessages: MAX_MESSAGES,
  finderSystem: FINDER_SYSTEM,
  classifySystem: CLASSIFY_SYSTEM,
  tripwireVersion: TRIPWIRE_VERSION,
  tripwireLexiconSha256: LEXICON_SHA,
}
const schemasJson = JSON.stringify({ FINDER_TOOL, FINDER_TOOL_FLAT, CLASSIFY_TOOL })
const cacheKeyFor = (logBytes) =>
  sha256(logBytes, specSha256, schemasJson, JSON.stringify(finderConfig), EXTRACTOR_VERSION)

// Exported for the manifest's finder descriptor (§5): the exact prompt and
// schema material the cache keys bind, hash-pinned. Model-independent.
export const PROMPTS_SHA256 = sha256(FINDER_SYSTEM, '\n', CLASSIFY_SYSTEM)
export const SCHEMAS_SHA256 = sha256(schemasJson)

const writeAtomic = (path, data) => {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}
const writeJsonl = (path, records) =>
  writeAtomic(path, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''))

/** Extraction needs table names only; roles/models/outcome stay unseen (§2, R18). */
function logFacts(events) {
  const names = {}
  for (const e of events) {
    if (e.type === 'game_created') for (const s of e.payload.seats) names[s.id] = s.name
  }
  return { names }
}

/** R19: normalized matching LOCATES; the stored quote is exact source bytes. */
export function locateQuote(source, quote) {
  if (typeof quote !== 'string' || quote.length === 0) return null
  const exact = source.indexOf(quote)
  if (exact >= 0) return { quote, charStart: exact }
  const s = normalizeIndexed(source)
  const q = normalizeIndexed(quote)
  if (!q.text) return null
  const at = s.text.indexOf(q.text)
  if (at < 0) return null
  const start = s.map[at]
  const end = s.map[at + q.text.length - 1]
  return { quote: source.slice(start, end + 1), charStart: start }
}

/**
 * v3.2 §1: the classifier's field object, with its three states kept apart —
 * a VALUE, an EXPLICIT deletion (`null`/`''`, which the schema can carry), and
 * OMISSION (the key is absent). v3.1 collapsed the last two by discarding
 * nulls before a spread merge, which is how a candidate value survived a
 * classifier that disagreed with it.
 */
export function classifierFields(obj, deletedFields = []) {
  const present = {}
  const deleted = new Set(Array.isArray(deletedFields) ? deletedFields.filter((f) => FIELD_NAMES.includes(f)) : [])
  for (const f of FIELD_NAMES) {
    if (!obj || !(f in obj)) continue
    const v = obj[f]
    if (v === undefined || v === null || v === '') deleted.add(f)
    else present[f] = v
  }
  for (const f of deleted) delete present[f] // an explicit deletion wins over a stray value
  return { present, deleted: [...deleted] }
}

/** Back-compat shim for callers that only want the valued fields. */
const definedFields = (obj) => classifierFields(obj).present

/**
 * v3.2 §1: the classifier's fields are AUTHORITATIVE and complete. A field the
 * classifier omits is deleted; a field it emits as null/'' is deleted
 * explicitly; a field it values overrides whatever the candidate said. The
 * candidate-fill spread merge is retired — candidate fields are a hint TO the
 * classifier, never a fallback IN the record.
 *
 * Every dropped candidate value is written to an audit trail, so a field that
 * vanished between candidate and record is countable rather than invisible
 * (the sweep1-39 mechanism, audit row 4).
 *
 * Returns { fields, fieldAudit }.
 */
export function authoritativeFields(candFields = {}, machine = {}) {
  const { present, deleted } = classifierFields(machine.fields, machine.deletedFields)
  const deletedSet = new Set(deleted)
  const fieldAudit = []
  for (const f of FIELD_NAMES) {
    const candidateValue = candFields?.[f]
    if (candidateValue === undefined || candidateValue === null || candidateValue === '') continue
    if (!(f in present)) {
      fieldAudit.push({
        field: f,
        candidateValue,
        reason: deletedSet.has(f) ? 'classifier-deleted' : 'classifier-omitted',
      })
    } else if (!fieldEq(f, present[f], candidateValue)) {
      fieldAudit.push({ field: f, candidateValue, reason: 'classifier-corrected' })
    }
  }
  return { fields: { ...present }, fieldAudit }
}
const fieldEq = (f, a, b) =>
  f === 'target' ? String(a).trim().toLowerCase() === String(b).trim().toLowerCase() : a === b
const compatible = (a, b) =>
  FIELD_NAMES.every((f) => a[f] === undefined || b[f] === undefined || fieldEq(f, a[f], b[f]))

/**
 * R17: one proposition once. Same seq+kind with compatible fields merge; a
 * field-incomplete candidate merges into the complete one BEFORE anything is
 * classified or counted. Sources union; all quotes kept as location hints.
 */
export function mergeCandidates(candidates) {
  const groups = new Map()
  for (const c of candidates) {
    const key = `${c.seq}|${c.kind}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(c)
  }
  const merged = []
  for (const group of groups.values()) {
    group.sort((a, b) => Object.keys(b.fields).length - Object.keys(a.fields).length)
    const reps = []
    for (const c of group) {
      const rep = reps.find((r) => compatible(r.fields, c.fields))
      if (rep) {
        rep.fields = { ...c.fields, ...rep.fields }
        for (const s of c.sources) if (!rep.sources.includes(s)) rep.sources.push(s)
        for (const q of c.quotes) if (!rep.quotes.includes(q)) rep.quotes.push(q)
      } else {
        reps.push({ seq: c.seq, kind: c.kind, fields: { ...c.fields }, quotes: [...c.quotes], sources: [...c.sources] })
      }
    }
    merged.push(...reps)
  }
  return merged.sort((a, b) => a.seq - b.seq || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind))
}

async function pool(items, worker, limit) {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

async function callWithRetry(fn, tries = 4) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try { return await fn() } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, 1500 * (i + 1) + Math.floor(Math.random() * 500)))
    }
  }
  throw lastErr
}

// Models sometimes return the claims array as a JSON-encoded string; coerce
// rather than lose those messages' claims (or iterate a string char by char).
function coerceClaims(raw) {
  let claims = raw ?? []
  if (typeof claims === 'string') {
    try {
      const parsed = JSON.parse(claims)
      claims = Array.isArray(parsed) ? parsed : (parsed?.claims ?? [])
    } catch { claims = [] }
  }
  if (!Array.isArray(claims)) claims = []
  return claims.filter((c) => c !== null && typeof c === 'object' && !Array.isArray(c))
}

// ---------------------------------------------------------------------------
// Finder callers. The primary finder and the classifier are Anthropic; the
// §3.2 second model is cross-lab (openai / google), selected by model name,
// and lazily constructed so default runs touch one SDK only.
// ---------------------------------------------------------------------------

const envKey = (...names) => names.map((n) => process.env[n]).find(Boolean) ?? null

let anthropicClient = null
async function getAnthropic() {
  if (!anthropicClient) {
    const apiKey = envKey('MAFIA_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY')
    if (!apiKey) { console.error('set MAFIA_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY'); process.exit(1) }
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    anthropicClient = new Anthropic({ apiKey, maxRetries: 3 })
  }
  return anthropicClient
}

async function anthropicToolCall({ model, system, user, tool, maxTokens }) {
  const client = await getAnthropic()
  const res = await client.messages.create({
    model, max_tokens: maxTokens,
    // cache_control on the system block caches the whole static prefix
    // (tools + codebook) across calls — the ~2k-token codebook was being
    // re-billed on every one of thousands of calls without this.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    tools: [tool], tool_choice: { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content: user }],
  })
  addUsage(res.usage)
  const input = res.content.find((b) => b.type === 'tool_use')?.input
  return {
    input,
    raw: {
      stopReason: res.stop_reason, responseId: res.id,
      tokens: {
        input: res.usage?.input_tokens ?? 0, output: res.usage?.output_tokens ?? 0,
        cacheRead: res.usage?.cache_read_input_tokens ?? 0, cacheWrite: res.usage?.cache_creation_input_tokens ?? 0,
      },
    },
  }
}

async function makeSecondFinder(model) {
  if (/^(gpt|o\d)/.test(model)) {
    const apiKey = envKey('MAFIA_OPENAI_API_KEY', 'OPENAI_API_KEY')
    if (!apiKey) { console.error('second model needs MAFIA_OPENAI_API_KEY or OPENAI_API_KEY'); process.exit(1) }
    const { default: OpenAI } = await import('openai')
    const client = new OpenAI({ apiKey, maxRetries: 3 })
    // Responses API, not chat-completions: current GPT models reject function
    // tools alongside reasoning on the chat endpoint ("use /v1/responses…"),
    // exactly as the seat adapter (packages/seats/src/providers/openai.ts)
    // found on the first live cross-provider game. Reasoning shares the
    // output budget, so the token floor is generous.
    return async ({ system, user }) => {
      const res = await client.responses.create({
        model,
        instructions: system,
        input: [{ role: 'user', content: user }],
        tools: [{ type: 'function', name: FINDER_TOOL_FLAT.name, description: FINDER_TOOL_FLAT.description, parameters: FINDER_TOOL_FLAT.input_schema, strict: false }],
        tool_choice: { type: 'function', name: FINDER_TOOL_FLAT.name },
        parallel_tool_calls: false,
        max_output_tokens: 8192,
        store: false,
      })
      const call = res.output.find((i) => i.type === 'function_call')
      let input = {}
      try { input = JSON.parse(call?.arguments ?? '{}') } catch { input = {} }
      return { input, raw: { stopReason: res.status, responseId: res.id ?? null } }
    }
  }
  if (/^gemini/.test(model)) {
    const apiKey = envKey('MAFIA_GEMINI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY')
    if (!apiKey) { console.error('second model needs MAFIA_GEMINI_API_KEY, GEMINI_API_KEY or GOOGLE_API_KEY'); process.exit(1) }
    const { GoogleGenAI } = await import('@google/genai')
    const ai = new GoogleGenAI({ apiKey })
    return async ({ system, user }) => {
      const res = await ai.models.generateContent({
        model,
        contents: user,
        config: {
          systemInstruction: system,
          maxOutputTokens: 2000,
          tools: [{ functionDeclarations: [{ name: FINDER_TOOL_FLAT.name, description: FINDER_TOOL_FLAT.description, parametersJsonSchema: FINDER_TOOL_FLAT.input_schema }] }],
          toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [FINDER_TOOL_FLAT.name] } },
        },
      })
      const call = res.functionCalls?.[0]
      return { input: call?.args ?? {}, raw: { stopReason: res.candidates?.[0]?.finishReason, responseId: res.responseId ?? null } }
    }
  }
  console.error(`--second-model ${model}: no cross-lab provider mapping (expected gpt-* or gemini-*)`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Candidate sources
// ---------------------------------------------------------------------------

/** Source 1 — recycle the archived v2 ledger: claims AND rejects, all kinds
 * (published families feed the ledger path; shelved families are carried
 * through classification so they are recorded, §2.1). Finder, never scorer. */
function v2Candidates(seed, v2Dir) {
  const out = []
  const push = (kind, rec) => {
    const mapped = V2_KIND_MAP[kind] ?? kind
    if (!KIND_FIELDS[mapped] || typeof rec.quote !== 'string' || typeof rec.seq !== 'number') return
    out.push({ seq: rec.seq, kind: mapped, fields: definedFields(rec), quotes: [rec.quote], sources: ['v2'] })
  }
  const claimsPath = join(v2Dir, `${seed}.claims.jsonl`)
  if (existsSync(claimsPath)) {
    for (const line of readFileSync(claimsPath, 'utf8').split('\n')) {
      if (!line.trim()) continue
      const rec = JSON.parse(line)
      if (rec._meta) continue
      push(rec.kind, rec)
    }
  }
  const rejectsPath = join(v2Dir, `${seed}.rejects.jsonl`)
  if (existsSync(rejectsPath)) {
    for (const line of readFileSync(rejectsPath, 'utf8').split('\n')) {
      if (!line.trim()) continue
      const rec = JSON.parse(line)
      const c = rec.claim
      if (!c || typeof c !== 'object' || typeof c.quote !== 'string') continue
      push(c.kind, { ...c, seq: rec.seq })
    }
  }
  return out
}

/** Source 2 — tripwire: any published-family lexicon hit on the normalized
 * message text (§3.1) nominates a fieldless candidate for classification. */
function tripwireCandidates(message) {
  const hits = lexiconHits(normalizeIndexed(message.payload.text).text, COMPILED_LEXICON)
  return hits.map((h) => {
    const located = locateQuote(message.payload.text, h.match)
    return {
      seq: message.seq, kind: TRIPWIRE_FAMILY_KIND[h.family], fields: {},
      quotes: [located?.quote ?? h.match], sources: ['tripwire'],
    }
  })
}

// ---------------------------------------------------------------------------
// Per-seed extraction
// ---------------------------------------------------------------------------

const renderFields = (fields) =>
  Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ') || '(none)'

const messagePrompt = (facts, m, priors) => {
  const speaker = facts.names[m.actor] ?? m.actor
  const others = Object.values(facts.names).filter((n) => n !== speaker).join(', ')
  const priorBlock = priors.length
    ? priors.map((p) => `[seq ${p.seq}] """${p.payload.text}"""`).join('\n')
    : '(none)'
  return { speaker, others, priorBlock }
}

async function extractSeed(path, opts) {
  const { outDir, v2Dir, secondFinder } = opts
  const seed = basename(path, '.jsonl')
  const logBytes = readFileSync(path)
  const events = logBytes.toString('utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  if (!events.some((e) => e.type === 'game_created')) return { seed, status: 'not-a-game' }
  const facts = logFacts(events)
  const cacheKey = cacheKeyFor(logBytes)

  // Named .claims.jsonl — the filename handcheck-v3 and check-gates consume.
  // The v2 archive uses the same suffix in a DIFFERENT directory; the main
  // block refuses out-dir === v2-dir so the archive can never be overwritten.
  const candidatesPath = join(outDir, `${seed}.claims.jsonl`)
  const negativesPath = join(outDir, `${seed}.negatives.jsonl`)
  const rejectsPath = join(outDir, `${seed}.rejects.jsonl`)
  const rawPath = join(outDir, `${seed}.raw.jsonl`)

  let messages = events
    .filter((e) => e.type === 'message_sent' && e.visibility === 'public')
    .sort((a, b) => a.seq - b.seq)
  const sliced = MAX_MESSAGES !== null && messages.length > MAX_MESSAGES
  if (MAX_MESSAGES !== null) messages = messages.slice(0, MAX_MESSAGES)
  const msgBySeq = new Map(messages.map((m) => [m.seq, m]))
  const priorsBySeat = new Map()
  const priorsFor = new Map() // seq -> speaker's prior public messages (R12b context)
  for (const m of messages) {
    const prior = priorsBySeat.get(m.actor) ?? []
    priorsFor.set(m.seq, [...prior])
    prior.push(m)
    priorsBySeat.set(m.actor, prior)
  }

  // Cache: reuse only a complete file whose content-addressed key matches.
  // Invalid, stale, or incomplete cache -> re-extract (fail-closed).
  if (!values.dry && existsSync(candidatesPath)) {
    let meta = null
    try { meta = JSON.parse(readFileSync(candidatesPath, 'utf8').split('\n')[0]) } catch { meta = null }
    if (meta?._meta && meta.cacheKey === cacheKey && meta.unprocessedMessages === 0 &&
        existsSync(negativesPath) && existsSync(rawPath)) {
      console.log(`${seed}: cached (key match), skipping`)
      return { seed, status: 'cached' }
    }
    console.log(`${seed}: cache invalid or stale, re-extracting`)
    for (const p of [candidatesPath, negativesPath, rejectsPath, rawPath]) rmSync(p, { force: true })
  }

  // Offline candidate sources.
  const rejects = []
  const offline = []
  for (const c of v2Candidates(seed, v2Dir)) {
    if (msgBySeq.has(c.seq)) offline.push(c)
    // Under a --max-messages calibration slice, out-of-slice candidates are
    // expected and dropped; on a full run an unknown seq is a logged reject.
    else if (!sliced) rejects.push({ seed, seq: c.seq, reason: 'v2 candidate seq is not a public message in this log', candidate: c })
  }
  for (const m of messages) offline.push(...tripwireCandidates(m))

  if (values.dry) {
    const preMerged = mergeCandidates(offline)
    const finderCalls = messages.length * (values['second-model'] ? 2 : 1)
    console.log(`${seed}: DRY plan — messages=${messages.length}${sliced ? ` (sliced to ${MAX_MESSAGES})` : ''} v2+tripwire candidates=${offline.length} merged=${preMerged.length} finderCalls=${finderCalls} classifyCalls>=${preMerged.length} (model sweep adds more) cacheKey=${cacheKey.slice(0, 16)}…`)
    return { seed, status: 'dry' }
  }

  // Per-seed lockfile: two extractors on one seed corrupt caches (§3).
  const lockPath = join(outDir, `${seed}.lock`)
  mkdirSync(outDir, { recursive: true })
  try {
    writeFileSync(lockPath, `${process.pid}\n`, { flag: 'wx' })
  } catch (err) {
    if (err?.code === 'EEXIST') {
      console.error(`${seed}: lockfile exists (${lockPath}) — another extractor owns this seed; refusing`)
      return { seed, status: 'locked' }
    }
    throw err
  }

  try {
    const raw = []
    let unprocessed = 0

    // Source 3 — the model sweep over EVERY public message.
    const swept = await pool(messages, async (m) => {
      const { speaker, others } = messagePrompt(facts, m, [])
      const user = `Game context: day ${m.day}. Speaker: ${speaker}. Other players: ${others}.\n\nMessage by ${speaker}:\n"""${m.payload.text}"""`
      const found = []
      const passes = [
        { source: 'model', run: () => anthropicToolCall({ model: values.model, system: FINDER_SYSTEM, user, tool: FINDER_TOOL, maxTokens: 2000 }) },
        ...(secondFinder ? [{ source: 'model2', run: () => secondFinder({ system: FINDER_SYSTEM, user }) }] : []),
      ]
      for (const pass of passes) {
        let res
        try {
          res = await callWithRetry(pass.run)
        } catch (err) {
          unprocessed += 1
          raw.push({ seq: m.seq, source: pass.source, error: String(err).slice(0, 300) })
          return found
        }
        const claims = coerceClaims(res.input?.claims)
        raw.push({ seq: m.seq, source: pass.source, ...res.raw, claims })
        for (const c of claims) {
          if (!KIND_FIELDS[c.kind] || typeof c.quote !== 'string') {
            rejects.push({ seed, seq: m.seq, reason: 'finder emitted unknown kind or missing quote', candidate: c })
            continue
          }
          found.push({ seq: m.seq, kind: c.kind, fields: definedFields(c), quotes: [c.quote], sources: [pass.source] })
        }
      }
      return found
    }, CONC)

    // R17 merge across ALL sources BEFORE classification: one proposition,
    // one classification call, sources[] recorded.
    const merged = mergeCandidates([...offline, ...swept.flat()])

    // Advisory classification — one structured call per MESSAGE, covering
    // all of that message's merged candidates (the message + prior-context
    // block dominates the prompt; billing it once per candidate multiplied
    // corpus cost ~4-5x). A missing index gets one corrective retry, then
    // fails the seed: partial classification must never pass as complete.
    let classifyFailures = 0
    const bySeq = new Map()
    for (const cand of merged) {
      if (!bySeq.has(cand.seq)) bySeq.set(cand.seq, [])
      bySeq.get(cand.seq).push(cand)
    }
    const classifyOne = async ([seq, cands]) => {
      const m = msgBySeq.get(seq)
      const { speaker, others, priorBlock } = messagePrompt(facts, m, priorsFor.get(m.seq) ?? [])
      const candBlock = cands.map((cand, i) =>
        `--- candidate ${i} ---
kind hint: ${cand.kind}
fields hint: ${renderFields(cand.fields)}
quote hint(s): ${cand.quotes.map((q) => JSON.stringify(q)).join(' | ')}
nominated by: ${cand.sources.join(', ')}`).join('\n')
      const user = `Day ${m.day}. Speaker: ${speaker}. Other players: ${others}.

=== THE MESSAGE (only this text can assert; R12b) ===
"""${m.payload.text}"""

=== ${speaker.toUpperCase()}'S PRIOR PUBLIC MESSAGES (field resolution only, R12b) ===
${priorBlock}

=== CANDIDATE PROPOSITIONS (one verdict per index) ===
${candBlock}

Classify every candidate against THE MESSAGE.`
      const call = () => anthropicToolCall({
        model: values.model, system: CLASSIFY_SYSTEM, user, tool: CLASSIFY_TOOL,
        maxTokens: Math.min(8192, 800 + 200 * cands.length),
      })
      let verdicts = null
      let res
      for (let attempt = 0; attempt < 2 && !verdicts; attempt++) {
        try {
          res = await callWithRetry(call)
        } catch (err) {
          classifyFailures += 1
          raw.push({ seq, classifyBatch: cands.length, error: String(err).slice(0, 300) })
          return null
        }
        // Same coercion the finder path has needed since v2: models
        // sometimes return the array as a JSON-encoded string, and index
        // as a numeric string. Both are transport noise, not judgment.
        let list = res.input?.verdicts ?? []
        if (typeof list === 'string') { try { list = JSON.parse(list) } catch { list = [] } }
        if (!Array.isArray(list)) list = []
        const byIndex = new Map(list
          .map((v) => (v && typeof v === 'object' ? { ...v, index: Number(v.index) } : v))
          .filter((v) => Number.isInteger(v?.index))
          .map((v) => [v.index, v]))
        if (cands.every((_, i) => byIndex.has(i))) verdicts = byIndex
        else raw.push({ seq, classifyBatch: cands.length, ...res.raw, retry: 'missing verdict indices', got: [...byIndex.keys()] })
      }
      if (!verdicts) {
        classifyFailures += 1
        raw.push({ seq, classifyBatch: cands.length, error: 'verdicts incomplete after retry' })
        return null
      }
      raw.push({ seq, classifyBatch: cands.length, ...res.raw, verdicts: [...verdicts.values()] })
      return cands.map((cand, i) => {
        const v = verdicts.get(i)
        const authoritative = classifierFields(v.fields ?? {}, v.deletedFields)
        const machine = {
          asserted: v.asserted === true,
          kind: KIND_FIELDS[v.kind] ? v.kind : null,
          fields: authoritative.present,
          ...(authoritative.deleted.length ? { deletedFields: authoritative.deleted } : {}),
          ...(v.resolvingContext && typeof v.resolvingContext.seq === 'number'
            ? { resolvingContext: { seq: v.resolvingContext.seq, text: String(v.resolvingContext.text ?? '') } }
            : {}),
        }
        // The claim record's machine block is the spec shape exactly; the
        // classifier's quote is a location hint, carried beside it.
        return { cand, machine, machineQuote: typeof v.quote === 'string' ? v.quote : null, message: m }
      })
    }
    const classified = (await pool([...bySeq.entries()], classifyOne, CONC)).flatMap((rows) => rows ?? [null])

    if (unprocessed > 0 || classifyFailures > 0 || classified.some((c) => c === undefined)) {
      // Fail-closed: raw kept for the audit trail, but no candidates file —
      // partial coverage must never look like completed extraction (§3).
      writeJsonl(rawPath, raw)
      console.error(`${seed}: FAILED — ${unprocessed} unprocessed messages, ${classifyFailures} classification failures; no candidates file written`)
      return { seed, status: 'failed' }
    }

    const positives = []
    const negatives = []
    for (const row of classified) {
      if (!row) continue
      const { cand, machine, machineQuote, message } = row
      const base = { seed, game: path, seq: cand.seq, seat: message.actor, day: message.day }
      if (!machine.asserted) {
        negatives.push({ ...base, candidate: { kind: cand.kind, fields: cand.fields, quotes: cand.quotes, sources: cand.sources }, machine })
        continue
      }
      // §6 confirm-all-positives: a machine-POSITIVE whose kind is missing or
      // out of enum is a malformed classification, not a negative — routing
      // it to the sampled negative pool would let it bypass human review.
      if (!machine.kind) {
        rejects.push({ ...base, reason: 'classifier asserted=true with missing or unknown kind (§6: positives never enter the negative pool)', candidate: cand, machine })
        continue
      }
      const kind = machine.kind
      // v3.2 §1: classifier fields are authoritative — an omitted field DELETES
      // the candidate's value rather than inheriting it. Every dropped
      // candidate value lands in fieldAudit.
      const { fields, fieldAudit } = authoritativeFields(cand.fields, machine)
      const missing = KIND_FIELDS[kind].required.filter((f) => fields[f] === undefined)
      if (missing.length > 0) {
        rejects.push({ ...base, reason: `R13: ${kind} missing required ${missing.join(', ')}`, candidate: cand, machine, fieldAudit })
        continue
      }
      // Pin the quote (R19): classifier's quote first, then source hints.
      let pin = null
      for (const q of [machineQuote, ...cand.quotes]) {
        pin = locateQuote(message.payload.text, q)
        if (pin) break
      }
      if (!pin) {
        rejects.push({ ...base, reason: 'R19: quote not locatable in source message', candidate: cand, machine })
        continue
      }
      // v3.2 §10 (as revised): the admissibility bars are ADVISORY. A flagged
      // candidate proceeds to adjudication carrying its advisory — the sheet
      // shows it, and only a human ruling removes the claim. The first
      // implementation rejected barred candidates here, which let over-firing
      // regexes silently delete legitimate claims before any human saw them.
      const advisory = barFor(kind, { quote: pin.quote })
      // v3.2 §2: a claimedNight the message does not LITERALLY state was
      // inferred, not stated. Strike it here and record the strike — the claim
      // stays scorable under R15's seq guard alone.
      if (fields.claimedNight !== undefined && !nightIsStated(fields.claimedNight, message.payload.text)) {
        fieldAudit.push({ field: 'claimedNight', candidateValue: fields.claimedNight, reason: 'unstated-night' })
        delete fields.claimedNight
      }
      const allowed = [...KIND_FIELDS[kind].required, ...KIND_FIELDS[kind].optional]
      const record = { ...base, charStart: pin.charStart, kind }
      for (const f of allowed) if (fields[f] !== undefined) record[f] = fields[f]
      record.quote = pin.quote
      record.sources = cand.sources
      record.machine = machine
      if (advisory) { record.advisory = advisory; record.advisoryReason = BAR_REASONS[advisory] }
      if (fieldAudit.length) record.fieldAudit = fieldAudit
      positives.push(record)
    }

    // R17 holds AFTER classification too: candidates nominated under
    // different family hints (e.g. "I'm the doctor" trips both the role and
    // protection lexicons) can reclassify to the SAME kind, and the pre-
    // classification merge keyed on the hint kind cannot see that.
    //
    // v3.2 §1/§4: two records merge only when their classifier fields are
    // IDENTICAL — same defined set, same values. A field-fill merge here would
    // be a second candidate-fill (the retired mechanism): it wrote top-level
    // fields absent from the survivor's machine.fields, so the archived
    // reading failed its own §4 projection, and it could re-supply a night the
    // §2 strike had just removed. Records that agree only partially stay
    // separate readings; the scorer's R17 merge handles one-proposition-once.
    const identicalFields = (a, b) => FIELD_NAMES.every((f) =>
      (a[f] === undefined) === (b[f] === undefined) && (a[f] === undefined || fieldEq(f, a[f], b[f])))
    const dedupedPositives = []
    for (const rec of positives) {
      const dup = dedupedPositives.find((r) =>
        r.seq === rec.seq && r.kind === rec.kind && identicalFields(r, rec))
      if (!dup) {
        dedupedPositives.push(rec)
        continue
      }
      for (const s of rec.sources) if (!dup.sources.includes(s)) dup.sources.push(s)
    }

    const meta = {
      _meta: true, seed, game: path,
      extractorVersion: EXTRACTOR_VERSION, finderModel: values.model,
      secondModel: values['second-model'] ?? null,
      specSha256, cacheKey, tripwireLexiconSha256: LEXICON_SHA,
      messages: messages.length, maxMessages: MAX_MESSAGES,
      candidates: dedupedPositives.length, negatives: negatives.length, rejects: rejects.length,
      unprocessedMessages: 0, extractedAt: new Date().toISOString(),
    }
    writeJsonl(rawPath, raw)
    writeAtomic(candidatesPath, [meta, ...dedupedPositives].map((r) => JSON.stringify(r)).join('\n') + '\n')
    writeAtomic(negativesPath, [meta, ...negatives].map((r) => JSON.stringify(r)).join('\n') + '\n')
    writeJsonl(rejectsPath, rejects)
    console.log(`${seed}: ${messages.length} messages -> ${dedupedPositives.length} candidates, ${negatives.length} negatives, ${rejects.length} rejects — running: ${costLine(values.model)}`)
    return { seed, status: 'ok' }
  } finally {
    rmSync(lockPath, { force: true })
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (isMain) {
  if (resolve(values['out-dir']) === resolve(values['v2-dir'])) {
    console.error('refusing: --out-dir equals --v2-dir — the v2 archive is frozen evidence and both use {seed}.claims.jsonl')
    process.exit(1)
  }
  const targets = positionals.filter((p) => !GAMES || GAMES.has(basename(p, '.jsonl')))
  if (targets.length === 0) {
    console.error('no logs selected (check --games against the given paths)')
    process.exit(1)
  }
  if (!values.dry && ABORT_DOLLARS > 0 && !PRICES[values.model]) {
    console.error(`no price table for ${values.model}: a nonzero --abort-dollars cannot be enforced.\n` +
      `Add the model to PRICES, or run uncapped EXPLICITLY with --abort-dollars 0.`)
    process.exit(1)
  }
  if (!values.dry) await getAnthropic() // key check up front, before any lock
  const secondFinder = !values.dry && values['second-model'] ? await makeSecondFinder(values['second-model']) : null

  let failed = 0
  let capped = false
  for (const path of targets) {
    const spent = estCost(values.model)
    if (ABORT_DOLLARS > 0 && spent !== null && spent >= ABORT_DOLLARS) {
      console.error(`abort: estimated spend $${spent.toFixed(2)} crossed the --abort-dollars ${ABORT_DOLLARS} cap — stopping before ${basename(path, '.jsonl')}; completed seeds are cached`)
      capped = true
      break
    }
    const res = await extractSeed(path, { outDir: values['out-dir'], v2Dir: values['v2-dir'], secondFinder })
    if (res.status === 'failed' || res.status === 'locked') failed += 1
  }
  console.log(`total: ${costLine(values.model)}`)
  if (failed > 0 || capped) {
    if (failed > 0) console.error(`${failed} seed(s) failed or locked`)
    process.exit(1)
  }
}
