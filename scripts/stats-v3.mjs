// stats-v3 — the statistics layer of analysis v3.1 (docs/analysis/analysis-v3-spec.md §4),
// as amended by docs/analysis/analysis-v3.2-amendment.md §5-§7. Consumes the
// opportunity table and the confirmed claim ledger; emits the
// coverage/conditional/effective triplets with paired excess over EACH of the
// two policy-named baselines (§5 — never "exact chance"), the two §4 strata
// with the renamed report stratum fed by BOTH truthful result types (§6),
// aggregate-only night metrics including first-time investigation targets with
// its empirical vacuity assertion (§7), per-model ledger family counts, and
// the scheduled-40 reliability report. Descriptive throughout:
// rows are alphabetical, denominators are always printed, nothing here orders
// models, and per-model rates with denominator n<10 publish as counts (§4).
//
//   node scripts/stats-v3.mjs --opportunity runs/analysis-v3/opportunity/table.jsonl \
//        --ledger runs/analysis-v3/ledger/claims.jsonl \
//        --manifest runs/analysis-v3/manifest.json --cohort headline-38 \
//        [--logs runs/sweep-download/sweep1] [--bootstrap-n 20000] [--json out.json]
//
// Fail-closed (§5): refuses to run unless the manifest loads and verifies,
// every input artifact carries the manifest's analysisRunId, the opportunity
// table is bound (not 'UNBOUND'), every scheduled log's bytes match the
// manifest's per-file sha256, and the LEDGER's seed coverage passes
// checkCohortBinding against --cohort (§5 required failing test: a strict-31
// scored artifact consumed as headline-38 must fail). Behavioral numbers come
// from the --cohort games only; reliability comes from ALL scheduled-40 games
// regardless of cohort, because computing reliability after excluding games
// FOR reliability problems is survivorship bias (§1).
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { draw } from '../packages/engine/src/rng.ts'
// The binding scoring-v3 API (§8): gameFacts/resolveEffectiveClaimTarget are the same
// resolution the scorer used, so stats can map ledger target spellings
// (table names, per the claim-record contract) back to seat ids.
import { EVALUATOR_VERSION, gameFacts, resolveEffectiveClaimTarget } from '../packages/seats/scripts/scoring-v3.mjs'
import * as manifestApi from './analysis-manifest.mjs'
import { aggregateClaimPropositions } from './claim-propositions.mjs'

const USAGE = `usage: node scripts/stats-v3.mjs --opportunity <table.jsonl> --ledger <claims.jsonl> \\
       --cohort <name> [--manifest runs/analysis-v3/manifest.json] \\
       [--logs runs/sweep-download/sweep1] [--bootstrap-n 20000] [--json out.json]`

const fail = (msg) => {
  console.error(`stats-v3: ${msg}`)
  process.exit(1)
}

let values
try {
  ;({ values } = parseArgs({
    options: {
      opportunity: { type: 'string' },
      ledger: { type: 'string' },
      manifest: { type: 'string', default: 'runs/analysis-v3/manifest.json' },
      cohort: { type: 'string' },
      logs: { type: 'string', default: 'runs/sweep-download/sweep1' },
      json: { type: 'string' },
      'bootstrap-n': { type: 'string' },
    },
  }))
} catch (e) {
  fail(`${e.message}\n${USAGE}`)
}
for (const flag of ['opportunity', 'ledger', 'cohort']) {
  if (!values[flag]) fail(`--${flag} is required\n${USAGE}`)
}

// ---- manifest ----------------------------------------------------------
// Coordinated helper names (spec §8, scripts/analysis-manifest.mjs):
// checkRunId(manifest, runId, label) and checkCohortBinding(manifest, name,
// seeds) both throw on mismatch. loadManifest/verifyManifest are used when
// exported so full manifest verification lives in one place.
const { checkCohortBinding, checkRunId } = manifestApi
if (typeof checkCohortBinding !== 'function' || typeof checkRunId !== 'function') {
  fail('scripts/analysis-manifest.mjs must export checkCohortBinding and checkRunId')
}
if (!existsSync(values.manifest)) fail(`manifest not found: ${values.manifest}`)
let manifest
try {
  manifest =
    typeof manifestApi.loadManifest === 'function'
      ? manifestApi.loadManifest(values.manifest)
      : JSON.parse(readFileSync(values.manifest, 'utf8'))
  if (typeof manifestApi.verifyManifest === 'function') manifestApi.verifyManifest(manifest)
} catch (e) {
  fail(`manifest failed to load/verify: ${e.message}`)
}
if (!manifest || typeof manifest.analysisRunId !== 'string' || !manifest.analysisRunId) {
  fail('manifest has no analysisRunId')
}
const runId = manifest.analysisRunId

const cohortSeedsOf = (name) => {
  const def = manifest.cohorts?.[name]
  const seeds = Array.isArray(def) ? def : (def?.seeds ?? def?.games)
  if (!Array.isArray(seeds) || seeds.length === 0) {
    fail(`manifest defines no seed list for cohort '${name}'`)
  }
  return [...new Set(seeds)].sort()
}
const cohortSeeds = cohortSeedsOf(values.cohort)
const scheduledSeeds = cohortSeedsOf('scheduled-40')
const cohortSet = new Set(cohortSeeds)
for (const s of cohortSeeds) {
  if (!scheduledSeeds.includes(s)) fail(`cohort '${values.cohort}' seed ${s} is not in scheduled-40`)
}

// ---- input artifacts ---------------------------------------------------
const readJsonl = (path) => {
  if (!existsSync(path)) fail(`input not found: ${path}`)
  const rows = []
  const lines = readFileSync(path, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    try {
      rows.push(JSON.parse(line))
    } catch {
      fail(`${path}:${i + 1} is not valid JSON`)
    }
  }
  return rows
}
// Every derived artifact embeds analysisRunId; every consumer verifies it (§5).
const checkArtifactRunId = (rows, label) => {
  const ids = new Set(rows.map((r) => r.analysisRunId))
  if (ids.has(undefined) || ids.has(null) || ids.has('')) fail(`${label} has records without analysisRunId`)
  if (ids.has('UNBOUND')) fail(`${label} is UNBOUND — regenerate it against the frozen manifest`)
  if (ids.size !== 1) fail(`${label} mixes ${ids.size} analysisRunIds`)
  try {
    checkRunId(manifest, [...ids][0], label)
  } catch (e) {
    fail(`${label}: ${e.message}`)
  }
}

const oppAll = readJsonl(values.opportunity)
const oppRows = oppAll.filter((r) => !r._meta)
if (oppRows.length === 0) fail(`opportunity table is empty: ${values.opportunity}`)
checkArtifactRunId(oppRows, 'opportunity table')

const ledgerAll = readJsonl(values.ledger)
const ledgerRows = ledgerAll.filter((r) => !r._meta)
if (ledgerRows.length > 0) checkArtifactRunId(ledgerRows, 'ledger')
// Every meta line is an input artifact and MUST be stamped — a meta without
// an analysisRunId is a v1/v2-shaped or truncated artifact, and a ledger
// with neither rows nor a stamped meta has no provenance at all (§5).
for (const [rows, label] of [[oppAll, 'opportunity table meta'], [ledgerAll, 'ledger meta']]) {
  for (const meta of rows.filter((r) => r._meta)) {
    checkArtifactRunId([meta], label)
  }
}
if (ledgerAll.length === 0) fail(`ledger is empty (no records, no meta line): ${values.ledger}`)
const ledgerMeta = ledgerAll.find((r) => r._meta)
if (!ledgerMeta || ledgerMeta.evaluatorVersion !== EVALUATOR_VERSION) {
  fail(`ledger evaluatorVersion ${JSON.stringify(ledgerMeta?.evaluatorVersion ?? null)} != current ${EVALUATOR_VERSION} — rebuild the ledger before computing statistics`)
}

// §5 required failing test: an artifact scored on one cohort's seed set must
// never be consumed as another cohort's. The ledger declares its coverage via
// a meta seed list when one exists; otherwise the seeds its records actually
// cover are the coverage. Either must exactly match the --cohort definition.
const ledgerMetaSeeds = ledgerAll
  .filter((r) => r._meta)
  .flatMap((m) => (Array.isArray(m.seeds) ? m.seeds : Array.isArray(m.games) ? m.games : []))
const ledgerSeeds = [...new Set(ledgerMetaSeeds.length > 0 ? ledgerMetaSeeds : ledgerRows.map((r) => r.seed))]
try {
  checkCohortBinding(manifest, values.cohort, ledgerSeeds)
} catch (e) {
  fail(`ledger is not a '${values.cohort}' artifact: ${e.message}`)
}

// Kind names as scripts/opportunity-table.mjs emits them (day_vote plus
// NIGHT_KIND_BY_ROLE: night_kill / night_protect / night_investigate),
// normalized to the short forms used below.
const KIND = {
  day_vote: 'vote',
  night_kill: 'kill',
  night_protect: 'protect',
  night_investigate: 'investigate',
}
for (const r of oppRows) {
  const k = KIND[r.kind]
  if (!k) fail(`opportunity row ${r.seed}#${r.seq}: unknown kind '${r.kind}'`)
  r.kind = k
}
const tableSeeds = new Set(oppRows.map((r) => r.seed))
for (const s of tableSeeds) {
  if (!scheduledSeeds.includes(s)) fail(`opportunity table has seed ${s} outside scheduled-40`)
}
for (const s of cohortSeeds) {
  if (!tableSeeds.has(s)) fail(`opportunity table is missing cohort seed ${s}`)
}

// ---- verified logs: seat→model bindings + reliability ------------------
// Reliability covers ALL scheduled-40 games (§1). seat→model is recomputed
// from the verified log, never trusted from a derived artifact (R18). Log
// bytes are checked against the manifest's per-file sha256 — stored at
// manifest.logs.files[seed].sha256 (analysis-manifest.mjs buildManifest) —
// so --logs pointing anywhere still verifies against the frozen corpus;
// a seed the manifest cannot vouch for is a hard failure, never a warning
// (§5: one changed byte anywhere fails the run).
const manifestHashOf = (seed) => manifest.logs?.files?.[seed]?.sha256 ?? null

const modelOf = new Map() // seed -> Map(seat -> modelKey)
const factsOf = new Map() // seed -> gameFacts(events)  (roles, names, votes…)
const mafiaBallotSeqOf = new Map() // seed -> Map(seat -> first seq of a ballot on a true mafia seat)
const rel = new Map() // modelKey -> reliability accumulator
const relFor = (m) => {
  if (!rel.has(m)) {
    rel.set(m, {
      wakes: 0, firstValid: 0, recovered: 0, retryAttempts: 0,
      invalidActionAttempts: 0, providerErrorAttempts: 0, abortedAttempts: 0,
      timeoutsDeadline: 0, timeoutsNoncompliance: 0, timeoutsProviderError: 0,
      terminalDefaults: 0,
      discussionTurns: 0, discussionSpoke: 0, voteTurns: 0, validBallots: 0,
    })
  }
  return rel.get(m)
}

for (const seed of scheduledSeeds) {
  const path = join(values.logs, `${seed}.jsonl`)
  if (!existsSync(path)) fail(`scheduled-40 log missing: ${path} — reliability must cover all scheduled games`)
  const bytes = readFileSync(path)
  const want = manifestHashOf(seed)
  if (!want) fail(`manifest records no sha256 for ${seed} — its bytes cannot be verified (§5)`)
  const got = createHash('sha256').update(bytes).digest('hex')
  if (got !== want) fail(`log ${seed} sha256 mismatch: manifest ${want} != file ${got}`)

  const events = bytes.toString('utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const facts = gameFacts(events)
  factsOf.set(seed, facts)
  const models = new Map()
  for (const e of events) {
    if (e.type === 'seat_bound') models.set(e.payload.seat, e.payload.modelKey)
  }
  modelOf.set(seed, models)
  // victim-had-voted-mafia needs seq-accurate ballot history: the first seq
  // at which each seat cast a ballot on a true mafia seat (forced defaults
  // carry target null and never count). Same construction the opportunity
  // table uses for its per-submission fact, recomputed here from the
  // verified log for the night's victim (R18).
  const mb = new Map()
  for (const e of events) {
    if (e.type !== 'vote_cast') continue
    const p = e.payload ?? {}
    const voter = p.seat ?? e.actor
    if (p.target && facts.roles[p.target] === 'mafia' && !mb.has(voter)) mb.set(voter, e.seq)
  }
  mafiaBallotSeqOf.set(seed, mb)

  // Timeout mechanics: a timeout event immediately precedes the defaulted
  // event by the same actor (verified against sweep1 logs), so pendingTimeout
  // marks exactly the next event as forced.
  let pendingTimeout = null
  for (const e of events) {
    const p = e.payload ?? {}
    const m = e.actor ? relFor(models.get(e.actor) ?? '?') : null
    if (!m) continue
    if (e.type === 'timeout') {
      m.terminalDefaults += 1
      if (p.cause === 'deadline') m.timeoutsDeadline += 1
      else if (p.cause === 'noncompliance') m.timeoutsNoncompliance += 1
      else if (p.cause === 'provider_error') m.timeoutsProviderError += 1
      pendingTimeout = e.actor
      continue
    }
    if (e.type === 'attempts_recorded') {
      const attempts = p.attempts ?? []
      m.wakes += 1
      if (attempts[0]?.outcome === 'ok') m.firstValid += 1
      else if (attempts.some((a) => a.outcome === 'ok')) m.recovered += 1
      m.retryAttempts += Math.max(0, attempts.length - 1)
      for (const a of attempts) {
        if (a.outcome === 'invalid_action') m.invalidActionAttempts += 1
        else if (a.outcome === 'provider_error') m.providerErrorAttempts += 1
        else if (a.outcome === 'aborted') m.abortedAttempts += 1
      }
    }
    if (e.phase === 'discussion' && (e.type === 'message_sent' || e.type === 'passed')) {
      m.discussionTurns += 1
      if (e.type === 'message_sent' && pendingTimeout !== e.actor) m.discussionSpoke += 1
    }
    if (e.type === 'vote_cast') {
      m.voteTurns += 1
      if (pendingTimeout !== e.actor && p.target !== null) m.validBallots += 1
    }
    pendingTimeout = null
  }
}

// R18 cross-check: a table row's model must agree with the log's binding.
for (const r of oppRows) {
  const logModel = modelOf.get(r.seed)?.get(r.seat)
  if (!logModel) fail(`opportunity row ${r.seed}#${r.seq}: seat ${r.seat} has no seat_bound in the log`)
  if (r.model && r.model !== logModel) {
    fail(`opportunity row ${r.seed}#${r.seq}: model '${r.model}' contradicts log binding '${logModel}' (R18)`)
  }
  r.model = logModel
}

// ---- groundTruth contract with scripts/opportunity-table.mjs -----------
// The table stamps groundTruth only on TARGETED rows (forced defaults and
// abstains carry null), with these fields per kind:
//   vote:        { targetRole, targetIsMafia }
//   protect:     { targetRole, selfProtect, interceptedKill }
//   investigate: { targetRole, result, previouslyCheckedByThisDetective }
//   kill:        { targetRole, targetWasPowerRole, targetHadVotedMafia,
//                  nightVictim, intercepted } — target* fields describe THAT
//                  member's submission; nightVictim is the night's resolved
//                  kill choice, identical on every targeted row of the night.
// Missing fields are a hard failure: silently guessing ground truth is how
// evaluators go wrong.
const gtOf = (row) => row.groundTruth ?? {}
const isAbstain = (s) => s === null || s === undefined || s === 'abstain'
const voteHit = (row) => {
  if (isAbstain(row.submitted)) return false
  const gt = gtOf(row)
  if ('targetRole' in gt) return gt.targetRole === 'mafia'
  fail(`vote row ${row.seed}#${row.seq}: groundTruth needs targetRole`)
}
const protectFacts = (row) => {
  const gt = gtOf(row)
  if (typeof gt.interceptedKill !== 'boolean' || typeof gt.selfProtect !== 'boolean') {
    fail(`protect row ${row.seed}#${row.seq}: groundTruth needs interceptedKill and selfProtect`)
  }
  return gt
}
// v3.2 §7: "first-time investigation targets" — a check on a seat this
// detective has not checked before. Living is guaranteed by the table (targets
// outside the legal living set hard-fail its derivation). The v3.1 metric
// conjoined targetNotReported, which is LOGICALLY VACUOUS here: with one
// detective per game and fixed roles, a confirmed true public report of a
// target presupposes that same detective already checked it, so
// !previouslyChecked implies targetNotReported. The conjunct is retired, the
// metric renamed away from "non-redundancy" (which overclaimed — a first-time
// target may still be redundant on other public evidence), and the vacuity is
// ASSERTED empirically on every rebuild rather than argued and trusted.
const investigateFirstTimeTarget = (row) => {
  const gt = gtOf(row)
  if (typeof gt.previouslyCheckedByThisDetective !== 'boolean') {
    fail(`investigate row ${row.seed}#${row.seq}: groundTruth needs previouslyCheckedByThisDetective`)
  }
  return !gt.previouslyCheckedByThisDetective
}

// ---- ledger: confirmed claims -----------------------------------------
// Only the four published families count in sweep 1 (§2.1); shelved-family
// records are carried but publish nothing. §6.1 confirm-all: every
// published-family record must carry a human block — one without ANY human
// block is a §6.1 violation and fails the run, not a filtering matter —
// and only an explicit human.confirmed === true publishes (the rule
// build-publication enforces); an overturned or unconfirmed record counts
// nowhere.
const PUBLISHED = ['investigation_claim', 'not_mafia_claim', 'protection_claim', 'role_claim']
const VERDICTS = ['true', 'false', 'ambiguous']
const unreviewed = ledgerRows.filter((r) => PUBLISHED.includes(r.kind) && !r.human)
if (unreviewed.length > 0) {
  fail(`ledger: ${unreviewed.length} published-family record(s) with no human block ` +
    `(first: ${unreviewed[0].seed}#${unreviewed[0].seq} ${unreviewed[0].kind}) — §6.1 confirm-all requires every machine-positive human-reviewed`)
}
const confirmed = ledgerRows.filter(
  (r) => PUBLISHED.includes(r.kind) && VERDICTS.includes(r.verdict) && r.human?.confirmed === true,
)
const confirmedCohort = confirmed.filter((claim) => cohortSet.has(claim.seed))
// v3.2.6: R20 receipts remain in the ledger. Exact repeat links collapse, but
// nightless or unresolved-target actions may be either repeats or new events,
// so paper-facing proposition counts are ranges rather than invented totals.
const aggregateConfirmed = (rows) => aggregateClaimPropositions(rows, {
  resolveTarget: (claim) => {
    const facts = factsOf.get(claim.seed)
    if (!facts) fail(`ledger ${claim.seed}#${claim.seq}: no verified facts for proposition grouping`)
    return resolveEffectiveClaimTarget(claim, facts)
  },
  getMessage: (seed, seq) => {
    const facts = factsOf.get(seed)
    const text = facts?.messageTexts?.get(seq)
    const actor = facts?.messageActors?.get(seq)
    return typeof text === 'string' ? { text, actor } : undefined
  },
})
const claimPropositions = aggregateConfirmed(confirmedCohort)

// §4 strata are derived from ledger-confirmed TRUE detective reports: an
// investigation_claim with verdict 'true' is necessarily the real detective
// reporting a real result. The claim record carries the extracted target
// STRING (a table name, per the §8 claim-record contract) — it is resolved to
// a seat id here with the same binding resolveTarget the scorer used, so a
// record the scorer graded 'true' must resolve; one that does not is corrupt
// and fails the run.
//
// v3.2 §6: BOTH truthful result types feed the strata. v3.1 admitted
// result === 'mafia' only, dropping every truthful public clear — and a
// truthful clear is equally a public verified investigation result, and
// equally changes what the table knows.
const TRUTHFUL_RESULT_TYPES = ['mafia', 'not mafia']
const reportsBySeed = new Map()
for (const c of confirmed) {
  if (c.kind !== 'investigation_claim' || c.verdict !== 'true') continue
  if (!TRUTHFUL_RESULT_TYPES.includes(c.result)) continue
  if (!c.target) fail(`ledger ${c.seed}#${c.seq}: true investigation_claim without a target`)
  const facts = factsOf.get(c.seed)
  if (!facts) fail(`ledger ${c.seed}#${c.seq}: seed ${c.seed} has no scheduled-40 log`)
  const target = resolveEffectiveClaimTarget(c, facts)
  if (!target) fail(`ledger ${c.seed}#${c.seq}: target '${c.target}' does not resolve to a seat in ${c.seed}`)
  const arr = reportsBySeed.get(c.seed) ?? []
  arr.push({ seq: c.seq, target, result: c.result })
  reportsBySeed.set(c.seed, arr)
}
const beforeAnyPublicVerifiedInvestigationResult = (row) => {
  const reports = reportsBySeed.get(row.seed) ?? []
  return reports.every((r) => r.seq >= row.seq)
}
const targetNotReported = (row) => {
  const reports = reportsBySeed.get(row.seed) ?? []
  return reports.every((r) => r.seq >= row.seq || r.target !== row.submitted)
}

// ---- behavioral accumulation (cohort games only) -----------------------
const cohortRows = oppRows.filter((r) => cohortSet.has(r.seed))
// v3.2 §5: two policy-named baselines are accumulated in parallel — legal
// (uniform over every legal target, self included) and nonSelf (uniform over
// living non-self targets). Neither is "exact chance".
const zeroBallot = () => ({ opps: 0, valid: 0, validNA: 0, hits: 0, chanceSumLegal: 0, chanceSumNonSelf: 0 })
const addBallot = (acc, row, hit) => {
  acc.opps += 1
  // A timeout-forced default is not the seat's action: it counts as an
  // opportunity but never as a valid action (same stance as R14's forced-
  // ballot exclusion).
  if (!row.valid || row.forced) return
  acc.valid += 1
  if (isAbstain(row.submitted)) return
  for (const f of ['chanceUniformOverLegalTargets', 'chanceUniformOverLivingNonSelf']) {
    if (typeof row[f] !== 'number') {
      fail(`vote row ${row.seed}#${row.seq}: town ballot without ${f} — regenerate the opportunity table under v3.2 §5`)
    }
  }
  acc.validNA += 1
  acc.hits += hit ? 1 : 0
  acc.chanceSumLegal += row.chanceUniformOverLegalTargets
  acc.chanceSumNonSelf += row.chanceUniformOverLivingNonSelf
}

const perModel = new Map() // model -> {all, villager, pre, byGame: Map, notRep: {n,hits,chanceSum,byGame}}
const modelFor = (m) => {
  if (!perModel.has(m)) {
    perModel.set(m, {
      all: zeroBallot(), villager: zeroBallot(), pre: zeroBallot(),
      byGame: new Map(),
      notRep: { validNA: 0, hits: 0, chanceSumLegal: 0, chanceSumNonSelf: 0 },
    })
  }
  return perModel.get(m)
}
const gameAccFor = (entry, game) => {
  if (!entry.byGame.has(game)) entry.byGame.set(game, zeroBallot())
  return entry.byGame.get(game)
}

const night = {
  protect: { n: 0, intercepts: 0, selfProtects: 0 },
  investigate: { n: 0, firstTimeTargets: 0 },
  kill: { nights: 0, victims: 0, powerRole: 0, votedMafia: 0 },
  byGame: new Map(),
}
const nightGameAcc = (game) => {
  if (!night.byGame.has(game)) {
    night.byGame.set(game, {
      prot: 0, intercepts: 0, selfProt: 0, inv: 0, firstTime: 0,
      nights: 0, victims: 0, power: 0, votedMafia: 0,
    })
  }
  return night.byGame.get(game)
}
const nightKillGroups = new Map() // `${seed}|${day}|${phase}` -> that night's mafia kill rows
// v3.2 §7: rows where the retired targetNotReported conjunct would have
// removed a first-time target. The argument says this list is always empty;
// the run refuses to publish the metric unless it actually is. The number of
// rows CHECKED is recorded too: gate S8 audits {checked > 0, violations: 0}
// as evidence, because a bare boolean the writer always sets to true is a
// gate that can never fail (review finding: S8 tautological).
const vacuityViolations = []
let vacuityChecked = 0

for (const row of cohortRows) {
  if (row.kind === 'vote') {
    if (row.role === 'mafia') continue // town ballots only (§4)
    const hit = voteHit(row)
    const entry = modelFor(row.model)
    addBallot(entry.all, row, hit)
    addBallot(gameAccFor(entry, row.seed), row, hit)
    if (row.role === 'villager') addBallot(entry.villager, row, hit)
    if (beforeAnyPublicVerifiedInvestigationResult(row)) addBallot(entry.pre, row, hit)
    if (row.valid && !row.forced && !isAbstain(row.submitted) && targetNotReported(row)) {
      entry.notRep.validNA += 1
      entry.notRep.hits += hit ? 1 : 0
      entry.notRep.chanceSumLegal += row.chanceUniformOverLegalTargets
      entry.notRep.chanceSumNonSelf += row.chanceUniformOverLivingNonSelf
    }
    continue
  }
  // Night metrics are aggregate-only — each model held doctor/detective only
  // 3–4 times, so per-model night rates are noise (§4). Never keyed by model.
  const g = nightGameAcc(row.seed)
  const acted = row.valid && !row.forced && !isAbstain(row.submitted)
  if (row.kind === 'protect' && acted) {
    const gt = protectFacts(row)
    night.protect.n += 1
    g.prot += 1
    if (gt.interceptedKill) { night.protect.intercepts += 1; g.intercepts += 1 }
    if (gt.selfProtect) { night.protect.selfProtects += 1; g.selfProt += 1 }
  }
  if (row.kind === 'investigate' && acted) {
    night.investigate.n += 1
    g.inv += 1
    if (investigateFirstTimeTarget(row)) { night.investigate.firstTimeTargets += 1; g.firstTime += 1 }
    // v3.2 §7: the empirical vacuity assertion for the retired conjunct.
    // Argued vacuity is not enough to publish a number: if a first-time target
    // ever WAS the subject of an earlier confirmed true public report, the
    // implication is false for this corpus and the metric's rename is
    // unjustified. Fail loudly with the offending row rather than quietly
    // publishing a different quantity than the one described.
    vacuityChecked += 1
    if (investigateFirstTimeTarget(row) && !targetNotReported(row)) {
      vacuityViolations.push(`${row.seed}#${row.seq} (detective ${row.seat} -> ${row.submitted})`)
    }
  }
  if (row.kind === 'kill') {
    const key = `${row.seed}|${row.day}|${row.phase}`
    if (!nightKillGroups.has(key)) nightKillGroups.set(key, [])
    nightKillGroups.get(key).push(row)
  }
}

// v3.2 §7: the vacuity assertion fires here, over the whole cohort table,
// before any first-time-targets number is computed.
if (vacuityViolations.length > 0) {
  fail(
    `v3.2 §7 vacuity assertion FAILED: ${vacuityViolations.length} first-time investigation target(s) WERE the ` +
    `subject of an earlier confirmed true public detective report — the retired targetNotReported conjunct was ` +
    `not vacuous for this corpus, so "first-time investigation targets" is not the metric v3.1 computed. ` +
    `First: ${vacuityViolations[0]}`,
  )
}

// One applied outcome per mafia night, not per prompted mafia seat. The
// table stamps kill groundTruth per SUBMISSION (null on forced/abstain
// rows), so the night's victim is read from any targeted row's nightVictim
// — a night whose every mafia row is forced or abstained resolved no kill.
// victim-was-power-role and victim-had-voted-mafia (§4) are victim-centric
// facts the table does not carry: both are recomputed from the verified log
// (R18) — the victim's role, and whether the victim had cast a ballot on a
// true mafia seat strictly before the night's first kill prompt.
for (const rows of nightKillGroups.values()) {
  const seed = rows[0].seed
  const g = nightGameAcc(seed)
  night.kill.nights += 1
  g.nights += 1
  const targeted = rows.filter((r) => r.groundTruth)
  for (const r of targeted) {
    if (!('nightVictim' in r.groundTruth)) {
      fail(`kill row ${r.seed}#${r.seq}: groundTruth needs nightVictim`)
    }
  }
  const victims = new Set(targeted.map((r) => r.groundTruth.nightVictim))
  if (victims.size > 1) fail(`kill rows ${seed} day ${rows[0].day}: nightVictim disagrees across the night's rows`)
  const victim = targeted.length > 0 ? (targeted[0].groundTruth.nightVictim ?? null) : null
  if (victim === null) continue
  night.kill.victims += 1
  g.victims += 1
  const role = factsOf.get(seed).roles[victim]
  if (!role) fail(`kill rows ${seed} day ${rows[0].day}: victim ${victim} has no role_assigned in the log`)
  if (role === 'doctor' || role === 'detective') { night.kill.powerRole += 1; g.power += 1 }
  const nightSeq = Math.min(...rows.map((r) => r.seq))
  const ballotSeq = mafiaBallotSeqOf.get(seed)?.get(victim)
  if (ballotSeq !== undefined && ballotSeq < nightSeq) { night.kill.votedMafia += 1; g.votedMafia += 1 }
}

// ---- ledger family counts per model (cohort games only) ----------------
// Primary = underlying-proposition RANGE. Secondary = exact utterance
// receipts. Keeping both makes R20 auditable without guessing whether a
// nightless or unresolved-target action statement is a reiteration or a new event.
const emptyLedgerFamily = () => ({ n: 0, true: 0, false: 0, ambiguous: 0, falseClass: {} })
const addLedgerCount = (map, c, where) => {
  const model = modelOf.get(c.seed)?.get(c.seat)
  if (!model) fail(`${where} ${c.seed}#${c.firstSeq ?? c.seq}: seat ${c.seat} has no log binding`)
  if (!map.has(model)) map.set(model, new Map())
  const fam = map.get(model)
  if (!fam.has(c.kind)) fam.set(c.kind, emptyLedgerFamily())
  const f = fam.get(c.kind)
  f.n += 1
  f[c.verdict] += 1
  if (c.verdict === 'false' && c.falseClass) {
    f.falseClass[c.falseClass] = (f.falseClass[c.falseClass] ?? 0) + 1
  }
}
const ledgerReceiptsByModel = new Map()
for (const receipt of confirmedCohort) addLedgerCount(ledgerReceiptsByModel, receipt, 'receipt')
const claimReceiptsByModel = new Map()
for (const receipt of confirmedCohort) {
  const model = modelOf.get(receipt.seed)?.get(receipt.seat)
  if (!model) fail(`receipt ${receipt.seed}#${receipt.seq}: seat ${receipt.seat} has no log binding`)
  if (!claimReceiptsByModel.has(model)) claimReceiptsByModel.set(model, [])
  claimReceiptsByModel.get(model).push(receipt)
}
const propositionRangesByModel = new Map([...claimReceiptsByModel].map(([model, rows]) => [model, aggregateConfirmed(rows)]))
for (const key of ['propositions', 'resolved', 'true', 'false', 'ambiguous']) {
  for (const endpoint of ['lower', 'upper']) {
    const sum = [...propositionRangesByModel.values()].reduce((n, mapping) => n + mapping.countRanges[key][endpoint], 0)
    if (sum !== claimPropositions.countRanges[key][endpoint]) {
      fail(`claim proposition ${key}.${endpoint}: per-model sum ${sum} != global ${claimPropositions.countRanges[key][endpoint]}`)
    }
  }
}
const zeroRange = () => ({ lower: 0, upper: 0 })
const emptyPropositionFamily = () => ({
  propositions: zeroRange(), resolved: zeroRange(), true: zeroRange(), false: zeroRange(),
  ambiguous: zeroRange(), falseClasses: {},
})

// ---- rates and bootstrap -----------------------------------------------
// Per-model rates with denominator n<10 publish as counts only (§4): the
// rate stays null and the printed counts carry the information.
const rateOr = (num, den) => (den >= 10 ? num / den : null)
const aggRate = (num, den) => (den > 0 ? num / den : null)

const bootstrapN = values['bootstrap-n'] !== undefined
  ? Number(values['bootstrap-n'])
  : (manifest.bootstrap?.replicates ?? 20000)
if (!Number.isInteger(bootstrapN) || bootstrapN < 1) fail(`--bootstrap-n must be a positive integer`)
const bootstrapSeed = manifest.bootstrap?.seed ?? manifest.bootstrapSeed ?? 'analysis-v3.1/stats-bootstrap'

// Game-cluster bootstrap: the game is the resampling unit (§4). Seeded via
// the engine's own draw so the replicates are reproducible from the seed
// string recorded in the output JSON.
function bootstrapCIs(byGame, statFns, scope, n) {
  const games = [...byGame.keys()].sort()
  const empty = Object.fromEntries(Object.keys(statFns).map((k) => [k, [null, null]]))
  if (games.length < 2) return empty
  const acc = Object.fromEntries(Object.keys(statFns).map((k) => [k, []]))
  const seedStr = `${bootstrapSeed}|${scope}`
  let counter = 0
  for (let i = 0; i < n; i++) {
    const sum = {}
    for (let j = 0; j < games.length; j++) {
      const d = draw(seedStr, counter)
      counter = d.counter
      const g = byGame.get(games[Math.floor(d.value * games.length)])
      for (const k in g) sum[k] = (sum[k] ?? 0) + g[k]
    }
    for (const k in statFns) {
      const v = statFns[k](sum)
      if (v !== null && Number.isFinite(v)) acc[k].push(v)
    }
  }
  const ci = {}
  for (const k in acc) {
    const a = acc[k].sort((x, y) => x - y)
    ci[k] = a.length
      ? [a[Math.floor(a.length * 0.025)], a[Math.min(a.length - 1, Math.floor(a.length * 0.975))]]
      : [null, null]
  }
  return ci
}

// v3.2 §5: excess is reported against EACH named baseline, and the field
// names carry the policy assumption so no reader can take either for "exact
// chance". The v3.1 meanChance/meanExcess pair is gone rather than aliased:
// an unnamed baseline is exactly the defect the amendment retires.
const tripletOf = (acc) => ({
  opportunities: acc.opps,
  validActions: acc.valid,
  validNonAbstain: acc.validNA,
  hits: acc.hits,
  coverage: rateOr(acc.valid, acc.opps),
  conditionalQuality: rateOr(acc.hits, acc.validNA),
  effectiveQuality: rateOr(acc.hits, acc.opps),
  meanChanceUniformOverLegalTargets: acc.validNA > 0 ? acc.chanceSumLegal / acc.validNA : null,
  meanChanceUniformOverLivingNonSelf: acc.validNA > 0 ? acc.chanceSumNonSelf / acc.validNA : null,
  meanExcessVsUniformOverLegalTargets: acc.validNA >= 10 ? (acc.hits - acc.chanceSumLegal) / acc.validNA : null,
  meanExcessVsUniformOverLivingNonSelf: acc.validNA >= 10 ? (acc.hits - acc.chanceSumNonSelf) / acc.validNA : null,
})

const models = [...perModel.keys()].sort()
const ballotStats = models.map((m) => {
  const entry = perModel.get(m)
  const ci = entry.all.validNA >= 10
    ? bootstrapCIs(entry.byGame, {
        coverage: (s) => (s.opps > 0 ? s.valid / s.opps : null),
        conditionalQuality: (s) => (s.validNA > 0 ? s.hits / s.validNA : null),
        effectiveQuality: (s) => (s.opps > 0 ? s.hits / s.opps : null),
        meanExcessVsUniformOverLegalTargets: (s) => (s.validNA > 0 ? (s.hits - s.chanceSumLegal) / s.validNA : null),
        meanExcessVsUniformOverLivingNonSelf: (s) => (s.validNA > 0 ? (s.hits - s.chanceSumNonSelf) / s.validNA : null),
      }, `ballots|${m}`, bootstrapN)
    : {
        coverage: [null, null], conditionalQuality: [null, null], effectiveQuality: [null, null],
        meanExcessVsUniformOverLegalTargets: [null, null], meanExcessVsUniformOverLivingNonSelf: [null, null],
      }
  return {
    model: m,
    ballots: { ...tripletOf(entry.all), ci95: ci },
    villager: tripletOf(entry.villager),
    // v3.2 §6: the stratum is renamed, and BOTH truthful result types feed it.
    // The name must never be read as "before evidence exists": votes,
    // discussion, and deaths are already evidence.
    strata: {
      beforeAnyPublicVerifiedInvestigationResult: tripletOf(entry.pre),
      targetNotPubliclyReported: {
        validNonAbstain: entry.notRep.validNA,
        hits: entry.notRep.hits,
        conditionalQuality: rateOr(entry.notRep.hits, entry.notRep.validNA),
        meanChanceUniformOverLegalTargets: entry.notRep.validNA > 0 ? entry.notRep.chanceSumLegal / entry.notRep.validNA : null,
        meanChanceUniformOverLivingNonSelf: entry.notRep.validNA > 0 ? entry.notRep.chanceSumNonSelf / entry.notRep.validNA : null,
        meanExcessVsUniformOverLegalTargets: entry.notRep.validNA >= 10
          ? (entry.notRep.hits - entry.notRep.chanceSumLegal) / entry.notRep.validNA
          : null,
        meanExcessVsUniformOverLivingNonSelf: entry.notRep.validNA >= 10
          ? (entry.notRep.hits - entry.notRep.chanceSumNonSelf) / entry.notRep.validNA
          : null,
      },
      resultTypes: TRUTHFUL_RESULT_TYPES,
    },
    ledgerFamilies: Object.fromEntries(
      PUBLISHED.map((k) => {
        const f = propositionRangesByModel.get(m)?.countRanges?.byKind?.[k] ?? emptyPropositionFamily()
        return [k, f]
      }),
    ),
    ledgerReceiptFamilies: Object.fromEntries(
      PUBLISHED.map((k) => {
        const f = ledgerReceiptsByModel.get(m)?.get(k) ?? emptyLedgerFamily()
        const resolvable = f.true + f.false
        return [k, { ...f, falseRate: rateOr(f.false, resolvable) }]
      }),
    ),
  }
})

const nightCi = bootstrapCIs(night.byGame, {
  doctorIntercept: (s) => (s.prot > 0 ? s.intercepts / s.prot : null),
  selfProtect: (s) => (s.prot > 0 ? s.selfProt / s.prot : null),
  detectiveFirstTimeTargets: (s) => (s.inv > 0 ? s.firstTime / s.inv : null),
  victimWasPowerRole: (s) => (s.victims > 0 ? s.power / s.victims : null),
  victimHadVotedMafia: (s) => (s.victims > 0 ? s.votedMafia / s.victims : null),
}, 'night-aggregate', bootstrapN)
const nightAggregate = {
  doctorIntercept: { count: night.protect.intercepts, n: night.protect.n, rate: aggRate(night.protect.intercepts, night.protect.n), ci95: nightCi.doctorIntercept },
  selfProtect: { count: night.protect.selfProtects, n: night.protect.n, rate: aggRate(night.protect.selfProtects, night.protect.n), ci95: nightCi.selfProtect },
  detectiveFirstTimeTargets: { count: night.investigate.firstTimeTargets, n: night.investigate.n, rate: aggRate(night.investigate.firstTimeTargets, night.investigate.n), ci95: nightCi.detectiveFirstTimeTargets },
  victimWasPowerRole: { count: night.kill.powerRole, n: night.kill.victims, rate: aggRate(night.kill.powerRole, night.kill.victims), ci95: nightCi.victimWasPowerRole },
  victimHadVotedMafia: { count: night.kill.votedMafia, n: night.kill.victims, rate: aggRate(night.kill.votedMafia, night.kill.victims), ci95: nightCi.victimHadVotedMafia },
  nightsObserved: night.kill.nights,
}

const relModels = [...rel.keys()].sort()
const relRow = (m, r) => ({
  model: m,
  wakes: r.wakes,
  firstAttemptValid: aggRate(r.firstValid, r.wakes),
  recoveredByRetry: r.recovered,
  retryAttempts: r.retryAttempts,
  invalidActionAttempts: r.invalidActionAttempts,
  providerErrorAttempts: r.providerErrorAttempts,
  abortedAttempts: r.abortedAttempts,
  timeouts: { deadline: r.timeoutsDeadline, noncompliance: r.timeoutsNoncompliance, provider_error: r.timeoutsProviderError },
  terminalDefaults: r.terminalDefaults,
  discussion: { turns: r.discussionTurns, spoke: r.discussionSpoke, coverage: aggRate(r.discussionSpoke, r.discussionTurns) },
  ballots: { turns: r.voteTurns, valid: r.validBallots, coverage: aggRate(r.validBallots, r.voteTurns) },
})
const relTotals = relRow('ALL', [...rel.values()].reduce((t, r) => {
  for (const k in r) {
    if (typeof r[k] === 'number') t[k] = (t[k] ?? 0) + r[k]
  }
  return t
}, {
  wakes: 0, firstValid: 0, recovered: 0, retryAttempts: 0,
  invalidActionAttempts: 0, providerErrorAttempts: 0, abortedAttempts: 0,
  timeoutsDeadline: 0, timeoutsNoncompliance: 0, timeoutsProviderError: 0,
  terminalDefaults: 0, discussionTurns: 0, discussionSpoke: 0, voteTurns: 0, validBallots: 0,
}))
const reliability = {
  cohort: 'scheduled-40',
  games: scheduledSeeds.length,
  perModel: relModels.map((m) => relRow(m, rel.get(m))),
  totals: relTotals,
}

// ---- output ------------------------------------------------------------
const FOOTER = 'rows alphabetical · denominators printed · rates with n<10 published as counts · no ordering or ranking is claimed'
const pct = (x) => (x === null || x === undefined ? '     —' : `${(x * 100).toFixed(1)}%`.padStart(6))
const sgn = (x) => (x === null || x === undefined ? '     —' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`.padStart(7))
const ciStr = (ci) => (ci?.[0] === null || ci?.[0] === undefined ? '[     —      — ]' : `[${pct(ci[0])} ${pct(ci[1])}]`)

console.log(`analysis v3.1 stats — cohort ${values.cohort} (${cohortSeeds.length} games) · analysisRunId ${runId.slice(0, 12)}…`)
console.log(`bootstrap: game-cluster, ${bootstrapN} replicates, seed '${bootstrapSeed}'`)

// v3.2 §5: both baselines are printed, each labelled by the policy it
// assumes. "legal" = uniform over all legal targets, self included;
// "non-self" = uniform over living non-self targets. Neither is exact.
console.log(`\n== town ballots (opportunity-table denominators; excess is paired per-ballot vs each named baseline, v3.2 §5) ==`)
console.log(`${'model'.padEnd(18)} opps valid vldNA hits  coverage  cond-qual [95% CI]           eff-qual  base:legal  exc:legal  base:nonself exc:nonself`)
for (const s of ballotStats) {
  const b = s.ballots
  console.log(
    `${s.model.padEnd(18)} ${String(b.opportunities).padStart(4)} ${String(b.validActions).padStart(5)} ` +
    `${String(b.validNonAbstain).padStart(5)} ${String(b.hits).padStart(4)}  ${pct(b.coverage)}   ` +
    `${pct(b.conditionalQuality)} ${ciStr(b.ci95.conditionalQuality)}  ${pct(b.effectiveQuality)}  ` +
    `${pct(b.meanChanceUniformOverLegalTargets)}  ${sgn(b.meanExcessVsUniformOverLegalTargets)}  ` +
    `${pct(b.meanChanceUniformOverLivingNonSelf)}   ${sgn(b.meanExcessVsUniformOverLivingNonSelf)}`,
  )
}

// v3.2 §6: renamed stratum, BOTH truthful result types. Not "before evidence
// exists" — votes, discussion, and deaths are already evidence.
console.log(`\n== strata (from ledger-confirmed true detective reports, results ${TRUTHFUL_RESULT_TYPES.join(' + ')}; v3.2 §6) ==`)
console.log(`${'model'.padEnd(18)} before-any-public-verified-investigation-result: opps vldNA hits cond-q  eff-q  exc:nonself | target-not-publicly-reported: vldNA hits cond-q  exc:nonself`)
for (const s of ballotStats) {
  const p = s.strata.beforeAnyPublicVerifiedInvestigationResult
  const t = s.strata.targetNotPubliclyReported
  console.log(
    `${s.model.padEnd(18)} ${String(p.opportunities).padStart(4)} ${String(p.validNonAbstain).padStart(5)} ` +
    `${String(p.hits).padStart(4)} ${pct(p.conditionalQuality)} ${pct(p.effectiveQuality)} ${sgn(p.meanExcessVsUniformOverLivingNonSelf)} | ` +
    `${String(t.validNonAbstain).padStart(5)} ${String(t.hits).padStart(4)} ${pct(t.conditionalQuality)} ${sgn(t.meanExcessVsUniformOverLivingNonSelf)}`,
  )
}

console.log(`\n== night actions — AGGREGATE ONLY (each model held doctor/detective 3–4 times; §4) ==`)
for (const [label, key] of [
  ['doctor-intercepts-victim', 'doctorIntercept'],
  ['self-protect', 'selfProtect'],
  ['detective first-time targets', 'detectiveFirstTimeTargets'],
  ['victim-was-power-role', 'victimWasPowerRole'],
  ['victim-had-voted-mafia', 'victimHadVotedMafia'],
]) {
  const v = nightAggregate[key]
  console.log(`  ${label.padEnd(26)} ${String(v.count).padStart(3)}/${String(v.n).padEnd(3)} ${pct(v.rate)}  ${ciStr(v.ci95)}`)
}
console.log(`  (${nightAggregate.nightsObserved} mafia nights observed; victim denominators are nights with a resolved kill choice — an intercepted night keeps its intended victim)`)

console.log(`\n== confirmed ledger, truth-resolved proposition RANGES — PRIMARY (lower–upper; nightless or unresolved-target action links are uncertain) ==`)
console.log(`${'model'.padEnd(18)} ${PUBLISHED.map((k) => k.replace('_claim', '').padStart(21)).join('')}`)
for (const s of ballotStats) {
  const cells = PUBLISHED.map((k) => {
    const f = s.ledgerFamilies[k]
    return `${f.resolved.lower}–${f.resolved.upper} (F ${f.false.lower}–${f.false.upper})`.padStart(21)
  })
  console.log(`${s.model.padEnd(18)} ${cells.join('')}`)
}
console.log(`  ambiguous propositions disclosed separately: ` +
  `${claimPropositions.countRanges.ambiguous.lower}–${claimPropositions.countRanges.ambiguous.upper} ` +
  `(not added to the primary lower bound because an ambiguous receipt may describe a resolved proposition)`)

console.log(`\n== confirmed ledger, public utterance receipts — SECONDARY/R20 (reiterations retained) ==`)
console.log(`${'model'.padEnd(18)} ${PUBLISHED.map((k) => k.replace('_claim', '').padStart(21)).join('')}`)
for (const s of ballotStats) {
  const cells = PUBLISHED.map((k) => {
    const f = s.ledgerReceiptFamilies[k]
    const rate = f.falseRate === null ? '' : ` ${pct(f.falseRate).trim()}F`
    return `${f.n}/${f.true}/${f.false}/${f.ambiguous}${rate}`.padStart(21)
  })
  console.log(`${s.model.padEnd(18)} ${cells.join('')}`)
}
console.log(`  ${claimPropositions.countRanges.resolved.lower}–${claimPropositions.countRanges.resolved.upper} truth-resolved underlying propositions; ` +
  `${claimPropositions.countRanges.ambiguous.lower}–${claimPropositions.countRanges.ambiguous.upper} ambiguous disclosed separately; ` +
  `${claimPropositions.receiptCount} total receipts; ${claimPropositions.exactlyLinkedReiterationReceipts} repeat receipt(s) linked exactly, ` +
  `${claimPropositions.linkageUncertainReceiptCount} action receipt(s) left linkage-uncertain (nightless or unresolved target)`)

console.log(`\n== reliability — ALL ${scheduledSeeds.length} scheduled games, regardless of cohort (§1) ==`)
console.log(`${'model'.padEnd(18)} wakes 1st-valid recov retry invalid prov-err abort  t/o dl:nc:pe  defaults  disc-cov(n)      ballot-cov(n)`)
for (const r of [...reliability.perModel, reliability.totals]) {
  console.log(
    `${r.model.padEnd(18)} ${String(r.wakes).padStart(5)}  ${pct(r.firstAttemptValid)}  ${String(r.recoveredByRetry).padStart(4)} ` +
    `${String(r.retryAttempts).padStart(5)} ${String(r.invalidActionAttempts).padStart(7)} ${String(r.providerErrorAttempts).padStart(8)} ` +
    `${String(r.abortedAttempts).padStart(5)}  ${String(r.timeouts.deadline).padStart(4)}:${r.timeouts.noncompliance}:${r.timeouts.provider_error}  ` +
    `${String(r.terminalDefaults).padStart(8)}  ${pct(r.discussion.coverage)}(${String(r.discussion.turns).padStart(4)})  ${pct(r.ballots.coverage)}(${String(r.ballots.turns).padStart(4)})`,
  )
}

console.log(`\n${FOOTER}`)

if (values.json) {
  const out = {
    generator: 'scripts/stats-v3.mjs',
    analysisRunId: runId,
    evaluatorVersion: EVALUATOR_VERSION,
    cohort: values.cohort,
    cohortSeeds,
    scheduledSeeds,
    bootstrap: { method: 'game-cluster percentile', seed: bootstrapSeed, replicates: bootstrapN },
    // v3.2 §5-§7: the definitions this artifact was computed under, stated in
    // the artifact rather than left to the reader.
    definitions: {
      chanceBaselines: {
        chanceUniformOverLegalTargets: 'uniform over all legal vote targets, self included (engine legal.ts:74)',
        chanceUniformOverLivingNonSelf: 'uniform over living non-self targets',
      },
      reportStratum: 'before any public verified investigation result',
      reportStratumResultTypes: TRUTHFUL_RESULT_TYPES,
      detectiveMetric: 'first-time investigation targets (previouslyCheckedByThisDetective only)',
      semanticUnits: {
        primary: 'truth-resolved underlying claim proposition count range (claim-proposition-v1)',
        ambiguous: 'ambiguous proposition count range, disclosed separately and not added to the primary lower bound',
        secondary: 'public claim utterance receipt (R20)',
        reiterations: 'exactly linked repeats do not increment either bound; nightless or unresolved-target action receipts remain linkage-uncertain and widen the range',
      },
      // §7 evidence: the run failed before this write if violations existed,
      // and the recorded denominator lets S8 verify the check actually RAN.
      vacuity: { checked: vacuityChecked, violations: vacuityViolations.length },
    },
    models: ballotStats,
    nightAggregate,
    claimPropositions,
    ledgerResolvedPropositionCountRange: claimPropositions.countRanges.resolved,
    ledgerAmbiguousPropositionCountRange: claimPropositions.countRanges.ambiguous,
    ledgerClaimReceipts: claimPropositions.receiptCount,
    reliability,
    note: FOOTER,
  }
  writeFileSync(values.json, JSON.stringify(out, null, 2))
  console.log(`wrote ${values.json}`)
}
