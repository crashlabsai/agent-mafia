// Deterministic clean-room regeneration for analysis v3.2.
//
// This is the executable proof behind publication gate G11. It rebuilds
// every deterministic post-rating artifact in a fresh temporary directory,
// using only the hash-pinned inputs in the requested run plus the frozen
// logs and current committed code. Every rebuilt file must be byte-identical
// to the corresponding publication-run file. Only after ALL subprocesses
// succeed and ALL byte comparisons match is an atomic ok:true attestation
// written.
//
//   node scripts/build-cleanroom-v3.mjs \
//     --manifest runs/analysis-v3.2/manifest.json \
//     --run-dir runs/analysis-v3.2 \
//     --logs runs/sweep-download/sweep1 \
//     --provenance runs/analysis-v3.2/handcheck/pf2-provenance.json \
//     [--out runs/analysis-v3.2/cleanroom.json]

import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import {
  checkRunId, loadManifest, sha256File, verifyManifest, writeFileAtomic,
} from './analysis-manifest.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const CLEANROOM_SCHEMA_VERSION = 'cleanroom-v3.2'
export const CLEANROOM_ARTIFACTS = Object.freeze([
  'ledger/confirmed-input.jsonl',
  'opportunity/table.jsonl',
  'ledger/confirmed-headline-38.jsonl',
  'ledger/confirmed-strict-31.jsonl',
  'ledger/confirmed-all-40-behavioral.jsonl',
  'stats/stats-headline-38.json',
  'stats/stats-strict-31.json',
  'stats/stats-all-40-behavioral.json',
  'stats/agreement.json',
  'stats/pf2-validation.json',
  'stats/sensitivity.json',
])

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const assertRegularFile = (path, label) => {
  if (!existsSync(path)) throw new Error(`${label} missing: ${path}`)
  if (!statSync(path).isFile()) throw new Error(`${label} is not a regular file: ${path}`)
}

/** A stable aggregate over path + byte count + content hash. */
export function cleanroomArtifactSetSha256(artifacts) {
  const digest = createHash('sha256')
  for (const artifact of artifacts) {
    digest.update(`${artifact.path}\x00${artifact.bytes}\x00${artifact.sha256}\n`)
  }
  return digest.digest('hex')
}

/**
 * Compare the fixed publication artifact set byte for byte. Paths in the
 * returned records are stable run-relative labels; absolute checkout and
 * temporary paths never enter the attestation.
 */
export function compareCleanroomArtifacts(expectedRoot, regeneratedRoot) {
  const compared = []
  for (const label of CLEANROOM_ARTIFACTS) {
    const expected = join(expectedRoot, label)
    const regenerated = join(regeneratedRoot, label)
    assertRegularFile(expected, `expected clean-room artifact ${label}`)
    assertRegularFile(regenerated, `regenerated clean-room artifact ${label}`)
    const expectedBytes = readFileSync(expected)
    const regeneratedBytes = readFileSync(regenerated)
    if (!expectedBytes.equals(regeneratedBytes)) {
      throw new Error(
        `${label}: clean-room bytes differ ` +
        `(expected sha256 ${sha256(expectedBytes)}, regenerated sha256 ${sha256(regeneratedBytes)})`,
      )
    }
    compared.push({ path: label, bytes: expectedBytes.length, sha256: sha256(expectedBytes) })
  }
  return compared
}

/** Re-validate a saved attestation against the artifacts that exist now. */
export function verifyCleanroomAttestation({
  report, manifest, manifestPath, runDir, provenance,
  headResolver = currentGitHead,
  committedTreeVerifier = assertCommittedAnalysisTree,
}) {
  if (!report || report.ok !== true) throw new Error('clean-room report present but ok !== true')
  checkRunId(manifest, report, 'clean-room report')
  if (report.schemaVersion !== CLEANROOM_SCHEMA_VERSION || report.generator !== 'scripts/build-cleanroom-v3.mjs') {
    throw new Error('clean-room report has an unknown schemaVersion or generator')
  }
  if (report.manifestSha256 !== sha256File(manifestPath)) {
    throw new Error('clean-room report is not bound to the current manifest bytes')
  }
  if (report.codeCommit !== manifest.codeCommit) {
    throw new Error('clean-room report codeCommit does not match the current manifest')
  }
  const head = headResolver()
  if (head !== manifest.codeCommit) {
    throw new Error(`current HEAD ${head} does not match the clean-room/manifest codeCommit ${manifest.codeCommit}`)
  }
  committedTreeVerifier()
  if (!existsSync(provenance) || report.pf2ProvenanceSha256 !== sha256File(provenance)) {
    throw new Error('clean-room report is not bound to the current PF-2 provenance bytes')
  }
  if (report.logs?.count !== manifest.logs?.count ||
      report.bootstrap?.seed !== manifest.bootstrap?.seed ||
      report.bootstrap?.replicates !== manifest.bootstrap?.replicates) {
    throw new Error('clean-room report log/bootstrap parameters do not match the current manifest')
  }
  if (!Array.isArray(report.reproduced) || report.artifactCount !== CLEANROOM_ARTIFACTS.length ||
      report.reproduced.length !== CLEANROOM_ARTIFACTS.length) {
    throw new Error(`clean-room report must enumerate exactly ${CLEANROOM_ARTIFACTS.length} derived artifacts`)
  }
  for (let i = 0; i < CLEANROOM_ARTIFACTS.length; i += 1) {
    const label = CLEANROOM_ARTIFACTS[i]
    const recorded = report.reproduced[i]
    if (!recorded || recorded.path !== label) {
      throw new Error(`clean-room artifact set/order differs at position ${i + 1}`)
    }
    const diskPath = join(runDir, label)
    assertRegularFile(diskPath, `clean-room-bound artifact ${label}`)
    if (recorded.bytes !== statSync(diskPath).size || recorded.sha256 !== sha256File(diskPath)) {
      throw new Error(`${label}: current bytes differ from the clean-room-attested artifact`)
    }
  }
  if (report.artifactSetSha256 !== cleanroomArtifactSetSha256(report.reproduced)) {
    throw new Error('clean-room artifactSetSha256 does not re-derive from its artifact inventory')
  }
  return { ok: true, artifacts: report.artifactCount }
}

const inputPaths = (runDir) => ({
  extract: join(runDir, 'extract'),
  key: join(runDir, 'handcheck', 'sealed-key.jsonl'),
  sensitivityRatings: join(runDir, 'handcheck', 'codex-ratings.json'),
  packetKey: join(runDir, 'handcheck', 'packet', 'packet-key.jsonl'),
  packetRatings: join(runDir, 'handcheck', 'packet', 'ryan-packet-ratings-blind-clarified.json'),
  negativesKey: join(runDir, 'handcheck', 'negatives-sealed-key.jsonl'),
  negativesRatings: join(runDir, 'handcheck', 'codex-negatives.json'),
})

const outputPaths = (runDir) => ({
  confirmed: join(runDir, 'ledger', 'confirmed-input.jsonl'),
  opportunity: join(runDir, 'opportunity', 'table.jsonl'),
  ledger: Object.fromEntries(['headline-38', 'strict-31', 'all-40-behavioral'].map((cohort) => [
    cohort, join(runDir, 'ledger', `confirmed-${cohort}.jsonl`),
  ])),
  stats: Object.fromEntries(['headline-38', 'strict-31', 'all-40-behavioral'].map((cohort) => [
    cohort, join(runDir, 'stats', `stats-${cohort}.json`),
  ])),
  agreement: join(runDir, 'stats', 'agreement.json'),
  pf2: join(runDir, 'stats', 'pf2-validation.json'),
  sensitivity: join(runDir, 'stats', 'sensitivity.json'),
})

const script = (name) => join(REPO_ROOT, 'scripts', name)

/** The exact deterministic subprocess graph, exported so tests can pin it. */
export function cleanroomRegenerationPlan({ manifest, runDir, logs, provenance, temporaryRunDir, bootstrapReplicates }) {
  const source = inputPaths(runDir)
  const out = outputPaths(temporaryRunDir)
  const cohorts = ['headline-38', 'strict-31', 'all-40-behavioral']
  const steps = [{
    name: 'merge finalized PF-2 rulings',
    program: script('merge-packet-rulings.mjs'),
    args: [
      '--key', source.key,
      '--sensitivity', source.sensitivityRatings,
      '--packet-key', source.packetKey,
      '--packet-ratings', source.packetRatings,
      '--negatives-key', source.negativesKey,
      '--negatives-ratings', source.negativesRatings,
      '--logs', logs,
      '--manifest', manifest,
      '--out', out.confirmed,
    ],
  }, {
    name: 'build opportunity table',
    program: script('opportunity-table.mjs'),
    args: ['--logs', logs, '--manifest', manifest, '--out', out.opportunity],
  }]

  for (const cohort of cohorts) {
    steps.push({
      name: `build ${cohort} ledger`,
      program: script('build-ledger.mjs'),
      args: [
        '--confirmed', out.confirmed,
        '--logs', logs,
        '--manifest', manifest,
        '--extract', source.extract,
        '--require-projection',
        '--drop-out-of-cohort',
        '--cohort', cohort,
        '--out', out.ledger[cohort],
      ],
    })
  }

  for (const cohort of cohorts) {
    steps.push({
      name: `build ${cohort} statistics`,
      program: script('stats-v3.mjs'),
      args: [
        '--opportunity', out.opportunity,
        '--ledger', out.ledger[cohort],
        '--manifest', manifest,
        '--cohort', cohort,
        '--logs', logs,
        '--bootstrap-n', String(bootstrapReplicates),
        '--json', out.stats[cohort],
      ],
    })
  }

  steps.push({
    name: 'build agreement report',
    program: script('agreement.mjs'),
    args: [
      '--key', source.key,
      '--negatives-key', source.negativesKey,
      '--negatives-ratings', source.negativesRatings,
      source.sensitivityRatings,
      '--json', out.agreement,
    ],
  }, {
    name: 'build PF-2 validation summary',
    program: script('build-pf2-validation.mjs'),
    args: [
      '--manifest', manifest,
      '--provenance', provenance,
      '--key', source.key,
      '--sensitivity', source.sensitivityRatings,
      '--packet-key', source.packetKey,
      '--packet-ratings', source.packetRatings,
      '--negatives-key', source.negativesKey,
      '--negatives-ratings', source.negativesRatings,
      '--confirmed-input', out.confirmed,
      '--out', out.pf2,
    ],
  }, {
    name: 'build cross-cohort sensitivity summary',
    program: script('build-sensitivity-v3.mjs'),
    args: [
      '--manifest', manifest,
      ...cohorts.flatMap((cohort) => ['--stats', out.stats[cohort]]),
      '--out', out.sensitivity,
    ],
  })
  return steps
}

function runStep(step) {
  const result = spawnSync(process.execPath, [step.program, ...step.args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw new Error(`${step.name}: could not start (${result.error.message})`)
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`${step.name}: subprocess exited ${result.status}${detail ? `\n${detail}` : ''}`)
  }
}

function currentGitHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function assertCommittedAnalysisTree() {
  const trackedChanges = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  if (trackedChanges) {
    throw new Error('tracked worktree changes are present — clean-room regeneration must run the committed code pinned by the manifest')
  }
  const entrypoints = [
    'scripts/build-cleanroom-v3.mjs',
    'scripts/merge-packet-rulings.mjs',
    'scripts/opportunity-table.mjs',
    'scripts/build-ledger.mjs',
    'scripts/stats-v3.mjs',
    'scripts/agreement.mjs',
    'scripts/build-pf2-validation.mjs',
    'scripts/build-sensitivity-v3.mjs',
  ]
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', ...entrypoints], {
    cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (tracked.status !== 0) {
    throw new Error('one or more clean-room builder entrypoints are not committed at current HEAD')
  }
}

/**
 * Run the clean-room proof. Optional dependencies exist solely for focused
 * fixture tests; the CLI always uses the real verifier and subprocess graph.
 */
export function runCleanroom(options, dependencies = {}) {
  for (const name of ['manifest', 'runDir', 'logs', 'provenance', 'out']) {
    if (!options?.[name]) throw new Error(`build-cleanroom-v3: --${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`)
  }
  const manifestPath = resolve(options.manifest)
  const runDir = resolve(options.runDir)
  const logs = resolve(options.logs)
  const provenance = resolve(options.provenance)
  const out = resolve(options.out)
  assertRegularFile(manifestPath, 'analysis manifest')
  assertRegularFile(provenance, 'PF-2 provenance manifest')
  if (!existsSync(runDir) || !statSync(runDir).isDirectory()) throw new Error(`run directory missing: ${runDir}`)
  if (!existsSync(logs) || !statSync(logs).isDirectory()) throw new Error(`log directory missing: ${logs}`)
  for (const label of CLEANROOM_ARTIFACTS) assertRegularFile(join(runDir, label), `expected clean-room artifact ${label}`)

  const loader = dependencies.loadManifest ?? loadManifest
  const verifier = dependencies.verifyManifest ?? verifyManifest
  const headResolver = dependencies.currentGitHead ?? currentGitHead
  const committedTreeVerifier = dependencies.assertCommittedAnalysisTree ?? assertCommittedAnalysisTree
  const manifest = loader(manifestPath)
  verifier(manifest, { logsDir: logs })
  const head = headResolver()
  if (manifest.codeCommit !== head) {
    throw new Error(`analysis manifest codeCommit ${String(manifest.codeCommit)} does not match current HEAD ${head}`)
  }
  committedTreeVerifier()
  if (!Number.isInteger(manifest.bootstrap?.replicates) || manifest.bootstrap.replicates < 1) {
    throw new Error('analysis manifest has no positive integer bootstrap.replicates')
  }

  // A failed rerun must not leave a previously-green report available for a
  // human or a weaker consumer to mistake for the current attempt. G11 also
  // re-hashes everything, but removing this one generated file makes the
  // fail-closed state unambiguous even outside the gate runner.
  if (existsSync(out)) {
    if (!statSync(out).isFile()) throw new Error(`clean-room output is not a regular file: ${out}`)
    rmSync(out)
  }

  const temporaryRunDir = mkdtempSync(join(tmpdir(), 'agent-mafia-cleanroom-v3-'))
  try {
    mkdirSync(join(temporaryRunDir, 'ledger'), { recursive: true })
    mkdirSync(join(temporaryRunDir, 'opportunity'), { recursive: true })
    mkdirSync(join(temporaryRunDir, 'stats'), { recursive: true })
    if (dependencies.regenerate) {
      dependencies.regenerate({ temporaryRunDir, manifest, manifestPath, runDir, logs, provenance })
    } else {
      const steps = cleanroomRegenerationPlan({
        manifest: manifestPath,
        runDir,
        logs,
        provenance,
        temporaryRunDir,
        bootstrapReplicates: manifest.bootstrap.replicates,
      })
      for (const step of steps) runStep(step)
    }

    const reproduced = compareCleanroomArtifacts(runDir, temporaryRunDir)
    const report = {
      schemaVersion: CLEANROOM_SCHEMA_VERSION,
      generator: 'scripts/build-cleanroom-v3.mjs',
      analysisRunId: manifest.analysisRunId,
      manifestSha256: sha256File(manifestPath),
      codeCommit: manifest.codeCommit,
      pf2ProvenanceSha256: sha256File(provenance),
      logs: { count: manifest.logs?.count ?? Object.keys(manifest.logs?.files ?? {}).length },
      bootstrap: {
        seed: manifest.bootstrap.seed,
        replicates: manifest.bootstrap.replicates,
      },
      ok: true,
      artifactCount: reproduced.length,
      artifactSetSha256: cleanroomArtifactSetSha256(reproduced),
      reproduced,
    }
    writeFileAtomic(out, `${JSON.stringify(report, null, 2)}\n`)
    return report
  } finally {
    rmSync(temporaryRunDir, { recursive: true, force: true })
  }
}

function main() {
  const { values } = parseArgs({
    options: {
      manifest: { type: 'string' },
      'run-dir': { type: 'string' },
      logs: { type: 'string' },
      provenance: { type: 'string' },
      out: { type: 'string' },
    },
  })
  for (const flag of ['manifest', 'run-dir', 'logs', 'provenance']) {
    if (!values[flag]) throw new Error(`--${flag} is required`)
  }
  const runDir = resolve(values['run-dir'])
  const report = runCleanroom({
    manifest: values.manifest,
    runDir,
    logs: values.logs,
    provenance: values.provenance,
    out: values.out ?? join(runDir, 'cleanroom.json'),
  })
  console.log(`clean-room PASS: ${report.artifactCount} byte-identical artifacts, run ${report.analysisRunId.slice(0, 12)}…`)
}

const isDirect = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isDirect) {
  try { main() } catch (error) {
    console.error(`build-cleanroom-v3: ${error.message ?? error}`)
    process.exit(1)
  }
}
