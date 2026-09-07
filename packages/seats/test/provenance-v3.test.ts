import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { HASH_CHAIN_GENESIS, buildManifest, chainHash, checkCohortBinding, checkExtractionMeta, checkRunId, cohortHash, computeAnalysisRunId, registerReading, verifyManifest } from '../../../scripts/analysis-manifest.mjs'

// The spec's §5 required failing tests, run against a tiny synthetic corpus
// whose logs are REAL hash chains (built with the same chainHash the sweep
// logs were written with), so every failure below is the provenance layer
// detecting a genuine discrepancy — never a codec mismatch.
//
// Seeds are chosen so the §1 exclusion lists bite: headline-38 drops
// sweep1-6/-15 and strict-31 additionally drops sweep1-0/-13, giving the
// two cohorts different member sets even in a 5-game corpus.
const SEEDS = ['sweep1-0', 'sweep1-2', 'sweep1-6', 'sweep1-13', 'sweep1-15']

const dirs: string[] = []
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function syntheticLog(seed: string) {
  const events = [
    { type: 'game_created', actor: null, day: 1, payload: { seats: [] } },
    { type: 'message_sent', actor: 'seat-1', day: 1, phase: 'discussion', visibility: 'public', payload: { text: `hello from ${seed}` } },
    { type: 'message_sent', actor: 'seat-2', day: 1, phase: 'discussion', visibility: 'public', payload: { text: 'I am the doctor' } },
    { type: 'game_ended', actor: null, day: 1, payload: { winner: 'town' } },
  ]
  let prev = HASH_CHAIN_GENESIS
  const lines = events.map((e, seq) => {
    const bare = { seq, roomId: seed, matchId: 'm0', gameIndex: 0, ts: `t${seq}`, ...e }
    prev = chainHash(prev, bare)
    return JSON.stringify({ ...bare, hash: prev })
  })
  return { lines, root: prev }
}

function makeCorpus() {
  const dir = mkdtempSync(join(tmpdir(), 'provenance-v3-'))
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
  writeFileSync(specPath, '# synthetic analysis spec v3.1\n')
  const build = () =>
    buildManifest({
      logsDir,
      rootsPath,
      specPath,
      expectedGames: SEEDS.length,
      calibrationCount: 2,
      codeCommit: 'synthetic-commit',
      tripwireLexiconPath: null,
      tripwireReportPath: null,
      finder: { model: 'claude-fable-5', codeVersion: 'test' },
    })
  return { dir, logsDir, rootsPath, specPath, manifest: build(), build }
}

test('an untampered synthetic corpus builds and verifies, deterministically', () => {
  const { manifest, logsDir, specPath, build } = makeCorpus()
  assert.equal(verifyManifest(manifest, { logsDir, specPath }).ok, true)
  assert.equal(build().analysisRunId, manifest.analysisRunId, 'same inputs must rebuild to the same runId')
  assert.equal(manifest.calibration.games.length, 2)
  assert.deepEqual(manifest.cohorts['headline-38'].games, ['sweep1-0', 'sweep1-2', 'sweep1-13'])
  assert.deepEqual(manifest.cohorts['strict-31'].games, ['sweep1-2'])
})

test('one flipped log byte fails verifyManifest (§1: one changed byte anywhere fails the run)', () => {
  const { manifest, logsDir, specPath } = makeCorpus()
  const path = join(logsDir, 'sweep1-2.jsonl')
  writeFileSync(path, readFileSync(path, 'utf8').replace('hello from sweep1-2', 'hallo from sweep1-2'))
  assert.throws(() => verifyManifest(manifest, { logsDir, specPath }), /sweep1-2/)
})

test('changing the exclusion wording changes the cohort hash (§1 definitions are content-addressed)', () => {
  const { manifest } = makeCorpus()
  const cohort = manifest.cohorts['headline-38']
  const rehashed = cohortHash({ name: 'headline-38', excluded: cohort.excluded, games: cohort.games })
  assert.equal(rehashed, cohort.sha256, 'identical definition must rehash identically')
  const altered = cohortHash({
    name: 'headline-38',
    excluded: ['sweep1-6'],
    games: [...cohort.games, 'sweep1-15'],
  })
  assert.notEqual(altered, cohort.sha256)
})

test('a strict-31 seed set does not bind to the headline-38 cohort (§5 required failing test)', () => {
  const { manifest } = makeCorpus()
  assert.throws(
    () => checkCohortBinding(manifest, 'headline-38', manifest.cohorts['strict-31'].games),
    /headline-38: artifact lacks/,
  )
  assert.equal(checkCohortBinding(manifest, 'headline-38', manifest.cohorts['headline-38'].games).ok, true)
  assert.throws(() => checkCohortBinding(manifest, 'no-such-cohort', []), /unknown cohort/)
})

test('a stale, missing, or coverage-less extraction meta fails checkExtractionMeta (§3, §5)', () => {
  const { manifest } = makeCorpus()
  // The shape extract-v3 stamps in its meta line: the cacheKey is minted by
  // extract-v3 over internals the manifest does not pin, so the check binds
  // on the co-stamped components the manifest DOES pin.
  const fresh = {
    seed: 'sweep1-0',
    cacheKey: 'ab'.repeat(32),
    specSha256: manifest.spec.sha256,
    finderModel: 'claude-fable-5',
    messages: 2,
    unprocessedMessages: 0,
  }
  assert.equal(checkExtractionMeta(manifest, fresh).ok, true)
  // A meta stamped under a different spec hash is exactly what "stale"
  // means: the extraction ran before the spec froze to its current bytes.
  assert.throws(() => checkExtractionMeta(manifest, { ...fresh, specSha256: '0'.repeat(64) }), /stale extraction/)
  assert.throws(() => checkExtractionMeta(manifest, { ...fresh, cacheKey: undefined }), /missing or malformed cacheKey/)
  assert.throws(() => checkExtractionMeta(manifest, { ...fresh, seed: 'sweep1-99' }), /unknown seed/)
  assert.throws(() => checkExtractionMeta(manifest, { ...fresh, finderModel: 'other-model' }), /finder model/)
  assert.throws(
    () => checkExtractionMeta(manifest, { ...fresh, unprocessedMessages: 1 }),
    /coverage must be complete/,
  )
  assert.throws(() => checkExtractionMeta(manifest, { ...fresh, messages: 3 }), /saw 3 messages/)
  // Fail-closed on omitted coverage fields: absence is never completeness.
  assert.throws(() => checkExtractionMeta(manifest, { ...fresh, messages: undefined }), /coverage unproven/)
  assert.throws(() => checkExtractionMeta(manifest, { ...fresh, unprocessedMessages: undefined }), /coverage unproven/)
})

test('an artifact missing or mismatching the analysisRunId fails checkRunId (§5)', () => {
  const { manifest } = makeCorpus()
  assert.equal(checkRunId(manifest, { analysisRunId: manifest.analysisRunId }).ok, true)
  assert.equal(checkRunId(manifest, manifest.analysisRunId).ok, true)
  assert.throws(() => checkRunId(manifest, {}), /does not embed an analysisRunId/)
  assert.throws(() => checkRunId(manifest, { analysisRunId: 'deadbeef' }), /does not match/)
})

test('editing the manifest body without recomputing the runId fails verifyManifest', () => {
  const { manifest, logsDir, specPath } = makeCorpus()
  const tampered = JSON.parse(JSON.stringify(manifest))
  tampered.bootstrap.replicates = 19999
  assert.throws(() => verifyManifest(tampered, { logsDir, specPath }), /analysisRunId does not match/)
})

test('registerReading pins the file, classifies it, and moves the runId', () => {
  const { dir, manifest } = makeCorpus()
  const before = manifest.analysisRunId
  const reading = join(dir, 'sweep1-0.claims.jsonl')
  writeFileSync(reading, '{"_meta":true}\n')
  const entry = registerReading(manifest, reading)
  assert.equal(entry.kind, 'extraction')
  assert.match(entry.sha256, /^[0-9a-f]{64}$/)
  assert.notEqual(manifest.analysisRunId, before, 'a new archived reading is a new run')
  assert.equal(computeAnalysisRunId(manifest), manifest.analysisRunId)
  // Re-registering the same bytes is idempotent.
  const again = registerReading(manifest, reading)
  assert.deepEqual(again, entry)
  assert.equal(manifest.archivedReadings.length, 1)
})

test('a tampered or missing archived reading fails verifyManifest (§5 hash-pinned readings)', () => {
  const { dir, manifest, logsDir, specPath } = makeCorpus()
  const reading = join(dir, 'sweep1-0.claims.jsonl')
  writeFileSync(reading, '{"_meta":true}\n')
  registerReading(manifest, reading)
  assert.equal(verifyManifest(manifest, { logsDir, specPath }).ok, true)
  writeFileSync(reading, '{"_meta":true,"tampered":1}\n')
  assert.throws(() => verifyManifest(manifest, { logsDir, specPath }), /bytes differ from the pinned hash/)
  rmSync(reading)
  assert.throws(() => verifyManifest(manifest, { logsDir, specPath }), /file missing/)
})

test('a hand-picked calibration list fails verifyManifest (§3.3 seeded draw)', () => {
  const { manifest, logsDir, specPath } = makeCorpus()
  const tampered = JSON.parse(JSON.stringify(manifest))
  // Two games guaranteed to differ from the seeded draw, runId recomputed —
  // the forgery the §3.3 protocol exists to prevent must still fail.
  const drawn = new Set<string>(tampered.calibration.games)
  tampered.calibration.games = SEEDS.filter((s) => !drawn.has(s)).slice(0, 2)
  tampered.analysisRunId = computeAnalysisRunId(tampered)
  assert.throws(
    () => verifyManifest(tampered, { logsDir, specPath }),
    /calibration games do not re-derive/,
  )
})
