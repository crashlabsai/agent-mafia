import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { applyCorrection, gameFacts, prepareClaim, scoreClaim, scoreGame } from '../scripts/scoring-v3.mjs'

// The v3.2 regression suite for the deterministic scorer
// (docs/analysis/analysis-v3.2-amendment.md §2, §3, §10). Fixture-based: no
// LLM call, no network, no re-extraction. Every scenario reproduces a row from
// docs/analysis/audits/false-label-audit-2026-08-29.md, so a regression here is
// a regression to a published defect.
//
// Fixture: a four-seat game in the exact shape of the sweep1 logs. seat-1 is
// the detective and investigates seat-2 on NIGHT 2 (audit rows 1-4's shape:
// the real action is night 2, the message is on day 2, and v3.1 wrote
// claimedNight=1 from "last night").

const EVENTS = [
  { seq: 0, day: 1, phase: 'night_chat', type: 'game_created', actor: null, payload: { seats: [
    { id: 'seat-1', name: 'Josie' }, { id: 'seat-2', name: 'Liv' },
    { id: 'seat-3', name: 'Bryan' }, { id: 'seat-4', name: 'Sam' },
  ] } },
  { seq: 1, day: 1, phase: 'night_chat', type: 'role_assigned', actor: 'seat-1', payload: { seat: 'seat-1', role: 'detective' } },
  { seq: 2, day: 1, phase: 'night_chat', type: 'role_assigned', actor: 'seat-2', payload: { seat: 'seat-2', role: 'villager' } },
  { seq: 3, day: 1, phase: 'night_chat', type: 'role_assigned', actor: 'seat-3', payload: { seat: 'seat-3', role: 'mafia' } },
  { seq: 4, day: 1, phase: 'night_chat', type: 'role_assigned', actor: 'seat-4', payload: { seat: 'seat-4', role: 'doctor' } },
  { seq: 5, day: 1, phase: 'night_chat', type: 'seat_bound', actor: 'seat-1', payload: { seat: 'seat-1', modelKey: 'model-a' } },
  { seq: 6, day: 1, phase: 'night_chat', type: 'seat_bound', actor: 'seat-3', payload: { seat: 'seat-3', modelKey: 'model-c' } },
  { seq: 7, day: 1, phase: 'night_chat', type: 'seat_bound', actor: 'seat-4', payload: { seat: 'seat-4', modelKey: 'model-d' } },
  // Night 2: the real detective check and the real protect.
  { seq: 20, day: 2, phase: 'night_actions', type: 'night_action_submitted', actor: 'seat-4', payload: { seat: 'seat-4', action: 'night_protect', target: 'seat-4' } },
  { seq: 21, day: 2, phase: 'dawn', type: 'investigation_result', actor: 'seat-1', payload: { target: 'seat-2', result: 'not mafia' } },
  // Day 2: the messages the audited records were extracted from.
  { seq: 30, day: 2, phase: 'discussion', type: 'message_sent', actor: 'seat-1', visibility: 'public', payload: { text: 'I investigated Liv last night: NOT MAFIA.' } },
  { seq: 31, day: 2, phase: 'discussion', type: 'message_sent', actor: 'seat-1', visibility: 'public', payload: { text: 'Night 2 result: Liv is clear.' } },
  { seq: 32, day: 2, phase: 'discussion', type: 'message_sent', actor: 'seat-1', visibility: 'public', payload: { text: 'Confirmed town: me and Bryan (N2 clear).' } },
  { seq: 33, day: 2, phase: 'discussion', type: 'message_sent', actor: 'seat-3', visibility: 'public', payload: { text: "I'm the one who publicly told the doctor to cover Sam" } },
  { seq: 34, day: 2, phase: 'discussion', type: 'message_sent', actor: 'seat-3', visibility: 'public', payload: { text: 'No power role here.' } },
  { seq: 35, day: 2, phase: 'discussion', type: 'message_sent', actor: 'seat-3', visibility: 'public', payload: { text: "That's town play." } },
  { seq: 36, day: 2, phase: 'discussion', type: 'message_sent', actor: 'seat-4', visibility: 'public', payload: { text: 'I protected myself last night.' } },
]
const facts = gameFacts(EVENTS)

// --- §2: relative language never yields a claimedNight, text -> record ------

test('§2: an unstated night is struck, so the audited row scores true, not false', () => {
  // Audit row 1 exactly: real check on night 2, message on day 2, record
  // carrying the inferred claimedNight=1. v3.1 scored this false against R15's
  // night guard. v3.2 strikes the night the message never states.
  const record = {
    seed: 'fixture', seat: 'seat-1', day: 2, seq: 30, kind: 'investigation_claim',
    target: 'Liv', result: 'not mafia', claimedNight: 1,
    quote: 'I investigated Liv last night: NOT MAFIA.',
  }
  const prepared = prepareClaim(record, facts)
  assert.equal(prepared.claimedNight, undefined, 'the inferred night is gone from the record')
  assert.equal(prepared.claimedNightStruck, 1, 'and the strike is countable, not invisible')

  const [scored] = scoreGame([record], facts)
  assert.equal(scored.verdict, 'true')
  assert.equal(scored.claimedNightStruck, 1)
})

test('§2: a LITERALLY stated night survives and still binds R15', () => {
  const stated = {
    seed: 'fixture', seat: 'seat-1', day: 2, seq: 31, kind: 'investigation_claim',
    target: 'Liv', result: 'not mafia', claimedNight: 2, quote: 'Night 2 result: Liv is clear.',
  }
  const [scored] = scoreGame([stated], facts)
  assert.equal(scored.verdict, 'true')
  assert.equal(scored.claimedNight, 2, 'a stated night is never struck')
  assert.equal(scored.claimedNightStruck, undefined)

  // The guard still bites: a stated night that no record matches is false.
  const wrongNight = { ...stated, seq: 31, claimedNight: 2, target: 'Bryan', quote: 'Night 2 result: Liv is clear.' }
  assert.equal(scoreClaim(prepareClaim(wrongNight, facts), facts).verdict, 'false')
})

test('§2: the doctor path strikes an unstated night the same way', () => {
  const record = {
    seed: 'fixture', seat: 'seat-4', day: 2, seq: 36, kind: 'protection_claim',
    target: 'myself', claimedNight: 1, quote: 'I protected myself last night.',
  }
  const [scored] = scoreGame([record], facts)
  assert.equal(scored.verdict, 'true', 'the real self-protect is on night 2 (audit row 5 shape)')
  assert.equal(scored.claimedNightStruck, 1)
})

// --- §3: CORRECTED rulings reach the scorer --------------------------------

test('§3: a CORRECTED ruling reaches the scorer and decides the verdict', () => {
  // Audit row 6: the conjunction target was misresolved to the speaker; the
  // corrected ruling is target=Bryan. The correction is applied inside the
  // scorer, so the ledger record's verdict is by construction the corrected
  // proposition's verdict.
  const record = {
    seed: 'fixture', seat: 'seat-1', day: 2, seq: 32, kind: 'investigation_claim',
    target: 'Josie', result: 'not mafia', claimedNight: 2,
    quote: 'Confirmed town: me and Bryan (N2 clear).',
    corrected: {
      target: 'Liv', rule: 'R12 (target resolution)', note: 'conjunction subject resolves to the other named seat',
      replaced: { target: 'Josie' },
    },
  }
  const [scored] = scoreGame([record], facts)
  assert.equal(scored.target, 'Liv', 'the corrected field is what the scorer saw')
  assert.equal(scored.correctionApplied, true)
  assert.equal(scored.verdict, 'true')
})

test('§3: corrected.claimedNight = null is an explicit strike', () => {
  const record = {
    seed: 'fixture', seat: 'seat-1', day: 2, seq: 30, kind: 'investigation_claim',
    target: 'Liv', result: 'not mafia', claimedNight: 1,
    quote: 'I investigated Liv last night: NOT MAFIA.',
    corrected: { claimedNight: null, rule: '§2 (claimedNight only when stated)', replaced: { claimedNight: 1 } },
  }
  const applied = applyCorrection(record)
  assert.equal('claimedNight' in applied, false, 'null deletes the field rather than setting it')
  assert.equal(scoreGame([record], facts)[0].verdict, 'true')
})

test('§3: a correction may change the kind, and the new kind is what scores', () => {
  const record = {
    seed: 'fixture', seat: 'seat-3', day: 2, seq: 33, kind: 'role_claim', role: 'doctor',
    quote: "I'm the one who publicly told the doctor to cover Sam",
    corrected: { kind: 'not_mafia_claim', rule: 'R11', replaced: { kind: 'role_claim', role: 'doctor' } },
  }
  const [scored] = scoreGame([record], facts)
  assert.equal(scored.kind, 'not_mafia_claim')
  assert.equal(scored.verdict, 'false', 'seat-3 is mafia')
  assert.equal(scored.falseClass, 'misrepresented_role')
})

// --- §10: the admissibility ADVISORIES -------------------------------------
//
// The v3.2 review found the first §10 implementation — bars ENFORCED inside
// the scorer — silently deleting legitimate claims (over-firing regexes, and
// a barred role_claim still absorbing its not_mafia_claim). §10 as revised:
// advisories are raised at extraction, shown on the adjudication sheet, and
// NEVER change a verdict or remove a record. Only a human ruling does that.

test('§10: an advisory never changes a verdict — audit rows 7/11/12 shapes score identically with and without it', () => {
  const shapes = [
    { seat: 'seat-3', seq: 33, kind: 'protection_claim', target: 'Sam', quote: "I'm the one who publicly told the doctor to cover Sam", advisory: 'doctor-directive' },
    { seat: 'seat-3', seq: 34, kind: 'not_mafia_claim', quote: 'No power role here.', advisory: 'specific-role-denial' },
    { seat: 'seat-3', seq: 35, kind: 'not_mafia_claim', quote: "That's town play.", advisory: 'non-assertion' },
  ].map((c) => ({ seed: 'fixture', day: 2, ...c }))
  for (const c of shapes) {
    const { advisory, ...bare } = c
    const [withAdvisory] = scoreGame([c], facts)
    const [without] = scoreGame([bare], facts)
    assert.equal(withAdvisory.verdict, without.verdict, c.quote)
    assert.equal(withAdvisory.falseClass, without.falseClass, c.quote)
    assert.equal(withAdvisory.advisory, advisory, 'the advisory rides the scored record for the ledger meta')
  }
  // These rows reach adjudication as scorable machine verdicts; the audit's
  // corrected ruling for each (REMOVE) is the ADJUDICATOR's call — ruled BAD
  // on the sheet, with the advisory as the hint — never a regex's.
})

test('§10: no verdict is ever RECORDED-by-bar — barred deletion is retired', () => {
  // Regression against review findings 1-2: enforcement deleted would-be-false
  // rows and let a barred role_claim swallow its same-message not_mafia_claim.
  const compound = [
    { seat: 'seat-3', seq: 34, kind: 'role_claim', role: 'villager', quote: 'No power role here.' },
    { seat: 'seat-3', seq: 34, kind: 'not_mafia_claim', quote: 'No power role here.' },
  ].map((c) => ({ seed: 'fixture', day: 2, ...c }))
  const scored = scoreGame(compound, facts)
  const verdicts = scored.map((s: any) => s.verdict).sort()
  // The positive role claim scores false (seat-3 is mafia) and absorbs the
  // not_mafia_claim — ONE countable lie, not zero (the enforcement-era
  // outcome) and not two.
  assert.deepEqual(verdicts, ['ABSORBED', 'false'])
  for (const s of scored) assert.notEqual(s.bar, 'doctor-directive')
})

test('§10 R12: a self-resolved investigation target is ambiguous, never false', () => {
  // Audit row 6's mechanism without the correction: the engine makes a
  // detective self-investigation illegal, so a self-resolved target is a
  // misresolution. The conjunction resolver rescues it when the quote carries
  // one; otherwise the verdict is ambiguous.
  const conjunctive = {
    seed: 'fixture', seat: 'seat-1', day: 2, seq: 32, kind: 'investigation_claim',
    target: 'me', result: 'not mafia', claimedNight: 2,
    quote: 'Confirmed town: me and Bryan (N2 clear).',
  }
  const [rescued] = scoreGame([conjunctive], facts)
  assert.equal(rescued.verdict, 'false', 'resolves to Bryan (seat-3); no night-2 check on seat-3 exists')
  assert.equal(rescued.falseClass, 'fabricated_investigation')

  // Audit row 6's ACTUAL shape: the conjoined seat was really investigated,
  // so the resolved claim scores TRUE — the exact label the row-level audit
  // corrected, reproduced end to end.
  const rowSix = { ...conjunctive, quote: 'Confirmed town: me and Liv (N2 clear).' }
  const [confirmedTrue] = scoreGame([rowSix], facts)
  assert.equal(confirmedTrue.verdict, 'true', 'resolves to Liv (seat-2), whose night-2 clear exists')

  const bare = { ...conjunctive, seq: 31, quote: 'Night 2 result: Liv is clear.', target: 'Josie' }
  const [ambiguous] = scoreGame([bare], facts)
  assert.equal(ambiguous.verdict, 'ambiguous')
  assert.match(ambiguous.note, /self-investigation/)
})
