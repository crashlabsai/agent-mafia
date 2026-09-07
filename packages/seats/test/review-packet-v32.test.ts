import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { PER_FAMILY_RATE_FLOOR, RETAINED_PRECISION_FLOOR, REVIEW_PACKET_VERSION, buildPacket, mergeRulings, renderSheet, selectCensus, selectRandomMessages, selectTrueSample } from '../../../scripts/build-review-packet.mjs'

// The single-author validation packet (docs/analysis/analysis-v3.2-amendment.md
// §8): three arms, one blinded shuffled sheet, deterministic given a seed, with
// an unblinding/merge mode. Fixtures only — building a packet touches no model.

const FAMILIES = ['role_claim', 'not_mafia_claim', 'investigation_claim', 'protection_claim']

/** A ledger-shaped claim. */
const claim = (i: number, kind: string, verdict: string) => ({
  seed: `sweep1-${i % 4}`, seq: 100 + i, day: 2, seat: 'seat-1', kind, verdict,
  ...(verdict === 'false' ? { falseClass: 'misrepresented_role' } : {}),
  target: 'Liv', quote: `quote ${i}`, charStart: 0,
  speakerRole: 'mafia', model: 'model-a', // must never reach the sheet
  human: { rater: 'ryan', confirmed: true },
})

const LEDGER = [
  { _meta: true, mode: 'ledger' },
  ...Array.from({ length: 24 }, (_, i) => claim(i, FAMILIES[i % 4]!, i % 3 === 0 ? 'false' : 'true')),
]

const MESSAGES = Array.from({ length: 40 }, (_, i) => ({
  seed: `sweep1-${i % 4}`, seq: 500 + i, day: 1, actor: 'seat-2', speaker: 'Liv', text: `message ${i}`,
}))

test('§8 arm 1 is a CENSUS — every false-labeled claim, no sampling', () => {
  const census = selectCensus(LEDGER)
  const allFalse = LEDGER.filter((c: any) => !c._meta && c.verdict === 'false')
  assert.equal(census.length, allFalse.length)
  assert.ok(census.every((c: any) => c.verdict === 'false'))
})

test('§8 arm 2 stratifies BY FAMILY ONLY, with a per-family minimum', () => {
  const sample = selectTrueSample(LEDGER, { n: 8, minPerFamily: 2, seed: 's' })
  assert.ok(sample.every((c: any) => c.verdict === 'true'))
  const byFamily = new Map<string, number>()
  for (const c of sample) byFamily.set(c.kind, (byFamily.get(c.kind) ?? 0) + 1)
  for (const f of FAMILIES) assert.ok((byFamily.get(f) ?? 0) >= 2, `${f} is below its per-family minimum`)
  // Oversampling protection and not_mafia — the two families the v3.1 audit
  // found the machine weakest on.
  assert.ok((byFamily.get('protection_claim') ?? 0) >= (byFamily.get('role_claim') ?? 0))
  assert.ok((byFamily.get('not_mafia_claim') ?? 0) >= (byFamily.get('role_claim') ?? 0))
})

test('§8: the packet is deterministic given a seed, and reshuffles when it changes', () => {
  const build = (seed: string) => buildPacket({
    census: selectCensus(LEDGER),
    trueSample: selectTrueSample(LEDGER, { n: 8, minPerFamily: 2, seed }),
    messages: selectRandomMessages(MESSAGES, { n: 10, seed }),
    seed,
  })
  const a = build('review-1')
  const b = build('review-1')
  assert.deepEqual(a.items, b.items, 'same seed, byte-identical packet')
  assert.deepEqual(a.key, b.key)
  const c = build('review-2')
  assert.notDeepEqual(a.key.map((k: any) => `${k.seed}|${k.seq}`), c.key.map((k: any) => `${k.seed}|${k.seq}`))
})

test('§8: the packet is independent of INPUT ORDER — same content, same bytes (review finding 13)', () => {
  // v3.2.0 hashed the array index into the shuffle, so re-ordering the ledger
  // rows changed the packet and the sealed key under the same seed. The
  // documented property is content-determinism, and this pins it.
  const rows = LEDGER.filter((c: any) => !c._meta)
  const forward = { census: selectCensus([...rows]), trueSample: selectTrueSample([...rows], { n: 8, minPerFamily: 2, seed: 'review-1' }), messages: selectRandomMessages([...MESSAGES], { n: 10, seed: 'review-1' }), seed: 'review-1' }
  const reversed = { census: selectCensus([...rows].reverse()), trueSample: selectTrueSample([...rows].reverse(), { n: 8, minPerFamily: 2, seed: 'review-1' }), messages: selectRandomMessages([...MESSAGES].reverse(), { n: 10, seed: 'review-1' }), seed: 'review-1' }
  const a = buildPacket(forward)
  const b = buildPacket(reversed)
  assert.deepEqual(a.items, b.items, 'reversed input order, byte-identical packet')
  assert.deepEqual(a.key, b.key, 'and byte-identical sealed key')
})

test('§8: items never reveal verdict, arm, role, model, or outcome', () => {
  const { items, key } = buildPacket({
    census: selectCensus(LEDGER),
    trueSample: selectTrueSample(LEDGER, { n: 8, minPerFamily: 2, seed: 's' }),
    messages: selectRandomMessages(MESSAGES, { n: 10, seed: 's' }),
    seed: 's',
  })
  const leaked = ['verdict', 'falseClass', 'arm', 'speakerRole', 'role', 'model', 'winner', 'human']
  for (const it of items) {
    for (const k of leaked) assert.equal(k in it, false, `item ${it.item} leaks ${k}`)
  }
  // The sealed key — which the rater does not open — is where those live.
  assert.ok(key.every((k: any) => 'arm' in k && 'verdict' in k))
  // A message-scan item shows no kind and no fields: the rater is looking for
  // claims, not confirming one.
  const scan = key.filter((k: any) => k.arm === 'message-scan').map((k: any) => k.item)
  for (const it of items.filter((i: any) => scan.includes(i.item))) {
    assert.equal(it.kind, null)
    assert.equal(it.fields, null)
  }
})

test('§8: the sheet shows the message, its context window, and the ruling slots', () => {
  const { items } = buildPacket({ census: [claim(1, 'role_claim', 'false')], seed: 's' })
  const bySeq = new Map([['sweep1-1|101', {
    seed: 'sweep1-1', seq: 101, day: 2, speaker: 'Josie', text: 'I am the doctor.',
    context: [{ speaker: 'Liv', text: 'who is the doctor?' }],
  }]])
  const sheet = renderSheet(items, bySeq, { context: 2 })
  assert.match(sheet, /> I am the doctor\./)
  assert.match(sheet, /earlier, Liv:\* who is the doctor\?/)
  assert.match(sheet, /ruling: OK \/ BAD \/ CORRECTED\s+rule:/)
  // The rendered ITEM carries no verdict and no falseClass. (The instructions
  // above it say the words "verdict" and "role" only to forbid them.)
  const body = sheet.slice(sheet.indexOf('**1.**'))
  assert.doesNotMatch(body, /verdict|misrepresented_role|falseClass/i)
})

// --- unblinding / merge -----------------------------------------------------

// A census of 40 role_claim rows and 1 not_mafia_claim row: 40 is enough for a
// clean census to clear the frozen retained-precision floor, and 1 is
// deliberately below the per-family positives floor.
const ROLE_CENSUS_N = 40
const KEY_META = {
  _meta: true, mode: 'review-packet', version: REVIEW_PACKET_VERSION, seed: 's',
  analysisRunId: 'run-A', ledgerSha256: 'ledger-sha',
  // v3.2.4: scan rows must match the sealed sampling frame exactly.
  samplingFrame: {
    cohort: 'headline-38', games: ['s1'], logSha256: {}, poolMessages: 2,
    excludedPacketMessages: 0, seed: 's', selectedMessages: ['s1|400', 's1|401'],
  },
}
const BIND = { analysisRunId: 'run-A', packetSeed: 's', packetVersion: REVIEW_PACKET_VERSION, packetKeySha256: 'key-sha' }
const KEY = [
  KEY_META,
  { item: 1, arm: 'census', seed: 's1', seq: 1, kind: 'not_mafia_claim', verdict: 'false' },
  ...Array.from({ length: ROLE_CENSUS_N }, (_, i) => ({
    item: 2 + i, arm: 'census', seed: 's1', seq: 10 + i, kind: 'role_claim', verdict: 'false',
  })),
  { item: ROLE_CENSUS_N + 2, arm: 'true-sample', seed: 's1', seq: 300, kind: 'role_claim', verdict: 'true' },
  { item: ROLE_CENSUS_N + 3, arm: 'true-sample', seed: 's1', seq: 301, kind: 'role_claim', verdict: 'true' },
  { item: ROLE_CENSUS_N + 4, arm: 'message-scan', seed: 's1', seq: 400, kind: null, verdict: null },
  { item: ROLE_CENSUS_N + 5, arm: 'message-scan', seed: 's1', seq: 401, kind: null, verdict: null },
]
const TRUE_ITEM = String(ROLE_CENSUS_N + 2)
const SCAN_ITEM = String(ROLE_CENSUS_N + 4)
const rulingsFor = (over: Record<string, string> = {}) => ({
  rater: 'ryan', ...BIND,
  positiveRatings: Object.fromEntries(KEY.filter((k: any) => !k._meta).map((k: any) => [String(k.item), over[String(k.item)] ?? 'OK'])),
  rules: Object.fromEntries(KEY.filter((k: any) => !k._meta).map((k: any) => [String(k.item), '§2.1'])),
  missedClaims: { [SCAN_ITEM]: [{ kind: 'role_claim', quote: 'I am the doctor' }] },
  notes: {},
})

test('§8: the merge publishes the census overturn rate per family', () => {
  const summary = mergeRulings(KEY, rulingsFor({ '2': 'BAD', '3': 'CORRECTED' }), { ledgerClaims: [] })
  const role = summary.census.byFamily.role_claim
  assert.equal(role.n, ROLE_CENSUS_N)
  assert.equal(role.overturned, 2, 'BAD and CORRECTED both overturn the published false label')
  assert.equal(role.upheld, ROLE_CENSUS_N - 2)
  assert.ok(Math.abs(role.overturnRate - 2 / ROLE_CENSUS_N) < 1e-12)
  assert.equal(summary.label, 'author-adjudicated reference sample, not an independent human gold standard')
})

test('§8: a family under the positives floor publishes counts only, never a rate', () => {
  const summary = mergeRulings(KEY, rulingsFor(), { ledgerClaims: [] })
  const thin = summary.census.byFamily.not_mafia_claim
  assert.equal(thin.n, 1)
  assert.ok(thin.n < PER_FAMILY_RATE_FLOOR)
  assert.equal(thin.overturnRate, null)
  assert.equal(thin.retainedPrecisionLowerBound, null)
  assert.match(thin.rateSuppressed, /counts only/)
  assert.equal(thin.tierLPublishable, false, 'a suppressed rate can never clear the publication gate')
})

test('§8: the publication gate omits a family below the retained-precision floor', () => {
  const clean = mergeRulings(KEY, rulingsFor(), { ledgerClaims: [] })
  // 40/40 upheld: the Wilson lower bound clears the frozen floor.
  assert.ok(clean.census.byFamily.role_claim.retainedPrecisionLowerBound >= RETAINED_PRECISION_FLOOR)
  assert.equal(clean.census.byFamily.role_claim.tierLPublishable, true)

  const dirty = mergeRulings(KEY, rulingsFor({ '2': 'BAD', '3': 'BAD', '4': 'BAD' }), { ledgerClaims: [] })
  assert.ok(dirty.census.byFamily.role_claim.retainedPrecisionLowerBound < RETAINED_PRECISION_FLOOR)
  assert.equal(dirty.census.byFamily.role_claim.tierLPublishable, false, 'unmet means OMIT, not disclose-and-publish')
})

test('§8: the message-scan arm yields a missed-claim estimate with a Wilson interval', () => {
  const summary = mergeRulings(KEY, rulingsFor(), { ledgerClaims: [] })
  assert.equal(summary.messageScan.n, 2)
  assert.equal(summary.messageScan.itemsWithMiss, 1)
  assert.equal(summary.messageScan.missRate, 0.5)
  assert.equal(summary.messageScan.wilson95.length, 2)
  assert.ok(summary.messageScan.wilson95[0] < 0.5 && summary.messageScan.wilson95[1] > 0.5)
  assert.equal(summary.messageScan.scope, 'published families')
  assert.equal(summary.trueSample.confirmationRate, 1)
})

test('§8: every merged ruling must cite a codebook rule', () => {
  const rulings = rulingsFor()
  delete (rulings.rules as Record<string, string>)[TRUE_ITEM]
  assert.throws(() => mergeRulings(KEY, rulings, { ledgerClaims: [] }), /cite the exact codebook rule/)
})

test('§8: an unruled or out-of-vocabulary item refuses the merge', () => {
  assert.throws(() => mergeRulings(KEY, rulingsFor({ [TRUE_ITEM]: 'MAYBE' }), { ledgerClaims: [] }), /invalid ruling/)
})

// --- v3.2.2: blinding, binding, cross-check --------------------------------

test('v3.2.2: sheet items never carry the machine advisory (anchoring)', () => {
  const withAdvisory = [
    { _meta: true, mode: 'ledger' },
    { ...claim(1, 'protection_claim', 'false'), advisory: 'doctor-directive' },
  ]
  const { items, key } = buildPacket({ census: selectCensus(withAdvisory), seed: 's' })
  assert.equal((items[0] as any).advisory, undefined, 'the advisory is hidden until after the first-pass ruling')
  assert.equal((key[0] as any).advisory, 'doctor-directive', 'and lives in the sealed key for the reconciliation')
})

test('v3.2.3: rulings bind by run id, seed, version, and key hash — missing metadata is rejected, not only mismatched', () => {
  const { key } = buildPacket({ census: selectCensus(LEDGER), seed: 's' })
  const meta = { _meta: true, analysisRunId: 'run-A', seed: 's', version: REVIEW_PACKET_VERSION, ledgerSha256: 'abc' }
  const base = {
    rater: 'ryan', analysisRunId: 'run-A', packetSeed: 's', packetVersion: REVIEW_PACKET_VERSION, packetKeySha256: 'deadbeef',
    positiveRatings: Object.fromEntries(key.map((k: any) => [String(k.item), 'OK'])),
    rules: Object.fromEntries(key.map((k: any) => [String(k.item), '§2.1'])),
  }
  // Missing metadata: rejected outright (v3.2.3 — absence was the bypass).
  const { packetKeySha256: _drop, ...missingHash } = base
  assert.throws(() => mergeRulings([meta, ...key], missingHash), /missing required metadata field "packetKeySha256"/)
  assert.throws(() => mergeRulings(key, base), /no meta line/)
  // Mismatches, each named.
  assert.throws(() => mergeRulings([meta, ...key], { ...base, analysisRunId: 'run-B' }), /analysisRunId/)
  assert.throws(() => mergeRulings([meta, ...key], { ...base, packetSeed: 'other' }), /packetSeed/)
  assert.throws(() => mergeRulings([{ ...meta, version: 'v9.9.9' }, ...key], base), /version/)
  assert.throws(() => mergeRulings([meta, ...key], base, { keySha256: 'not-deadbeef' }), /packetKeySha256/)
  const ok = mergeRulings([meta, ...key], base, { keySha256: 'deadbeef' })
  assert.equal(ok.ledgerSha256, 'abc', 'the provisional ledger hash rides the summary')
  assert.equal(ok.packetKeySha256, 'deadbeef')
  assert.ok(Array.isArray(ok.census.claimKeys) && ok.census.claimKeys.length === ok.census.n, 'exact claim identities, not counts')
})

test('v3.2.3 §8 cross-check: complete model ratings, typed disagreements, final-based machine metrics, unaided first-pass beside them', () => {
  const meta = { _meta: true, mode: 'review-packet', version: REVIEW_PACKET_VERSION, seed: 's', analysisRunId: 'run-A' }
  const { key } = buildPacket({ census: selectCensus(LEDGER), seed: 's' })
  const rulings = {
    rater: 'ryan', analysisRunId: 'run-A', packetSeed: 's', packetVersion: REVIEW_PACKET_VERSION, packetKeySha256: 'x',
    positiveRatings: Object.fromEntries(key.map((k: any) => [String(k.item), 'OK'])),
    rules: Object.fromEntries(key.map((k: any) => [String(k.item), '§2.1'])),
  }
  const model = {
    rater: 'model-x', analysisRunId: 'run-A', packetSeed: 's', packetVersion: REVIEW_PACKET_VERSION, packetKeySha256: 'x',
    method: { model: 'model-x-2026', promptSha256: 'ff'.repeat(32), settings: { temperature: 0 } },
    positiveRatings: { ...rulings.positiveRatings, [String((key[0] as any).item)]: 'BAD' },
  }
  // Incomplete model ratings refuse the merge (v3.2.3).
  const { positiveRatings: full, ...restModel } = model
  const incomplete = { ...restModel, positiveRatings: { ...full } }
  delete incomplete.positiveRatings[String((key[1] as any).item)]
  assert.throws(() => mergeRulings([meta, ...key], rulings, { modelRulings: incomplete, modelRulingsSha256: 'model-sha' }), /no valid ruling/)
  // A model artifact without its method is not reviewable evidence.
  const { method: _m, ...noMethod } = model
  assert.throws(() => mergeRulings([meta, ...key], rulings, { modelRulings: noMethod, modelRulingsSha256: 'model-sha' }), /method/)
  // A disagreement without a final ruling refuses the merge.
  assert.throws(() => mergeRulings([meta, ...key], rulings, { modelRulings: model, modelRulingsSha256: 'model-sha', ledgerClaims: [] }), /reconciliation incomplete/)
  const finals = {
    positiveRatings: { [String((key[0] as any).item)]: 'BAD' },
    rules: { [String((key[0] as any).item)]: '§2 (non-assertion)' },
  }
  const summary = mergeRulings([meta, ...key], rulings, { modelRulings: model, modelRulingsSha256: 'model-sha', finalRulings: finals })
  assert.equal(summary.crossCheck.rater, 'model-x', 'never counted as a second human — named as the model it is')
  assert.equal(summary.crossCheck.method.model, 'model-x-2026', 'the artifact names how it was produced')
  assert.deepEqual(summary.crossCheck.disagreements.map((d: any) => d.about), ['ruling'])
  assert.equal(summary.crossCheck.resolutions[0].finalRuling, 'BAD')
  // v3.2.3 (reversing v3.2.2): machine-error metrics use the FINAL
  // adjudication of the frozen provisional rows — the final BAD counts as an
  // overturn — while the unaided first-pass is preserved beside it.
  const overturns = Object.values(summary.census.byFamily).reduce((a: number, v: any) => a + v.overturned, 0)
  assert.equal(overturns, 1, 'the final BAD overturns the machine row')
  const unaided = Object.values(summary.unaidedFirstPass.censusOverturnsByFamily).reduce((a: number, v: any) => a + v, 0)
  assert.equal(unaided, 0, 'the unaided author overturned nothing — that drift is itself published')
  assert.equal(summary.unaidedFirstPass.changedByReconciliation, 1)
})

test('v3.2.3 surgical: the cross-check compares the COMPLETE proposition — role, referencedDay, resolvingContext', () => {
  const meta = { _meta: true, mode: 'review-packet', version: REVIEW_PACKET_VERSION, seed: 's', analysisRunId: 'run-A' }
  const scanKey = [
    { ...meta, samplingFrame: { cohort: 'headline-38', games: ['s1'], logSha256: {}, poolMessages: 1, excludedPacketMessages: 0, seed: 's', selectedMessages: ['s1|400'] } },
    { item: 1, arm: 'message-scan', seed: 's1', seq: 400, kind: null, verdict: null },
  ]
  const bind = { analysisRunId: 'run-A', packetSeed: 's', packetVersion: REVIEW_PACKET_VERSION, packetKeySha256: 'x' }
  const method = { model: 'model-x-2026', promptSha256: 'ab'.repeat(32) }
  const author = {
    rater: 'ryan', ...bind,
    positiveRatings: { '1': 'OK' }, rules: { '1': '§2.1' },
    missedClaims: { '1': [{ kind: 'role_claim', role: 'doctor', quote: 'I am the doctor' }] },
  }
  // Same kind, same quote — the ONLY difference is the role. v3.2.3's bug:
  // this compared as agreement.
  const model = {
    rater: 'model-x', ...bind, method,
    positiveRatings: { '1': 'OK' },
    missedClaims: { '1': [{ kind: 'role_claim', role: 'mafia', quote: 'I am the doctor' }] },
  }
  assert.throws(() => mergeRulings(scanKey, author, { modelRulings: model, modelRulingsSha256: 'model-sha', ledgerClaims: [] }), /reconciliation incomplete/,
    'a role-only difference IS a disagreement and demands reconciliation')
  // Resolving the missed-claims disagreement takes CONTENT, not a label.
  const labelOnly = { positiveRatings: { '1': 'OK' }, rules: { '1': '§2.1' } }
  assert.throws(() => mergeRulings(scanKey, author, { modelRulings: model, modelRulingsSha256: 'model-sha', finalRulings: labelOnly, ledgerClaims: [] }), /no missedClaims list/)
  const withContent = { ...labelOnly, missedClaims: { '1': [{ kind: 'role_claim', role: 'doctor', quote: 'I am the doctor' }] } }
  const summary = mergeRulings(scanKey, author, { modelRulings: model, modelRulingsSha256: 'model-sha', finalRulings: withContent, ledgerClaims: [] })
  assert.equal(summary.crossCheck.disagreements[0].about, 'missed-claims')

  // Corrected-fields: identical except resolvingContext — also a disagreement,
  // and its resolution must carry the chosen corrections.
  const claimKey2 = [meta, { item: 1, arm: 'census', seed: 's1', seq: 10, kind: 'investigation_claim', verdict: 'false' }]
  const authorC = {
    rater: 'ryan', ...bind,
    positiveRatings: { '1': 'CORRECTED' }, rules: { '1': 'R12b' },
    corrections: { '1': { target: 'Liv', resolvingContext: { seq: 4, text: 'earlier' } } },
  }
  const modelC = {
    rater: 'model-x', ...bind, method,
    positiveRatings: { '1': 'CORRECTED' },
    corrections: { '1': { target: 'Liv', resolvingContext: { seq: 7, text: 'different' } } },
  }
  assert.throws(() => mergeRulings(claimKey2, authorC, { modelRulings: modelC, modelRulingsSha256: 'model-sha' }), /reconciliation incomplete/,
    'a resolvingContext-only difference IS a disagreement')
  const labelOnlyC = { positiveRatings: { '1': 'CORRECTED' }, rules: { '1': 'R12b' } }
  assert.throws(() => mergeRulings(claimKey2, authorC, { modelRulings: modelC, modelRulingsSha256: 'model-sha', finalRulings: labelOnlyC }), /no corrections entry/)
  const withCorr = { ...labelOnlyC, corrections: { '1': { target: 'Liv', resolvingContext: { seq: 4, text: 'earlier' } } } }
  const s2 = mergeRulings(claimKey2, authorC, { modelRulings: modelC, modelRulingsSha256: 'model-sha', finalRulings: withCorr })
  assert.equal(s2.crossCheck.disagreements[0].about, 'corrected-fields')
})

// --- v3.2.4 regressions ------------------------------------------------------

test('v3.2.4: a rater-listed claim the ledger already carries is NEVER a miss', () => {
  // The provisional ledger already holds a role_claim on scanned message
  // s1|400 — the rater listing it is recall WORKING, not failing.
  const already = mergeRulings(KEY, rulingsFor(), {
    ledgerClaims: [{ seed: 's1', seq: 400, kind: 'role_claim' }],
  })
  assert.equal(already.messageScan.itemsWithMiss, 0, 'an already-extracted claim never counts as a miss')
  assert.equal(already.messageScan.claimLevel.alreadyExtracted, 1)
  assert.equal(already.messageScan.claimLevel.newMisses, 0)
  assert.equal(already.messageScan.missedByFamily.role_claim, 0)
  assert.equal(already.messageScan.statistic, 'message-level omission incidence', 'the statistic is named for what it is')
  // A ledger claim of a DIFFERENT kind on the same message does not absorb it.
  const distinct = mergeRulings(KEY, rulingsFor(), {
    ledgerClaims: [{ seed: 's1', seq: 400, kind: 'protection_claim', target: 'X' }],
  })
  assert.equal(distinct.messageScan.itemsWithMiss, 1, 'a distinct-kind listing is still a genuine miss')
  assert.equal(distinct.messageScan.claimLevel.newMisses, 1)
})

test('v3.2.4: a substituted, truncated, or frameless scan arm is refused; ledgerClaims are mandatory', () => {
  // Substituted: a scan row outside the sealed selection.
  const subKey = KEY.map((k: any) => (String(k.item) === SCAN_ITEM ? { ...k, seq: 999 } : k))
  assert.throws(() => mergeRulings(subKey, rulingsFor(), { ledgerClaims: [] }), /not in the sealed samplingFrame/)
  // Truncated frame vs the rows on the sheet.
  const truncMeta = { ...(KEY_META as any), samplingFrame: { ...(KEY_META as any).samplingFrame, selectedMessages: ['s1|400'] } }
  assert.throws(() => mergeRulings([truncMeta, ...KEY.slice(1)], rulingsFor(), { ledgerClaims: [] }), /truncated or padded/)
  // No frame at all: a pre-v3.2.4 packet is refused, not trusted.
  const { samplingFrame: _f, ...noFrame } = KEY_META as any
  assert.throws(() => mergeRulings([noFrame, ...KEY.slice(1)], rulingsFor(), { ledgerClaims: [] }), /no samplingFrame/)
  // The already-extracted comparison is not optional.
  assert.throws(() => mergeRulings(KEY, rulingsFor()), /no ledgerClaims/)
})
