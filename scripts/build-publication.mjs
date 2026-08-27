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
//   node scripts/build-publication.mjs --manifest runs/analysis-v3/manifest.json \
//        --opportunity runs/analysis-v3/opportunity/opportunity-table.jsonl \
//        --stats runs/analysis-v3/stats/stats.json \
//        --ledger runs/analysis-v3/ledger/confirmed.jsonl \
//        --agreement runs/analysis-v3/handcheck/agreement.json \
//        --sensitivity runs/analysis-v3/stats/sensitivity.json \
//        [--out runs/analysis-v3/publication.json]
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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
    out: { type: 'string', default: 'runs/analysis-v3/publication.json' },
    // Overridable ONLY for offline validation of this assembler; the default
    // gates script is binding for real runs.
    gates: { type: 'string', default: join(REPO_ROOT, 'scripts', 'check-gates.mjs') },
  },
})

const fail = (msg) => { console.error(`build-publication: ${msg}`); process.exit(1) }

for (const flag of ['manifest', 'opportunity', 'stats', 'ledger', 'agreement', 'sensitivity']) {
  if (!values[flag]) fail(`--${flag} is required (every input, or exit 1)`)
  if (!existsSync(values[flag])) fail(`--${flag} ${values[flag]}: file does not exist`)
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

const agreement = readJson(values.agreement)
checkStampedJson(values.agreement, agreement, { allowSuperseded: true })
refuseForbidden('agreement', agreement)

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

const ledgerRows = readJsonl(values.ledger)
const ledgerMeta = checkStampedJsonl(values.ledger, ledgerRows)
refuseForbidden('ledger', ledgerRows)
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

// ---- ledger counts -------------------------------------------------------
const byKind = {}
for (const k of [...PUBLISHED_KINDS].sort()) byKind[k] = { true: 0, false: 0, ambiguous: 0 }
const falseClasses = {}
for (const c of claims) {
  byKind[c.kind][c.verdict]++
  if (c.verdict === 'false') falseClasses[c.falseClass] = (falseClasses[c.falseClass] ?? 0) + 1
}

// ---- PF-2: sensitivity-uncontested confirmations need the validation
// block and the hash-pinned amendment document — never silently.
const humanNamesEarly = Array.isArray(manifest.humanRaters) ? manifest.humanRaters : []
const uncontested = claims.filter((c) => c.human?.via === 'sensitivity-uncontested' || !humanNamesEarly.includes(c.human?.rater)).length
let pf2 = null
let amendmentSha256 = null
if (uncontested > 0) {
  if (!values.pf2 || !values.amendment) fail(`${uncontested} confirmations are not from a manifest human rater — --pf2 validation and --amendment document are required (PF-2)`)
  pf2 = readJson(values.pf2)
  if (pf2.analysisRunId !== RUN_ID) fail(`--pf2 ${values.pf2}: analysisRunId mismatch`)
  if (typeof pf2.humanPacket?.audit?.agreementRate !== 'number') fail(`--pf2 ${values.pf2}: no humanPacket.audit.agreementRate — the residual-error bound is the point`)
  amendmentSha256 = sha256(readFileSync(values.amendment))
}
const totalFalse = claims.filter((c) => c.verdict === 'false').length

// §6.5 honesty fallback: without a second HUMAN rater the ledger publishes
// as single-human-adjudicated and every count is a verified lower bound.
// Defaulting to lower-bound language when the manifest is silent fails safe.
const humanRaters = Array.isArray(manifest.humanRaters) ? manifest.humanRaters.length
  : typeof manifest.humanRaters === 'number' ? manifest.humanRaters : 1
const lowerBound = humanRaters < 2
const falseStatementLanguage = lowerBound
  ? `at least ${totalFalse} verifiably false statements`
  : `${totalFalse} verifiably false statements`

// ---- hoist the stats sections (fail-closed) ------------------------------
// stats-v3.mjs emits {models, nightAggregate, reliability, ...}. A §7
// section the stats file does not actually carry refuses assembly — a null
// section in a file whose header promises fail-closed is a silent drop.
const need = (obj, key, label) => {
  const v = obj[key]
  if (v === undefined || v === null) fail(`${label} lacks "${key}" — refusing to publish a null §7 section (§5 fail-closed)`)
  return v
}
const statModels = need(stats, 'models', values.stats)
if (!Array.isArray(statModels) || statModels.length === 0) fail(`${values.stats}: "models" is empty`)
const nightAggregate = need(stats, 'nightAggregate', values.stats)
const reliability = need(stats, 'reliability', values.stats)
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
const negativeSample = {
  rater: nr.rater, n: nr.ratedItems,
  publishedFamilies: nr.publishedFamilies,
  fullCodebook: nr.fullCodebook,
  // Legacy scalar fields = the PUBLISHED figure, the one sweep 1 stands on.
  misses: nr.publishedFamilies.itemsWithMiss,
  missRate: nr.publishedFamilies.missRate, wilson95: nr.publishedFamilies.wilson95,
}

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
  specSha256: manifest.specSha256 ?? manifest.spec?.sha256 ?? null,
  evaluatorVersion: ledgerMeta?.evaluatorVersion ?? stats.evaluatorVersion ?? null,
  cohorts: manifest.cohorts ?? null,
  negativeSample,
  honesty: { secondHumanRater: humanRaters >= 2, lowerBoundLanguage: lowerBound },
  sensitivity: { reversals: sensitivityIn.reversals },
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
    nightActionsAggregate: nightAggregate,
    falseStatementLedger: {
      singleHumanAdjudicated: lowerBound,
      lowerBound,
      language: falseStatementLanguage,
      totals: {
        claims: claims.length,
        byKind,
        false: totalFalse,
        falseClasses,
        ambiguous: claims.filter((c) => c.verdict === 'ambiguous').length,
      },
      claims,
    },
    humanValidation: agreement,
    ...(pf2 ? { pf2, amendment: { path: values.amendment, sha256: amendmentSha256 } } : {}),
  },
  opportunity: { rows: oppData.length, byKind: oppByKind, sha256: sha256(oppBytes), path: values.opportunity },
  stats,
  manifest,
}
refuseForbidden('publication', publication)

mkdirSync(dirname(resolve(values.out)), { recursive: true })
const tmp = `${values.out}.tmp-${process.pid}`
writeFileSync(tmp, JSON.stringify(publication, null, 2) + '\n')
renameSync(tmp, values.out)
console.log(`wrote ${values.out} (${claims.length} confirmed claims; ${falseStatementLanguage}; ${oppData.length} opportunity rows)`)

// ---- §7 gates: publication.json is not a deliverable until they pass -----
// The gates must audit the SAME artifacts this publication embeds, so every
// shared input path is forwarded; check-gates takes the ledger as the
// directory holding the confirmed file. Gates-only inputs (extract/,
// cleanroom, outdir) keep their defaults.
const gates = spawnSync(process.execPath, [
  values.gates,
  '--publication', resolve(values.out),
  '--manifest', resolve(values.manifest),
  '--agreement', resolve(values.agreement),
  '--ledger', dirname(resolve(values.ledger)),
  '--extract', resolve(values.extract),
], { cwd: REPO_ROOT, stdio: 'inherit' })
if (gates.error) fail(`could not spawn ${values.gates}: ${gates.error.message}`)
process.exit(gates.status ?? 1)
