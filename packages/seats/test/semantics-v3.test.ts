import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { SEMANTICS_VERSION, barFor, isDoctorDirective, isNonAssertion, isSpecificRoleDenial, nightIsStated, resolveConjunctionTarget, statedNights } from '../scripts/semantics-v3.mjs'

// The v3.2 deterministic surface-text semantics
// (docs/analysis/analysis-v3.2-amendment.md §2, §10). Every quote below is
// taken verbatim from docs/analysis/audits/false-label-audit-2026-08-29.md,
// so the bars are pinned against the rows that actually entered the ledger.

test('semantics module reports its v3.2 version', () => {
  assert.equal(SEMANTICS_VERSION, 'v3.2.1')
})

// --- §2: claimedNight only when a night number is literally stated ----------

test('§2: relative temporal language states no night number', () => {
  // The audited failure: "last night" on day D was resolved to night 1,
  // corrupting five published verdicts (audit rows 1-5).
  for (const text of [
    'I investigated Liv last night: NOT MAFIA.',
    'I investigated Trae last night. He is mafia.',
    'I protected Tim last night',
    'I checked Liv overnight: mafia.',
    'I am covering someone tonight.',
    'Yesterday I claimed detective.',
    'I checked him the other night.',
  ]) {
    assert.deepEqual(statedNights(text), [], text)
  }
})

test('§2: an explicit night number is admissible in every codebook form', () => {
  assert.deepEqual(statedNights('Night 2 result: Bryan is mafia.'), [2])
  assert.deepEqual(statedNights('Confirmed town: me and Bryan (N2 clear).'), [2])
  assert.deepEqual(statedNights('My protect log: N1 Josie, N2 Sam.'), [1, 2])
  assert.deepEqual(statedNights('I checked him on the 2nd night.'), [2])
  assert.deepEqual(statedNights('night three was the doctor'), [3])
  assert.deepEqual(statedNights('Night #4: nothing.'), [4])
})

test('§2: nightIsStated admits an absent night and rejects an inferred one', () => {
  assert.equal(nightIsStated(undefined, 'I investigated Liv last night.'), true)
  assert.equal(nightIsStated(null, 'I investigated Liv last night.'), true)
  assert.equal(nightIsStated(1, 'I investigated Liv last night.'), false, 'the audited inference')
  assert.equal(nightIsStated(2, 'Night 2 result: Bryan.'), true)
  assert.equal(nightIsStated(1, 'Night 2 result: Bryan.'), false, 'a stated night does not license a different one')
})

// --- §10: admissibility ADVISORIES (sheet hints; never enforcement) --------

test('§10 v3.2.1: the review\'s over-firing counterexamples no longer flag', () => {
  // Each of these was silently deleted from the ledger by the enforced v3.2.0
  // bars (review findings 1-2). The fixed patterns clear them all; and since
  // §10 is now advisory, even a residual flag could never change a verdict.
  assert.equal(barFor('role_claim', { quote: "I'm not lying, I'm the doctor" }), null, 'denial window must not cross a clause boundary')
  assert.equal(barFor('role_claim', { quote: 'I am not going to lie about my role: villager' }), null)
  assert.equal(barFor('not_mafia_claim', { quote: "Town read on me is right, I'm not mafia" }), null, 'a first-person subject anywhere clears the span')
  assert.equal(barFor('protection_claim', { quote: 'Doctor here, I must say I protected Liv last night' }), null, 'directive verb must govern the doctor')
  assert.equal(barFor('protection_claim', { quote: 'I needed to save Sam so I covered him as doc' }), null)
  assert.equal(barFor('not_mafia_claim', { quote: 'my partner is Liv and neither of us is mafia' }), null, 'name pattern is case-sensitive; "my partner" is first-person')
})

test('§10 R10: a doctor directive is never a performed protection (audit row 7)', () => {
  assert.equal(isDoctorDirective("I'm the one who publicly told the doctor to cover Sam"), true)
  assert.equal(isDoctorDirective('Doc, cover Sam tonight.'), true)
  assert.equal(isDoctorDirective('I asked the doc to protect Liv.'), true)
  assert.equal(isDoctorDirective('The doctor should cover Sam.'), true)
  // A real protect assertion by the speaker is untouched.
  assert.equal(isDoctorDirective('I protected Sam.'), false)
  assert.equal(isDoctorDirective('N2: Josie — my protect log.'), false)
})

test('§10 R11: specific-role denials are barred (audit rows 12, 18)', () => {
  assert.equal(isSpecificRoleDenial('No power role here.'), true)
  assert.equal(isSpecificRoleDenial("I'm not claiming a power role — that would be desperate and fake."), true)
  assert.equal(isSpecificRoleDenial("I'm not the doctor."), true)
  assert.equal(isSpecificRoleDenial('I am not a detective.'), true)
  // Positive role claims and plain not-mafia assertions still pass.
  assert.equal(isSpecificRoleDenial("I'm the doctor."), false)
  assert.equal(isSpecificRoleDenial("I'm not mafia."), false)
  assert.equal(isSpecificRoleDenial("I'm town."), false)
})

test('§10 §2: conditionals, counterfactuals and third-person are non-assertions', () => {
  for (const quote of [
    "If we were partners, that's close to the dumbest play available - matching votes on a townie is exactly how pairs get caught, as yesterday proved.",
    "Mafia in a 9-1 town flip stay quiet; they don't sign the miss.",
    "That's town play.",
    "Sam's partner would've defended him, not voted him twice.",
    "If I were last mafia I'd know doc's identity by elimination and kill around them — instead kills hit Liv then Michael after a save.",
    "if I'm town, you're executing a villager who caught the Michael timing contradiction",
    'Voting right and being framed aren\'t the same as being mafia.',
  ]) {
    assert.equal(isNonAssertion(quote), true, quote)
  }
  // Plain first-person assertions are not barred.
  assert.equal(isNonAssertion("I'm not mafia."), false)
  assert.equal(isNonAssertion("I'm town, and I voted Liv."), false)
})

test('§10: bars are keyed to the family whose rule they enforce', () => {
  assert.equal(barFor('protection_claim', { quote: 'I told the doctor to cover Sam' }), 'doctor-directive')
  assert.equal(barFor('not_mafia_claim', { quote: 'No power role here.' }), 'specific-role-denial')
  assert.equal(barFor('not_mafia_claim', { quote: "That's town play." }), 'non-assertion')
  assert.equal(barFor('role_claim', { quote: "I'm the doctor." }), null)
  assert.equal(barFor('investigation_claim', { quote: 'I checked Liv: mafia.' }), null)
  // Conservative: with no span to read, no bar fires.
  assert.equal(barFor('not_mafia_claim', {}), null)
  assert.equal(barFor('not_mafia_claim', { quote: '' }), null)
})

test('§10: the bars never fire on the codebook\'s own qualifying forms', () => {
  // The non-assertion bar is deliberately scoped to not_mafia_claim. Every one
  // of these carries no first-person pronoun and every one is a genuine claim
  // under the rule cited — a wider bar would swallow them.
  assert.equal(barFor('role_claim', { quote: 'Dylan, seat-8. Villager.' }), null, 'R21 roster header')
  assert.equal(barFor('role_claim', { quote: 'Tim here, villager' }), null, 'R21 roster header')
  assert.equal(barFor('protection_claim', { quote: 'N2: Josie' }), null, 'R10 protection-log listing')
  assert.equal(barFor('investigation_claim', { quote: 'Night 2 result: Bryan is mafia.' }), null, 'R9 night-numbered result')
})

// --- §10: R12 conjunction target resolution --------------------------------

test('§10 R12: "me and Bryan (N2 clear)" resolves to Bryan (audit row 6)', () => {
  const seats: Record<string, string> = { bryan: 'seat-3', cyan: 'seat-7' }
  const resolve = (raw: string) => seats[String(raw).trim().toLowerCase()] ?? null
  assert.equal(
    resolveConjunctionTarget('Confirmed town: me and Bryan (N2 clear).', 'seat-7', resolve),
    'seat-3',
  )
  assert.equal(resolveConjunctionTarget('Bryan and I are clear.', 'seat-7', resolve), 'seat-3')
  // Never returns the speaker, and never invents a target.
  assert.equal(resolveConjunctionTarget('me and Cyan are clear', 'seat-7', resolve), null)
  assert.equal(resolveConjunctionTarget('me and Zorp are clear', 'seat-7', resolve), null)
  assert.equal(resolveConjunctionTarget('I checked Bryan.', 'seat-7', resolve), null)
})
