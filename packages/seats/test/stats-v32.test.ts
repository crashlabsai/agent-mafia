import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { HASH_CHAIN_GENESIS, buildManifest, chainHash } from '../../../scripts/analysis-manifest.mjs'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { EVALUATOR_VERSION } from '../scripts/scoring-v3.mjs'

// v3.2 §5 (two named vote-chance baselines), §6 (both truthful result types in
// the report strata, stratum renamed) and §7 (first-time investigation targets
// with an empirical vacuity assertion), driven through the real stats-v3
// script over a synthetic corpus. Fixtures only: no LLM, no network.

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SEEDS = ['sweep1-0', 'sweep1-2', 'sweep1-6', 'sweep1-13', 'sweep1-15']
const COHORT = ['sweep1-0', 'sweep1-2', 'sweep1-13'] // headline-38 over this corpus

const dirs: string[] = []
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

const writeJsonl = (path: string, rows: unknown[]) =>
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')

const ROLES: Record<string, string> = {
  'seat-1': 'villager', 'seat-2': 'villager', 'seat-3': 'mafia',
  'seat-4': 'villager', 'seat-5': 'detective',
}
const SEAT_MODELS: Record<string, string> = {
  'seat-1': 'model-a', 'seat-2': 'model-a', 'seat-3': 'model-a',
  'seat-4': 'model-a', 'seat-5': 'model-b',
}

function syntheticLog(seed: string) {
  const seats = Object.keys(ROLES)
  const events: Record<string, unknown>[] = [
    { type: 'game_created', actor: null, day: 1, phase: 'night_chat', payload: { seats: seats.map((id) => ({ id, name: id })) } },
    ...seats.map((id) => ({ type: 'role_assigned', actor: id, day: 1, phase: 'night_chat', payload: { seat: id, role: ROLES[id] } })),
    ...seats.map((id) => ({ type: 'seat_bound', actor: id, day: 1, phase: 'night_chat', payload: { seat: id, modelKey: SEAT_MODELS[id] } })),
    { type: 'message_sent', actor: 'seat-1', day: 1, phase: 'discussion', visibility: 'public', payload: { text: `hello from ${seed}` } },
    { type: 'game_ended', actor: null, day: 1, phase: 'ended', payload: { winner: 'town' } },
  ]
  let prev = HASH_CHAIN_GENESIS
  const lines = events.map((e, seq) => {
    const bare = { seq, roomId: seed, matchId: 'm0', gameIndex: 0, ts: `t${seq}`, ...e }
    prev = chainHash(prev, bare)
    return JSON.stringify({ ...bare, hash: prev })
  })
  return { lines, root: prev }
}

/** A town ballot row in the v3.2 opportunity-table shape (§5). */
const voteRow = (seed: string, seq: number, over: Record<string, unknown> = {}) => ({
  seed, root: null, seq, seat: 'seat-1', model: 'model-a', role: 'villager', day: 1,
  phase: 'vote', kind: 'day_vote', legalTargets: ['seat-1', 'seat-2', 'seat-3', 'seat-4'],
  submitted: 'seat-3', valid: true, forced: false,
  groundTruth: { targetRole: 'mafia', targetIsMafia: true },
  chanceUniformOverLegalTargets: 1 / 4,
  chanceUniformOverLivingNonSelf: 1 / 3,
  chance: 1 / 3,
  ...over,
})

const investigateRow = (seed: string, seq: number, gt: Record<string, unknown>, submitted = 'seat-2') => ({
  seed, root: null, seq, seat: 'seat-5', model: 'model-b', role: 'detective', day: 1,
  phase: 'night_actions', kind: 'night_investigate', legalTargets: ['seat-2', 'seat-3'],
  submitted, valid: true, forced: false, groundTruth: gt,
  chanceUniformOverLegalTargets: null, chanceUniformOverLivingNonSelf: null, chance: null,
})

function makeCase(opts: {
  oppExtra?: Record<string, unknown>[]
  ledgerExtra?: Record<string, unknown>[]
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'stats-v32-'))
  dirs.push(dir)
  const logsDir = join(dir, 'logs')
  mkdirSync(logsDir)
  const roots: string[] = []
  for (const seed of SEEDS) {
    const { lines, root } = syntheticLog(seed)
    writeFileSync(join(logsDir, `${seed}.jsonl`), `${lines.join('\n')}\n`)
    roots.push(`${seed} ${root}`)
  }
  const rootsPath = join(dir, 'roots.txt')
  writeFileSync(rootsPath, `${roots.join('\n')}\n`)
  const specPath = join(dir, 'spec.md')
  writeFileSync(specPath, '# synthetic analysis spec\n')
  const manifest = buildManifest({
    logsDir, rootsPath, specPath, expectedGames: SEEDS.length, calibrationCount: 2,
    codeCommit: 'synthetic-commit', tripwireLexiconPath: null, tripwireReportPath: null,
    finder: { model: 'claude-sonnet-5', codeVersion: 'test' },
  })
  const manifestPath = join(dir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  const runId = manifest.analysisRunId
  const stamp = (r: Record<string, unknown>) => ({ ...r, analysisRunId: runId })

  const oppPath = join(dir, 'table.jsonl')
  writeJsonl(oppPath, [
    { _meta: true, generator: 'opportunity-table', analysisRunId: runId },
    // Ballots before and after the public verified investigation result the
    // ledger fixtures place at seq 40. Four before and two after per cohort
    // game keeps validNonAbstain above the §4 n>=10 floor, so the excess
    // figures are actually computed rather than suppressed as counts.
    ...COHORT.flatMap((seed) => [10, 11, 12, 13, 60, 61].map((seq) => voteRow(seed, seq))).map(stamp),
    ...(opts.oppExtra ?? []).map(stamp),
  ])

  const ledgerPath = join(dir, 'confirmed.jsonl')
  writeJsonl(ledgerPath, [
    { _meta: true, mode: 'ledger', analysisRunId: runId, cohort: 'headline-38', seeds: COHORT, rater: 'ryan', evaluatorVersion: EVALUATOR_VERSION },
    ...(opts.ledgerExtra ?? []).map(stamp),
  ])

  return { dir, logsDir, manifestPath, oppPath, ledgerPath, runId, stamp }
}

type Case = ReturnType<typeof makeCase>

function runStats(c: Case) {
  const jsonPath = join(c.dir, 'stats.json')
  const stdout = execFileSync(process.execPath, [
    join(REPO, 'scripts', 'stats-v3.mjs'),
    '--opportunity', c.oppPath, '--ledger', c.ledgerPath, '--manifest', c.manifestPath,
    '--cohort', 'headline-38', '--logs', c.logsDir, '--bootstrap-n', '20', '--json', jsonPath,
  ], { cwd: REPO, encoding: 'utf8', stdio: 'pipe' })
  return { stdout, out: JSON.parse(readFileSync(jsonPath, 'utf8')) }
}

/** A ledger row: a truthful public investigation report at `seq`. */
const report = (seed: string, seq: number, result: string, target = 'seat-2') => ({
  seed, seq, seat: 'seat-5', day: 1, kind: 'investigation_claim',
  target, result, verdict: 'true', quote: 'x',
  human: { rater: 'ryan', confirmed: true, via: 'packet-dispute' },
})

// --- §5: two named baselines ------------------------------------------------

test('§5: both baselines reach the statistics artifact, each named for its policy', () => {
  const { out } = runStats(makeCase())
  const b = out.models[0].ballots
  const near = (actual: number, expected: number, what: string) =>
    assert.ok(Math.abs(actual - expected) < 1e-12, `${what}: ${actual} !~ ${expected}`)
  near(b.meanChanceUniformOverLegalTargets, 1 / 4, 'legal-targets baseline')
  near(b.meanChanceUniformOverLivingNonSelf, 1 / 3, 'non-self baseline')
  // Every ballot in the fixture hits, so excess is 1 - baseline against each.
  near(b.meanExcessVsUniformOverLegalTargets, 1 - 1 / 4, 'excess vs legal targets')
  near(b.meanExcessVsUniformOverLivingNonSelf, 1 - 1 / 3, 'excess vs non-self')
  // The unnamed v3.1 fields are gone, not aliased: an unnamed baseline is the
  // defect the amendment retires (v3.2 §5).
  assert.equal('meanChance' in b, false)
  assert.equal('meanExcess' in b, false)
  assert.deepEqual(out.definitions.chanceBaselines, {
    chanceUniformOverLegalTargets: 'uniform over all legal vote targets, self included (engine legal.ts:74)',
    chanceUniformOverLivingNonSelf: 'uniform over living non-self targets',
  })
})

test('§5: a town ballot missing a named baseline fails closed', () => {
  const c = makeCase()
  const rows = readFileSync(c.oppPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  for (const r of rows) if (!r._meta) delete r.chanceUniformOverLegalTargets
  writeJsonl(c.oppPath, rows)
  assert.throws(() => runStats(c), /without chanceUniformOverLegalTargets/)
})

// --- §6: both truthful result types, renamed stratum ------------------------

test('§6: a truthful NOT-MAFIA report closes the stratum, as a mafia hit does', () => {
  // v3.1 admitted result === 'mafia' only, so every truthful clear was
  // invisible and ballots cast after one still counted as "before any report".
  const withClear = runStats(makeCase({ ledgerExtra: COHORT.map((s) => report(s, 40, 'not mafia')) }))
  const withHit = runStats(makeCase({ ledgerExtra: COHORT.map((s) => report(s, 40, 'mafia')) }))
  const none = runStats(makeCase())

  const pre = (r: any) => r.out.models[0].strata.beforeAnyPublicVerifiedInvestigationResult.validNonAbstain
  assert.equal(pre(none), 18, 'no report anywhere: every ballot is in the stratum')
  assert.equal(pre(withHit), 12, 'the four pre-report ballots per cohort game')
  assert.equal(pre(withClear), 12, 'a truthful clear must close the stratum exactly as a hit does')
  assert.deepEqual(withClear.out.models[0].strata.resultTypes, ['mafia', 'not mafia'])
})

test('§6: the stratum is published under its renamed key', () => {
  const { out, stdout } = runStats(makeCase())
  const strata = out.models[0].strata
  assert.ok('beforeAnyPublicVerifiedInvestigationResult' in strata)
  assert.equal('preAnyPublicDetectiveReport' in strata, false, 'the v3.1 name is retired, not aliased')
  assert.match(stdout, /before-any-public-verified-investigation-result/)
  assert.equal(out.definitions.reportStratum, 'before any public verified investigation result')
})

test('v3.2.6: statistics refuse a ledger built by a stale evaluator', () => {
  const c = makeCase()
  const rows = readFileSync(c.ledgerPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  rows[0].evaluatorVersion = 'v3.2.2'
  writeJsonl(c.ledgerPath, rows)
  assert.throws(() => runStats(c), /ledger evaluatorVersion.*v3\.2\.2.*current v3\.2\.3/)
})

test('v3.2.6: repeated N1 result is one primary proposition and two R20 receipts', () => {
  const first = {
    ...report('sweep1-0', 40, 'not mafia'),
    claimedNight: 1, charStart: 0, quote: 'N1 seat-2 is not mafia',
  }
  const repeat = {
    ...report('sweep1-0', 50, 'not mafia'),
    claimedNight: 1, charStart: 0, quote: 'My N1 seat-2 clear still stands',
  }
  const { out, stdout } = runStats(makeCase({
    ledgerExtra: [first, repeat],
    oppExtra: [voteRow('sweep1-0', 70, { seat: 'seat-5', model: 'model-b', role: 'detective' })],
  }))
  const model = out.models.find((m: any) => m.model === 'model-b')
  assert.deepEqual(model.ledgerFamilies.investigation_claim.propositions, { lower: 1, upper: 1 }, 'primary family table counts the underlying proposition once')
  assert.equal(model.ledgerReceiptFamilies.investigation_claim.n, 2, 'secondary table keeps both public utterance receipts')
  assert.deepEqual(out.ledgerResolvedPropositionCountRange, { lower: 1, upper: 1 })
  assert.deepEqual(out.ledgerAmbiguousPropositionCountRange, { lower: 0, upper: 0 })
  assert.equal(out.ledgerClaimReceipts, 2)
  assert.equal(out.claimPropositions.upperBoundRows[0].mentionCount, 2)
  assert.match(stdout, /truth-resolved proposition RANGES — PRIMARY/)
  assert.match(stdout, /ambiguous propositions disclosed separately/)
  assert.match(stdout, /public utterance receipts — SECONDARY\/R20/)
})

test('v3.2.6: report strata use the scorer’s conjunction-repaired target', () => {
  const conjunction = {
    ...report('sweep1-0', 40, 'not mafia', 'me'),
    claimedNight: 1,
    quote: 'Confirmed town: me and seat-2 (N1 clear).',
  }
  const { out } = runStats(makeCase({
    ledgerExtra: [conjunction],
    oppExtra: [voteRow('sweep1-0', 70, { seat: 'seat-5', model: 'model-b', role: 'detective' })],
  }))
  const detective = out.models.find((m: any) => m.model === 'model-b')
  assert.deepEqual(detective.ledgerFamilies.investigation_claim.propositions, { lower: 1, upper: 1 })
  assert.equal(
    out.models.find((m: any) => m.model === 'model-a').strata.beforeAnyPublicVerifiedInvestigationResult.validNonAbstain,
    16,
    'the true report is accepted and closes the stratum instead of failing on raw target "me"',
  )
})

// --- §7: first-time investigation targets + vacuity assertion ---------------

test('§7: the metric is renamed and drops the vacuous conjunct', () => {
  const { out, stdout } = runStats(makeCase({
    oppExtra: [
      investigateRow('sweep1-0', 20, { targetRole: 'villager', result: 'not mafia', previouslyCheckedByThisDetective: false }),
      investigateRow('sweep1-0', 30, { targetRole: 'villager', result: 'not mafia', previouslyCheckedByThisDetective: true }),
    ],
  }))
  const m = out.nightAggregate
  assert.deepEqual(
    [m.detectiveFirstTimeTargets.count, m.detectiveFirstTimeTargets.n],
    [1, 2],
    'only previouslyCheckedByThisDetective decides the metric now',
  )
  assert.equal('detectiveNonRedundancy' in m, false, '"non-redundancy" overclaimed and is retired')
  assert.match(stdout, /detective first-time targets/)
  // v3.2.1: recorded evidence, not a boolean literal — gate S8 audits the
  // denominator (review: the boolean form made S8 tautological).
  assert.ok(out.definitions.vacuity.checked > 0)
  assert.equal(out.definitions.vacuity.violations, 0)
})

test('§7: the vacuity assertion FAILS LOUDLY when the implication is violated', () => {
  // A first-time target that WAS the subject of an earlier confirmed true
  // public report. The logical argument says this cannot happen with one
  // detective per game; the run refuses to publish unless it actually does not.
  const c = makeCase({
    oppExtra: [investigateRow('sweep1-0', 50, { targetRole: 'villager', result: 'not mafia', previouslyCheckedByThisDetective: false }, 'seat-2')],
    ledgerExtra: [report('sweep1-0', 40, 'mafia', 'seat-2')],
  })
  assert.throws(() => runStats(c), /vacuity assertion FAILED/)
})

test('§7: the assertion passes silently when the conjunct really is vacuous', () => {
  const { out } = runStats(makeCase({
    oppExtra: [investigateRow('sweep1-0', 30, { targetRole: 'villager', result: 'not mafia', previouslyCheckedByThisDetective: true }, 'seat-2')],
    ledgerExtra: [report('sweep1-0', 20, 'mafia', 'seat-2')],
  }))
  assert.equal(out.nightAggregate.detectiveFirstTimeTargets.count, 0)
})
