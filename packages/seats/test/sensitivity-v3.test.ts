import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { computeAnalysisRunId } from '../../../scripts/analysis-manifest.mjs'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { buildSensitivity, SENSITIVITY_COHORTS } from '../../../scripts/build-sensitivity-v3.mjs'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { EVALUATOR_VERSION } from '../scripts/scoring-v3.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SCRIPT = join(REPO, 'scripts', 'build-sensitivity-v3.mjs')
const games: Record<string, string[]> = {
  'headline-38': ['s1', 's2', 's3'],
  'strict-31': ['s2'],
  'all-40-behavioral': ['s1', 's2', 's3', 's4'],
  'scheduled-40': ['s1', 's2', 's3', 's4'],
}

const dirs: string[] = []
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }) })

function makeManifest() {
  const manifest: Record<string, any> = {
    schemaVersion: 1,
    cohorts: Object.fromEntries(Object.entries(games).map(([name, cohortGames]) => [name, { games: cohortGames }])),
  }
  manifest.analysisRunId = computeAnalysisRunId(manifest)
  return manifest
}

function ballots(hits: number, n: number, legalChance: number, nonSelfChance: number) {
  return {
    validNonAbstain: n,
    hits,
    conditionalQuality: n >= 10 ? hits / n : null,
    meanChanceUniformOverLegalTargets: n ? legalChance : null,
    meanChanceUniformOverLivingNonSelf: n ? nonSelfChance : null,
    meanExcessVsUniformOverLegalTargets: n >= 10 ? hits / n - legalChance : null,
    meanExcessVsUniformOverLivingNonSelf: n >= 10 ? hits / n - nonSelfChance : null,
  }
}

function stats(manifest: Record<string, any>, cohort: string, overrides: Record<string, any> = {}) {
  const byCohort: Record<string, [number, number, number, number]> = {
    // model-a deliberately changes sign across cohorts and between baseline
    // policies, so the fixture proves reversal ranges are emitted.
    'headline-38': [7, 10, 0.4, 0.8],
    'strict-31': [3, 10, 0.4, 0.2],
    'all-40-behavioral': [6, 10, 0.4, 0.5],
  }
  const modelA = byCohort[cohort]
  if (!modelA) throw new Error(`fixture has no cohort ${cohort}`)
  return {
    generator: 'scripts/stats-v3.mjs',
    analysisRunId: manifest.analysisRunId,
    evaluatorVersion: EVALUATOR_VERSION,
    cohort,
    cohortSeeds: games[cohort],
    scheduledSeeds: games['scheduled-40'],
    models: [
      { model: 'model-b', ballots: ballots(5, 10, 0.2, 0.3) },
      { model: 'model-a', ballots: ballots(modelA[0], modelA[1], modelA[2], modelA[3]) },
    ],
    ...overrides,
  }
}

type StatsInput = { artifact: Record<string, any>, label: string, sha256: string }

function input(artifact: Record<string, any>): StatsInput {
  return {
    artifact,
    label: `stats-${artifact.cohort}.json`,
    sha256: createHash('sha256').update(JSON.stringify(artifact)).digest('hex'),
  }
}

function allInputs(manifest: Record<string, any>): StatsInput[] {
  return SENSITIVITY_COHORTS.map((cohort: string) => input(stats(manifest, cohort)))
}

test('builds deterministic per-model cohort ranges and preserves the v3.1 compatibility fields', () => {
  const manifest = makeManifest()
  const ordered = buildSensitivity(manifest, allInputs(manifest))
  const reversed = buildSensitivity(manifest, allInputs(manifest).reverse())
  assert.deepEqual(reversed, ordered)
  assert.equal(ordered.analysisRunId, manifest.analysisRunId)
  assert.equal(ordered.evaluatorVersion, EVALUATOR_VERSION)
  assert.deepEqual(ordered.checked.map((r: any) => r.model), ['model-a', 'model-b'])

  const a = ordered.checked[0]
  assert.deepEqual(a.condQualByCohort, {
    'headline-38': 0.7,
    'strict-31': 0.3,
    'all-40-behavioral': 0.6,
  })
  assert.deepEqual(a.conditionalQualityRange, { lower: 0.3, upper: 0.7 })
  assert.equal(a.excessPositiveByCohortBasis, 'uniformOverLivingNonSelf')
  assert.deepEqual(a.excessPositiveByCohort, {
    'headline-38': false,
    'strict-31': true,
    'all-40-behavioral': true,
  })
  assert.equal(a.excessSignByNamedBaseline.uniformOverLegalTargets['strict-31'], 'negative')
  assert.equal(a.excessSignByNamedBaseline.uniformOverLivingNonSelf['headline-38'], 'negative')
})

test('every cross-cohort or cross-baseline sign reversal carries its exact numeric range', () => {
  const output = buildSensitivity(makeManifest(), allInputs(makeManifest()))
  assert.ok(output.reversals.length > 0)
  for (const reversal of output.reversals) {
    assert.ok(reversal.range)
    assert.equal(typeof reversal.range.lower, 'number')
    assert.equal(typeof reversal.range.upper, 'number')
    assert.ok(reversal.range.lower <= reversal.range.upper)
  }
  assert.ok(output.reversals.some((r: any) =>
    r.model === 'model-a' && r.comparison === 'excess sign across cohorts' && r.baseline === 'uniformOverLegalTargets'))
  assert.ok(output.reversals.some((r: any) =>
    r.model === 'model-a' && r.comparison === 'excess sign across named baselines' && r.cohort === 'headline-38'))
  assert.deepEqual(output.reversals.find((r: any) =>
    r.model === 'model-a' && r.comparison === 'excess sign across cohorts' && r.baseline === 'uniformOverLegalTargets').range,
  { lower: -0.10000000000000003, upper: 0.29999999999999993 })
})

test('fails closed on run, cohort, and model-set mismatches', () => {
  const manifest = makeManifest()

  const wrongRun = allInputs(manifest)
  const wrongRunRow = wrongRun[0]!
  wrongRunRow.artifact = { ...wrongRunRow.artifact, analysisRunId: 'wrong-run' }
  assert.throws(() => buildSensitivity(manifest, wrongRun), /analysisRunId.*does not match/)

  const wrongCohort = allInputs(manifest)
  const wrongCohortRow = wrongCohort[0]!
  wrongCohortRow.artifact = { ...wrongCohortRow.artifact, cohortSeeds: ['s1'] }
  assert.throws(() => buildSensitivity(manifest, wrongCohort), /artifact lacks|cohort game/)

  const wrongModels = allInputs(manifest)
  const wrongModelRow = wrongModels[1]!
  wrongModelRow.artifact = { ...wrongModelRow.artifact, models: wrongModelRow.artifact.models.slice(1) }
  assert.throws(() => buildSensitivity(manifest, wrongModels), /model set mismatch/)
})

test('fails closed on duplicate cohorts and internally inconsistent stats', () => {
  const manifest = makeManifest()
  const duplicate = allInputs(manifest)
  duplicate[2] = input(stats(manifest, 'headline-38'))
  assert.throws(() => buildSensitivity(manifest, duplicate), /duplicate cohort stats/)

  const inconsistent = allInputs(manifest)
  inconsistent[0]!.artifact.models[0]!.ballots.conditionalQuality = 0.9
  assert.throws(() => buildSensitivity(manifest, inconsistent), /does not match its hits\/denominator\/baseline inputs/)
})

test('CLI stamps the manifest run and is byte-deterministic regardless of --stats order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sensitivity-v3-'))
  dirs.push(dir)
  const manifest = makeManifest()
  const manifestPath = join(dir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  const statsPaths = allInputs(manifest).map(({ artifact }) => {
    const path = join(dir, `${artifact.cohort}.json`)
    writeFileSync(path, JSON.stringify(artifact, null, 2))
    return path
  })
  const outA = join(dir, 'sensitivity-a.json')
  const outB = join(dir, 'sensitivity-b.json')
  const run = (paths: string[], out: string) => execFileSync(process.execPath, [
    SCRIPT, '--manifest', manifestPath,
    ...paths.flatMap((path) => ['--stats', path]),
    '--out', out,
  ], { cwd: REPO, encoding: 'utf8', stdio: 'pipe' })
  run(statsPaths, outA)
  run([...statsPaths].reverse(), outB)
  assert.equal(readFileSync(outA, 'utf8'), readFileSync(outB, 'utf8'))
  assert.equal(JSON.parse(readFileSync(outA, 'utf8')).analysisRunId, manifest.analysisRunId)
})
