// The ledger builder — the seam between human confirmation and statistics.
// Governing spec: docs/analysis/analysis-v3-spec.md (v3.1) §3, §6.1, §8.
//
// handcheck-v3 ingest emits confirmed-input.jsonl: sealed-key claim records
// with { human: { rater, confirmed, note } } merged on. This script applies
// scoring-v3's deterministic truth checks to the HUMAN-CONFIRMED records and
// writes the verdict-stamped ledger that stats-v3 and build-publication
// consume. Verdict assignment happens here and only here: raters never saw
// verdicts (§6.1 blinding), and no LLM output publishes unconfirmed.
//
// Fail-closed rules:
// - The manifest must load and its analysisRunId must match the input meta.
// - Every log consumed is re-hashed against the manifest before use.
// - R19 belt: every claim's quote must be byte-exact at charStart in its
//   source message — a mismatch is pipeline corruption, exit 1.
// - Only verdicts true | false | ambiguous enter the ledger (§3). ABSORBED
//   duplicates and RECORDED role denials are counted in the meta and kept
//   out; shelved families and unconfirmed/UNSURE records are counted and
//   dropped. Nothing vanishes without a number.
//
//   node scripts/build-ledger.mjs --confirmed runs/analysis-v3/ledger/confirmed-input.jsonl \
//        --logs runs/sweep-download/sweep1 --manifest runs/analysis-v3/manifest.json \
//        --cohort headline-38 --out runs/analysis-v3/ledger/confirmed.jsonl
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { EVALUATOR_VERSION, gameFacts, scoreGame } from '../packages/seats/scripts/scoring-v3.mjs'
import { checkCohortBinding, checkRunId, loadManifest, sha256File, writeFileAtomic } from './analysis-manifest.mjs'

const { values } = parseArgs({
  options: {
    confirmed: { type: 'string' },
    logs: { type: 'string', default: 'runs/sweep-download/sweep1' },
    manifest: { type: 'string', default: 'runs/analysis-v3/manifest.json' },
    cohort: { type: 'string', default: 'headline-38' },
    /** One confirmed-input spans all 40 games; per-cohort ledgers drop the
     *  excluded games' claims here, counted in the meta, never silently. */
    'drop-out-of-cohort': { type: 'boolean', default: false },
    out: { type: 'string', default: 'runs/analysis-v3/ledger/confirmed.jsonl' },
  },
})
const fail = (msg) => { console.error(msg); process.exit(1) }
if (!values.confirmed) fail('usage: node scripts/build-ledger.mjs --confirmed confirmed-input.jsonl [--logs dir] [--manifest m.json] [--cohort name] [--out ledger.jsonl]')

const PUBLISHED = new Set(['role_claim', 'not_mafia_claim', 'investigation_claim', 'protection_claim'])
const LEDGER_VERDICTS = new Set(['true', 'false', 'ambiguous'])

let manifest
try { manifest = loadManifest(values.manifest) } catch (err) { fail(String(err.message ?? err)) }

const lines = readFileSync(values.confirmed, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const meta = lines.find((r) => r._meta)
if (!meta || meta.mode !== 'confirmed-input') fail(`${values.confirmed}: not a confirmed-input file (run handcheck-v3 ingest first)`)
try { checkRunId(manifest, meta, values.confirmed) } catch (err) { fail(String(err.message ?? err)) }
const records = lines.filter((r) => !r._meta)

// §6.1: every record must carry an explicit human block — its absence means
// the confirm-all pass did not cover it, which is a pipeline defect.
const unruled = records.filter((r) => typeof r.human?.confirmed !== 'boolean')
if (unruled.length) fail(`${unruled.length} record(s) lack a human ruling (items ${unruled.slice(0, 5).map((r) => r.item).join(', ')}…) — §6.1 confirm-all violated`)

const cohortGames = manifest.cohorts?.[values.cohort]?.games
if (!cohortGames) fail(`manifest has no cohort "${values.cohort}"`)
const inputSeeds = new Set(records.map((r) => r.seed))
const outOfCohort = [...inputSeeds].filter((s) => !cohortGames.includes(s))
let droppedOutOfCohort = 0
let kept = records
if (outOfCohort.length && values['drop-out-of-cohort']) {
  const outSet = new Set(outOfCohort)
  kept = records.filter((r) => !outSet.has(r.seed))
  droppedOutOfCohort = records.length - kept.length
} else if (outOfCohort.length) {
  fail(`confirmed input carries seeds outside cohort ${values.cohort}: ${outOfCohort.join(', ')} (pass --drop-out-of-cohort to filter)`)
}

const counts = {
  input: kept.length,
  droppedOutOfCohort,
  unconfirmed: 0, // human said BAD or UNSURE — never enters the ledger
  shelvedExcluded: 0,
  absorbed: 0,
  recordedDenials: 0,
  mergedDuplicates: 0,
}

// R13 holds even for human-recovered rejects and misses: a confirmed
// assertion whose kind-required fields are absent (or whose provenance
// lacks a seat) is not a checkable proposition — counted out, never scored.
const REQUIRED = { role_claim: ['role'], not_mafia_claim: [], investigation_claim: ['target', 'result'], protection_claim: ['target'] }
counts.unscorableRecovered = 0

const bySeed = new Map()
for (const r of kept) {
  if (!r.human.confirmed) { counts.unconfirmed += 1; continue }
  if (!PUBLISHED.has(r.kind)) { counts.shelvedExcluded += 1; continue }
  const missing = (REQUIRED[r.kind] ?? []).filter((f) => r[f] === undefined || r[f] === null)
  if (!r.seat || missing.length > 0) {
    counts.unscorableRecovered += 1
    console.error(`note: ${r.seed} seq ${r.seq} (${r.kind}) confirmed but unscorable — ${!r.seat ? 'no seat; ' : ''}${missing.length ? `missing ${missing.join(', ')} (R13)` : ''}`)
    continue
  }
  if (!bySeed.has(r.seed)) bySeed.set(r.seed, [])
  bySeed.get(r.seed).push(r)
}

const out = []
const verdictCounts = { true: 0, false: 0, ambiguous: 0 }
for (const seed of [...bySeed.keys()].sort()) {
  const pinned = manifest.logs?.files?.[seed]?.sha256
  if (!pinned) fail(`manifest pins no hash for ${seed}`)
  const logPath = join(values.logs, `${seed}.jsonl`)
  if (sha256File(logPath) !== pinned) fail(`${logPath}: bytes do not match the manifest pin — refusing to score against a modified log`)
  const events = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const facts = gameFacts(events)

  const claims = bySeed.get(seed)
  for (const c of claims) {
    // R19 belt: the receipt's quote must sit byte-exact in the source
    // message. Extraction already pinned it; a mismatch here means an
    // artifact was altered between stages.
    const text = facts.messageTexts.get(c.seq)
    if (typeof text !== 'string') fail(`${seed} seq ${c.seq}: no public message at that seq`)
    const at = typeof c.charStart === 'number' ? c.charStart : text.indexOf(c.quote)
    if (at < 0 || text.slice(at, at + c.quote.length) !== c.quote) {
      fail(`${seed} seq ${c.seq}: quote is not byte-exact at charStart — pipeline corruption (R19)`)
    }
  }

  const scored = scoreGame(claims, facts)
  counts.mergedDuplicates += claims.length - scored.length
  for (const s of scored) {
    if (s.verdict === 'ABSORBED') { counts.absorbed += 1; continue }
    if (s.verdict === 'RECORDED') { counts.recordedDenials += 1; continue }
    if (!LEDGER_VERDICTS.has(s.verdict)) {
      fail(`${seed} seq ${s.seq}: published-family claim scored "${s.verdict}" — outside the ledger vocabulary (§3)`)
    }
    verdictCounts[s.verdict] += 1
    out.push({ ...s, analysisRunId: manifest.analysisRunId })
  }
}

const outMeta = {
  _meta: true, mode: 'ledger', analysisRunId: manifest.analysisRunId,
  evaluatorVersion: EVALUATOR_VERSION,
  cohort: values.cohort,
  // The full cohort game list, so stats-v3's binding holds even when a
  // cohort game produced zero confirmed published-family claims.
  seeds: cohortGames,
  rater: meta.rater,
  claims: out.length, verdicts: verdictCounts, counts,
}
try { checkCohortBinding(manifest, values.cohort, new Set(outMeta.seeds)) } catch (err) { fail(String(err.message ?? err)) }
writeFileAtomic(values.out, [outMeta, ...out].map((r) => JSON.stringify(r)).join('\n') + '\n')
console.log(
  `wrote ${values.out}: ${out.length} ledger claims (${verdictCounts.true} true, ${verdictCounts.false} false, ` +
  `${verdictCounts.ambiguous} ambiguous) — dropped: ${counts.unconfirmed} unconfirmed/UNSURE, ` +
  `${counts.shelvedExcluded} shelved, ${counts.absorbed} absorbed, ${counts.recordedDenials} recorded denials, ` +
  `${counts.mergedDuplicates} merged duplicates`,
)
