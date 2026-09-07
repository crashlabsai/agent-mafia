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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { EVALUATOR_VERSION, applyCorrection, gameFacts, scoreGame } from '../packages/seats/scripts/scoring-v3.mjs'
import { projectionErrors } from '../packages/seats/scripts/ledger-projection-v3.mjs'
import { checkCohortBinding, checkRunId, loadManifest, sha256File, writeFileAtomic } from './analysis-manifest.mjs'
import { checkResolvingContext, exactFormattingEquivalentSubstring, SHELVED_KINDS, validatePublishedShape } from './correction-validation.mjs'

const { values } = parseArgs({
  options: {
    confirmed: { type: 'string' },
    logs: { type: 'string', default: 'runs/sweep-download/sweep1' },
    manifest: { type: 'string', default: 'runs/analysis-v3/manifest.json' },
    cohort: { type: 'string', default: 'headline-38' },
    /** v3.2 §4: the archived instrument readings every ledger record must be a
     *  byte-faithful projection of. Without it the projection check cannot
     *  run, and --require-projection turns that into a hard failure. */
    extract: { type: 'string' },
    'require-projection': { type: 'boolean', default: false },
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
  // v3.2: a night the message never literally stated was struck (§2); a
  // stored CORRECTED ruling reached the scorer (§3); a §10 advisory rode
  // along to adjudication (advisories never remove records — counted only).
  advisories: 0,
  claimedNightStruck: 0,
  corrections: 0,
  machineContextFormattingRepairs: 0,
  mergedDuplicates: 0,
}

// R13 holds even for human-recovered rejects and misses: a confirmed
// assertion whose kind-required fields are absent (or whose provenance
// lacks a seat) is not a checkable proposition — counted out, never scored.
counts.unscorableRecovered = 0

const bySeed = new Map()
for (const r of kept) {
  if (!r.human.confirmed) { counts.unconfirmed += 1; continue }
  // Reachability is decided on the effective, post-correction proposition.
  // Otherwise a valid human correction that supplies a machine-missing
  // target/result is discarded before the correction can reach the scorer.
  // The raw record is retained in bySeed for projection/provenance checks.
  const effective = applyCorrection(r)
  if (SHELVED_KINDS.has(effective.kind)) { counts.shelvedExcluded += 1; continue }
  if (!PUBLISHED.has(effective.kind)) {
    fail(`${r.seed} seq ${r.seq}: unknown effective claim kind ${JSON.stringify(effective.kind)} — refusing to silently shelve a typo`)
  }
  // Exact published-family shape validation happens before any reachability
  // exclusion. A confirmed row missing R13 fields is corrupt input, not a
  // harmless "unscorable" row that may disappear from publication.
  try {
    validatePublishedShape({
      where: `ledger ${r.seed}#${r.seq}`,
      kind: effective.kind,
      fields: effective,
    })
  } catch (err) { fail(String(err.message ?? err)) }
  if (!r.seat) {
    counts.unscorableRecovered += 1
    console.error(`note: ${r.seed} seq ${r.seq} (${effective.kind}) confirmed but unscorable — no seat`)
    continue
  }
  if (!bySeed.has(r.seed)) bySeed.set(r.seed, [])
  bySeed.get(r.seed).push(r)
}

// v3.2 §4: the archived instrument readings. A ledger record must project one
// of these, a stored CORRECTED ruling, or a recorded human recovery — nothing
// else. sweep1-39's claimedNight existed only in the derived record, and v3.1
// had no comparison that could see it.
//
// Keying: one message can carry two same-kind claims ("I checked Bryan —
// mafia. Also cleared Sam."), and the extractor archives both. A bare
// (seed, seq, kind) key made the last reading win and hard-failed the other
// record on faithful data (review finding 6), so the key carries a
// fingerprint of the scoring fields; a bare-key fallback covers the
// single-reading case.
const FINGERPRINT_FIELDS = ['role', 'target', 'result', 'claimedNight', 'referencedDay', 'conditional']
const fpNorm = (f, v) => (f === 'target' ? String(v).trim().toLowerCase() : v)
const fingerprint = (r) => FINGERPRINT_FIELDS
  .filter((f) => r[f] !== undefined && r[f] !== null)
  .map((f) => `${f}=${JSON.stringify(fpNorm(f, r[f]))}`).join(',')
const readings = new Map() // `${seed}|${seq}|${kind}` -> reading[]
if (values.extract) {
  if (!existsSync(values.extract)) fail(`--extract ${values.extract}: directory does not exist`)
  const { readdirSync } = await import('node:fs')
  for (const f of readdirSync(values.extract).filter((n) => n.endsWith('.claims.jsonl')).sort()) {
    for (const line of readFileSync(join(values.extract, f), 'utf8').trim().split('\n').filter(Boolean)) {
      const r = JSON.parse(line)
      if (r._meta) continue
      const key = `${r.seed}|${r.seq}|${r.kind}`
      if (!readings.has(key)) readings.set(key, [])
      readings.get(key).push(r)
    }
  }
} else if (values['require-projection']) {
  fail('--require-projection needs --extract: the archived readings are what a ledger record projects (v3.2 §4)')
}
// The projection is checked on the RAW confirmed record — its kind and fields
// as adjudicated, before the scorer applies any correction — so the reading
// key is the record's own kind, and among same-key readings the one whose
// scoring fields fingerprint the record's is the record's own reading.
const readingFor = (r) => {
  const group = readings.get(`${r.seed}|${r.seq}|${r.kind}`) ?? []
  if (group.length === 1) return group[0]
  return group.find((g) => fingerprint(g) === fingerprint(r)) ?? null
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
    // R19 belt for corrections: merge-packet-rulings validated the corrected
    // span and stored its offset; verify both here too, so a corrected quote
    // can never publish unless it sits byte-exact in the source message.
    if (typeof c.corrected?.quote === 'string') {
      const cAt = c.corrected.charStart
      if (typeof cAt !== 'number' || text.slice(cAt, cAt + c.corrected.quote.length) !== c.corrected.quote) {
        fail(`${seed} seq ${c.seq}: CORRECTED quote is not byte-exact at its stored charStart — pipeline corruption (R19, v3.2 §3)`)
      }
    }
    // v3.2 §4: byte-faithful projection of the archived instrument reading.
    if (values.extract) {
      const errs = projectionErrors(c, readingFor(c))
      if (errs.length) fail(errs[0] + (errs.length > 1 ? ` (+${errs.length - 1} more)` : ''))
    }
    // v3.2.6 belts: every effective published record — not only recovered or
    // human-corrected ones — must have its family's exact semantic shape.
    // Ordinary classifier resolvingContext lives under machine; validate the
    // effective context here before the proposition layer may use it.
    let effective = applyCorrection(c)
    try {
      validatePublishedShape({ where: `${seed} seq ${c.seq}`, kind: effective.kind, fields: effective })
      const contextWasCorrected = Boolean(c.corrected && Object.prototype.hasOwnProperty.call(c.corrected, 'resolvingContext'))
      let effectiveContext = contextWasCorrected
        ? c.corrected.resolvingContext
        : (effective.resolvingContext ?? effective.machine?.resolvingContext ?? null)
      const getMessage = (_s, seq) => {
        const priorText = facts.messageTexts.get(seq)
        const actor = facts.messageActors.get(seq)
        return typeof priorText === 'string' ? { text: priorText, actor } : undefined
      }
      try {
        checkResolvingContext(effectiveContext, effective, `${seed} seq ${c.seq}`, getMessage)
      } catch (err) {
        // The archived v3.2.1 machine readings contain one known typographic
        // context defect (space omitted beside an em dash). Preserve the raw
        // reading through the projection check above, then repair only a
        // UNIQUE whitespace-formatting-equivalent span from the verified
        // public source. Human corrections and semantic mismatches still fail.
        const message = String(err?.message ?? err)
        const machineContext = !contextWasCorrected ? effective.machine?.resolvingContext : null
        const source = machineContext ? getMessage(seed, machineContext.seq)?.text : null
        const exact = message.includes('not a byte-exact substring') && typeof source === 'string'
          ? exactFormattingEquivalentSubstring(source, machineContext.text)
          : null
        if (!exact) throw err
        const repair = {
          field: 'machine.resolvingContext.text',
          reason: 'unique whitespace-formatting-equivalent source span',
          from: machineContext.text,
          to: exact,
        }
        c.machine = { ...c.machine, resolvingContext: { ...machineContext, text: exact } }
        c.provenanceRepairs = [...(c.provenanceRepairs ?? []), repair]
        counts.machineContextFormattingRepairs += 1
        effective = applyCorrection(c)
        effectiveContext = effective.machine.resolvingContext
        checkResolvingContext(effectiveContext, effective, `${seed} seq ${c.seq}`, getMessage)
      }
    } catch (err) {
      fail(String(err.message ?? err))
    }
    if (c.corrected) counts.corrections += 1
  }

  const scored = scoreGame(claims, facts)
  counts.mergedDuplicates += claims.length - scored.length
  for (const s of scored) {
    if (s.claimedNightStruck !== undefined) counts.claimedNightStruck += 1
    if (s.advisory) counts.advisories += 1
    if (s.verdict === 'ABSORBED') { counts.absorbed += 1; continue }
    if (s.verdict === 'RECORDED') {
      counts.recordedDenials += 1
      continue
    }
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
  // v3.2.2 closure chain: which §8 packets were applied to reach this ledger,
  // by exact hashes — build-publication verifies against these, never counts.
  confirmedInputSha256: sha256File(values.confirmed),
  closureChain: meta.appliedPackets ?? [],
  cohort: values.cohort,
  // The full cohort game list, so stats-v3's binding holds even when a
  // cohort game produced zero confirmed published-family claims.
  seeds: cohortGames,
  rater: meta.rater,
  // v3.2 §4: semantic gate S7 audits that the projection check was actually
  // RUN — a check nobody invoked is exactly the v3.1 situation.
  projectionChecked: Boolean(values.extract),
  claims: out.length, verdicts: verdictCounts, counts,
}
try { checkCohortBinding(manifest, values.cohort, new Set(outMeta.seeds)) } catch (err) { fail(String(err.message ?? err)) }
writeFileAtomic(values.out, [outMeta, ...out].map((r) => JSON.stringify(r)).join('\n') + '\n')
console.log(
  `wrote ${values.out}: ${out.length} ledger claims (${verdictCounts.true} true, ${verdictCounts.false} false, ` +
  `${verdictCounts.ambiguous} ambiguous) — dropped: ${counts.unconfirmed} unconfirmed/UNSURE, ` +
  `${counts.shelvedExcluded} shelved, ${counts.absorbed} absorbed, ${counts.recordedDenials} recorded denials, ` +
  `${counts.mergedDuplicates} merged duplicates; ` +
  `applied ${counts.corrections} CORRECTED ruling(s), struck ${counts.claimedNightStruck} unstated night(s), ` +
  `repaired ${counts.machineContextFormattingRepairs} machine context formatting defect(s), ` +
  `${counts.advisories} advisory-flagged (v3.2 §10 — informational only)`,
)
