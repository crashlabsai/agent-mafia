import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'agreement.mjs')
const dirs = []
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }) })

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
const writeJsonl = (path, rows) => writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`)

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agreement-separated-'))
  dirs.push(dir)
  const runId = 'run-123'
  const key = join(dir, 'sealed-key.jsonl')
  const negativesKey = join(dir, 'negatives-sealed-key.jsonl')
  const positives = join(dir, 'codex-ratings.json')
  const negatives = join(dir, 'codex-negatives.json')
  const out = join(dir, 'agreement.json')
  writeJsonl(key, [
    { _meta: true, analysisRunId: runId, items: 2 },
    { item: 1, kind: 'role_claim', machineDecision: 'accepted', quote: 'I am Detective.' },
    { item: 2, kind: 'not_mafia_claim', machineDecision: 'rejected', quote: 'That is not my team.' },
  ])
  writeJsonl(negativesKey, [
    { _meta: true, analysisRunId: runId, items: 2 },
    { item: 'N1', text: 'I am Doctor.', machineClaims: [] },
    { item: 'N2', text: 'No claim here.', machineClaims: [] },
  ])
  writeJson(positives, {
    rater: 'Codex', analysisRunId: runId, answerKeyOpened: false,
    positiveRatings: { 1: 'OK', 2: 'BAD' },
  })
  writeJson(negatives, {
    rater: 'Codex', analysisRunId: runId, answerKeyOpened: false,
    negativeClaims: { N1: [{ kind: 'role_claim' }], N2: [] },
  })
  return { dir, runId, key, negativesKey, positives, negatives, out }
}

function run(c) {
  return spawnSync(process.execPath, [
    SCRIPT,
    '--key', c.key,
    '--negatives-key', c.negativesKey,
    '--negatives-ratings', c.negatives,
    c.positives,
    '--json', c.out,
  ], { encoding: 'utf8' })
}

function runCombined(c) {
  return spawnSync(process.execPath, [
    SCRIPT,
    '--key', c.key,
    '--negatives-key', c.negativesKey,
    c.positives,
    '--json', c.out,
  ], { encoding: 'utf8' })
}

test('separate negative ratings join their positive rater and bind exact input hashes', () => {
  const c = fixture()
  const result = run(c)
  assert.equal(result.status, 0, result.stderr)

  const report = JSON.parse(readFileSync(c.out, 'utf8'))
  assert.equal(report.analysisRunId, c.runId)
  assert.deepEqual(report.perRater.map((row) => ({
    rater: row.rater, items: row.items, decided: row.decided, agreeJudge: row.agreeJudge,
  })), [{ rater: 'Codex', items: 2, decided: 2, agreeJudge: 2 }])
  assert.deepEqual(report.negatives.perRater.map((row) => ({
    rater: row.rater,
    ratedItems: row.ratedItems,
    listedClaims: row.listedClaims,
    missedClaims: row.missedClaims,
    itemsWithMiss: row.itemsWithMiss,
    publishedMisses: row.publishedFamilies.misses,
  })), [{
    rater: 'Codex', ratedItems: 2, listedClaims: 1, missedClaims: 1,
    itemsWithMiss: 1, publishedMisses: 1,
  }])
  assert.deepEqual(report.inputBindings, {
    key: { sha256: sha256(c.key), analysisRunId: c.runId },
    positiveRatings: [{ rater: 'Codex', sha256: sha256(c.positives), analysisRunId: c.runId }],
    negativesKey: { sha256: sha256(c.negativesKey), analysisRunId: c.runId },
    negativesRatings: { rater: 'Codex', sha256: sha256(c.negatives), analysisRunId: c.runId },
  })
})

test('separate negative ratings fail closed on positive or negative run mismatch', () => {
  const positiveMismatch = fixture()
  const positive = JSON.parse(readFileSync(positiveMismatch.positives, 'utf8'))
  positive.analysisRunId = 'other-run'
  writeJson(positiveMismatch.positives, positive)
  let result = run(positiveMismatch)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /does not match --key/)

  const negativeMismatch = fixture()
  const negative = JSON.parse(readFileSync(negativeMismatch.negatives, 'utf8'))
  negative.analysisRunId = 'other-run'
  writeJson(negativeMismatch.negatives, negative)
  result = run(negativeMismatch)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /does not match --key/)
})

test('separate negative ratings fail closed on rater or item-set mismatch', () => {
  const raterMismatch = fixture()
  const wrongRater = JSON.parse(readFileSync(raterMismatch.negatives, 'utf8'))
  wrongRater.rater = 'Someone else'
  writeJson(raterMismatch.negatives, wrongRater)
  let result = run(raterMismatch)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /matches 0 positive-ratings inputs/)

  const itemMismatch = fixture()
  const partial = JSON.parse(readFileSync(itemMismatch.negatives, 'utf8'))
  delete partial.negativeClaims.N2
  writeJson(itemMismatch.negatives, partial)
  result = run(itemMismatch)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /negativeClaims keys do not exactly match --negatives-key; missing N2/)
})

test('legacy combined positive and negative rater file remains supported', () => {
  const c = fixture()
  const combined = JSON.parse(readFileSync(c.positives, 'utf8'))
  combined.negativeClaims = JSON.parse(readFileSync(c.negatives, 'utf8')).negativeClaims
  writeJson(c.positives, combined)
  const result = runCombined(c)
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(readFileSync(c.out, 'utf8'))
  assert.equal(report.negatives.perRater[0].ratedItems, 2)
  assert.equal(report.negatives.perRater[0].missedClaims, 1)
  assert.equal(report.inputBindings.negativesRatings, undefined)
})
