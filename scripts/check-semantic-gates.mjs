// Semantic gates — analysis v3.2 §11, beside the publication gates.
//
// scripts/check-gates.mjs validates INTEGRITY AND PROVENANCE ONLY: hashes,
// run ids, coverage, artifact shape. Not one of its gates could have caught
// any of the 20 invalid rows in
// docs/analysis/audits/false-label-audit-2026-08-29.md — they were all
// semantic, and every artifact was perfectly well-formed. These gates check
// what the numbers MEAN.
//
// Three-valued, same as check-gates: PASS (checked and holds), FAIL (checked
// and violated), PENDING (the artifact this gate needs does not exist yet).
// Under --strict, which is the publication path, PENDING blocks exactly like
// FAIL. On a bare `pnpm run check`, run before any artifact exists, the
// source-level gates S1-S3 still run and PENDING is not an error.
//
// A missing SOURCE file is always FAIL, never a silent skip: the first
// version of S3 `continue`d past missing files and reported PASS having
// scanned nothing (review finding 15) — a gate that fails open is theater.
//
//   node scripts/check-semantic-gates.mjs [--strict]
//        [--publication runs/analysis-v3/publication.json]
//        [--ledger runs/analysis-v3/ledger] [--stats runs/analysis-v3/stats]
//        [--opportunity runs/analysis-v3/opportunity/table.jsonl]
//        [--logs data/sweep1]
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { sha256File } from './analysis-manifest.mjs'
import { nightIsStated } from '../packages/seats/scripts/semantics-v3.mjs'

const { values } = parseArgs({
  options: {
    strict: { type: 'boolean', default: false },
    spec: { type: 'string', default: 'docs/analysis/analysis-v3-spec.md' },
    amendment: { type: 'string', default: 'docs/analysis/analysis-v3.2-amendment.md' },
    publication: { type: 'string', default: 'runs/analysis-v3/publication.json' },
    ledger: { type: 'string', default: 'runs/analysis-v3/ledger' },
    stats: { type: 'string', default: 'runs/analysis-v3/stats' },
    opportunity: { type: 'string', default: 'runs/analysis-v3/opportunity/table.jsonl' },
    /** §2's recomputation source: the COMMITTED public logs, so S4 re-derives
     *  night admissibility from the messages themselves rather than trusting
     *  a flag an upstream stage wrote. */
    logs: { type: 'string', default: 'data/sweep1' },
  },
})

// v3.2 "Spec-is-law": the frozen v3.1 spec's sha256 at the time the amendment
// was written. The v3.1 file is pinned by the analysis manifest and binds every
// archived instrument reading; changing a byte of it orphans them, which is
// exactly why v3.2 is a separate document.
const FROZEN_SPEC_SHA256 = 'edbd93790ce40c96ab33de0557c1bf1d37040d2ab2b7728aee598080f1dd9f20'

const AMENDMENT_SECTIONS = [
  'Classifier fields are authoritative',
  'only when a night number is literally stated',
  'OK / BAD / **CORRECTED**',
  'byte-faithful projections of archived readings',
  'Two named vote-chance baselines',
  'both truthful result types',
  'first-time investigation targets',
  'The single-author validation protocol (frozen)',
  'Lower-bound language retired',
  'Admissibility advisories',
  'Semantic gates beside the publication gates',
]

// Retired vocabulary: each is a defect the amendment names, and each would be
// invisible to every integrity gate. Patterns cover template interpolation
// ("at least ${totals.false} verifiably false") and prose variants
// ("exactly chance", "before evidence exists") — the first version's narrow
// regexes let both ship (review finding 15).
const RETIRED_VOCABULARY = [
  { re: /exact(?:ly)? chance/i, why: 'v3.2 §5: baselines are policy-named; "exact chance" is retired' },
  { re: /at least \S+ verifiably false/i, why: 'v3.2 §9: lower-bound ("at least N") language is retired' },
  { re: /non-redundanc/i, why: 'v3.2 §7: the detective metric is "first-time investigation targets"' },
  { re: /before (?:any )?evidence exist/i, why: 'v3.2 §6: the stratum is "before any public verified investigation result" — votes, discussion and deaths are already evidence' },
]

const PASS = (detail) => ({ status: 'PASS', detail })
const FAIL = (detail) => ({ status: 'FAIL', detail })
const PENDING = (detail) => ({ status: 'PENDING', detail })

const readJson = (p) => (p && existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null)
const readJsonl = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
const listFiles = (dir, re) => (existsSync(dir) ? readdirSync(dir).filter((f) => re.test(f)).sort() : [])

const gates = []
const gate = (id, name, fn) => gates.push({ id, name, fn })

/** Verdict-stamped ledgers only: the confirmed-INPUT carries no verdicts. */
function ledgerFiles() {
  return listFiles(values.ledger, /\.jsonl$/).filter((f) => {
    try { return JSON.parse(readFileSync(join(values.ledger, f), 'utf8').split('\n')[0]).mode === 'ledger' } catch { return false }
  })
}
/** Stats artifacts only, by SHAPE: the stats directory also holds
 *  sensitivity.json and other JSON, and a bare *.json glob failed S6/S8 on a
 *  well-formed run because of them (review finding 9). */
function statsFiles() {
  return listFiles(values.stats, /\.json$/).filter((f) => {
    const j = readJson(join(values.stats, f))
    return j && Array.isArray(j.models) && j.definitions && typeof j.definitions === 'object'
  })
}

// ---- S1-S3: source-level, always evaluable ------------------------------

gate('S1', 'spec-is-law: the frozen v3.1 spec is byte-identical', () => {
  if (!existsSync(values.spec)) return FAIL(`${values.spec} is missing — the frozen spec must exist`)
  const actual = sha256File(values.spec)
  return actual === FROZEN_SPEC_SHA256
    ? PASS(`${values.spec} unchanged (${actual.slice(0, 12)}…)`)
    : FAIL(`${values.spec} sha256 ${actual.slice(0, 12)}… != the pinned ${FROZEN_SPEC_SHA256.slice(0, 12)}… — v3.1 is FROZEN; amend v3.2 instead`)
})

gate('S2', 'the v3.2 amendment exists and codifies all eleven sections', () => {
  if (!existsSync(values.amendment)) return FAIL(`${values.amendment} is missing`)
  const text = readFileSync(values.amendment, 'utf8')
  const missing = AMENDMENT_SECTIONS.filter((s) => !text.includes(s))
  return missing.length
    ? FAIL(`amendment does not codify: ${missing.join('; ')}`)
    : PASS(`${AMENDMENT_SECTIONS.length} sections codified`)
})

gate('S3', 'no retired vocabulary on any reader-facing v3.2 surface', () => {
  // Source-level, so it holds before any artifact exists. The scan covers
  // every file whose strings can reach a reader: the statistics and table
  // emitters, the packet builder, the publication assembler, the ledger
  // builder, the gates, and — above all — the site renderer, which the first
  // version of this gate did not scan while it shipped "exact chance" in a
  // column header (review finding 15).
  const targets = [
    'scripts/stats-v3.mjs', 'scripts/opportunity-table.mjs', 'scripts/build-review-packet.mjs',
    'scripts/render-site.mjs', 'scripts/build-publication.mjs', 'scripts/build-ledger.mjs',
    'scripts/check-gates.mjs',
  ]
  const hits = []
  const missing = []
  for (const path of targets) {
    if (!existsSync(path)) { missing.push(path); continue }
    readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
      // Whole-line comments are where the retirement is DOCUMENTED; what the
      // gate is after is retired vocabulary that can still reach a reader —
      // console output, JSON field names, artifact values.
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return
      for (const v of RETIRED_VOCABULARY) if (v.re.test(line)) hits.push(`${path}:${i + 1} — ${v.why}`)
    })
  }
  if (missing.length) return FAIL(`cannot scan missing file(s): ${missing.join(', ')} — a gate never passes on files it did not read`)
  return hits.length ? FAIL(hits[0] + (hits.length > 1 ? ` (+${hits.length - 1} more)` : ''))
    : PASS(`${targets.length} v3.2 source files scanned, clear of retired vocabulary`)
})

// ---- S4-S9: artifact-level ----------------------------------------------

gate('S4', 'every published claimedNight is literally stated in its message (§2)', () => {
  // Recomputed from the COMMITTED logs, not trusted from a flag: for every
  // published record carrying a claimedNight, the source message must
  // literally state that night (semantics-v3's statedNights, the same
  // helper the pipeline uses). Strike markers are normal, counted operation —
  // the first version of this gate FAILed the publication on any struck
  // marker, contradicting §2's strike-and-continue design (review finding 10).
  const files = ledgerFiles()
  if (files.length === 0) return PENDING(`no verdict-stamped ledger in ${values.ledger}`)
  const messageCache = new Map()
  const textAt = (seed, seq) => {
    if (!messageCache.has(seed)) {
      const logPath = join(values.logs, `${seed}.jsonl`)
      if (!existsSync(logPath)) return { missingLog: logPath }
      const bySeq = new Map()
      for (const e of readJsonl(logPath)) if (e.type === 'message_sent') bySeq.set(e.seq, e.payload.text)
      messageCache.set(seed, bySeq)
    }
    return { text: messageCache.get(seed).get(seq) }
  }
  const errors = []
  let n = 0, withNight = 0, struck = 0
  for (const f of files) {
    for (const c of readJsonl(join(values.ledger, f))) {
      if (c._meta) continue
      n += 1
      if (c.claimedNightStruck !== undefined) struck += 1
      if (c.claimedNight === undefined || c.claimedNight === null) continue
      withNight += 1
      if (c.claimedNight === c.claimedNightStruck) {
        errors.push(`${c.seed}#${c.seq}: claimedNight equals its own strike marker — contradictory record`)
        continue
      }
      const { text, missingLog } = textAt(c.seed, c.seq)
      if (missingLog) { errors.push(`${c.seed}#${c.seq}: no log at ${missingLog} — cannot recompute §2`); continue }
      if (typeof text !== 'string') { errors.push(`${c.seed}#${c.seq}: no public message at that seq`); continue }
      if (!nightIsStated(c.claimedNight, text)) {
        errors.push(`${c.seed}#${c.seq}: claimedNight ${c.claimedNight} is not literally stated in the message (§2)`)
      }
    }
  }
  return errors.length
    ? FAIL(errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} more)` : ''))
    : PASS(`${n} record(s): ${withNight} stated night(s) recomputed against the logs, ${struck} strike marker(s) (normal operation)`)
})

gate('S5', 'a v3.2 publication is protocol-labeled, never lower-bound-labeled (§9)', () => {
  const pub = readJson(values.publication)
  if (!pub) return PENDING(`no publication at ${values.publication}`)
  if (pub.honesty?.protocol === undefined) {
    return FAIL('publication carries no honesty.protocol — not a v3.2 artifact (archived v3.1 artifacts validate at the manifest-pinned code commit, never against these gates)')
  }
  const errors = []
  if (pub.honesty.lowerBoundLanguage === true) {
    errors.push('honesty.lowerBoundLanguage is asserted on a v3.2 publication (v3.2 §9 retires it)')
  }
  const language = pub.sections?.falseStatementLedger?.language ?? ''
  if (/at least/i.test(language)) errors.push(`falseStatementLedger.language is lower-bound wording: ${JSON.stringify(language)}`)
  if (!/author-adjudicated/i.test(language)) errors.push(`falseStatementLedger.language must be protocol-labeled ("author-adjudicated counts"), got ${JSON.stringify(language)}`)
  if (pub.honesty.mode === 'exploratory-v1') {
    const scope = pub.honesty.semanticResults
    if (pub.honesty.protocol !== 'PF-2 single-author adjudication (exploratory v1)') {
      errors.push(`exploratory-v1 protocol label is wrong: ${JSON.stringify(pub.honesty.protocol)}`)
    }
    if (scope?.exploratory !== true || scope?.authorAdjudicated !== true ||
        scope?.potentiallyIncomplete !== true || scope?.generalRecallOrOmissionRateEstimated !== false ||
        scope?.section8ThreeArmValidation !== 'deferred beyond v1') {
      errors.push('exploratory-v1 semanticResults must explicitly say exploratory, author-adjudicated, potentially incomplete, no general recall/omission estimate, and §8 deferred')
    }
    if (pub.honesty.validation !== undefined) {
      errors.push('exploratory-v1 must not embed or imply a §8 validation summary that was not run')
    }
    if (!/exploratory/i.test(language) || !/potentially incomplete/i.test(language)) {
      errors.push(`exploratory-v1 ledger language must disclose exploratory/potentially incomplete scope, got ${JSON.stringify(language)}`)
    }
    return errors.length ? FAIL(errors.join('; ')) : PASS(`honestly scoped exploratory-v1 semantics: ${JSON.stringify(language)}`)
  }
  if (!pub.honesty.validation?.census?.byFamily) errors.push('honesty.validation.census.byFamily missing — the §8 label needs its evidence (review finding 10)')
  return errors.length ? FAIL(errors.join('; ')) : PASS(`protocol-labeled with embedded §8 evidence: ${JSON.stringify(language)}`)
})

gate('S6', 'both truthful result types feed the renamed report stratum (§6)', () => {
  const files = statsFiles()
  if (files.length === 0) return PENDING(`no statistics artifact in ${values.stats}`)
  const errors = []
  for (const f of files) {
    const s = readJson(join(values.stats, f))
    const types = s?.definitions?.reportStratumResultTypes
    if (!Array.isArray(types) || !types.includes('mafia') || !types.includes('not mafia')) {
      errors.push(`${f}: report strata must be computed over BOTH truthful result types, got ${JSON.stringify(types ?? null)}`)
      continue
    }
    for (const m of s.models ?? []) {
      if (!m.strata?.beforeAnyPublicVerifiedInvestigationResult) {
        errors.push(`${f}: model ${m.model} lacks the renamed stratum beforeAnyPublicVerifiedInvestigationResult`)
        break
      }
      if (m.strata.preAnyPublicDetectiveReport) {
        errors.push(`${f}: model ${m.model} still publishes the retired stratum name`)
        break
      }
    }
  }
  return errors.length ? FAIL(errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} more)` : ''))
    : PASS(`${files.length} statistics artifact(s) use the renamed stratum over both result types`)
})

gate('S7', 'every ledger record projects an archived reading (§4)', () => {
  const files = ledgerFiles()
  if (files.length === 0) return PENDING(`no verdict-stamped ledger in ${values.ledger}`)
  // build-ledger performs the byte-level projection under --extract; this gate
  // audits that it was actually run, because a projection check nobody invoked
  // is exactly the v3.1 situation.
  const unchecked = []
  for (const f of files) {
    const meta = readJsonl(join(values.ledger, f))[0]
    if (meta?.projectionChecked !== true) unchecked.push(f)
  }
  return unchecked.length
    ? FAIL(`${unchecked.join(', ')}: built without the §4 projection check — rerun build-ledger with --extract --require-projection`)
    : PASS(`${files.length} ledger(s) built under the §4 projection check`)
})

gate('S8', 'the retired targetNotReported conjunct is empirically vacuous (§7)', () => {
  const files = statsFiles()
  if (files.length === 0) return PENDING(`no statistics artifact in ${values.stats}`)
  const errors = []
  for (const f of files) {
    const s = readJson(join(values.stats, f))
    // Evidence, not a constant: stats-v3 fails before writing when violations
    // exist, so a boolean literal could never fail here (review finding: S8
    // tautological). The artifact must carry the recorded denominator.
    const v = s?.definitions?.vacuity
    if (!v || typeof v.checked !== 'number' || v.checked <= 0 || v.violations !== 0) {
      errors.push(`${f}: no vacuity evidence ({checked > 0, violations: 0}) — the first-time-targets value is [pending] until recorded`)
    }
    if (s?.nightAggregate && !('detectiveFirstTimeTargets' in s.nightAggregate)) {
      errors.push(`${f}: nightAggregate lacks detectiveFirstTimeTargets`)
    }
  }
  return errors.length ? FAIL(errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} more)` : ''))
    : PASS(`${files.length} statistics artifact(s) carry vacuity evidence with a non-zero denominator`)
})

gate('S9', 'both named chance baselines on every town-ballot row (§5)', () => {
  if (!existsSync(values.opportunity)) return PENDING(`no opportunity table at ${values.opportunity}`)
  const rows = readJsonl(values.opportunity).filter((r) => !r._meta)
  const votes = rows.filter((r) => r.kind === 'day_vote' && r.role !== 'mafia')
  if (votes.length === 0) return PENDING('opportunity table carries no town ballots')
  const bad = votes.filter((r) =>
    typeof r.chanceUniformOverLegalTargets !== 'number' || typeof r.chanceUniformOverLivingNonSelf !== 'number')
  return bad.length
    ? FAIL(`${bad.length} town ballot(s) without both named baselines (first: ${bad[0].seed}#${bad[0].seq}) — regenerate the table under v3.2 §5`)
    : PASS(`${votes.length} town ballot(s) carry both named baselines`)
})

gate('S10', 'closure: every false ledger row carries a §8 adjudication (v3.2.2)', () => {
  const pub = readJson(values.publication)
  if (pub?.honesty?.mode === 'exploratory-v1') {
    const scope = pub.honesty.semanticResults
    if (scope?.section8ThreeArmValidation !== 'deferred beyond v1' ||
        scope?.potentiallyIncomplete !== true || scope?.generalRecallOrOmissionRateEstimated !== false) {
      return FAIL('exploratory-v1 cannot defer §8 closure without the complete potentially-incomplete/no-recall scope disclosure')
    }
    return PASS('§8 closure explicitly deferred beyond v1; no closure, precision, recall, or completeness claim is published')
  }
  // The §8 sitting's rulings APPLY (apply-review-rulings) and rebuilding can
  // create new false rows; this gate is what drives the closure loop — it
  // stays PENDING (blocking publication under --strict) until every false row
  // in every verdict-stamped ledger carries a reviewRuling, and it FAILs on a
  // malformed ruling. Counts never satisfy it; the stamps do.
  const files = ledgerFiles()
  if (files.length === 0) return PENDING(`no verdict-stamped ledger in ${values.ledger}`)
  const errors = []
  let falseRows = 0, ruled = 0
  const unruled = []
  for (const f of files) {
    for (const c of readJsonl(join(values.ledger, f))) {
      if (c._meta || c.verdict !== 'false') continue
      falseRows += 1
      const rr = c.reviewRuling
      // The stamp must have been made ABOUT this row's falsity: a stamp from
      // a true-sample or message-scan sitting (verdictAtRuling !== 'false')
      // never closes a row that BECAME false on rebuild — that row goes into
      // the next census (closure rerun finding 3).
      if (!rr || rr.verdictAtRuling !== 'false') { unruled.push(`${c.seed}#${c.seq}`); continue }
      ruled += 1
      if (!['OK', 'BAD', 'CORRECTED'].includes(rr.ruling) || typeof rr.rule !== 'string' || rr.rule.trim() === '') {
        errors.push(`${f} ${c.seed}#${c.seq}: malformed reviewRuling (needs a ruling and a codebook rule)`)
      }
      if (rr.ruling === 'BAD') {
        errors.push(`${f} ${c.seed}#${c.seq}: a BAD-ruled row is still in the ledger — apply-review-rulings withdraws it; this ledger was not rebuilt from the applied confirmed-input`)
      }
    }
  }
  if (errors.length) return FAIL(errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} more)` : ''))
  if (unruled.length) {
    return PENDING(`closure incomplete: ${unruled.length}/${falseRows} false row(s) await §8 adjudication (${unruled.slice(0, 3).join(', ')}…) — build the next census packet over exactly these rows`)
  }
  return PASS(`${falseRows} false row(s), every one carrying a §8 adjudication stamp`)
})

// ---- run -----------------------------------------------------------------

const results = gates.map((g) => ({ id: g.id, name: g.name, ...g.fn() }))
const width = Math.max(...results.map((r) => r.name.length))
console.log(`analysis-v3.2 semantic gates · ${values.strict ? 'strict (publication path)' : 'acceptance check'}\n`)
for (const r of results) {
  console.log(`${r.id.padEnd(4)} ${r.status.padEnd(8)} ${r.name.padEnd(width)}  ${r.detail}`)
}
const counts = { PASS: 0, FAIL: 0, PENDING: 0 }
for (const r of results) counts[r.status] += 1
console.log(`\n${counts.PASS} pass · ${counts.FAIL} fail · ${counts.PENDING} pending`)
const blocking = counts.FAIL + (values.strict ? counts.PENDING : 0)
if (blocking > 0) {
  console.log(values.strict
    ? 'publication is BLOCKED: every semantic gate must PASS'
    : 'semantic gates FAILED')
  process.exit(1)
}
if (counts.PENDING > 0 && !values.strict) {
  console.log('pending gates need run artifacts; they block under --strict (the publication path)')
}
