// Fail-closed assembly of runs/analysis-v3/publication.json (spec §5, §7).
//
// The renderer consumes ONLY publication.json, so this is the last gate
// before anything becomes visible. Refused with exit 1 (§5 fail-closed):
//   - any missing input file or flag;
//   - any artifact whose analysisRunId is absent or differs from the
//     manifest's (a claims-style meta line WITHOUT analysisRunId is a
//     v1/v2-shaped artifact and is named as such);
//   - any ranking / composite / leaderboard field anywhere (§4: "No
//     rankings, no composite scores, anywhere");
//   - any ledger claim lacking human confirmation (§6.1 confirm-all), any
//     shelved-family claim (§2.1: nothing about them publishes in sweep 1),
//     or any non-v3 verdict vocabulary.
// Ends by spawning node scripts/check-gates.mjs (§7) and propagating its
// exit status — publication.json without passing gates is not a deliverable.
//
// v3.2-ONLY. There is no v3.1 compatibility path in this code: the archived
// v3.1 publication regenerates at the code commit the analysis manifest pins
// (manifest.codeCommit), which is the only honest way to reproduce it — the
// review found the "byte-for-byte v3.1 branch" claim false at every upstream
// stage (stats, scorer, renderer), so the claim is retired rather than
// half-kept.
//
//   node scripts/build-publication.mjs --manifest runs/analysis-v3/manifest.json \
//        --opportunity runs/analysis-v3/opportunity/opportunity-table.jsonl \
//        --stats runs/analysis-v3/stats/stats.json \
//        --ledger runs/analysis-v3/ledger/confirmed.jsonl \
//        --agreement runs/analysis-v3/handcheck/agreement.json \
//        --sensitivity runs/analysis-v3/stats/sensitivity.json \
//        --validation runs/analysis-v3/handcheck/review-packet/review-packet-merged.json \
//        [--out runs/analysis-v3/publication.json]
import { spawnSync } from 'node:child_process'
import { derivePublishability, scrubOmittedFamilies } from './publication-omission.mjs'
import { claimKey } from './build-review-packet.mjs'
import { aggregateClaimPropositions } from './claim-propositions.mjs'
import { EVALUATOR_VERSION, gameFacts, resolveEffectiveClaimTarget } from '../packages/seats/scripts/scoring-v3.mjs'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
  options: {
    manifest: { type: 'string' },
    opportunity: { type: 'string' },
    stats: { type: 'string' },
    ledger: { type: 'string' },
    agreement: { type: 'string' },
    // §7: "no headline conclusion reverses across §1 cohorts or equal-vs-
    // ballot weighting; if one does, the range is published" — the cross-
    // cohort comparison is an input ({reversals: [{..., range}]}, stamped),
    // not something one single-cohort stats file can attest.
    sensitivity: { type: 'string' },
    // PF-2 (docs/analysis/amendments/PF-2.md): the validation block for a
    // ledger carrying sensitivity-uncontested confirmations, and the
    // amendment document itself (hash-pinned into the publication).
    pf2: { type: 'string' },
    amendment: { type: 'string' },
    extract: { type: 'string', default: 'runs/analysis-v3/extract-s5' },
    /** v3.2 §8: the unblinded single-author validation summary
     *  (review-packet-merged.json). REQUIRED — a publication cannot assert
     *  the protocol label without the evidence the protocol ran; the review
     *  found the label satisfiable by a constant (finding 10). v3.2.4: this
     *  is the INITIAL packet's summary and must sit at closure-chain
     *  position 0 — a later, smaller packet can never substitute. */
    validation: { type: 'string' },
    /** v3.2.4: the provisional ledger the initial packet was built from —
     *  its false rows ARE the census, and the summary's claimKeys must equal
     *  them exactly (the complete-initial-census check; kills the n=0
     *  bypass). */
    'provisional-ledger': { type: 'string' },
    /** v3.2.4: one merged summary per closure iteration after the first,
     *  comma-separated, in chain order — the publication binds to the
     *  COMPLETE evidence chain, never to whichever packet came last. */
    'closure-validations': { type: 'string' },
    /** Paper-v1 scope decision (2026-09-01): publish the completed PF-2
     *  author adjudication as exploratory/potentially-incomplete semantics,
     *  without pretending the deferred §8 three-arm validation ran. */
    'exploratory-v1': { type: 'boolean', default: false },
    /** Forwarded to the semantic gates' S4 recomputation (v3.2.3): the gates
     *  must audit against the same logs the pipeline scored. */
    logs: { type: 'string', default: 'data/sweep1' },
    /** Gates-only provenance inputs. These default beside the selected
     *  manifest, never to the retired runs/analysis-v3 tree: a v3.2
     *  publication must be audited against its own run directory. */
    cleanroom: { type: 'string' },
    'tripwire-report': { type: 'string' },
    outdir: { type: 'string' },
    out: { type: 'string', default: 'runs/analysis-v3/publication.json' },
    // Overridable ONLY for offline validation of this assembler; the default
    // gates script is binding for real runs.
    gates: { type: 'string', default: join(REPO_ROOT, 'scripts', 'check-gates.mjs') },
  },
})

const fail = (msg) => { console.error(`build-publication: ${msg}`); process.exit(1) }
const exploratoryV1 = values['exploratory-v1'] === true

for (const flag of ['manifest', 'opportunity', 'stats', 'ledger', 'agreement', 'sensitivity']) {
  if (!values[flag]) fail(`--${flag} is required (every input, or exit 1)`)
  if (!existsSync(values[flag])) fail(`--${flag} ${values[flag]}: file does not exist`)
}
if (!exploratoryV1) {
  if (!values.validation) fail('--validation is required unless --exploratory-v1 is explicitly selected')
  if (!existsSync(values.validation)) fail(`--validation ${values.validation}: file does not exist`)
}

const PUBLISHED_KINDS = new Set(['role_claim', 'not_mafia_claim', 'investigation_claim', 'protection_claim'])
const SHELVED_KINDS = new Set(['vote_commitment', 'vote_stance', 'vote_retraction', 'past_vote_claim', 'past_vote_denial'])
const PUBLISHED_VERDICTS = new Set(['true', 'false', 'ambiguous'])
const FALSE_CLASSES = new Set(['misrepresented_role', 'fabricated_investigation', 'fabricated_protection'])

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const readJsonl = (p) => readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

// ---- manifest and run id -------------------------------------------------
const manifest = readJson(values.manifest)
if (typeof manifest.analysisRunId !== 'string' || !manifest.analysisRunId) {
  fail(`${values.manifest}: no analysisRunId`)
}
const RUN_ID = manifest.analysisRunId
const RUN_DIR = resolve(values.outdir ?? dirname(resolve(values.manifest)))
const CLEANROOM_PATH = resolve(values.cleanroom ?? join(RUN_DIR, 'cleanroom.json'))
const tripwireReportInput = values['tripwire-report'] ?? manifest.tripwire?.validationReportPath
const TRIPWIRE_REPORT_PATH = tripwireReportInput ? resolve(tripwireReportInput) : null

/** Every derived artifact embeds the run id and every consumer verifies it
 *  (§5). A meta line without one is the v1/v2 artifact shape and is refused
 *  by name — that is the exact regression the required failing tests cover. */
function checkStampedJsonl(path, rows) {
  const meta = rows.find((r) => r._meta) ?? null
  if (meta && typeof meta.analysisRunId !== 'string') {
    fail(`${path}: meta line has no analysisRunId — v1/v2-shaped artifact, refused (§5)`)
  }
  if (meta && meta.analysisRunId !== RUN_ID) {
    fail(`${path}: meta analysisRunId ${meta.analysisRunId} != manifest ${RUN_ID}`)
  }
  for (const r of rows.filter((r) => !r._meta)) {
    if (typeof r.analysisRunId !== 'string') {
      const v2ish = 'support' in r || 'game' in r
      fail(`${path}: record${r.seq != null ? ` seq ${r.seq}` : ''} lacks analysisRunId${v2ish ? ' (looks v2-shaped)' : ''}, refused (§5)`)
    }
    if (r.analysisRunId !== RUN_ID) fail(`${path}: record analysisRunId mismatch (${r.analysisRunId})`)
  }
  return meta
}
function checkStampedJson(path, obj, { allowSuperseded = false } = {}) {
  if (typeof obj.analysisRunId !== 'string') fail(`${path}: no analysisRunId — pre-v3 artifact, refused (§5)`)
  if (obj.analysisRunId === RUN_ID) return
  // Rating-phase derivatives (the agreement report is computed from sealed
  // keys and rating files) legitimately carry the id the ratings were
  // collected under, when the manifest explicitly supersedes it (gate G10's
  // rule for the readings themselves).
  if (allowSuperseded && (manifest.supersedes ?? []).includes(obj.analysisRunId)) return
  fail(`${path}: analysisRunId ${obj.analysisRunId} != manifest ${RUN_ID}`)
}

// ---- no ranking / composite fields anywhere (§4, §7) ---------------------
const FORBIDDEN_KEYS = [/^ranks?$/i, /^rankings?$/i, /leaderboard/i, /composite/i, /^elo$/i, /^eloscore$/i]
function scanForbidden(v, path, hits) {
  if (Array.isArray(v)) { v.forEach((x, i) => scanForbidden(x, `${path}[${i}]`, hits)); return }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN_KEYS.some((re) => re.test(k))) hits.push(`${path}.${k}`)
      scanForbidden(x, `${path}.${k}`, hits)
    }
  }
}
function refuseForbidden(name, obj) {
  const hits = []
  scanForbidden(obj, name, hits)
  if (hits.length) fail(`ranking/composite field(s) refused (§4): ${hits.join(', ')}`)
}

// ---- load + verify each artifact -----------------------------------------
const stats = readJson(values.stats)
checkStampedJson(values.stats, stats)
refuseForbidden('stats', stats)

const agreementSha256 = sha256(readFileSync(values.agreement))
const agreement = readJson(values.agreement)
checkStampedJson(values.agreement, agreement, { allowSuperseded: true })
refuseForbidden('agreement', agreement)

const sensitivitySha256 = sha256(readFileSync(values.sensitivity))
const sensitivityIn = readJson(values.sensitivity)
checkStampedJson(values.sensitivity, sensitivityIn)
refuseForbidden('sensitivity', sensitivityIn)
if (!Array.isArray(sensitivityIn.reversals)) {
  fail(`${values.sensitivity}: must carry {reversals: [...]} — the §7 cohort/weighting comparison, [] when nothing reverses`)
}
// §7: a reversal may publish only WITH its range (same rule gate G7 enforces).
const bareReversals = sensitivityIn.reversals.filter((r) => !r.range)
if (bareReversals.length) fail(`${values.sensitivity}: ${bareReversals.length} reversal(s) without a range, refused (§7)`)

const oppBytes = readFileSync(values.opportunity)
const oppRows = values.opportunity.endsWith('.jsonl')
  ? readJsonl(values.opportunity)
  : (() => { const o = readJson(values.opportunity); return Array.isArray(o) ? o : (o.rows ?? [o]) })()
checkStampedJsonl(values.opportunity, oppRows)
refuseForbidden('opportunity', oppRows)
const oppData = oppRows.filter((r) => !r._meta)
if (oppData.length === 0) fail(`${values.opportunity}: zero opportunity rows`)

const ledgerBytes = readFileSync(values.ledger)
const ledgerRows = readJsonl(values.ledger)
const ledgerMeta = checkStampedJsonl(values.ledger, ledgerRows)
refuseForbidden('ledger', ledgerRows)
if (ledgerMeta?.evaluatorVersion !== EVALUATOR_VERSION) {
  fail(`${values.ledger}: evaluatorVersion ${JSON.stringify(ledgerMeta?.evaluatorVersion ?? null)} != current ${EVALUATOR_VERSION} — rebuild the ledger`)
}
if (stats.evaluatorVersion !== EVALUATOR_VERSION) {
  fail(`${values.stats}: evaluatorVersion ${JSON.stringify(stats.evaluatorVersion ?? null)} != current ${EVALUATOR_VERSION} — rerun stats-v3`)
}
const claims = ledgerRows.filter((r) => !r._meta)
for (const c of claims) {
  const at = `${c.seed ?? '?'} seq ${c.seq ?? '?'}`
  // §6.1 confirm-all: no positive publishes unconfirmed. A claim the human
  // marked BAD/UNSURE must not reach this file at all.
  if (!c.human || c.human.confirmed !== true || !c.human.rater) {
    fail(`${values.ledger}: claim at ${at} lacks human confirmation ({human:{rater,confirmed:true}}), refused (§6.1)`)
  }
  if (SHELVED_KINDS.has(c.kind)) fail(`${values.ledger}: shelved-family claim (${c.kind}) at ${at} — nothing about shelved families publishes in sweep 1 (§2.1)`)
  if (!PUBLISHED_KINDS.has(c.kind)) fail(`${values.ledger}: unknown kind "${c.kind}" at ${at}`)
  if (!PUBLISHED_VERDICTS.has(c.verdict)) {
    fail(`${values.ledger}: verdict "${c.verdict}" at ${at} is not in the published vocabulary true|false|ambiguous (v2 vocabularies are refused; §3)`)
  }
  if (c.verdict === 'false' && !FALSE_CLASSES.has(c.falseClass)) {
    fail(`${values.ledger}: false claim at ${at} lacks a valid falseClass (§3)`)
  }
}

// ---- v3.2.6 claim unit: receipts versus underlying propositions ---------
// R20 keeps each reasserting message as an auditable receipt. Paper-facing
// semantic totals count the matching underlying proposition once. Recompute
// the mapping from the exact ledger and verified logs here, then require the
// stats artifact to carry the same content-addressed mapping.
const propositionFacts = new Map()
const factsForPropositions = (seed) => {
  if (propositionFacts.has(seed)) return propositionFacts.get(seed)
  const path = join(values.logs, `${seed}.jsonl`)
  if (!existsSync(path)) fail(`claim-proposition grouping needs verified log ${path}`)
  const bytes = readFileSync(path)
  const want = manifest.logs?.files?.[seed]?.sha256
  if (!want) fail(`manifest has no log hash for ${seed}; claim-proposition target normalization cannot be verified`)
  const got = sha256(bytes)
  if (got !== want) fail(`claim-proposition grouping: ${seed} log sha256 mismatch (${got} != ${want})`)
  const events = bytes.toString('utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const facts = gameFacts(events)
  propositionFacts.set(seed, facts)
  return facts
}
const aggregateClaims = (rows, includeKinds) => aggregateClaimPropositions(rows, {
  resolveTarget: (claim) => resolveEffectiveClaimTarget(claim, factsForPropositions(claim.seed)),
  getMessage: (seed, seq) => {
    const facts = factsForPropositions(seed)
    const text = facts.messageTexts.get(seq)
    const actor = facts.messageActors.get(seq)
    return typeof text === 'string' ? { text, actor } : undefined
  },
  ...(includeKinds ? { includeKinds } : {}),
})
const ledgerClaimPropositions = aggregateClaims(claims)
if (!stats.claimPropositions || stats.claimPropositions.mappingSha256 !== ledgerClaimPropositions.mappingSha256 ||
    JSON.stringify(stats.claimPropositions) !== JSON.stringify(ledgerClaimPropositions)) {
  fail(`${values.stats}: claimPropositions mapping does not match the exact confirmed ledger — rerun stats-v3 under v3.2.6`)
}
if (JSON.stringify(stats.ledgerResolvedPropositionCountRange) !== JSON.stringify(ledgerClaimPropositions.countRanges.resolved) ||
    JSON.stringify(stats.ledgerAmbiguousPropositionCountRange) !== JSON.stringify(ledgerClaimPropositions.countRanges.ambiguous) ||
    stats.ledgerClaimReceipts !== ledgerClaimPropositions.receiptCount) {
  fail(`${values.stats}: explicit claim-unit totals do not match the confirmed ledger ` +
    `(${JSON.stringify(stats.ledgerResolvedPropositionCountRange)}/${JSON.stringify(stats.ledgerAmbiguousPropositionCountRange)}/${stats.ledgerClaimReceipts} vs ` +
    `${JSON.stringify(ledgerClaimPropositions.countRanges.resolved)}/${JSON.stringify(ledgerClaimPropositions.countRanges.ambiguous)}/${ledgerClaimPropositions.receiptCount})`)
}

// ---- ledger counts -------------------------------------------------------
const receiptByKind = {}
for (const k of [...PUBLISHED_KINDS].sort()) receiptByKind[k] = { true: 0, false: 0, ambiguous: 0 }
for (const c of claims) receiptByKind[c.kind][c.verdict]++

// ---- PF-2: sensitivity-uncontested confirmations need the validation
// block and the hash-pinned amendment document — never silently.
const humanNamesEarly = Array.isArray(manifest.humanRaters) ? manifest.humanRaters : []
const uncontested = claims.filter((c) => c.human?.via === 'sensitivity-uncontested' || !humanNamesEarly.includes(c.human?.rater)).length
let pf2 = null
let amendmentSha256 = null
let pf2Sha256 = null
if (uncontested > 0 || exploratoryV1) {
  if (!values.pf2 || !values.amendment) fail(`${exploratoryV1 ? 'exploratory-v1' : `${uncontested} non-human-rater confirmation(s)`} requires --pf2 validation and --amendment document (PF-2)`)
  if (!existsSync(values.pf2) || !existsSync(values.amendment)) fail('--pf2 and --amendment must name existing files')
  pf2 = readJson(values.pf2)
  pf2Sha256 = sha256(readFileSync(values.pf2))
  if (pf2.analysisRunId !== RUN_ID) fail(`--pf2 ${values.pf2}: analysisRunId mismatch`)
  if (typeof pf2.humanPacket?.audit?.confirmationRate !== 'number') {
    fail(`--pf2 ${values.pf2}: no humanPacket.audit.confirmationRate — this is a one-human confirmation sample, not inter-rater agreement`)
  }
  if (pf2.provenance?.inputs?.confirmedInputSha256 !== ledgerMeta?.confirmedInputSha256) {
    fail(`--pf2 ${values.pf2}: confirmed-input hash does not match the ledger's confirmedInputSha256 — validation and scored claims came from different rulings`)
  }
  amendmentSha256 = sha256(readFileSync(values.amendment))
}
// ---- v3.2 §8: the validation evidence, and the Tier L publication gate ----
// The §8 sitting runs on the FINAL ledger, so the publication is assembled
// after it, from its unblinded summary. Every family's census count must
// match this ledger (a census is a census), and a family whose retained-
// precision lower bound misses the floor has its Tier L results OMITTED —
// rows out, disclosure in — never disclose-and-publish.
let validationBytes = null
let validation = null
let censusByFamily = null
const closureChain = ledgerMeta?.closureChain ?? []
let closureIterations = []
const omittedFamilies = []
if (!exploratoryV1) {
validationBytes = readFileSync(values.validation)
validation = JSON.parse(validationBytes)
checkStampedJson(values.validation, validation, { allowSuperseded: true })
if (validation.protocol !== 'single-author validation protocol (v3.2 §8)') {
  fail(`--validation ${values.validation}: not a §8 validation summary (protocol=${JSON.stringify(validation.protocol ?? null)})`)
}
if (!validation.rater) fail(`--validation ${values.validation}: no rater recorded`)
if (!validation.crossCheck?.rater) {
  fail(`--validation ${values.validation}: no model cross-check recorded — §8 promises one, and a promise the pipeline cannot show ran is retracted or kept, never assumed (v3.2.2)`)
}
censusByFamily = validation.census?.byFamily
if (!censusByFamily) fail(`--validation ${values.validation}: no census.byFamily — the §8 census is the precision evidence`)
// v3.2.2 binding — hashes and exact identities, never counts (closure review
// finding 2: a same-count substituted ledger passed the old check):
// the ledger's closure chain must contain the packet this validation summary
// was computed from, and that packet must pin the provisional ledger it was
// built over.
if (!validation.packetKeySha256) fail(`--validation ${values.validation}: no packetKeySha256 — regenerate with build-review-packet --unblind (v3.2.2)`)
// v3.2.4: the summary binds to closure-chain POSITION 0, not to membership.
// Membership let any later iteration's packet — smaller by construction,
// empty in the limit — stand in for the complete initial census. The
// initial packet is the census; later packets are the closure evidence.
if (closureChain.length === 0) fail('ledger meta carries no closure chain — the §8 sitting was never applied to this lineage (v3.2.2)')
const chainEntry = closureChain[0]
if (chainEntry.packetKeySha256 !== validation.packetKeySha256) {
  fail(`--validation packet ${String(validation.packetKeySha256).slice(0, 12)}… is not the INITIAL packet in this ledger's closure chain (position 0 is ${String(chainEntry.packetKeySha256 ?? null).slice(0, 12)}…) — a later packet must never substitute for the full census (v3.2.4)`)
}
// The RULINGS bind too, not just the packet: a summary computed from one
// rulings file must never publish beside a ledger built from another
// (closure rerun finding 5 — the packet-only check left the rulings free).
if (!validation.rulingsSha256 || validation.rulingsSha256 !== chainEntry.rulingsSha256) {
  fail(`--validation rulingsSha256 ${String(validation.rulingsSha256 ?? null).slice(0, 12)}… does not match the closure chain's ${String(chainEntry.rulingsSha256 ?? null).slice(0, 12)}… — the summary and the applied rulings are different files (v3.2.2)`)
}
if ((validation.finalRulingsSha256 ?? null) !== (chainEntry.finalRulingsSha256 ?? null)) {
  fail(`--validation finalRulingsSha256 does not match the closure chain's — reconciliation files differ (v3.2.2)`)
}
// v3.2.4: the §8 evidence the publication embeds must be COMPLETE — the
// cross-check with its hash-bound artifact, the unaided first-pass metric,
// and the precisely-labeled scan statistic. A summary missing any of them is
// a pre-v3.2.4 artifact; regenerate it.
if (!validation.crossCheck?.method?.model || !Array.isArray(validation.crossCheck?.resolutions)) {
  fail(`--validation ${values.validation}: crossCheck lacks method/resolutions — regenerate with build-review-packet --unblind (v3.2.4)`)
}
if (!validation.modelRulingsSha256) {
  fail(`--validation ${values.validation}: no modelRulingsSha256 — the model cross-check artifact must be hash-bound (v3.2.4)`)
}
if (!validation.unaidedFirstPass) {
  fail(`--validation ${values.validation}: no unaidedFirstPass block — the unaided-author metric publishes beside the final-based metrics (v3.2.3)`)
}
if (validation.messageScan?.statistic !== 'message-level omission incidence') {
  fail(`--validation ${values.validation}: messageScan.statistic must be 'message-level omission incidence' — never conflated with claim-level recall (v3.2.4)`)
}
// v3.2.4: the complete-initial-census check. The provisional ledger the
// initial packet pins is re-read, its false rows' claim keys are recomputed
// with the ONE claimKey definition, and the summary's census must equal them
// EXACTLY — which also kills the n=0 bypass: a family with false rows in the
// provisional ledger and n=0 in the census fails set equality here.
if (!values['provisional-ledger']) fail('--provisional-ledger is required (the ledger the initial §8 packet was built from — v3.2.4)')
const provisionalBytes = readFileSync(values['provisional-ledger'])
if (sha256(provisionalBytes) !== chainEntry.provisionalLedgerSha256) {
  fail(`--provisional-ledger ${values['provisional-ledger']} sha256 does not match closure chain position 0's provisionalLedgerSha256 — wrong file (v3.2.4)`)
}
const provisionalFalseKeys = provisionalBytes.toString('utf8').trim().split('\n').filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((r) => !r._meta && r.verdict === 'false')
  .map((r) => claimKey(r))
  .sort()
const censusKeys = [...(validation.census?.claimKeys ?? [])].sort()
if (JSON.stringify(censusKeys) !== JSON.stringify(provisionalFalseKeys)) {
  fail(`--validation census claimKeys (${censusKeys.length}) do not equal the provisional ledger's false rows (${provisionalFalseKeys.length}) — the initial census must be COMPLETE, no sampling, no zero-count bypass (v3.2.4)`)
}
// v3.2.4: every closure iteration publishes its evidence. One summary per
// chain entry after the first, in order, each hash-bound to its entry — an
// evidence chain with holes is not a chain.
const closureValidationPaths = (values['closure-validations'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
if (closureValidationPaths.length !== closureChain.length - 1) {
  fail(`closure chain has ${closureChain.length} entr${closureChain.length === 1 ? 'y' : 'ies'} but ${closureValidationPaths.length} --closure-validations summar${closureValidationPaths.length === 1 ? 'y' : 'ies'} supplied — every iteration after the first publishes its evidence (v3.2.4)`)
}
closureIterations = closureValidationPaths.map((p, i) => {
  const entry = closureChain[i + 1]
  if (!existsSync(p)) fail(`--closure-validations ${p}: file does not exist`)
  const bytes = readFileSync(p)
  const s = JSON.parse(bytes)
  if (s.packetKeySha256 !== entry.packetKeySha256) fail(`${p}: packetKeySha256 does not match closure chain entry ${i + 1}`)
  if (!s.rulingsSha256 || s.rulingsSha256 !== entry.rulingsSha256) fail(`${p}: rulingsSha256 does not match closure chain entry ${i + 1}`)
  if ((s.finalRulingsSha256 ?? null) !== (entry.finalRulingsSha256 ?? null)) fail(`${p}: finalRulingsSha256 does not match closure chain entry ${i + 1}`)
  if (!Number.isInteger(s.census?.n) || s.census.n < 1) fail(`${p}: a closure iteration with an empty census would never have been sat — malformed evidence (v3.2.4)`)
  return {
    path: p, sha256: sha256(bytes), packetKeySha256: s.packetKeySha256,
    items: s.items ?? null, census: { n: s.census.n, claimKeys: s.census.claimKeys ?? null },
  }
})
// §8 publishability is DERIVED from validated counts and the frozen Wilson
// floor here and again in gate G5 — a stored tierLPublishable boolean is
// never trusted (closure review finding 3).
for (const fam of [...PUBLISHED_KINDS].sort()) {
  const v = censusByFamily[fam]
  const derived = derivePublishability({ n: v?.n ?? 0, upheld: v?.upheld ?? 0 })
  if ((v?.n ?? 0) > 0 && !derived.publishable) {
    const rows = claims.filter((c) => c.kind === fam)
    const propositionRanges = ledgerClaimPropositions.countRanges.byKind[fam]
    omittedFamilies.push({
      family: fam,
      reason: `retained-precision lower bound below the §8 floor — Tier L results omitted, not disclose-and-published`,
      omittedReceiptCounts: {
        true: rows.filter((c) => c.verdict === 'true').length,
        false: rows.filter((c) => c.verdict === 'false').length,
        ambiguous: rows.filter((c) => c.verdict === 'ambiguous').length,
      },
      omittedPropositionCountRanges: propositionRanges,
    })
  }
}
}
const omittedSet = new Set(omittedFamilies.map((o) => o.family))
const publishable = claims.filter((c) => !omittedSet.has(c.kind))
const survivingPublishedKinds = [...PUBLISHED_KINDS].sort().filter((kind) => !omittedSet.has(kind))
const publishableClaimPropositions = aggregateClaims(publishable, survivingPublishedKinds)
const publishableByKind = {}
for (const k of [...PUBLISHED_KINDS].sort()) {
  if (omittedSet.has(k)) continue
  publishableByKind[k] = publishableClaimPropositions.countRanges.byKind[k]
}
const totalFalse = publishableClaimPropositions.countRanges.false
const totalFalseReceipts = publishable.filter((c) => c.verdict === 'false').length
const formatRange = ({ lower, upper }) => lower === upper ? String(lower) : `${lower}–${upper}`

const humanRaters = Array.isArray(manifest.humanRaters) ? manifest.humanRaters.length
  : typeof manifest.humanRaters === 'number' ? manifest.humanRaters : 1
// v3.2 §9: lower-bound ("at least N") wording is retired — it is
// one-directional and survives only without false positives, and the
// row-level audit found 20 confirmed-invalid rows out of 171. Counts are
// labeled by the protocol that produced them.
const falseStatementLanguage =
  `${formatRange(totalFalse)} author-adjudicated verifiably false underlying claim propositions ` +
  `(${totalFalseReceipts} public claim utterance receipts; ` +
  (exploratoryV1
    ? 'exploratory, author-adjudicated, and potentially incomplete; no general recall or omission-rate estimate)'
    : 'single-author validation protocol, v3.2 §8)') +
  (omittedFamilies.length
    ? `; ${omittedFamilies.length} famil${omittedFamilies.length === 1 ? 'y' : 'ies'} omitted at the §8 gate`
    : '')

// ---- hoist the stats sections (fail-closed) ------------------------------
// stats-v3.mjs emits {models, nightAggregate, reliability, ...}. A §7
// section the stats file does not actually carry refuses assembly — a null
// section in a file whose header promises fail-closed is a silent drop.
//
// v3.2.3: the scrub happens HERE, before any hoisting — sections.ballotAccuracy
// is hoisted from the SAME scrubbed object that gets embedded, so an omitted
// family cannot ride into the publication through a pre-scrub alias.
const scrubbedStats = scrubOmittedFamilies(stats, omittedFamilies.map((o) => o.family))
// The embedded mapping covers exactly the families that survive the §8 gate.
// Recompute rather than filtering stored rows so its hash remains meaningful.
scrubbedStats.claimPropositions = publishableClaimPropositions
scrubbedStats.ledgerResolvedPropositionCountRange = publishableClaimPropositions.countRanges.resolved
scrubbedStats.ledgerAmbiguousPropositionCountRange = publishableClaimPropositions.countRanges.ambiguous
scrubbedStats.ledgerClaimReceipts = publishableClaimPropositions.receiptCount
// v3.2.4: per-model family FALSITY RATES do not publish — the exploratory
// campaign's recall validation supports author-adjudicated counts and
// receipts, not per-model rate comparisons whose true denominators it never
// established. Counts stay; the rate field goes, on every surface (the
// embedded stats and the hoisted ballotAccuracy are this same object).
for (const m of scrubbedStats.models ?? []) {
  for (const f of Object.values(m.ledgerFamilies ?? {})) delete f.falseRate
  for (const f of Object.values(m.ledgerReceiptFamilies ?? {})) delete f.falseRate
}
if (scrubbedStats.definitions) {
  scrubbedStats.definitions.ledgerFamilyRates =
    'counts only — per-model falsity rates require validated true denominators and recall the exploratory campaign does not establish (v3.2.4)'
}
const need = (obj, key, label) => {
  const v = obj[key]
  if (v === undefined || v === null) fail(`${label} lacks "${key}" — refusing to publish a null §7 section (§5 fail-closed)`)
  return v
}
const statModels = need(scrubbedStats, 'models', values.stats)
if (!Array.isArray(statModels) || statModels.length === 0) fail(`${values.stats}: "models" is empty`)
const nightAggregate = need(scrubbedStats, 'nightAggregate', values.stats)
const reliability = need(scrubbedStats, 'reliability', values.stats)
if (reliability.cohort !== 'scheduled-40') {
  fail(`${values.stats}: reliability cohort "${reliability.cohort}" — must be scheduled-40 (§1: reliability never excludes games for reliability problems)`)
}

// ---- negative sample (§6.2/§6.4) -----------------------------------------
// The published miss rate is the HUMAN rater's; agreement.mjs emits
// negatives.perRater rows with {ratedItems, itemsWithMiss, missRate,
// wilson95}, which gate G5 recomputes from {misses, n}.
const negRaters = agreement.negatives?.perRater
if (!Array.isArray(negRaters) || negRaters.length === 0) {
  fail(`${values.agreement}: no negatives.perRater — run agreement.mjs with --negatives-key (§6.2)`)
}
const humanNames = Array.isArray(manifest.humanRaters) ? manifest.humanRaters : null
const humanNeg = humanNames ? negRaters.filter((r) => humanNames.includes(r.rater)) : negRaters
// PF-2: the §6.2 sample may be the sensitivity rater's; the single
// published-family miss it surfaced was human-ruled in the packet.
let nr
if (humanNeg.length === 1) nr = humanNeg[0]
else if (pf2 && negRaters.length === 1) nr = negRaters[0]
else fail(`${values.agreement}: ${humanNeg.length} candidate human rater(s) for the negative sample — designate one via manifest.humanRaters, or run under PF-2 with a single sensitivity rater`)
if (typeof nr.ratedItems !== 'number' || nr.ratedItems < 80 || nr.ratedItems > 120) {
  fail(`${values.agreement}: negative sample n=${nr.ratedItems} is outside the §6.2 precommitted band 80–120`)
}
// Both recall figures, never conflated (§6.2 as read under PF-2): the
// published-family rate is sweep 1's recall number; the full-codebook rate
// (shelved vote families included) is sweep-2 evidence beside it.
if (!nr.publishedFamilies || !nr.fullCodebook) {
  fail(`${values.agreement}: negatives.perRater lacks the publishedFamilies/fullCodebook split — rerun agreement.mjs`)
}
const negativeSample = exploratoryV1 ? null : {
  rater: nr.rater, n: nr.ratedItems,
  publishedFamilies: nr.publishedFamilies,
  fullCodebook: nr.fullCodebook,
  // Legacy scalar fields = the PUBLISHED figure, the one sweep 1 stands on.
  misses: nr.publishedFamilies.itemsWithMiss,
  missRate: nr.publishedFamilies.missRate, wilson95: nr.publishedFamilies.wilson95,
}
const targetedCandidateScan = exploratoryV1 ? {
  rater: nr.rater,
  messagesScreened: nr.ratedItems,
  publishedFamilyCandidateMessages: nr.publishedFamilies.itemsWithMiss,
  fullCodebookCandidateMessages: nr.fullCodebook.itemsWithMiss,
  interpretation: 'model-assisted candidate generation with human adjudication of surfaced published-family candidates; targeted cleanup only, not a recall or omission-rate estimate',
} : null

// ---- opportunity summary (stats-v3 consumed the rows; the publication
// carries the summary and the hash that pins the exact table) --------------
const oppByKind = {}
for (const r of oppData) oppByKind[r.kind ?? 'unknown'] = (oppByKind[r.kind ?? 'unknown'] ?? 0) + 1

// ---- assemble, §7 inference-strength order -------------------------------
// negativeSample, honesty, sensitivity, reliability, and attestations sit at
// the top level: that is the schema the gates (check-gates.mjs G5/G7/G8/G12)
// audit.
const publication = {
  analysisRunId: RUN_ID,
  protocol: 'v3.2',
  specSha256: manifest.specSha256 ?? manifest.spec?.sha256 ?? null,
  evaluatorVersion: EVALUATOR_VERSION,
  cohorts: manifest.cohorts ?? null,
  ...(exploratoryV1 ? { targetedCandidateScan } : { negativeSample }),
  honesty: {
    secondHumanRater: humanRaters >= 2,
    mode: exploratoryV1 ? 'exploratory-v1' : 'full-v3.2-validation',
    protocol: exploratoryV1
      ? 'PF-2 single-author adjudication (exploratory v1)'
      : 'single-author validation protocol (v3.2 §8)',
    authorAdjudicatedReferenceSample: true,
    independentHumanGoldStandard: false,
    ...(exploratoryV1 ? {
      semanticResults: {
        exploratory: true,
        authorAdjudicated: true,
        potentiallyIncomplete: true,
        generalRecallOrOmissionRateEstimated: false,
        section8ThreeArmValidation: 'deferred beyond v1',
      },
    } : {
    // §8 evidence, embedded and hash-pinned: the label above is backed by the
    // unblinded validation summary, never asserted bare (review finding 10).
    // v3.2.4: the cross-check (with its hash-bound model artifact and every
    // disagreement resolution), the unaided first-pass metric, and every
    // closure iteration's summary embed too — the publication carries the
    // COMPLETE evidence chain, not its first page.
    validation: {
      path: values.validation,
      sha256: sha256(validationBytes),
      rater: validation.rater,
      label: validation.label ?? null,
      items: validation.items,
      census: validation.census,
      trueSample: validation.trueSample,
      messageScan: validation.messageScan,
      crossCheck: validation.crossCheck,
      unaidedFirstPass: validation.unaidedFirstPass,
      rulingsSha256: validation.rulingsSha256,
      finalRulingsSha256: validation.finalRulingsSha256 ?? null,
      modelRulingsSha256: validation.modelRulingsSha256,
      packetKeySha256: validation.packetKeySha256,
      closureIterations,
    },
    }),
  },
  sensitivity: { reversals: sensitivityIn.reversals },
  artifactBindings: {
    agreementSha256,
    sensitivitySha256,
    ...(pf2Sha256 ? { pf2Sha256 } : {}),
  },
  reliability,
  // §7: "renderer consumes only publication.json" is the contract this
  // assembler exists to serve; gate G12 requires the artifact to carry the
  // attestation because it is not statically provable from here.
  attestations: { rendererConsumesPublicationOnly: true },
  sections: {
    integrity: {
      logs: { dir: manifest.logs?.dir ?? null, count: manifest.logs?.count ?? null },
      specSha256: manifest.spec?.sha256 ?? null,
      codeCommit: manifest.codeCommit ?? null,
      archivedReadings: manifest.archivedReadings?.length ?? 0,
    },
    reliability,
    // Each row carries the §4 coverage/conditional/effective triplets, the
    // two strata, and the per-model ledger family counts.
    ballotAccuracy: statModels,
    // v3.2.4: the report-conditioned strata are classified Tier L — their
    // denominators are ledger-confirmed true investigation reports, so they
    // are ledger-dependent results, and they leave with investigation_claim
    // whenever that family is omitted (scrubOmittedFamilies enforces it).
    strataClassification: exploratoryV1
      ? 'report-conditioned investigation strata are exploratory, author-adjudicated, and potentially incomplete; no general recall/omission estimate is claimed'
      : 'report-conditioned investigation strata are Tier L (conditioned on ledger-confirmed true investigation reports); omitted with investigation_claim (v3.2.4)',
    nightActionsAggregate: nightAggregate,
    falseStatementLedger: {
      singleHumanAdjudicated: true,
      countLabel: 'author-adjudicated counts',
      language: falseStatementLanguage,
      // G13 resolves this basename strictly beneath --ledger, verifies the
      // exact file bytes, and derives the published receipt rows from it.
      // A copied claims[] array is evidence only when its source is pinned.
      sourceLedger: {
        filename: basename(resolve(values.ledger)),
        sha256: sha256(ledgerBytes),
      },
      // §8 gate: omitted families' rows are OUT of totals and claims, with
      // the omission disclosed here — counts of what was withheld included.
      omittedFamilies,
      totals: {
        // v3.2.4: quantitative totals cover VALIDATED verdicts only. The §8
        // arms adjudicate false rows (census) and true rows (sample);
        // ambiguous rows sit outside both, so they are disclosed beside the
        // totals — receipts published, never folded into a quantitative total.
        scope: 'underlying-proposition count ranges with validated verdicts (true/false) — nightless or unresolved-target action linkage uncertainty widens the range; R20 utterance receipts are exact and secondary; ambiguous propositions disclosed beside, not totaled (v3.2.6)',
        // Explicit field retained even though it equals true+false: consumers
        // must not infer the claim unit from receipt counts.
        propositionCountRange: publishableClaimPropositions.countRanges.resolved,
        claimUtteranceReceipts: publishable.filter((c) => c.verdict !== 'ambiguous').length,
        byKind: Object.fromEntries(Object.entries(publishableByKind).map(([k, v]) => [k, { true: v.true, false: v.false }])),
        falsePropositionCountRange: totalFalse,
        falseClaimUtteranceReceipts: totalFalseReceipts,
        falseClassRanges: publishableClaimPropositions.countRanges.falseClasses,
      },
      ambiguousDisclosed: {
        propositionCountRange: publishableClaimPropositions.countRanges.ambiguous,
        utteranceReceipts: publishable.filter((c) => c.verdict === 'ambiguous').length,
        byKind: Object.fromEntries(Object.entries(publishableByKind).map(([k, v]) => [k, v.ambiguous])),
        note: exploratoryV1
          ? 'author-adjudicated ambiguous propositions and receipts are disclosed, not folded into quantitative totals; §8 validation is deferred beyond v1'
          : 'outside the §8 validation arms — proposition and utterance receipts published, excluded from quantitative totals (v3.2.6)',
      },
      claimUnit: {
        primary: 'truth-resolved underlying claim proposition count range',
        secondary: 'public claim utterance receipt (R20)',
        mappingVersion: publishableClaimPropositions.version,
        mappingSha256: publishableClaimPropositions.mappingSha256,
        linkageBasisCounts: publishableClaimPropositions.linkageBasisCounts,
      },
      upperBoundPropositionCandidates: publishableClaimPropositions.upperBoundRows,
      claimsLabel: 'public claim utterance receipts — exact reiterations collapse; linkage-uncertain nightless or unresolved-target action receipts widen the proposition range',
      claims: publishable,
    },
    // Exploratory v1 deliberately does not embed agreement.mjs verbatim:
    // its negative-arm Wilson fields are useful pipeline diagnostics but are
    // not a valid recall/omission estimate under the chosen v1 scope. The
    // hash-bound external artifact remains available to gates G6/G14.
    ...(!exploratoryV1 ? { humanValidation: agreement } : {}),
    ...(pf2 ? { pf2, amendment: { path: values.amendment, sha256: amendmentSha256 } } : {}),
  },
  opportunity: { rows: oppData.length, byKind: oppByKind, sha256: sha256(oppBytes), path: values.opportunity },
  // v3.2.2/v3.2.3: an omitted family is omitted from EVERY surface — the
  // embedded statistics AND the hoisted sections come from one scrubbed
  // object (closure review finding 4; v3.2.3 item 8 caught ballotAccuracy
  // hoisted pre-scrub).
  stats: scrubbedStats,
  closureChain,
  manifest,
}
refuseForbidden('publication', publication)

mkdirSync(dirname(resolve(values.out)), { recursive: true })
const tmp = `${values.out}.tmp-${process.pid}`
writeFileSync(tmp, JSON.stringify(publication, null, 2) + '\n')
renameSync(tmp, values.out)
console.log(`wrote ${values.out} (${claims.length} confirmed claim utterance receipts; ${falseStatementLanguage}; ${oppData.length} opportunity rows)`)

// ---- §7 gates: publication.json is not a deliverable until they pass -----
// The gates must audit the SAME artifacts this publication embeds, so every
// shared input path is forwarded; check-gates takes the ledger as the
// directory holding the confirmed file. Gates-only inputs are resolved from
// THIS manifest's run directory and forwarded explicitly; otherwise a v3.2
// build can accidentally audit stale runs/analysis-v3 artifacts.
const gates = spawnSync(process.execPath, [
  values.gates,
  '--publication', resolve(values.out),
  '--manifest', resolve(values.manifest),
  '--agreement', resolve(values.agreement),
  '--ledger', dirname(resolve(values.ledger)),
  '--extract', resolve(values.extract),
  '--logs', resolve(values.logs),
  '--outdir', RUN_DIR,
  '--cleanroom', CLEANROOM_PATH,
  ...(TRIPWIRE_REPORT_PATH ? ['--tripwire-report', TRIPWIRE_REPORT_PATH] : []),
], { cwd: REPO_ROOT, stdio: 'inherit' })
if (gates.error) fail(`could not spawn ${values.gates}: ${gates.error.message}`)
if ((gates.status ?? 1) !== 0) process.exit(gates.status ?? 1)

// v3.2 §11: the semantic gates run BESIDE the publication gates, and under
// --strict a PENDING blocks exactly like a FAIL. The original 12 integrity
// gates validate provenance only; not one of them could have caught any of
// the 20 invalid rows the row-level audit found. G13 now additionally enforces
// the v3.2.6 claim-unit mapping. The gates must audit the SAME
// artifacts this publication embeds, so the stats DIRECTORY and the exact
// opportunity table are forwarded too (review finding 9: the spawn that
// forwarded only two paths audited whatever sat at the defaults).
const semantic = spawnSync(process.execPath, [
  join(REPO_ROOT, 'scripts', 'check-semantic-gates.mjs'), '--strict',
  '--publication', resolve(values.out),
  '--ledger', dirname(resolve(values.ledger)),
  '--stats', dirname(resolve(values.stats)),
  '--opportunity', resolve(values.opportunity),
  '--logs', resolve(values.logs),
], { cwd: REPO_ROOT, stdio: 'inherit' })
if (semantic.error) fail(`could not spawn check-semantic-gates.mjs: ${semantic.error.message}`)
process.exit(semantic.status ?? 1)
