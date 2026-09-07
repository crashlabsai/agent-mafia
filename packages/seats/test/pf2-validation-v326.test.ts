import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { computeAnalysisRunId } from '../../../scripts/analysis-manifest.mjs'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { buildPf2Validation, writePf2Validation } from '../../../scripts/build-pf2-validation.mjs'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { PF2_PACKET_VERSION, recallClaimFingerprint } from '../../../scripts/correction-validation.mjs'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { wilson } from '../../../scripts/publication-omission.mjs'

const dirs: string[] = []
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const writeJson = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
const writeJsonl = (path: string, rows: unknown[]) => writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`)

type Fixture = {
  dir: string
  paths: FixturePaths
  options: Record<string, string>
}

type FixturePaths = {
  manifest: string
  provenance: string
  key: string
  sensitivity: string
  packetKey: string
  packetRatings: string
  negativesKey: string
  negativesRatings: string
  confirmedInput: string
  out: string
}

function makeFixture(mutate?: (artifacts: Record<string, any>) => void): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'pf2-validation-'))
  dirs.push(dir)
  const paths: FixturePaths = {
    manifest: join(dir, 'manifest.json'),
    provenance: join(dir, 'provenance.json'),
    key: join(dir, 'key.jsonl'),
    sensitivity: join(dir, 'sensitivity.json'),
    packetKey: join(dir, 'packetKey.jsonl'),
    packetRatings: join(dir, 'packetRatings.json'),
    negativesKey: join(dir, 'negativesKey.jsonl'),
    negativesRatings: join(dir, 'negativesRatings.json'),
    confirmedInput: join(dir, 'confirmedInput.jsonl'),
    out: join(dir, 'out.json'),
  }
  const ratedRun = 'a'.repeat(64)
  const codeCommit = 'b'.repeat(40)

  const sealedRows = [
    { item: 1, seed: 's1', seq: 10, kind: 'role_claim', role: 'doctor', quote: 'I am doctor', machineDecision: 'accepted', analysisRunId: ratedRun },
    { item: 2, seed: 's1', seq: 20, kind: 'role_claim', role: 'mafia', quote: 'I am mafia', machineDecision: 'accepted', analysisRunId: ratedRun },
    { item: 3, seed: 's1', seq: 30, kind: 'investigation_claim', target: 'Nia', result: 'mafia', quote: 'Nia is mafia', machineDecision: 'accepted', analysisRunId: ratedRun },
    { item: 4, seed: 's1', seq: 40, kind: 'protection_claim', target: 'Alex', quote: 'I protected Alex', machineDecision: 'accepted', analysisRunId: ratedRun },
    { item: 5, seed: 's1', seq: 50, kind: 'investigation_claim', target: 'Jo', result: 'not mafia', quote: 'Jo is clear', machineDecision: 'rejected', analysisRunId: ratedRun },
  ]
  const key = [
    { _meta: true, mode: 'positives', analysisRunId: ratedRun, items: 5, machinePositives: 4, rejectedPowerCandidates: 1 },
    ...sealedRows,
  ]
  const sensitivity = {
    rater: 'Codex test', analysisRunId: ratedRun,
    blindSource: 'synthetic blind sheets', answerKeyOpened: false,
    positiveRatings: { 1: 'OK', 2: 'BAD', 3: 'CORRECTED', 4: 'OK', 5: 'BAD' },
    rules: { 2: 'R10', 3: 'R12b', 5: 'R10' },
    corrections: { 3: { target: 'Nia' } }, notes: {},
  }
  const negativeSource = {
    item: 'N1', seed: 's1', seq: 60, day: 1, seat: 'seat-2', text: 'For clarity: I am the doctor.', analysisRunId: ratedRun,
  }
  const negativesKey = [
    { _meta: true, mode: 'negatives', analysisRunId: ratedRun, items: 1, requested: 1 },
    negativeSource,
  ]
  const missed = { kind: 'role_claim', role: 'doctor', quote: 'I am the doctor' }
  const negativesRatings = {
    rater: 'Codex test', analysisRunId: ratedRun,
    blindSource: 'synthetic blind negative sheet', answerKeyOpened: false,
    negativeClaims: { N1: [missed] },
  }
  const packetRows = [
    { packetItem: 1, origin: 2, seed: 's1', seq: 20, kind: 'role_claim', section: 'dispute', sensitivityRuling: 'BAD', analysisRunId: ratedRun },
    { packetItem: 2, origin: 1, seed: 's1', seq: 10, kind: 'role_claim', section: 'audit', sensitivityRuling: 'OK', analysisRunId: ratedRun },
    { packetItem: 3, origin: 3, seed: 's1', seq: 30, kind: 'investigation_claim', section: 'dispute', sensitivityRuling: 'CORRECTED', analysisRunId: ratedRun },
    {
      packetItem: 4, origin: 'miss-N1', claimId: 'miss-N1#0', seed: 's1', seq: 60,
      kind: 'role_claim', section: 'recall-miss', sensitivityRuling: 'CLAIMED', analysisRunId: ratedRun,
      claim: { ...recallClaimFingerprint(missed), charStart: negativeSource.text.indexOf(missed.quote) },
    },
    { packetItem: 5, origin: 4, seed: 's1', seq: 40, kind: 'protection_claim', section: 'audit', sensitivityRuling: 'OK', analysisRunId: ratedRun },
    { packetItem: 6, origin: 5, seed: 's1', seq: 50, kind: 'investigation_claim', section: 'dispute', sensitivityRuling: 'BAD', analysisRunId: ratedRun },
  ]
  const packetKey = [
    { _meta: true, mode: 'adjudication-packet', analysisRunId: ratedRun, sensitivityRater: 'Codex test', seed: 'packet-900', items: 6, disputes: 3, audit: 2, misses: 1 },
    ...packetRows,
  ]
  const packetRatings = {
    rater: 'ryan', analysisRunId: ratedRun, packetSeed: 'packet-900', packetVersion: PF2_PACKET_VERSION,
    packetKeySha256: '', packetItems: 6, blindSource: 'packet sheet only', answerKeyOpened: false,
    rulingVocabulary: ['OK', 'BAD', 'CORRECTED'],
    positiveRatings: { 1: 'BAD', 2: 'OK', 3: 'OK', 4: 'OK', 5: 'CORRECTED', 6: 'BAD' },
    rules: { 1: 'R10', 2: 'R1', 3: 'R12b', 4: 'R1', 5: 'R12b', 6: 'R10' },
    corrections: { 5: { target: 'Nia' } }, notes: {},
  }
  const artifacts: Record<string, any> = { key, sensitivity, negativesKey, negativesRatings, packetKey, packetRatings }
  mutate?.(artifacts)

  writeJsonl(paths.key, artifacts.key)
  writeJson(paths.sensitivity, artifacts.sensitivity)
  writeJsonl(paths.negativesKey, artifacts.negativesKey)
  writeJson(paths.negativesRatings, artifacts.negativesRatings)
  writeJsonl(paths.packetKey, artifacts.packetKey)
  artifacts.packetRatings.packetKeySha256 = sha(readFileSync(paths.packetKey))
  writeJson(paths.packetRatings, artifacts.packetRatings)

  const immutable = [
    [paths.key, 'sealed-key'], [paths.negativesKey, 'sealed-key'],
    [paths.sensitivity, 'sensitivity-ratings'], [paths.negativesRatings, 'sensitivity-ratings'],
    [paths.packetKey, 'packet'], [paths.packetRatings, 'human-adjudication'],
  ] as const
  const provenanceFiles = immutable.map(([path, kind]) => ({
    path, kind, bytes: statSync(path).size, sha256: sha(readFileSync(path)),
  }))
  const counts: Record<string, number> = {}
  const aggregate = createHash('sha256')
  for (const file of provenanceFiles) {
    counts[file.kind] = (counts[file.kind] ?? 0) + 1
    aggregate.update(`${file.path}\x00${file.sha256}\n`)
  }
  const provenance = {
    manifestVersion: `pf2-provenance-${PF2_PACKET_VERSION}`, analysisRunId: ratedRun,
    codeCommit, packetVersion: PF2_PACKET_VERSION, counts, files: provenanceFiles,
    disclosures: ['The sitting is item-level blind but not prior-free.'],
    aggregateSha256: aggregate.digest('hex'),
  }
  writeJson(paths.provenance, provenance)

  const current = {
    manifestVersion: 'analysis-v3.1', codeCommit, humanRaters: ['ryan'], supersedes: [ratedRun],
    archivedReadings: [
      ...immutable.map(([path]) => ({ path, sha256: sha(readFileSync(path)), kind: path.endsWith('jsonl') ? 'jsonl' : 'json' })),
      { path: paths.provenance, sha256: sha(readFileSync(paths.provenance)), kind: 'json' },
    ],
  } as Record<string, any>
  current.analysisRunId = computeAnalysisRunId(current)
  writeJson(paths.manifest, current)

  const humanFor = (packetItem: number, via: string) => ({
    rater: 'ryan', confirmed: artifacts.packetRatings.positiveRatings[String(packetItem)] !== 'BAD',
    ruling: artifacts.packetRatings.positiveRatings[String(packetItem)],
    rule: artifacts.packetRatings.rules[String(packetItem)], note: '', via,
  })
  const confirmedRows = [
    { ...sealedRows[0], analysisRunId: current.analysisRunId, human: humanFor(2, 'packet-audit') },
    { ...sealedRows[1], analysisRunId: current.analysisRunId, human: humanFor(1, 'packet-dispute') },
    { ...sealedRows[2], analysisRunId: current.analysisRunId, human: humanFor(3, 'packet-dispute') },
    {
      ...sealedRows[3], analysisRunId: current.analysisRunId,
      corrected: { rule: 'R12b', target: 'Nia', replaced: { target: 'Alex' } },
      human: humanFor(5, 'packet-audit'),
    },
    { ...sealedRows[4], analysisRunId: current.analysisRunId, human: humanFor(6, 'packet-dispute') },
    {
      item: 'miss-N1#0', seed: 's1', game: null, seq: 60, day: 1, seat: 'seat-2', kind: 'role_claim', role: 'doctor',
      quote: missed.quote, charStart: negativeSource.text.indexOf(missed.quote), machineDecision: 'missed-recovered',
      analysisRunId: current.analysisRunId, sources: ['negative-sample'],
      machine: { asserted: true, kind: 'role_claim', fields: { role: 'doctor' } },
      human: { rater: 'ryan', confirmed: true, ruling: 'OK', rule: 'R1', note: '', via: 'packet-recall-miss' },
    },
  ]
  const confirmedMeta = {
    _meta: true, mode: 'confirmed-input', analysisRunId: current.analysisRunId, ratedUnderRunId: ratedRun,
    rater: 'ryan', sensitivityRater: 'Codex test', design: 'PF-2 targeted human pass, v3.2 §3 OK/BAD/CORRECTED',
    rulingVocabulary: ['OK', 'BAD', 'CORRECTED'], items: 6, total: 5, humanRuled: 5,
    sensitivityOnly: 0, confirmed: 4, corrected: 1, excluded: 2, missesAdded: 1,
  }
  writeJsonl(paths.confirmedInput, [confirmedMeta, ...confirmedRows])

  return {
    dir, paths,
    options: {
      manifest: paths.manifest, provenance: paths.provenance, key: paths.key,
      sensitivity: paths.sensitivity, packetKey: paths.packetKey, packetRatings: paths.packetRatings,
      negativesKey: paths.negativesKey, negativesRatings: paths.negativesRatings,
      confirmedInput: paths.confirmedInput, out: paths.out,
    },
  }
}

test('PF-2 validation derives sensitivity, dispute, audit, recall, and final-input counts', () => {
  const fixture = makeFixture()
  const summary = buildPf2Validation(fixture.options)
  assert.equal(summary.analysisRunId, JSON.parse(readFileSync(fixture.paths.manifest, 'utf8')).analysisRunId)
  assert.deepEqual(summary.sensitivityPass.rulings, { ok: 2, bad: 2, corrected: 1 })
  assert.deepEqual(summary.sensitivityPass.machineAcceptedByFamily.role_claim, {
    rated: 2, ok: 1, bad: 1, corrected: 0, okRate: 0.5,
  })
  assert.equal(summary.sensitivityPass.rejectedPowerCandidates, 1)
  assert.deepEqual(summary.humanPacket.disputes.finalRulings, { ok: 1, bad: 2, corrected: 0 })
  assert.equal(summary.humanPacket.disputes.exactAgreement, 2)
  assert.deepEqual(summary.humanPacket.audit.finalRulings, { ok: 1, bad: 0, corrected: 1 })
  assert.equal(summary.humanPacket.audit.confirmationRate, 0.5)
  assert.deepEqual(summary.humanPacket.audit.wilson95, wilson(1, 2))
  assert.match(summary.humanPacket.audit.metricLabel, /not two-human agreement/)
  assert.deepEqual(summary.humanPacket.recallMiss.finalRulings, { ok: 1, bad: 0, corrected: 0 })
  assert.equal(summary.targetedCandidateScan.publishedFamilyCandidates, 1)
  assert.match(summary.targetedCandidateScan.interpretation, /not a recall or omission-rate estimate/i)
  assert.deepEqual(summary.finalLedgerInput, {
    records: 6, sourceCandidates: 5, confirmed: 4, excluded: 2, corrected: 1,
    humanFinal: 6, humanRuledSourceCandidates: 5, sensitivityUncontested: 0, recoveredMisses: 1,
  })
})

test('PF-2 validation output is deterministic and content-addressed', () => {
  const fixture = makeFixture()
  const first = writePf2Validation(fixture.options)
  const firstBytes = readFileSync(fixture.paths.out)
  const second = writePf2Validation(fixture.options)
  assert.deepEqual(second, first)
  assert.deepEqual(readFileSync(fixture.paths.out), firstBytes)
  assert.match(first.provenance.inputs.confirmedInputSha256, /^[0-9a-f]{64}$/)
  assert.match(first.provenance.generatorSourceSha256, /^[0-9a-f]{64}$/)
  assert.match(first.provenance.codeCommitScope, /rating\/extraction pipeline/)
})

test('PF-2 validation fails on bytes no longer pinned by both manifests', () => {
  const fixture = makeFixture()
  const sensitivity = JSON.parse(readFileSync(fixture.paths.sensitivity, 'utf8'))
  sensitivity.positiveRatings['1'] = 'BAD'
  writeJson(fixture.paths.sensitivity, sensitivity)
  assert.throws(() => buildPf2Validation(fixture.options), /not pinned exactly once|bytes differ|byte count changed/)
})

test('PF-2 validation fails closed on a mislabeled packet section even when the bad bytes are pinned', () => {
  const fixture = makeFixture((artifacts) => {
    artifacts.packetKey[2].section = 'dispute'
    artifacts.packetKey[0].audit = 1
    artifacts.packetKey[0].disputes = 4
  })
  assert.throws(() => buildPf2Validation(fixture.options), /dispute section is not the full sensitivity non-OK census/)
})

test('PF-2 validation re-derives the full seeded packet order', () => {
  const fixture = makeFixture((artifacts) => {
    const meta = artifacts.packetKey[0]
    const rows = artifacts.packetKey.slice(1).reverse()
    rows.forEach((row: any, index: number) => { row.packetItem = index + 1 })
    artifacts.packetKey = [meta, ...rows]
  })
  assert.throws(() => buildPf2Validation(fixture.options), /full shuffled order does not re-derive/)
})

test('PF-2 validation fails closed on confirmed-input ruling-path drift', () => {
  const fixture = makeFixture()
  const lines = readFileSync(fixture.paths.confirmedInput, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  lines[1].human.via = 'sensitivity-uncontested'
  writeJsonl(fixture.paths.confirmedInput, lines)
  assert.throws(() => buildPf2Validation(fixture.options), /human\.via does not match/)
})

test('PF-2 validation rejects source-field or corrected-block drift in confirmed-input', () => {
  const sourceDrift = makeFixture()
  const sourceLines = readFileSync(sourceDrift.paths.confirmedInput, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  sourceLines[1].quote = 'substituted receipt'
  writeJsonl(sourceDrift.paths.confirmedInput, sourceLines)
  assert.throws(() => buildPf2Validation(sourceDrift.options), /sealed source fields changed/)

  const correctionDrift = makeFixture()
  const correctionLines = readFileSync(correctionDrift.paths.confirmedInput, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  correctionLines.find((row) => row.item === 4).corrected.result = 'mafia'
  writeJsonl(correctionDrift.paths.confirmedInput, correctionLines)
  assert.throws(() => buildPf2Validation(correctionDrift.options), /corrected block has missing or extra fields/)
})

test('PF-2 validation requires both negative artifacts when recall candidates are present', () => {
  const fixture = makeFixture()
  const { negativesKey: _key, negativesRatings: _ratings, ...withoutNegatives } = fixture.options
  assert.throws(() => buildPf2Validation(withoutNegatives), /recall-miss rows but negative key\/ratings were not supplied/)
})
