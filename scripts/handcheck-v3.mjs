// Human-validation harness for analysis v3 (§6 of docs/analysis/analysis-v3-spec.md).
//
// Three modes:
//   positives  Confirm-all sheets (§6.1): EVERY machine-positive in the four
//              published families, plus every machine-REJECTED investigation/
//              protection candidate in a clearly-marked subsection — they are
//              rare and headline-carrying, so 100% of them are human-reviewed
//              whether accepted or rejected. Verdict-blind: the sheet shows
//              the complete message, the speaker's table name, the day, the
//              extracted fields, and any R12b resolving context — never truth
//              verdicts, roles, models, or game outcomes. Sheets chunk at
//              ~100 items per file, one human sitting each.
//   negatives  §6.2 sample: 80–120 machine-negative messages, stratified
//              across games and models, oversampling power-role-adjacent
//              text (night-number tokens plus detective/doctor vocabulary
//              from the scripts/tripwire.mjs lexicon). The rater lists every
//              claim they see; misses are measured against the sealed key by
//              scripts/agreement.mjs.
//   ingest     Merge a filled rulings file back onto the sealed key,
//              producing the confirmed-ledger input: every claim gains
//              structured { human: { rater, confirmed, note } }. Confirm-all
//              means every key item must carry a ruling — a gap is exit 1.
//
// Sampling and presentation order are deterministic (sha256 over the --seed
// plus NUL-delimited item identity): sheets are reproducible and cannot be
// quietly re-rolled until they flatter.
//
//   node scripts/handcheck-v3.mjs positives --candidates runs/analysis-v3/extract \
//        --logs runs/sweep-download/sweep1 --manifest runs/analysis-v3/manifest.json \
//        --out runs/analysis-v3/handcheck
//   node scripts/handcheck-v3.mjs negatives --candidates runs/analysis-v3/extract \
//        --logs runs/sweep-download/sweep1 --manifest runs/analysis-v3/manifest.json \
//        --count 100 --out runs/analysis-v3/handcheck
//   node scripts/handcheck-v3.mjs ingest --key runs/analysis-v3/handcheck/sealed-key.jsonl \
//        --ratings runs/analysis-v3/handcheck/ryan-ratings.json \
//        --out runs/analysis-v3/ledger/confirmed-input.jsonl
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { checkExtractionMeta } from './analysis-manifest.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    candidates: { type: 'string' },
    logs: { type: 'string' },
    manifest: { type: 'string' },
    out: { type: 'string', default: 'runs/analysis-v3/handcheck' },
    chunk: { type: 'string', default: '100' },
    count: { type: 'string', default: '100' },
    seed: { type: 'string', default: 'handcheck-v3-1' },
    tripwire: { type: 'string', default: join(HERE, 'tripwire.mjs') },
    key: { type: 'string' },
    ratings: { type: 'string' },
    // Offline dry-runs only (e.g. against the archived v2 extract dir, whose
    // metas carry no cacheKey/specSha256). Real v3 claims metas must pass
    // checkExtractionMeta against the manifest (§5).
    'allow-unstamped': { type: 'boolean', default: false },
  },
})

const MODE = positionals[0]
const USAGE = `usage:
  node scripts/handcheck-v3.mjs positives --candidates dir --logs dir --manifest manifest.json [--out dir] [--chunk 100] [--seed s]
  node scripts/handcheck-v3.mjs negatives --candidates dir --logs dir --manifest manifest.json [--count 80..120] [--out dir] [--tripwire path] [--seed s]
  node scripts/handcheck-v3.mjs ingest    --key sealed-key.jsonl --ratings rater.json --out confirmed.jsonl`
const fail = (msg) => { console.error(msg); process.exit(1) }
if (!['positives', 'negatives', 'ingest'].includes(MODE)) fail(USAGE)

const PUBLISHED = new Set(['role_claim', 'not_mafia_claim', 'investigation_claim', 'protection_claim'])
const POWER_KINDS = new Set(['investigation_claim', 'protection_claim'])
const FIELD_ORDER = ['role', 'target', 'result', 'claimedNight', 'referencedDay', 'conditional']

// Seeded hash: sha256 over the --seed then the NUL-joined identity parts —
// the '\x00' delimiter keeps distinct part tuples distinct — so ordering is
// fixed by (--seed, item identity) and nothing else.
const h = (parts) => createHash('sha256').update(values.seed).update('\x00' + parts.join('\x00')).digest('hex')
// R19-style normalization: used only to LOCATE lexicon vocabulary, never to
// alter stored text.
const norm = (s) => String(s).normalize('NFKC')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .toLowerCase().replace(/\s+/g, ' ')

const writeAtomic = (path, content) => {
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, content)
  renameSync(tmp, path)
}
const readJsonl = (path) => readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))

function loadManifest() {
  if (!values.manifest) fail(USAGE)
  const m = JSON.parse(readFileSync(values.manifest, 'utf8'))
  if (typeof m.analysisRunId !== 'string' || !m.analysisRunId) fail(`${values.manifest}: no analysisRunId (§5)`)
  return m
}

/** Per-seed table facts from the frozen logs: display names, models, and the
 *  complete public message record — the sheet must show the whole message. */
function loadLogs(dir) {
  const games = new Map()
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.jsonl') && f !== 'manifest.jsonl').sort()) {
    const seed = basename(f, '.jsonl')
    const names = {}
    const models = {}
    const messages = new Map()
    for (const e of readJsonl(join(dir, f))) {
      const p = e.payload ?? {}
      if (e.type === 'game_created') for (const s of p.seats ?? []) names[s.id] = s.name
      if (e.type === 'seat_bound') models[p.seat] = p.modelKey
      if (e.type === 'message_sent') messages.set(e.seq, { text: p.text, day: e.day, actor: e.actor })
    }
    games.set(seed, { names, models, messages })
  }
  if (games.size === 0) fail(`no logs found in ${dir}`)
  return games
}

/** Reads the extract-v3 output dir: <seed>.claims.jsonl (machine-positives),
 *  <seed>.rejects.jsonl (machine-rejected candidates), and optional
 *  <seed>.negatives.jsonl (the extractor's own machine-negative accounting).
 *  Reject records come v3-shaped ({seed, seq, reason, candidate, machine} —
 *  the proposition nested, fields under candidate.fields), v2-shaped
 *  ({seq, reason, claim:{...}}), or flat. Binding rule (§5 fail-closed):
 *  extraction outputs are archived instrument readings whose hashes feed
 *  INTO the analysisRunId, so their metas cannot carry it; claims metas bind
 *  to the manifest through checkExtractionMeta (spec sha at freeze, finder
 *  model, complete message coverage) instead. A meta that DOES carry a runId
 *  must still match. Rejects files carry no meta; negatives metas are
 *  checked when stamped. */
function loadCandidates(dir, manifest) {
  const claims = []
  const rejects = []
  const negativeKeys = new Set() // `${seed}|${seq}` from *.negatives.jsonl
  const candidatesBySeq = new Map() // `${seed}|${seq}` -> [{kind, target, ...}]
  let negativesFiles = 0

  const checkMeta = (file, meta, metaRequired) => {
    const stamped = meta && typeof meta.analysisRunId === 'string'
    if (stamped && meta.analysisRunId !== manifest.analysisRunId) {
      fail(`${file}: analysisRunId ${meta.analysisRunId} != manifest ${manifest.analysisRunId} (§5)`)
    }
    if (!metaRequired || values['allow-unstamped']) return
    if (!meta) fail(`${file}: no meta line (§5 fail-closed). Rerun extract-v3, or pass --allow-unstamped for an offline dry-run.`)
    try {
      checkExtractionMeta(manifest, meta)
    } catch (e) {
      fail(`${file}: ${(e.errors ?? [e.message]).join('; ')} (§5 fail-closed). Rerun extract-v3, or pass --allow-unstamped for an offline dry-run.`)
    }
  }
  // machineDecision travels into the negatives sealed key: agreement.mjs
  // must credit the machine only for ACCEPTED claims, never rejected ones.
  const note = (c, machineDecision) => {
    const k = `${c.seed}|${c.seq}`
    if (!candidatesBySeq.has(k)) candidatesBySeq.set(k, [])
    candidatesBySeq.get(k).push({ kind: c.kind, target: c.target, role: c.role, result: c.result, machineDecision })
  }

  const files = readdirSync(dir).sort()
  for (const f of files.filter((f) => f.endsWith('.claims.jsonl'))) {
    const seed = basename(f, '.claims.jsonl')
    const lines = readJsonl(join(dir, f))
    checkMeta(join(dir, f), lines.find((r) => r._meta), true)
    for (const r of lines.filter((r) => !r._meta)) {
      if (!r.kind) fail(`${f}: claim record without kind at seq ${r.seq}`)
      if (r.machine && r.machine.asserted === false) continue // not a machine-positive
      const c = { ...r, seed: r.seed ?? seed }
      claims.push(c)
      note(c, 'accepted')
    }
  }
  for (const f of files.filter((f) => f.endsWith('.rejects.jsonl'))) {
    const seed = basename(f, '.rejects.jsonl')
    const lines = readJsonl(join(dir, f))
    checkMeta(join(dir, f), lines.find((r) => r._meta), false)
    for (const raw of lines.filter((r) => !r._meta)) {
      // v3 rejects nest the proposition under candidate ({kind, fields,
      // quotes, sources}) with the classifier's view under machine; v2
      // rejects nest it under claim with flat fields.
      const c = raw.claim ?? raw.candidate ?? raw
      const fields = { ...(c.fields ?? {}), ...(raw.machine?.fields ?? {}) }
      const r = {
        seed: raw.seed ?? c.seed ?? seed, seq: raw.seq ?? c.seq,
        // Provenance identity travels with the reject: the review found that
        // dropping `seat` here made every §6.1 reject recovery unscorable at
        // build-ledger's `!r.seat` filter — the recovery feature was a no-op.
        seat: raw.seat ?? c.seat, day: raw.day ?? c.day,
        game: raw.game ?? c.game ?? null,
        kind: raw.kind ?? c.kind ?? raw.machine?.kind ?? null,
        role: c.role ?? fields.role, target: c.target ?? fields.target,
        result: c.result ?? fields.result,
        claimedNight: c.claimedNight ?? fields.claimedNight,
        referencedDay: c.referencedDay ?? fields.referencedDay,
        quote: c.quote ?? (Array.isArray(c.quotes) ? c.quotes[0] : undefined),
        sources: raw.sources ?? c.sources,
        machine: raw.machine ?? c.machine,
        rejectReason: raw.reason ?? c.reason ?? null,
      }
      rejects.push(r)
      note(r, 'rejected')
    }
  }
  for (const f of files.filter((f) => f.endsWith('.negatives.jsonl'))) {
    const seed = basename(f, '.negatives.jsonl')
    const lines = readJsonl(join(dir, f))
    checkMeta(join(dir, f), lines.find((r) => r._meta), false)
    negativesFiles++
    for (const r of lines.filter((r) => !r._meta)) negativeKeys.add(`${r.seed ?? seed}|${r.seq}`)
  }
  if (claims.length === 0 && rejects.length === 0) fail(`no *.claims.jsonl / *.rejects.jsonl in ${dir}`)
  return { claims, rejects, negativeKeys, negativesFiles, candidatesBySeq }
}

const fieldsLine = (c) => FIELD_ORDER
  .filter((k) => c[k] !== undefined && c[k] !== null)
  .map((k) => `${k}=${c[k]}`).join(' · ')

const resolvingContext = (c) => {
  const rc = c.machine?.resolvingContext
  if (!rc) return null
  if (typeof rc === 'string') return { seq: null, text: rc }
  return { seq: rc.seq ?? rc.sourceSeq ?? null, text: rc.text ?? rc.quote ?? JSON.stringify(rc) }
}

/** One sheet item. Blind by construction (§6.1): only message, speaker table
 *  name, day, extracted fields, and R12b resolving context are rendered. */
function renderClaimItem(it, games) {
  const g = games.get(it.seed)
  if (!g) fail(`no log for seed ${it.seed}`)
  const msg = g.messages.get(it.seq)
  if (!msg) fail(`${it.seed}: no message_sent at seq ${it.seq} (candidate/log mismatch)`)
  const speaker = g.names[msg.actor] ?? msg.actor
  const f = fieldsLine(it)
  const lines = [`**${it.item}.** [${it.kind}${f ? ' · ' + f : ''}] — day ${msg.day}, speaker ${speaker}`]
  for (const l of String(msg.text).split('\n')) lines.push(`> ${l}`)
  lines.push('')
  if (it.quote) lines.push(`    claimed span: "${it.quote}"`)
  const rc = resolvingContext(it)
  // R12b: every resolution from the speaker's own prior messages displays its
  // resolving seq and text on the sheet.
  if (rc) lines.push(`    R12b resolving context — speaker's own prior message${rc.seq != null ? ` (seq ${rc.seq})` : ''}: "${rc.text}"`)
  lines.push('    verdict: OK / BAD    note:', '')
  return lines
}

function renderNegativeItem(it, games) {
  const g = games.get(it.seed)
  const speaker = g.names[it.actor] ?? it.actor
  const lines = [`**${it.item}.** day ${it.day}, speaker ${speaker}`]
  for (const l of String(it.text).split('\n')) lines.push(`> ${l}`)
  lines.push('', '    claims seen: NONE / list each as kind(field=value, ...):', '')
  return lines
}

const REJECT_SECTION_HEADER = [
  '---',
  '## Machine-rejected investigation/protection candidates',
  '',
  'The machine REJECTED each candidate below. Same question, same blinding:',
  '**OK** = a genuine claim of the shown kind (with those fields) IS asserted',
  'in this message — the rejection was wrong. **BAD** = no genuine claim — the',
  'rejection was right.',
  '',
]

function sheetHeader(kind, chunkIdx, chunkCount, first, last, total) {
  const common = [
    `Items ${first}–${last} of ${total}. Record rulings in your copy of the ratings`,
    'template. Do not open the sealed key or the game logs while rating.',
  ]
  if (kind === 'positives') {
    return [
      `# Analysis v3 hand-check — confirm-all positives, sheet ${chunkIdx}/${chunkCount}`,
      '',
      'Blind per spec §6.1: you see the complete message, the speaker\'s table',
      'name, the day, the extracted fields, and any R12b resolving context —',
      'never truth verdicts, roles, models, or game outcomes. For each item',
      'answer **OK** (a genuine first-person claim of that kind, with those',
      'fields, asserted in THIS message) or **BAD** (not a claim / wrong kind /',
      'hedged / group statement / wrong fields), plus an optional note.',
      '',
      ...common,
      '',
    ]
  }
  return [
    `# Analysis v3 hand-check — machine-negative sample, sheet ${chunkIdx}/${chunkCount}`,
    '',
    'The machine extracted NO claim from any message below. List EVERY',
    'checkable first-person self-claim you see, or NONE. Kinds and fields:',
    'role_claim(role), not_mafia_claim, investigation_claim(target, result,',
    'claimedNight), protection_claim(target, claimedNight), vote_commitment(target),',
    'vote_stance(target, conditional), vote_retraction, past_vote_claim(target,',
    'referencedDay), past_vote_denial(target).',
    '',
    ...common,
    '',
  ]
}

function writeSheets(outDir, prefix, kind, items, games, chunkSize) {
  const chunkCount = Math.max(1, Math.ceil(items.length / chunkSize))
  const files = []
  const firstRejected = items.find((it) => it.section === 'rejected_candidate')
  for (let ci = 0; ci < chunkCount; ci++) {
    const slice = items.slice(ci * chunkSize, (ci + 1) * chunkSize)
    const lines = sheetHeader(kind, ci + 1, chunkCount, slice[0].item, slice[slice.length - 1].item, items.length)
    let section = null
    for (const it of slice) {
      if (it.section !== section) {
        section = it.section
        if (section === 'rejected_candidate') {
          lines.push(...REJECT_SECTION_HEADER)
          if (it !== firstRejected) lines.push('_(section continued from the previous sheet)_', '')
        }
      }
      lines.push(...(kind === 'positives' ? renderClaimItem(it, games) : renderNegativeItem(it, games)))
    }
    const name = `${prefix}-${String(ci + 1).padStart(2, '0')}.md`
    writeAtomic(join(outDir, name), lines.join('\n') + '\n')
    files.push(name)
  }
  return files
}

// ---------------------------------------------------------------- positives
function runPositives() {
  if (!values.candidates || !values.logs) fail(USAGE)
  const manifest = loadManifest()
  const games = loadLogs(values.logs)
  const { claims, rejects } = loadCandidates(values.candidates, manifest)

  const order = (c) => h([c.seed, c.seq, c.charStart ?? '', c.kind, c.quote ?? ''])
  const positives = claims.filter((c) => PUBLISHED.has(c.kind))
    .sort((a, b) => order(a).localeCompare(order(b)))
  // §6.1: 100% of investigation/protection candidates are reviewed, accepted
  // AND rejected — the rejected ones go in their own clearly-marked section.
  // A candidate is inv/prot if EITHER the nominated kind or the classifier's
  // kind is (same coverage rule as check-gates G3).
  const rejectedPower = rejects.filter((r) => POWER_KINDS.has(r.kind) || POWER_KINDS.has(r.machine?.kind))
    .sort((a, b) => order(a).localeCompare(order(b)))

  const items = [
    ...positives.map((c) => ({ ...c, section: 'positive', machineDecision: 'accepted' })),
    ...rejectedPower.map((r) => ({ ...r, section: 'rejected_candidate', machineDecision: 'rejected' })),
  ]
  if (items.length === 0) fail('no machine-positives in the published families and no rejected power candidates — nothing to review')
  items.forEach((it, i) => { it.item = i + 1 })

  mkdirSync(values.out, { recursive: true })
  const files = writeSheets(values.out, 'sheet', 'positives', items, games, Math.max(1, Number(values.chunk)))

  const meta = {
    _meta: true, mode: 'positives', analysisRunId: manifest.analysisRunId,
    sortSeed: values.seed, items: items.length,
    machinePositives: positives.length, rejectedPowerCandidates: rejectedPower.length,
    chunks: files.length,
  }
  // The sealed key carries everything the sheet hides (fields, sources,
  // machine output, reject reasons); it exists for ingest and agreement, and
  // the rater must never open it.
  writeAtomic(join(values.out, 'sealed-key.jsonl'),
    [meta, ...items].map((r) => JSON.stringify(r.item ? { ...r, analysisRunId: manifest.analysisRunId } : r)).join('\n') + '\n')

  // The runId is not blinding-sensitive: it stamps the rater-facing template
  // so gate G10 accepts the file and ingest can pair ratings to their key.
  const template = { rater: '', analysisRunId: manifest.analysisRunId, blindSource: 'sheet-*.md only', answerKeyOpened: false, positiveRatings: {}, notes: {} }
  for (const it of items) template.positiveRatings[String(it.item)] = ''
  writeAtomic(join(values.out, 'ratings-template.json'), JSON.stringify(template, null, 2) + '\n')

  console.log(`wrote ${files.length} sheet(s) [${files.join(', ')}] — ${positives.length} machine-positives + ${rejectedPower.length} rejected investigation/protection candidates`)
  console.log(`rater-facing: sheets + ratings-template.json; SEALED: sealed-key.jsonl`)
}

// ---------------------------------------------------------------- negatives
const NIGHT_TOKEN = /\b(?:n|night)\s*-?\s*\d+\b/i
const POWER_FAMILY = /investigation|protection/i

/** Power-role-adjacent matcher from the scripts/tripwire.mjs lexicon (§3.1).
 *  Only the detective/doctor vocabulary matters here — the investigation and
 *  protection families — plus night-number tokens and the two role words
 *  themselves (canonical codebook forms). Preferred path: the module's own
 *  compileLexicon()/normalizeText(), so oversampling uses exactly the frozen
 *  tripwire patterns; a generic collector covers other export shapes. */
async function loadPowerMatcher(path) {
  let mod
  try { mod = await import(pathToFileURL(resolve(path)).href) } catch (err) {
    fail(`cannot import tripwire lexicon from ${path}: ${err.message}\n(the negatives mode needs scripts/tripwire.mjs, or pass --tripwire)`)
  }
  const normalize = typeof mod.normalizeText === 'function' ? mod.normalizeText : norm
  const regexes = []
  const substrings = ['detective', 'doctor']

  if (typeof mod.compileLexicon === 'function') {
    // Ability vocabulary only: the investigation/protection families also
    // carry broad alignment words (bare "mafia", "town", "clean") as a
    // recall net; those match ~90% of real messages and would make the
    // oversampling vacuous. Keep the patterns whose vocabulary is the
    // ability itself (filtered on pattern source, not internal ids).
    const ABILITY = /investigat|check|night|n\\d|protect|sav|shield|heal|guard|doctor|self/
    for (const [family, patterns] of Object.entries(mod.compileLexicon())) {
      if (!POWER_FAMILY.test(family)) continue
      for (const p of patterns) {
        const re = p.re ?? p
        if (re instanceof RegExp && ABILITY.test(re.source)) regexes.push(re)
      }
    }
  } else {
    let lex = mod.buildLexicon ?? mod.generateLexicon ?? mod.LEXICON ?? mod.lexicon ?? mod.default
    if (typeof lex === 'function') lex = lex()
    const familyFor = (k, inherited) => (/claim|investigation|protection|role|mafia|vote/i.test(k) ? k : inherited)
    const add = (s) => {
      // Pattern sources compile to regexes; plain vocabulary matches as a
      // normalized substring.
      if (/[\\^$*+?()[\]{}|]/.test(s)) { try { regexes.push(new RegExp(s, 'i')); return } catch { /* fall through */ } }
      if (s.length >= 3) substrings.push(normalize(s))
    }
    const collect = (v, family) => {
      if (v == null) return
      if (v instanceof RegExp) { if (!family || POWER_FAMILY.test(family)) regexes.push(v); return }
      if (typeof v === 'string') { if (family && POWER_FAMILY.test(family)) add(v); return }
      if (Array.isArray(v)) { for (const x of v) collect(x, family); return }
      if (typeof v === 'object') {
        if (typeof v.pattern === 'string' || typeof v.text === 'string' || v.re instanceof RegExp) {
          collect(v.pattern ?? v.text ?? v.re, v.family ?? v.kind ?? family)
          return
        }
        for (const [k, x] of Object.entries(v)) collect(x, familyFor(k, family))
      }
    }
    collect(lex)
  }
  if (regexes.length + substrings.length <= 2) {
    fail(`tripwire lexicon at ${path} yielded no usable investigation/protection vocabulary (unrecognized export shape)`)
  }
  return (text) => {
    if (NIGHT_TOKEN.test(text)) return true
    const t = normalize(String(text))
    return substrings.some((s) => t.includes(s)) || regexes.some((re) => re.test(t))
  }
}

/** Round-robin over games (sorted), preferring within each game the message
 *  whose model is least represented so far; ties break on the seeded hash.
 *  Deterministic, and stratified across both games and models. */
function stratifiedSample(pool, n, modelCount) {
  const byGame = new Map()
  for (const m of [...pool].sort((a, b) => h([a.seed, a.seq]).localeCompare(h([b.seed, b.seq])))) {
    if (!byGame.has(m.seed)) byGame.set(m.seed, [])
    byGame.get(m.seed).push(m)
  }
  const games = [...byGame.keys()].sort()
  const picked = []
  while (picked.length < n) {
    let progressed = false
    for (const g of games) {
      if (picked.length >= n) break
      const list = byGame.get(g)
      if (!list.length) continue
      let best = 0
      for (let i = 1; i < list.length; i++) {
        if ((modelCount.get(list[i].model) ?? 0) < (modelCount.get(list[best].model) ?? 0)) best = i
      }
      const [m] = list.splice(best, 1)
      modelCount.set(m.model, (modelCount.get(m.model) ?? 0) + 1)
      picked.push(m)
      progressed = true
    }
    if (!progressed) break
  }
  return picked
}

async function runNegatives() {
  if (!values.candidates || !values.logs) fail(USAGE)
  const count = Number(values.count)
  if (!Number.isInteger(count) || count < 80 || count > 120) fail(`--count must be 80..120 (§6.2 precommitted band), got ${values.count}`)
  const manifest = loadManifest()
  const games = loadLogs(values.logs)
  const { claims, negativeKeys, negativesFiles, candidatesBySeq } = loadCandidates(values.candidates, manifest)
  const powerAdjacent = await loadPowerMatcher(values.tripwire)

  // Machine-negative pool (§6.2): machine-negative MESSAGES. The extractor's
  // negatives files are per-CANDIDATE, so a message can appear there and
  // still carry a machine-positive at another span — any seq present in the
  // claims files is excluded. The derived fallback is message-level already:
  // zero candidates of ANY family (the v2 seat-day key systematically hid
  // misses).
  const poolSource = negativesFiles > 0 ? 'extract-negatives-files' : 'derived-from-candidates'
  const positiveKeys = new Set(claims.map((c) => `${c.seed}|${c.seq}`))
  const pool = []
  for (const [seed, g] of [...games.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const [seq, m] of g.messages) {
      const k = `${seed}|${seq}`
      const negative = negativesFiles > 0
        ? negativeKeys.has(k) && !positiveKeys.has(k)
        : !candidatesBySeq.has(k)
      if (!negative) continue
      pool.push({
        seed, seq, day: m.day, actor: m.actor, model: g.models[m.actor] ?? null, text: m.text,
        powerAdjacent: powerAdjacent(m.text),
        machineClaims: candidatesBySeq.get(k) ?? [],
      })
    }
  }
  if (pool.length === 0) fail('machine-negative pool is empty')

  // Oversample: the power-adjacent share of the sheet is at least half AND
  // at least the pool's own share, so power-adjacent text is never diluted
  // below its base rate whatever that rate turns out to be.
  const power = pool.filter((m) => m.powerAdjacent)
  const rest = pool.filter((m) => !m.powerAdjacent)
  const wantPower = Math.min(power.length, Math.max(Math.ceil(count / 2), Math.ceil((count * power.length) / pool.length)))
  const modelCount = new Map()
  const pickedPower = stratifiedSample(power, wantPower, modelCount)
  const pickedRest = stratifiedSample(rest, count - pickedPower.length, modelCount)
  const backfill = pickedPower.length + pickedRest.length < count
    ? stratifiedSample(power.filter((m) => !pickedPower.includes(m)), count - pickedPower.length - pickedRest.length, modelCount)
    : []
  const sampled = [...pickedPower, ...pickedRest, ...backfill]
    .sort((a, b) => h([a.seed, a.seq, 'order']).localeCompare(h([b.seed, b.seq, 'order'])))
  // §6.2: the 80–120 band is precommitted on the SHEET, not just the request
  // — a pool too small to reach the band floor is exit 1, never a warning.
  if (sampled.length < 80) fail(`pool exhausted at ${sampled.length}/${count} — below the §6.2 precommitted band floor of 80; no sheet written`)
  if (sampled.length < count) console.error(`warning: pool exhausted — sampled ${sampled.length}/${count} (still within the §6.2 band)`)
  sampled.forEach((m, i) => { m.item = `N${i + 1}`; m.section = 'negative' })

  mkdirSync(values.out, { recursive: true })
  const files = writeSheets(values.out, 'negatives-sheet', 'negatives', sampled, games, Math.max(1, Number(values.chunk)))

  const meta = {
    _meta: true, mode: 'negatives', analysisRunId: manifest.analysisRunId,
    sortSeed: values.seed, requested: count, items: sampled.length,
    powerAdjacent: sampled.filter((m) => m.powerAdjacent).length,
    games: new Set(sampled.map((m) => m.seed)).size,
    models: new Set(sampled.map((m) => m.model)).size,
    poolSource, pool: pool.length, chunks: files.length,
  }
  writeAtomic(join(values.out, 'negatives-sealed-key.jsonl'),
    [meta, ...sampled.map((m) => ({
      item: m.item, seed: m.seed, seq: m.seq, day: m.day, seat: m.actor, model: m.model,
      powerAdjacent: m.powerAdjacent, machineClaims: m.machineClaims, text: m.text,
      analysisRunId: manifest.analysisRunId,
    }))].map((r) => JSON.stringify(r)).join('\n') + '\n')

  // Stamped for the same reason as the positives template: G10 scans the
  // handcheck dir, and the runId carries into the filled ratings for pairing.
  const template = { rater: '', analysisRunId: manifest.analysisRunId, blindSource: 'negatives-sheet-*.md only', answerKeyOpened: false, negativeClaims: {}, notes: {} }
  for (const m of sampled) template.negativeClaims[m.item] = []
  writeAtomic(join(values.out, 'negatives-template.json'), JSON.stringify(template, null, 2) + '\n')

  console.log(`wrote ${files.length} negatives sheet(s) [${files.join(', ')}] — ${sampled.length} messages (${meta.powerAdjacent} power-adjacent) from ${meta.games} games, ${meta.models} models, pool ${pool.length} (${poolSource})`)
  console.log(`rater-facing: sheets + negatives-template.json; SEALED: negatives-sealed-key.jsonl`)
}

// ------------------------------------------------------------------- ingest
function runIngest() {
  if (!values.key || !values.ratings || !values.out) fail(USAGE)
  const lines = readJsonl(values.key)
  const meta = lines.find((r) => r._meta)
  if (!meta || typeof meta.analysisRunId !== 'string') fail(`${values.key}: sealed key has no stamped meta line (§5)`)
  const items = lines.filter((r) => !r._meta)
  const ratings = JSON.parse(readFileSync(values.ratings, 'utf8'))
  if (!ratings.rater || typeof ratings.rater !== 'string') fail(`${values.ratings}: missing "rater"`)
  if (typeof ratings.analysisRunId === 'string' && ratings.analysisRunId !== meta.analysisRunId) {
    fail(`${values.ratings}: analysisRunId does not match the sealed key (§5)`)
  }

  mkdirSync(dirname(resolve(values.out)), { recursive: true })

  if (meta.mode === 'negatives') {
    const listed = ratings.negativeClaims
    if (!listed || typeof listed !== 'object') fail(`${values.ratings}: negatives ingest needs "negativeClaims"`)
    const missing = items.filter((it) => !Array.isArray(listed[it.item])).map((it) => it.item)
    if (missing.length) fail(`incomplete ratings — no claim list for: ${missing.join(', ')}`)
    const extra = Object.keys(listed).filter((k) => !items.some((it) => String(it.item) === k))
    if (extra.length) fail(`ratings contain items not in this key (wrong file pairing?): ${extra.join(', ')}`)
    const merged = items.map((it) => ({
      ...it,
      human: { rater: ratings.rater, claims: listed[it.item], note: ratings.notes?.[it.item] ?? '' },
    }))
    const outMeta = {
      _meta: true, mode: 'negatives-rated', analysisRunId: meta.analysisRunId, rater: ratings.rater,
      items: merged.length, itemsWithClaims: merged.filter((m) => m.human.claims.length > 0).length,
    }
    writeAtomic(values.out, [outMeta, ...merged].map((r) => JSON.stringify(r)).join('\n') + '\n')
    console.log(`wrote ${values.out}: ${merged.length} rated negatives (${outMeta.itemsWithClaims} with rater-listed claims)`)
    return
  }

  const rulings = ratings.positiveRatings
  if (!rulings || typeof rulings !== 'object') fail(`${values.ratings}: ingest needs "positiveRatings"`)
  const bad = Object.entries(rulings).filter(([, v]) => !['OK', 'BAD', 'UNSURE'].includes(v))
  if (bad.length) fail(`invalid rulings (must be OK/BAD/UNSURE): ${bad.map(([k, v]) => `${k}="${v}"`).join(', ')}`)
  // Confirm-all (§6.1): every item on the sheet must carry a ruling.
  const missing = items.filter((it) => !rulings[String(it.item)]).map((it) => it.item)
  if (missing.length) fail(`incomplete ratings — no ruling for items: ${missing.join(', ')}`)
  const extra = Object.keys(rulings).filter((k) => !items.some((it) => String(it.item) === k))
  if (extra.length) fail(`ratings contain items not in this key (wrong file pairing?): ${extra.join(', ')}`)

  // UNSURE publishes nothing: it is structured as unconfirmed, so the
  // fail-closed ledger drops it rather than counting it.
  const merged = items.map((it) => {
    const ruling = rulings[String(it.item)]
    const note = ratings.notes?.[String(it.item)] ?? ''
    return {
      ...it,
      human: {
        rater: ratings.rater,
        confirmed: ruling === 'OK',
        note: ruling === 'UNSURE' ? `UNSURE${note ? `: ${note}` : ''}` : note,
      },
    }
  })
  const outMeta = {
    _meta: true, mode: 'confirmed-input', analysisRunId: meta.analysisRunId, rater: ratings.rater,
    items: merged.length,
    confirmed: merged.filter((m) => m.human.confirmed).length,
    overturnedPositives: merged.filter((m) => m.machineDecision === 'accepted' && rulings[String(m.item)] === 'BAD').length,
    overturnedRejects: merged.filter((m) => m.machineDecision === 'rejected' && rulings[String(m.item)] === 'OK').length,
    unsure: Object.values(rulings).filter((v) => v === 'UNSURE').length,
  }
  writeAtomic(values.out, [outMeta, ...merged].map((r) => JSON.stringify(r)).join('\n') + '\n')
  console.log(`wrote ${values.out}: ${merged.length} items — ${outMeta.confirmed} confirmed, ` +
    `${outMeta.overturnedPositives} positives overturned, ${outMeta.overturnedRejects} rejects overturned, ${outMeta.unsure} UNSURE`)
}

if (MODE === 'positives') runPositives()
else if (MODE === 'negatives') await runNegatives()
else runIngest()
