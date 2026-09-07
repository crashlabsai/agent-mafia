import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { aggregateClaimPropositions } from '../../../scripts/claim-propositions.mjs'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { EVALUATOR_VERSION } from '../scripts/scoring-v3.mjs'

// The semantic gates beside the publication gates
// (docs/analysis/analysis-v3.2-amendment.md §11). The integrity gates validate
// provenance only — not one of them could have caught any of the 20 invalid
// rows in the row-level audit, because every artifact was well-formed. These
// gates check what the numbers mean. Fixtures only.

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SCRIPT = join(REPO, 'scripts', 'check-semantic-gates.mjs')
const PUBLICATION_GATES = join(REPO, 'scripts', 'check-gates.mjs')
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const dirs: string[] = []
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

const writeJsonl = (path: string, rows: unknown[]) =>
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')

/** Artifacts that make every artifact-level gate PASS; `patch` bends one. */
function makeArtifacts(patch: {
  ledgerRows?: Record<string, unknown>[]
  ledgerMeta?: Record<string, unknown>
  publication?: Record<string, unknown> | null
  stats?: Record<string, unknown>
  oppRows?: Record<string, unknown>[]
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'semantic-gates-'))
  dirs.push(dir)
  const ledgerDir = join(dir, 'ledger')
  const statsDir = join(dir, 'stats')
  mkdirSync(ledgerDir)
  mkdirSync(statsDir)

  writeJsonl(join(ledgerDir, 'confirmed.jsonl'), [
    { _meta: true, mode: 'ledger', projectionChecked: true, ...(patch.ledgerMeta ?? {}) },
    ...(patch.ledgerRows ?? [{ seed: 's1', seq: 10, kind: 'role_claim', verdict: 'true' }]),
  ])

  const publication = patch.publication === null ? null : {
    protocol: 'v3.2',
    honesty: {
      secondHumanRater: false,
      protocol: 'single-author validation protocol (v3.2 §8)',
      authorAdjudicatedReferenceSample: true, independentHumanGoldStandard: false,
      // §8 evidence: the label is never asserted bare (review finding 10).
      validation: {
        rater: 'ryan',
        census: { n: 12, byFamily: { role_claim: { n: 12, upheld: 12, tierLPublishable: true } } },
        trueSample: { n: 8, confirmed: 8 },
        messageScan: { n: 10, itemsWithMiss: 0 },
      },
    },
    sections: {
      falseStatementLedger: {
        countLabel: 'author-adjudicated counts',
        language: '12 author-adjudicated verifiably false statements (single-author validation protocol, v3.2 §8)',
      },
    },
    ...(patch.publication ?? {}),
  }
  const pubPath = join(dir, 'publication.json')
  if (publication) writeFileSync(pubPath, JSON.stringify(publication, null, 2))

  writeFileSync(join(statsDir, 'stats.json'), JSON.stringify(patch.stats ?? {
    definitions: {
      reportStratum: 'before any public verified investigation result',
      reportStratumResultTypes: ['mafia', 'not mafia'],
      vacuity: { checked: 5, violations: 0 },
    },
    models: [{ model: 'model-a', strata: { beforeAnyPublicVerifiedInvestigationResult: { hits: 1 } } }],
    nightAggregate: { detectiveFirstTimeTargets: { count: 1, n: 2 } },
  }, null, 2))

  const oppPath = join(dir, 'table.jsonl')
  writeJsonl(oppPath, [
    { _meta: true, generator: 'opportunity-table' },
    ...(patch.oppRows ?? [{
      seed: 's1', seq: 5, kind: 'day_vote', role: 'villager',
      chanceUniformOverLegalTargets: 0.25, chanceUniformOverLivingNonSelf: 1 / 3,
    }]),
  ])

  return { dir, ledgerDir, statsDir, pubPath, oppPath }
}

type Artifacts = ReturnType<typeof makeArtifacts>

function runGates(a: Artifacts, extra: string[] = []) {
  const r = spawnSync(process.execPath, [
    SCRIPT, '--strict',
    '--publication', a.pubPath, '--ledger', a.ledgerDir,
    '--stats', a.statsDir, '--opportunity', a.oppPath, ...extra,
  ], { cwd: REPO, encoding: 'utf8' })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

const emptyLedgerFamily = () => ({ n: 0, true: 0, false: 0, ambiguous: 0, falseClass: {} })

/** Minimal fixture for the independently executable G13 publication gate.
 * Other publication gates may be pending/failing; these tests assert G13's
 * own row, which is evaluated regardless so tampering cannot hide behind an
 * earlier failure. */
function makeG13Artifacts(tamper?: (fixture: {
  publication: Record<string, any>
  ledgerPath: string
  claims: Record<string, any>[]
}) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'g13-gates-'))
  dirs.push(dir)
  const ledgerDir = join(dir, 'ledger')
  const logsDir = join(dir, 'logs')
  mkdirSync(ledgerDir)
  mkdirSync(logsDir)

  const runId = 'g13-test-run'
  const events = [
    { seq: 1, type: 'game_created', payload: { seats: [{ id: 'seat-1', name: 'Ryan' }] } },
    { seq: 2, type: 'seat_bound', payload: { seat: 'seat-1', modelKey: 'model-a' } },
    { seq: 10, type: 'message_sent', visibility: 'public', actor: 'seat-1', payload: { text: 'I am a villager.' } },
    { seq: 11, type: 'message_sent', visibility: 'public', actor: 'seat-1', payload: { text: 'As I said, I am a villager.' } },
  ]
  const logBytes = events.map((row) => JSON.stringify(row)).join('\n') + '\n'
  writeFileSync(join(logsDir, 's1.jsonl'), logBytes)

  const claims = [10, 11].map((seq) => ({
    analysisRunId: runId,
    seed: 's1', seat: 'seat-1', seq, day: 1, charStart: 0,
    kind: 'role_claim', role: 'villager', verdict: 'true',
    quote: seq === 10 ? 'I am a villager.' : 'As I said, I am a villager.',
    human: { rater: 'ryan', confirmed: true },
  }))
  const ledgerPath = join(ledgerDir, 'confirmed.jsonl')
  const ledgerBytes = [
    { _meta: true, mode: 'ledger', analysisRunId: runId, projectionChecked: true, evaluatorVersion: EVALUATOR_VERSION },
    ...claims,
  ].map((row) => JSON.stringify(row)).join('\n') + '\n'
  writeFileSync(ledgerPath, ledgerBytes)

  const mapping = aggregateClaimPropositions(claims)
  const propositionFamilies = mapping.countRanges.byKind
  const receiptFamilies = Object.fromEntries([
    ['investigation_claim', emptyLedgerFamily()],
    ['not_mafia_claim', emptyLedgerFamily()],
    ['protection_claim', emptyLedgerFamily()],
    ['role_claim', { n: 2, true: 2, false: 0, ambiguous: 0, falseClass: {} }],
  ])
  const publication: Record<string, any> = {
    analysisRunId: runId,
    protocol: 'v3.2',
    evaluatorVersion: EVALUATOR_VERSION,
    sections: {
      falseStatementLedger: {
        sourceLedger: { filename: 'confirmed.jsonl', sha256: sha256(ledgerBytes) },
        omittedFamilies: [],
        claimUnit: {
          primary: 'truth-resolved underlying claim proposition count range',
          secondary: 'public claim utterance receipt (R20)',
          mappingVersion: mapping.version,
          mappingSha256: mapping.mappingSha256,
          linkageBasisCounts: mapping.linkageBasisCounts,
        },
        upperBoundPropositionCandidates: mapping.upperBoundRows,
        claims,
        totals: {
          propositionCountRange: { lower: 1, upper: 1 }, claimUtteranceReceipts: 2,
          falsePropositionCountRange: { lower: 0, upper: 0 }, falseClaimUtteranceReceipts: 0,
          byKind: {
            investigation_claim: { true: { lower: 0, upper: 0 }, false: { lower: 0, upper: 0 } },
            not_mafia_claim: { true: { lower: 0, upper: 0 }, false: { lower: 0, upper: 0 } },
            protection_claim: { true: { lower: 0, upper: 0 }, false: { lower: 0, upper: 0 } },
            role_claim: { true: { lower: 1, upper: 1 }, false: { lower: 0, upper: 0 } },
          },
          falseClassRanges: {},
        },
        ambiguousDisclosed: {
          propositionCountRange: { lower: 0, upper: 0 }, utteranceReceipts: 0,
          byKind: Object.fromEntries(['investigation_claim', 'not_mafia_claim', 'protection_claim', 'role_claim']
            .map((kind) => [kind, { lower: 0, upper: 0 }])),
        },
      },
      ballotAccuracy: JSON.parse(JSON.stringify([
        { model: 'model-a', ledgerFamilies: propositionFamilies, ledgerReceiptFamilies: receiptFamilies },
      ])),
    },
    stats: {
      evaluatorVersion: EVALUATOR_VERSION,
      claimPropositions: mapping,
      ledgerResolvedPropositionCountRange: { lower: 1, upper: 1 },
      ledgerAmbiguousPropositionCountRange: { lower: 0, upper: 0 },
      ledgerClaimReceipts: 2,
      models: [{
        model: 'model-a',
        ledgerFamilies: JSON.parse(JSON.stringify(propositionFamilies)),
        ledgerReceiptFamilies: JSON.parse(JSON.stringify(receiptFamilies)),
      }],
    },
  }
  tamper?.({ publication, ledgerPath, claims })
  const pubPath = join(dir, 'publication.json')
  writeFileSync(pubPath, JSON.stringify(publication, null, 2))

  const manifestPath = join(dir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify({
    analysisRunId: runId,
    logs: { count: 1, files: { s1: { sha256: sha256(logBytes) } } },
    tripwire: {},
  }, null, 2))
  return { dir, ledgerDir, logsDir, pubPath, manifestPath }
}

function runG13(a: ReturnType<typeof makeG13Artifacts>) {
  const r = spawnSync(process.execPath, [
    PUBLICATION_GATES,
    '--manifest', a.manifestPath,
    '--publication', a.pubPath,
    '--ledger', a.ledgerDir,
    '--logs', a.logsDir,
    '--outdir', a.dir,
  ], { cwd: REPO, encoding: 'utf8' })
  return `${r.stdout}${r.stderr}`
}

function omitRoleFamily(publication: Record<string, any>, claims: Record<string, any>[]) {
  const surviving = ['investigation_claim', 'not_mafia_claim', 'protection_claim']
  const keptMapping = aggregateClaimPropositions([], { includeKinds: surviving })
  const omittedMapping = aggregateClaimPropositions(claims, { includeKinds: ['role_claim'] })
  const zeroReceipt = () => emptyLedgerFamily()
  publication.sections.falseStatementLedger.omittedFamilies = [{
    family: 'role_claim',
    reason: 'retained-precision lower bound below the §8 floor — Tier L results omitted, not disclose-and-published',
    omittedReceiptCounts: { true: 2, false: 0, ambiguous: 0 },
    omittedPropositionCountRanges: omittedMapping.countRanges.byKind.role_claim,
  }]
  publication.sections.falseStatementLedger.claims = []
  publication.sections.falseStatementLedger.claimUnit.mappingSha256 = keptMapping.mappingSha256
  publication.sections.falseStatementLedger.claimUnit.linkageBasisCounts = keptMapping.linkageBasisCounts
  publication.sections.falseStatementLedger.upperBoundPropositionCandidates = []
  publication.sections.falseStatementLedger.totals = {
    propositionCountRange: { lower: 0, upper: 0 }, claimUtteranceReceipts: 0,
    falsePropositionCountRange: { lower: 0, upper: 0 }, falseClaimUtteranceReceipts: 0,
    byKind: Object.fromEntries(surviving.map((kind) => [kind, {
      true: { lower: 0, upper: 0 }, false: { lower: 0, upper: 0 },
    }])),
    falseClassRanges: {},
  }
  publication.sections.falseStatementLedger.ambiguousDisclosed = {
    propositionCountRange: { lower: 0, upper: 0 }, utteranceReceipts: 0,
    byKind: Object.fromEntries(surviving.map((kind) => [kind, { lower: 0, upper: 0 }])),
  }
  publication.stats.claimPropositions = keptMapping
  publication.stats.ledgerResolvedPropositionCountRange = { lower: 0, upper: 0 }
  publication.stats.ledgerAmbiguousPropositionCountRange = { lower: 0, upper: 0 }
  publication.stats.ledgerClaimReceipts = 0
  publication.stats.models[0].ledgerFamilies = keptMapping.countRanges.byKind
  publication.stats.models[0].ledgerReceiptFamilies = Object.fromEntries(surviving.map((kind) => [kind, zeroReceipt()]))
  publication.sections.ballotAccuracy = JSON.parse(JSON.stringify(publication.stats.models))
}

test('G13: hash-pinned source receipts and both log-attributed model tables pass recomputation', () => {
  const out = runG13(makeG13Artifacts())
  assert.match(out, /G13\s+PASS/)
  assert.match(out, /1–1 truth-resolved underlying proposition\(s\); 0–0 ambiguous disclosed separately; 2 receipt\(s\)/)
})

test('G13: a stale evaluator version cannot publish under the current claim-unit contract', () => {
  const out = runG13(makeG13Artifacts(({ publication }) => {
    publication.evaluatorVersion = 'v3.2.2'
  }))
  assert.match(out, /G13\s+FAIL/)
  assert.match(out, /publication evaluatorVersion "v3\.2\.2" != current v3\.2\.3/)
})

test('G13: a changed source ledger fails its published sha256 pin', () => {
  const out = runG13(makeG13Artifacts(({ ledgerPath }) => {
    writeFileSync(ledgerPath, '{"tampered":true}\n')
  }))
  assert.match(out, /G13\s+FAIL/)
  assert.match(out, /source ledger sha256 does not match/)
})

test('G13: substituted publication receipts fail exact equality with the pinned ledger', () => {
  const out = runG13(makeG13Artifacts(({ publication }) => {
    publication.sections.falseStatementLedger.claims[1] = {
      ...publication.sections.falseStatementLedger.claims[1],
      quote: 'same count, different receipt',
    }
  }))
  assert.match(out, /G13\s+FAIL/)
  assert.match(out, /receipt rows do not exactly equal/)
})

test('G13: tampered proposition-range family cells fail recomputation', () => {
  const out = runG13(makeG13Artifacts(({ publication }) => {
    publication.stats.models[0].ledgerFamilies.role_claim.propositions.upper = 2
  }))
  assert.match(out, /G13\s+FAIL/)
  assert.match(out, /ledgerFamilies does not recompute/)
})

test('G13: the hoisted ballotAccuracy copy cannot drift from stats.models', () => {
  const out = runG13(makeG13Artifacts(({ publication }) => {
    publication.sections.ballotAccuracy[0].ledgerFamilies.role_claim.true.upper = 2
  }))
  assert.match(out, /G13\s+FAIL/)
  assert.match(out, /ballotAccuracy does not exactly equal/)
})

test('G13: tampered receipt-family cells and stored model attribution fail recomputation', () => {
  const badReceipt = runG13(makeG13Artifacts(({ publication }) => {
    publication.stats.models[0].ledgerReceiptFamilies.role_claim.true = 1
  }))
  assert.match(badReceipt, /G13\s+FAIL/)
  assert.match(badReceipt, /ledgerReceiptFamilies does not recompute/)

  const badModel = runG13(makeG13Artifacts(({ publication }) => {
    publication.stats.models[0].model = 'model-b'
  }))
  assert.match(badModel, /G13\s+FAIL/)
  assert.match(badModel, /omits log-attributed model model-a/)
})

test('G13: omitted-family receipt counts and proposition ranges are bound to the source ledger', () => {
  const good = makeG13Artifacts(({ publication, claims }) => omitRoleFamily(publication, claims))
  assert.match(runG13(good), /G13\s+PASS/)

  const badCounts = makeG13Artifacts(({ publication, claims }) => {
    omitRoleFamily(publication, claims)
    publication.sections.falseStatementLedger.omittedFamilies[0].omittedReceiptCounts.true = 1
  })
  assert.match(runG13(badCounts), /omitted receipt counts\/proposition ranges do not recompute/)

  const badRange = makeG13Artifacts(({ publication, claims }) => {
    omitRoleFamily(publication, claims)
    publication.sections.falseStatementLedger.omittedFamilies[0].omittedPropositionCountRanges.propositions.upper = 2
  })
  assert.match(runG13(badRange), /omitted receipt counts\/proposition ranges do not recompute/)
})

test('§11: complete v3.2 artifacts pass every semantic gate under --strict', () => {
  const { status, out } = runGates(makeArtifacts())
  assert.equal(status, 0, out)
  assert.match(out, /10 pass · 0 fail · 0 pending/)
})

test('S1 spec-is-law: a changed byte of the frozen v3.1 spec fails the check', () => {
  const a = makeArtifacts()
  const forged = join(a.dir, 'spec.md')
  writeFileSync(forged, '# not the frozen spec\n')
  const { status, out } = runGates(a, ['--spec', forged])
  assert.equal(status, 1)
  assert.match(out, /S1\s+FAIL/)
  assert.match(out, /v3\.1 is FROZEN; amend v3\.2 instead/)
})

test('S4: an unstated claimedNight fails, recomputed from the logs; strike markers are normal (§2)', () => {
  // v3.2.1: S4 recomputes §2 from the committed logs — for every published
  // record with a claimedNight, the source message must literally state that
  // night. A strike MARKER is normal counted operation and passes (the
  // v3.2.0 gate failed publication on every strike, contradicting §2's
  // strike-and-continue design: review finding 10).
  const a = makeArtifacts({
    ledgerRows: [{ seed: 's1', seq: 10, kind: 'investigation_claim', verdict: 'false', claimedNight: 2 }],
  })
  const logsDir = join(a.dir, 'logs')
  mkdirSync(logsDir)
  writeJsonl(join(logsDir, 's1.jsonl'), [
    { seq: 10, day: 2, type: 'message_sent', actor: 'seat-1', visibility: 'public', payload: { text: 'I investigated Liv last night.' } },
  ])
  const unstated = runGates(a, ['--logs', logsDir])
  assert.equal(unstated.status, 1)
  assert.match(unstated.out, /S4\s+FAIL/)
  assert.match(unstated.out, /not literally stated/)

  // Same record with the night stated in the message: PASS.
  const b = makeArtifacts({
    ledgerRows: [
      { seed: 's1', seq: 10, kind: 'investigation_claim', verdict: 'true', claimedNight: 2 },
      { seed: 's1', seq: 11, kind: 'investigation_claim', verdict: 'true', claimedNightStruck: 1 },
    ],
  })
  const logsB = join(b.dir, 'logs')
  mkdirSync(logsB)
  writeJsonl(join(logsB, 's1.jsonl'), [
    { seq: 10, day: 2, type: 'message_sent', actor: 'seat-1', visibility: 'public', payload: { text: 'Night 2 result: Liv is clear.' } },
    { seq: 11, day: 2, type: 'message_sent', actor: 'seat-1', visibility: 'public', payload: { text: 'I checked Sam last night.' } },
  ])
  const stated = runGates(b, ['--logs', logsB])
  assert.match(stated.out, /S4\s+PASS/)
  assert.match(stated.out, /1 strike marker/)
})

test('S5: a v3.2 publication carrying lower-bound language fails (§9)', () => {
  const withLowerBound = runGates(makeArtifacts({
    publication: {
      honesty: {
        secondHumanRater: false, lowerBoundLanguage: true,
        protocol: 'single-author validation protocol (v3.2 §8)',
        authorAdjudicatedReferenceSample: true,
      },
      sections: { falseStatementLedger: { language: 'at least 171 verifiably false statements' } },
    },
  }))
  assert.equal(withLowerBound.status, 1)
  assert.match(withLowerBound.out, /S5\s+FAIL/)
  assert.match(withLowerBound.out, /lower-bound/)
})

test('S6: a stratum computed over one truthful result type fails (§6)', () => {
  const { status, out } = runGates(makeArtifacts({
    stats: {
      definitions: {
        reportStratum: 'before any public verified investigation result',
        reportStratumResultTypes: ['mafia'],
        vacuity: { checked: 5, violations: 0 },
      },
      models: [], nightAggregate: { detectiveFirstTimeTargets: { count: 0, n: 0 } },
    },
  }))
  assert.equal(status, 1)
  assert.match(out, /S6\s+FAIL/)
  assert.match(out, /BOTH truthful result types/)
})

test('S7: a ledger built without the §4 projection check fails', () => {
  const { status, out } = runGates(makeArtifacts({ ledgerMeta: { projectionChecked: false } }))
  assert.equal(status, 1)
  assert.match(out, /S7\s+FAIL/)
  assert.match(out, /--extract --require-projection/)
})

test('S8: statistics without the vacuity assertion cannot publish the metric (§7)', () => {
  const { status, out } = runGates(makeArtifacts({
    stats: {
      definitions: {
        reportStratum: 'before any public verified investigation result',
        reportStratumResultTypes: ['mafia', 'not mafia'],
      },
      models: [], nightAggregate: { detectiveFirstTimeTargets: { count: 0, n: 0 } },
    },
  }))
  assert.equal(status, 1)
  assert.match(out, /S8\s+FAIL/)
  assert.match(out, /\[pending\] until recorded/)
})

test('S9: a town ballot missing a named baseline fails (§5)', () => {
  const { status, out } = runGates(makeArtifacts({
    oppRows: [{ seed: 's1', seq: 5, kind: 'day_vote', role: 'villager', chance: 1 / 3 }],
  }))
  assert.equal(status, 1)
  assert.match(out, /S9\s+FAIL/)
  assert.match(out, /both named baselines/)
})

test('§11: PENDING blocks under --strict but not on a bare acceptance check', () => {
  const a = makeArtifacts()
  const empty = join(a.dir, 'nothing')
  mkdirSync(empty)
  const args = ['--publication', join(empty, 'publication.json'), '--ledger', empty, '--stats', empty, '--opportunity', join(empty, 'table.jsonl')]
  const strict = spawnSync(process.execPath, [SCRIPT, '--strict', ...args], { cwd: REPO, encoding: 'utf8' })
  assert.equal(strict.status, 1, strict.stdout)
  assert.match(strict.stdout, /publication is BLOCKED/)
  const loose = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO, encoding: 'utf8' })
  assert.equal(loose.status, 0, loose.stdout)
  assert.match(loose.stdout, /pending gates need run artifacts/)
})
