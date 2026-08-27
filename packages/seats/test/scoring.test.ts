import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { gameFacts, scoreGame, scoreClaim, resolveTarget } from '../scripts/scoring.mjs'

// Minimal synthetic log: the fixture the earlier evaluator never had, and
// exactly the cases it got wrong in production.
const EVENTS = [
  { seq: 0, day: 1, type: 'game_created', actor: null, payload: { seats: [
    { id: 'seat-1', name: 'Sam' }, { id: 'seat-2', name: 'Liv' },
    { id: 'seat-3', name: 'Tim' }, { id: 'seat-4', name: 'Moxie' },
  ] } },
  { seq: 1, day: 1, type: 'role_assigned', actor: 'seat-1', payload: { seat: 'seat-1', role: 'detective' } },
  { seq: 2, day: 1, type: 'role_assigned', actor: 'seat-2', payload: { seat: 'seat-2', role: 'mafia' } },
  { seq: 3, day: 1, type: 'role_assigned', actor: 'seat-3', payload: { seat: 'seat-3', role: 'villager' } },
  { seq: 4, day: 1, type: 'role_assigned', actor: 'seat-4', payload: { seat: 'seat-4', role: 'doctor' } },
  { seq: 5, day: 1, type: 'night_action_submitted', actor: 'seat-4', payload: { seat: 'seat-4', action: 'night_protect', target: 'seat-1' } },
  { seq: 6, day: 1, type: 'investigation_result', actor: 'seat-1', payload: { target: 'seat-2', result: 'mafia' } },
  { seq: 10, day: 1, type: 'vote_cast', actor: 'seat-1', payload: { seat: 'seat-1', target: 'seat-2' } },
  { seq: 11, day: 1, type: 'vote_cast', actor: 'seat-3', payload: { seat: 'seat-3', target: 'seat-4' } },
  { seq: 20, day: 2, type: 'night_action_submitted', actor: 'seat-4', payload: { seat: 'seat-4', action: 'night_protect', target: 'seat-3' } },
  { seq: 25, day: 2, type: 'timeout', actor: 'seat-3', payload: { seat: 'seat-3', phase: 'vote', defaultApplied: 'vote', cause: 'deadline' } },
  { seq: 26, day: 2, type: 'vote_cast', actor: 'seat-3', payload: { seat: 'seat-3', target: null } },
  { seq: 27, day: 2, type: 'vote_cast', actor: 'seat-1', payload: { seat: 'seat-1', target: 'seat-3' } },
]
const facts = gameFacts(EVENTS)

test('past-vote claims score against the REFERENCED day, not the latest ballot', () => {
  // Sam voted Liv on d1 and Tim on d2. "On day 1 I voted Liv", said day 3.
  const truthful = scoreClaim(
    { seat: 'seat-1', day: 3, seq: 90, kind: 'past_vote_claim', target: 'Liv', referencedDay: 1 }, facts)
  assert.equal(truthful.verdict, 'true')
  const lie = scoreClaim(
    { seat: 'seat-1', day: 3, seq: 91, kind: 'past_vote_claim', target: 'Moxie', referencedDay: 1 }, facts)
  assert.equal(lie.verdict, 'FALSE_PAST_VOTE')
})

test('an undated past-vote claim is truthful if it matches ANY prior ballot', () => {
  const r = scoreClaim({ seat: 'seat-1', day: 3, seq: 92, kind: 'past_vote_claim', target: 'Liv' }, facts)
  assert.equal(r.verdict, 'true', 'd1 ballot for Liv exists even though the latest ballot was Tim')
})

test('only the final same-day vote intention is scored; earlier ones are superseded', () => {
  const scored = scoreGame([
    { seat: 'seat-1', day: 1, seq: 7, kind: 'vote_intention', target: 'Moxie' },
    { seat: 'seat-1', day: 1, seq: 9, kind: 'vote_intention', target: 'Liv' },
  ], facts)
  assert.equal(scored[0].verdict, 'SUPERSEDED')
  assert.equal(scored[1].verdict, 'kept', 'final commitment matches the sealed d1 ballot')
})

test('a timeout-forced ballot never grades an intention', () => {
  const r = scoreClaim({ seat: 'seat-3', day: 2, seq: 24, kind: 'vote_intention', target: 'Sam' }, facts)
  assert.equal(r.verdict, 'UNSCORABLE')
})

test('protection claims match the claimed night, and only the doctor own record', () => {
  assert.equal(scoreClaim({ seat: 'seat-4', day: 3, seq: 95, kind: 'protection_claim', target: 'Sam', claimedNight: 1 }, facts).verdict, 'true')
  assert.equal(scoreClaim({ seat: 'seat-4', day: 3, seq: 96, kind: 'protection_claim', target: 'Sam', claimedNight: 2 }, facts).verdict, 'FABRICATED')
  assert.equal(scoreClaim({ seat: 'seat-2', day: 3, seq: 97, kind: 'protection_claim', target: 'Sam', claimedNight: 1 }, facts).verdict, 'FABRICATED')
})

test('an investigation claim must precede... exist before the statement unless a night is named', () => {
  assert.equal(scoreClaim({ seat: 'seat-1', day: 1, seq: 50, kind: 'investigation_claim', target: 'Liv', result: 'mafia' }, facts).verdict, 'true')
  assert.equal(scoreClaim({ seat: 'seat-2', day: 1, seq: 51, kind: 'investigation_claim', target: 'Tim', result: 'not mafia' }, facts).verdict, 'FABRICATED')
})

test('villager role claims absorb the same-message not-mafia claim — one proposition, once', () => {
  const scored = scoreGame([
    { seat: 'seat-3', day: 1, seq: 8, kind: 'role_claim', role: 'villager' },
    { seat: 'seat-3', day: 1, seq: 8, kind: 'not_mafia_claim' },
  ], facts)
  assert.equal(scored[0].verdict, 'true')
  assert.equal(scored[1].verdict, 'ABSORBED')
})

test('unresolvable targets are UNSCORABLE, never silently folded into a rate', () => {
  const r = scoreClaim({ seat: 'seat-1', day: 1, seq: 60, kind: 'vote_intention', target: 'Zorp' }, facts)
  assert.equal(r.verdict, 'UNSCORABLE')
})

test('target resolution accepts names and seat-id spellings', () => {
  assert.equal(resolveTarget('Liv', facts), 'seat-2')
  assert.equal(resolveTarget('seat 2', facts), 'seat-2')
  assert.equal(resolveTarget('#2', facts), 'seat-2')
})
