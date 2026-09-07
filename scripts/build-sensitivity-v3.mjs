// Deterministic cross-cohort sensitivity summary for analysis v3.2.
//
// Consumes the three stats-v3 artifacts named by the frozen analysis design
// (headline-38, strict-31, all-40-behavioral).  It compares each model's
// conditional town-ballot quality and the sign of its paired excess against
// BOTH policy-named baselines.  No threshold is invented for conditional
// quality: that metric is published as cohort values plus a min/max range.
// A sign change in excess, across cohorts or across the two baseline policies,
// is emitted as a reversal and always carries the underlying numeric range.
//
// Exact CLI:
//   node scripts/build-sensitivity-v3.mjs \
//     --manifest runs/analysis-v3.2/manifest.json \
//     --stats runs/analysis-v3.2/stats/stats-headline-38.json \
//     --stats runs/analysis-v3.2/stats/stats-strict-31.json \
//     --stats runs/analysis-v3.2/stats/stats-all-40-behavioral.json \
//     --out runs/analysis-v3.2/stats/sensitivity.json

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { EVALUATOR_VERSION } from '../packages/seats/scripts/scoring-v3.mjs'
import { checkCohortBinding, checkRunId, loadManifest } from './analysis-manifest.mjs'

export const SENSITIVITY_COHORTS = ['headline-38', 'strict-31', 'all-40-behavioral']

export const NAMED_BASELINES = {
  uniformOverLegalTargets: {
    excessField: 'meanExcessVsUniformOverLegalTargets',
    chanceField: 'meanChanceUniformOverLegalTargets',
  },
  uniformOverLivingNonSelf: {
    excessField: 'meanExcessVsUniformOverLivingNonSelf',
    chanceField: 'meanChanceUniformOverLivingNonSelf',
  },
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x))
const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const close = (a, b) => Math.abs(a - b) <= 1e-12

const rangeOf = (values) => {
  const xs = values.filter(finite)
  return xs.length ? { lower: Math.min(...xs), upper: Math.max(...xs) } : null
}

const signOf = (value) => {
  if (value === null) return null
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return 'zero'
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
}

function validateRate(value, n, expected, label, { min = -1, max = 1 } = {}) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label}: validNonAbstain must be a non-negative integer`)
  if (n < 10) {
    if (value !== null) throw new Error(`${label}: rate must be null when validNonAbstain < 10`)
    return
  }
  if (!finite(value) || value < min || value > max) throw new Error(`${label}: expected a finite rate in [${min}, ${max}]`)
  if (!close(value, expected)) throw new Error(`${label}: value does not match its hits/denominator/baseline inputs`)
}

function validateStatsArtifact(manifest, artifact, label) {
  assertObject(artifact, label)
  if (typeof artifact.analysisRunId !== 'string' || artifact.analysisRunId.length === 0) {
    throw new Error(`${label}: analysisRunId must be a non-empty string`)
  }
  checkRunId(manifest, artifact, label)
  if (!SENSITIVITY_COHORTS.includes(artifact.cohort)) {
    throw new Error(`${label}: unexpected cohort ${JSON.stringify(artifact.cohort)}; expected one of ${SENSITIVITY_COHORTS.join(', ')}`)
  }
  if (artifact.evaluatorVersion !== EVALUATOR_VERSION) {
    throw new Error(`${label}: evaluatorVersion ${JSON.stringify(artifact.evaluatorVersion ?? null)} != current ${EVALUATOR_VERSION}`)
  }
  if (!Array.isArray(artifact.cohortSeeds)) throw new Error(`${label}: cohortSeeds must be an array`)
  if (new Set(artifact.cohortSeeds).size !== artifact.cohortSeeds.length) throw new Error(`${label}: cohortSeeds contains duplicates`)
  checkCohortBinding(manifest, artifact.cohort, artifact.cohortSeeds)
  if (!Array.isArray(artifact.scheduledSeeds)) throw new Error(`${label}: scheduledSeeds must be an array`)
  if (new Set(artifact.scheduledSeeds).size !== artifact.scheduledSeeds.length) throw new Error(`${label}: scheduledSeeds contains duplicates`)
  checkCohortBinding(manifest, 'scheduled-40', artifact.scheduledSeeds)
  if (!Array.isArray(artifact.models) || artifact.models.length === 0) throw new Error(`${label}: models must be a non-empty array`)

  const models = new Set()
  for (const [i, row] of artifact.models.entries()) {
    assertObject(row, `${label}: models[${i}]`)
    if (typeof row.model !== 'string' || row.model.length === 0) throw new Error(`${label}: models[${i}] has no model id`)
    if (models.has(row.model)) throw new Error(`${label}: duplicate model ${row.model}`)
    models.add(row.model)
    assertObject(row.ballots, `${label}: ${row.model}.ballots`)
    const b = row.ballots
    const n = b.validNonAbstain
    if (!Number.isInteger(b.hits) || b.hits < 0 || !Number.isInteger(n) || b.hits > n) {
      throw new Error(`${label}: ${row.model}.ballots has invalid hits/validNonAbstain`)
    }
    validateRate(b.conditionalQuality, n, n ? b.hits / n : 0,
      `${label}: ${row.model}.ballots.conditionalQuality`, { min: 0, max: 1 })
    for (const { excessField, chanceField } of Object.values(NAMED_BASELINES)) {
      const chance = b[chanceField]
      if (n > 0 && (!finite(chance) || chance < 0 || chance > 1)) {
        throw new Error(`${label}: ${row.model}.ballots.${chanceField} must be a finite probability when ballots exist`)
      }
      if (n === 0 && chance !== null) {
        throw new Error(`${label}: ${row.model}.ballots.${chanceField} must be null when no ballots exist`)
      }
      const expected = n ? (b.hits / n) - chance : 0
      validateRate(b[excessField], n, expected, `${label}: ${row.model}.ballots.${excessField}`)
    }
  }
  return models
}

/** Pure builder used by the CLI and fixture tests. */
export function buildSensitivity(manifest, inputs) {
  assertObject(manifest, 'manifest')
  if (typeof manifest.analysisRunId !== 'string' || manifest.analysisRunId.length === 0) {
    throw new Error('manifest.analysisRunId must be a non-empty string')
  }
  if (!Array.isArray(inputs) || inputs.length !== SENSITIVITY_COHORTS.length) {
    throw new Error(`exactly ${SENSITIVITY_COHORTS.length} cohort stats artifacts are required`)
  }

  const byCohort = new Map()
  let expectedModels = null
  for (const input of inputs) {
    assertObject(input, 'stats input')
    if (typeof input.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(input.sha256)) {
      throw new Error(`${input.label ?? 'stats input'}: missing or invalid content sha256`)
    }
    const models = validateStatsArtifact(manifest, input.artifact, input.label ?? 'stats input')
    if (byCohort.has(input.artifact.cohort)) throw new Error(`duplicate cohort stats: ${input.artifact.cohort}`)
    byCohort.set(input.artifact.cohort, input)
    if (expectedModels === null) expectedModels = models
    else if (!sameSet(expectedModels, models)) {
      const missing = [...expectedModels].filter((m) => !models.has(m))
      const extra = [...models].filter((m) => !expectedModels.has(m))
      throw new Error(`${input.label ?? 'stats input'}: model set mismatch (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`)
    }
  }
  for (const cohort of SENSITIVITY_COHORTS) {
    if (!byCohort.has(cohort)) throw new Error(`missing cohort stats: ${cohort}`)
  }

  const modelRows = new Map()
  for (const cohort of SENSITIVITY_COHORTS) {
    modelRows.set(cohort, new Map(byCohort.get(cohort).artifact.models.map((r) => [r.model, r])))
  }

  const reversals = []
  const checked = [...expectedModels].sort().map((model) => {
    const condQualByCohort = Object.fromEntries(SENSITIVITY_COHORTS.map((cohort) => [
      cohort, modelRows.get(cohort).get(model).ballots.conditionalQuality,
    ]))
    const excessByNamedBaseline = {}
    const excessSignByNamedBaseline = {}
    const excessRangeByNamedBaseline = {}

    for (const [baseline, { excessField }] of Object.entries(NAMED_BASELINES)) {
      const values = Object.fromEntries(SENSITIVITY_COHORTS.map((cohort) => [
        cohort, modelRows.get(cohort).get(model).ballots[excessField],
      ]))
      const signs = Object.fromEntries(SENSITIVITY_COHORTS.map((cohort) => [cohort, signOf(values[cohort])]))
      const range = rangeOf(Object.values(values))
      excessByNamedBaseline[baseline] = values
      excessSignByNamedBaseline[baseline] = signs
      excessRangeByNamedBaseline[baseline] = range
      const observedSigns = new Set(Object.values(signs).filter((x) => x !== null))
      if (observedSigns.size > 1) {
        reversals.push({
          model,
          comparison: 'excess sign across cohorts',
          baseline,
          valuesByCohort: values,
          signsByCohort: signs,
          range,
        })
      }
    }

    // A baseline-policy choice can itself change the sign for one cohort.
    for (const cohort of SENSITIVITY_COHORTS) {
      const valuesByBaseline = Object.fromEntries(Object.keys(NAMED_BASELINES).map((baseline) => [
        baseline, excessByNamedBaseline[baseline][cohort],
      ]))
      const signsByBaseline = Object.fromEntries(Object.entries(valuesByBaseline).map(([baseline, value]) => [baseline, signOf(value)]))
      const observedSigns = new Set(Object.values(signsByBaseline).filter((x) => x !== null))
      if (observedSigns.size > 1) {
        reversals.push({
          model,
          comparison: 'excess sign across named baselines',
          cohort,
          valuesByBaseline,
          signsByBaseline,
          range: rangeOf(Object.values(valuesByBaseline)),
        })
      }
    }

    return {
      model,
      // Compatibility with the archived v3.1 sensitivity shape.
      condQualByCohort,
      conditionalQualityRange: rangeOf(Object.values(condQualByCohort)),
      // The v3.1 field was implicitly the living-non-self baseline. Keep it
      // for consumers while making that policy choice explicit beside it.
      excessPositiveByCohort: Object.fromEntries(SENSITIVITY_COHORTS.map((cohort) => [
        cohort, excessByNamedBaseline.uniformOverLivingNonSelf[cohort] === null
          ? null
          : excessByNamedBaseline.uniformOverLivingNonSelf[cohort] > 0,
      ])),
      excessPositiveByCohortBasis: 'uniformOverLivingNonSelf',
      excessByNamedBaseline,
      excessSignByNamedBaseline,
      excessRangeByNamedBaseline,
    }
  })

  return {
    generator: 'scripts/build-sensitivity-v3.mjs',
    schemaVersion: 'sensitivity-v3.2',
    analysisRunId: manifest.analysisRunId,
    evaluatorVersion: EVALUATOR_VERSION,
    comparison: 'conditional ballot quality and named-baseline excess sign across the three frozen sensitivity cohorts',
    cohorts: [...SENSITIVITY_COHORTS],
    namedBaselines: Object.keys(NAMED_BASELINES),
    inputStatsSha256ByCohort: Object.fromEntries(SENSITIVITY_COHORTS.map((cohort) => [cohort, byCohort.get(cohort).sha256])),
    reversals,
    checked,
  }
}

function main(argv) {
  let values
  try {
    ;({ values } = parseArgs({
      args: argv,
      options: {
        manifest: { type: 'string' },
        stats: { type: 'string', multiple: true },
        out: { type: 'string' },
      },
    }))
  } catch (err) {
    throw new Error(err.message)
  }
  if (!values.manifest) throw new Error('--manifest is required')
  if (!values.out) throw new Error('--out is required')
  if (!Array.isArray(values.stats) || values.stats.length !== SENSITIVITY_COHORTS.length) {
    throw new Error(`--stats is required exactly ${SENSITIVITY_COHORTS.length} times`)
  }
  for (const path of [values.manifest, ...values.stats]) {
    if (!existsSync(path)) throw new Error(`input not found: ${path}`)
  }

  const manifest = loadManifest(values.manifest)
  const inputs = values.stats.map((path) => {
    const bytes = readFileSync(path)
    let artifact
    try { artifact = JSON.parse(bytes.toString('utf8')) } catch { throw new Error(`${path}: invalid JSON`) }
    return { artifact, label: path, sha256: sha256(bytes) }
  })
  const output = buildSensitivity(manifest, inputs)
  writeFileSync(values.out, `${JSON.stringify(output, null, 2)}\n`)
  console.log(`${values.out}: ${output.checked.length} models, ${output.reversals.length} reversal(s), run ${output.analysisRunId.slice(0, 12)}…`)
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirect) {
  try { main(process.argv.slice(2)) } catch (err) {
    console.error(`build-sensitivity-v3: ${err.message}`)
    process.exit(1)
  }
}
