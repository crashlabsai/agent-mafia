import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { aggregateClaimPropositions } from '../../../scripts/claim-propositions.mjs'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { resolveEffectiveClaimTarget } from '../scripts/scoring-v3.mjs'

const base = {
  seed: 'g1', seat: 'seat-1', day: 2, kind: 'investigation_claim',
  target: 'Dylan', result: 'not mafia', verdict: 'true',
}
const TARGETS: Record<string, string> = { Dylan: 'seat-2', Sam: 'seat-3' }
const MESSAGES: Record<string, { text: string, actor: string }> = {
  'g1:10': { text: 'N1 Dylan is not mafia', actor: 'seat-1' },
  'g1:20': { text: 'I checked him again last night: clear', actor: 'seat-1' },
}
const aggregate = (rows: Record<string, unknown>[]) => aggregateClaimPropositions(rows, {
  resolveTarget: (claim: any) => TARGETS[String(claim.target)] ?? null,
  getMessage: (seed: string, seq: number) => MESSAGES[`${seed}:${seq}`],
})

test('v3.2.6: a later N1 reiteration is one proposition with two utterance receipts', () => {
  const out = aggregate([
    { ...base, seq: 10, claimedNight: 1, quote: 'N1 Dylan is not mafia' },
    { ...base, seq: 30, claimedNight: 1, quote: 'My N1 Dylan clear still stands' },
  ])
  assert.equal(out.receiptCount, 2)
  assert.deepEqual(out.countRanges.propositions, { lower: 1, upper: 1 })
  assert.equal(out.exactlyLinkedReiterationReceipts, 1)
  assert.equal(out.upperBoundRows[0].mentionCount, 2)
  assert.equal(out.upperBoundRows[0].eventRef, 'night:1')
  assert.deepEqual(out.upperBoundRows[0].receipts.map((r: any) => r.groupingBasis), ['literal-night', 'literal-night'])
})

test('v3.2.6: nightless action text never auto-collapses onto a prior event', () => {
  const unlinked = aggregate([
    { ...base, seq: 10, claimedNight: 1, quote: 'N1 Dylan clear' },
    { ...base, seq: 20, quote: 'I checked Dylan again last night: clear' },
  ])
  assert.deepEqual(unlinked.countRanges.propositions, { lower: 1, upper: 2 }, 'the second text could be a repeat or a new action')
  assert.equal(unlinked.linkageUncertainReceiptCount, 1)
  assert.ok(unlinked.upperBoundRows.some((row: any) => row.eventRef.startsWith('receipt:')))

  const contextOnly = aggregate([
    { ...base, seq: 10, claimedNight: 1, quote: 'N1 Dylan is not mafia' },
    { ...base, seq: 20, quote: 'I checked him again last night: clear', resolvingContext: { seq: 10, text: 'N1 Dylan is not mafia' } },
  ])
  assert.deepEqual(contextOnly.countRanges.propositions, { lower: 1, upper: 2 }, 'context can resolve “him” without proving the same investigation event')
  assert.equal(contextOnly.upperBoundRows[1].receipts[0].groupingBasis, 'context-validated-event-unlinked')

  assert.throws(() => aggregate([
    { ...base, seq: 20, quote: 'I checked him again last night: clear', resolvingContext: false },
  ]), /resolvingContext needs exactly/, 'a falsy primitive cannot bypass source-ledger validation')
})

test('v3.2.6: unresolved targets are wildcards below and receipt-bound above', () => {
  const resolvedPlusPronoun = aggregate([
    { ...base, seq: 10, target: 'Dylan', claimedNight: 1, quote: 'N1 Dylan clear' },
    { ...base, seq: 20, target: 'him', claimedNight: 1, quote: 'N1 he was clear' },
  ])
  assert.deepEqual(resolvedPlusPronoun.countRanges.propositions, { lower: 1, upper: 2 })
  assert.equal(resolvedPlusPronoun.linkageUncertainReceiptCount, 1)

  const twoPronouns = aggregate([
    { ...base, seq: 20, target: 'him', claimedNight: 1, quote: 'N1 he was clear' },
    { ...base, seq: 30, target: 'him', claimedNight: 1, quote: 'My N1 on him was clear' },
  ])
  assert.deepEqual(twoPronouns.countRanges.propositions, { lower: 1, upper: 2 })
  assert.equal(twoPronouns.upperBoundRows.length, 2, 'unresolved wording never proves upper-bound identity')
})

test('v3.2.6: an ambiguous action receipt may overlap a later resolved proposition', () => {
  const out = aggregate([
    { ...base, seq: 10, target: 'him', claimedNight: 1, verdict: 'ambiguous', quote: 'N1 he was clear' },
    { ...base, seq: 30, target: 'Dylan', claimedNight: 1, verdict: 'true', quote: 'My N1 Dylan clear still stands' },
  ])
  assert.deepEqual(out.countRanges.propositions, { lower: 1, upper: 2 })
  assert.deepEqual(out.countRanges.resolved, { lower: 1, upper: 1 })
  assert.deepEqual(out.countRanges.ambiguous, { lower: 1, upper: 1 })
  assert.match(out.rangeRelationshipNote, /not added/)
})

test('v3.2.6: all-status lower bounds combine per independent semantic base', () => {
  const out = aggregate([
    // Base A (not-mafia result): ambiguity is provably distinct in event
    // space, so its all-status minimum is 2 while resolved minimum is 1.
    { ...base, seq: 10, target: 'Dylan', claimedNight: 1, verdict: 'true' },
    { ...base, seq: 20, target: 'him', claimedNight: 2, verdict: 'ambiguous' },
    // Base B (mafia result): same target/night but different truth-at-
    // utterance, so resolved minimum is 2 while status-agnostic minimum is 1.
    { ...base, seq: 30, target: 'Sam', result: 'mafia', claimedNight: 3, verdict: 'true' },
    { ...base, seq: 40, target: 'Sam', result: 'mafia', claimedNight: 3, verdict: 'false', falseClass: 'fabricated_investigation' },
    // Base C is a different family; it must add to both global endpoints,
    // rather than disappearing inside a global max across families.
    { ...base, seq: 50, kind: 'not_mafia_claim', target: undefined, result: undefined, claimedNight: undefined, verdict: 'true' },
  ])
  assert.deepEqual(out.countRanges.propositions, { lower: 5, upper: 5 })
  assert.deepEqual(out.countRanges.byKind.investigation_claim.propositions, { lower: 4, upper: 4 })
  assert.deepEqual(out.countRanges.byKind.not_mafia_claim.propositions, { lower: 1, upper: 1 })
  for (const endpoint of ['lower', 'upper'] as const) {
    const sum = Object.values(out.countRanges.byKind).reduce(
      (n: number, family: any) => n + family.propositions[endpoint], 0,
    )
    assert.equal(out.countRanges.propositions[endpoint], sum)
  }
})

test('v3.2.6: different nights, targets, speakers, games, and results remain distinct', () => {
  const out = aggregate([
    { ...base, seq: 10, claimedNight: 1 },
    { ...base, seq: 20, claimedNight: 2 },
    { ...base, seq: 30, target: 'Sam', claimedNight: 1 },
    { ...base, seq: 40, seat: 'seat-4', claimedNight: 1 },
    { ...base, seq: 50, seed: 'g2', claimedNight: 1 },
    { ...base, seq: 60, claimedNight: 1, result: 'mafia', verdict: 'false' },
  ])
  assert.deepEqual(out.countRanges.propositions, { lower: 6, upper: 6 })
  const contradiction = out.upperBoundRows.filter((r: any) => r.seed === 'g1' && r.seat === 'seat-1' && r.target === 'seat-2' && r.eventRef === 'night:1')
  assert.equal(contradiction.length, 2)
  assert.ok(contradiction.every((r: any) => r.episodeContradiction))
})

test('v3.2.6: grouped investigation results count once per target, not once per sentence', () => {
  const out = aggregate([
    { ...base, seq: 10, target: 'Dylan', claimedNight: 1, charStart: 5, quote: 'Dylan clear' },
    { ...base, seq: 10, target: 'Sam', claimedNight: 1, charStart: 20, quote: 'Sam clear' },
    { ...base, seq: 30, target: 'Dylan', claimedNight: 1, quote: 'Dylan remains clear' },
    { ...base, seq: 30, target: 'Sam', claimedNight: 1, charStart: 22, quote: 'Sam remains clear' },
  ])
  assert.deepEqual(out.countRanges.propositions, { lower: 2, upper: 2 }, 'one underlying proposition per named target')
  assert.equal(out.receiptCount, 4, 'both later reassertions remain auditable')
  assert.deepEqual(out.upperBoundRows.map((row: any) => [row.target, row.mentionCount]).sort(), [
    ['seat-2', 2], ['seat-3', 2],
  ])
})

test('v3.2.6: proposition target is exactly the conjunction target the scorer evaluates', () => {
  const facts = {
    names: { 'seat-1': 'Josie', 'seat-2': 'Bryan' },
    nameToSeat: { josie: 'seat-1', bryan: 'seat-2' },
    messageTexts: new Map([[10, 'Confirmed town: me and Bryan (N2 clear).']]),
  }
  const out = aggregateClaimPropositions([
    { ...base, seq: 10, target: 'me', result: 'not mafia', claimedNight: 2, quote: 'Confirmed town: me and Bryan (N2 clear).' },
    { ...base, seq: 20, target: 'Bryan', result: 'not mafia', claimedNight: 2, quote: 'My N2 Bryan clear still stands.' },
  ], {
    resolveTarget: (claim: any) => resolveEffectiveClaimTarget(claim, facts),
  })
  assert.deepEqual(out.countRanges.propositions, { lower: 1, upper: 1 })
  assert.equal(out.upperBoundRows[0].target, 'seat-2')
  assert.equal(out.upperBoundRows[0].mentionCount, 2)
})

test('v3.2.6: a bare detective self-target is unresolved in the bounds, as it is in scoring', () => {
  const facts = {
    names: { 'seat-1': 'Josie', 'seat-2': 'Dylan' },
    nameToSeat: { josie: 'seat-1', dylan: 'seat-2' },
    messageTexts: new Map([
      [10, 'N1 I checked me: clear.'],
      [30, 'My N1 Dylan clear still stands.'],
    ]),
  }
  const out = aggregateClaimPropositions([
    { ...base, seq: 10, target: 'me', claimedNight: 1, verdict: 'ambiguous', quote: 'N1 I checked me: clear.' },
    { ...base, seq: 30, target: 'Dylan', claimedNight: 1, verdict: 'true', quote: 'My N1 Dylan clear still stands.' },
  ], {
    resolveTarget: (claim: any) => resolveEffectiveClaimTarget(claim, facts),
  })
  assert.deepEqual(out.countRanges.propositions, { lower: 1, upper: 2 })
  assert.deepEqual(out.countRanges.resolved, { lower: 1, upper: 1 })
  assert.deepEqual(out.countRanges.ambiguous, { lower: 1, upper: 1 })
  assert.equal(out.linkageUncertainReceiptCount, 1)
})

test('v3.2.6: role and self-alignment restatements collapse within a seat-game only', () => {
  const out = aggregate([
    { seed: 'g1', seat: 'seat-1', seq: 1, kind: 'role_claim', role: 'detective', verdict: 'true' },
    { seed: 'g1', seat: 'seat-1', seq: 2, kind: 'role_claim', role: 'detective', verdict: 'true' },
    { seed: 'g1', seat: 'seat-1', seq: 3, kind: 'role_claim', role: 'doctor', verdict: 'false' },
    { seed: 'g1', seat: 'seat-1', seq: 4, kind: 'not_mafia_claim', verdict: 'true' },
    { seed: 'g1', seat: 'seat-1', seq: 5, kind: 'not_mafia_claim', verdict: 'true' },
  ])
  assert.equal(out.receiptCount, 5)
  assert.deepEqual(out.countRanges.propositions, { lower: 3, upper: 3 })
  assert.equal(out.upperBoundRows.find((r: any) => r.kind === 'not_mafia_claim').mentionCount, 2)
})

test('v3.2.6: truth-at-utterance changes distinguish a premature claim from the later true report', () => {
  const out = aggregate([
    { ...base, seq: 10, claimedNight: 3, verdict: 'false', falseClass: 'fabricated_investigation' },
    { ...base, seq: 60, claimedNight: 3, verdict: 'true' },
  ])
  assert.deepEqual(out.countRanges.propositions, { lower: 2, upper: 2 })
  assert.deepEqual(out.countRanges.resolved, { lower: 2, upper: 2 })
  assert.deepEqual(out.countRanges.true, { lower: 1, upper: 1 })
  assert.deepEqual(out.countRanges.false, { lower: 1, upper: 1 })
  assert.equal(out.upperBoundRows.length, 2)
  assert.ok(out.upperBoundRows.every((row: any) => row.episodeContradiction === false), 'truth-at-utterance change is not conflicting content')
})

test('v3.2.6: one receipt identity cannot enter two proposition buckets', () => {
  assert.throws(() => aggregate([
    { ...base, seq: 10, claimedNight: 1, verdict: 'true' },
    { ...base, seq: 10, claimedNight: 1, verdict: 'false', falseClass: 'fabricated_investigation' },
  ]), /duplicate receipt identity/)
})

test('v3.2.6: fixed-role state receipts with mixed verdicts fail closed', () => {
  assert.throws(() => aggregate([
    { seed: 'g1', seat: 'seat-1', seq: 1, kind: 'role_claim', role: 'detective', verdict: 'true' },
    { seed: 'g1', seat: 'seat-1', seq: 2, kind: 'role_claim', role: 'detective', verdict: 'false' },
  ]), /mixed verdicts/)
})
