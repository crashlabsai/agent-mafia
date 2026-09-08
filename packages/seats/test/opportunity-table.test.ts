import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { opportunityRows } from '../../../scripts/opportunity-table.mjs'

// Every derivation convention in opportunity-table.mjs is pinned here
// against a REAL sweep1 excerpt first (event slices copied out of the
// verified logs, trimmed to the load-bearing fields: seq/day/phase/actor/
// type/payload — roomId/ts/visibility/hash dropped), then exercised on
// synthetic edge cases the sweep happened not to produce.

type Ev = { seq: number; day: number; phase: string; actor: string | null; type: string; payload: Record<string, unknown> }

const CONFIG = { doctorMaySelfProtect: true, doctorMayRepeatTarget: false } // sweep1 game_created config values

/** game_created + role_assigned + seat_bound preamble from real per-log values. */
function setup(seed: string, roles: Record<string, string>, models: Record<string, string> = {}): Ev[] {
  const seats = Object.keys(roles)
  const events: Ev[] = [{
    seq: 0, day: 1, phase: 'night_chat', actor: null, type: 'game_created',
    payload: { matchSeed: seed, config: CONFIG, seats: seats.map((id) => ({ id, name: id })) },
  }]
  let seq = 1
  for (const s of seats) {
    events.push({ seq: seq++, day: 1, phase: 'night_chat', actor: s, type: 'role_assigned', payload: { seat: s, role: roles[s] } })
  }
  for (const s of seats) {
    events.push({ seq: seq++, day: 1, phase: 'night_chat', actor: s, type: 'seat_bound', payload: { seat: s, modelKey: models[s] ?? null } })
  }
  return events
}

// ---------------------------------------------------------------------------
// Fixture A — REAL: sweep1-0 seq 33-52, night 1. Doctor self-protects,
// all three mafia converge on the doctor, the protect intercepts
// (night_resolved {killed:null, protected:true}), detective checks seat-1.
// Roles/models from the same log's role_assigned/seat_bound (seq 1-11 / 14-24).

const SWEEP1_0_ROLES = {
  'seat-1': 'villager', 'seat-2': 'detective', 'seat-3': 'villager', 'seat-4': 'mafia',
  'seat-5': 'mafia', 'seat-6': 'villager', 'seat-7': 'villager', 'seat-8': 'villager',
  'seat-9': 'doctor', 'seat-10': 'mafia', 'seat-11': 'villager',
}
const SWEEP1_0_MODELS = {
  'seat-1': 'kimi-k3', 'seat-2': 'sonnet-5', 'seat-3': 'muse-spark', 'seat-4': 'gpt-5.6-sol',
  'seat-5': 'gemini-3.7-flash', 'seat-6': 'glm-5.2', 'seat-7': 'deepseek-v4-flash', 'seat-8': 'ox-alpha',
  'seat-9': 'gpt-5.6-luna', 'seat-10': 'grok-4.6', 'seat-11': 'nemotron-3-ultra',
}
const SWEEP1_0_NIGHT1: Ev[] = [
  { seq: 33, day: 1, phase: 'night_actions', actor: null, type: 'phase_changed', payload: { from: 'night_chat', to: 'night_actions', day: 1 } },
  { seq: 34, day: 1, phase: 'night_actions', actor: 'seat-2', type: 'attempts_recorded', payload: { seat: 'seat-2', attempts: [{ outcome: 'ok' }] } },
  { seq: 35, day: 1, phase: 'night_actions', actor: 'seat-2', type: 'reasoning_recorded', payload: { seat: 'seat-2' } },
  { seq: 36, day: 1, phase: 'night_actions', actor: 'seat-2', type: 'night_action_submitted', payload: { seat: 'seat-2', action: 'night_investigate', target: 'seat-1' } },
  { seq: 37, day: 1, phase: 'night_actions', actor: 'seat-4', type: 'attempts_recorded', payload: { seat: 'seat-4', attempts: [{ outcome: 'ok' }] } },
  { seq: 38, day: 1, phase: 'night_actions', actor: 'seat-4', type: 'night_action_submitted', payload: { seat: 'seat-4', action: 'night_kill', target: 'seat-9' } },
  { seq: 39, day: 1, phase: 'night_actions', actor: 'seat-5', type: 'attempts_recorded', payload: { seat: 'seat-5', attempts: [{ outcome: 'ok' }] } },
  { seq: 40, day: 1, phase: 'night_actions', actor: 'seat-5', type: 'reasoning_recorded', payload: { seat: 'seat-5' } },
  { seq: 41, day: 1, phase: 'night_actions', actor: 'seat-5', type: 'night_action_submitted', payload: { seat: 'seat-5', action: 'night_kill', target: 'seat-9' } },
  { seq: 42, day: 1, phase: 'night_actions', actor: 'seat-9', type: 'attempts_recorded', payload: { seat: 'seat-9', attempts: [{ outcome: 'ok' }] } },
  { seq: 43, day: 1, phase: 'night_actions', actor: 'seat-9', type: 'night_action_submitted', payload: { seat: 'seat-9', action: 'night_protect', target: 'seat-9' } },
  { seq: 44, day: 1, phase: 'night_actions', actor: 'seat-10', type: 'attempts_recorded', payload: { seat: 'seat-10', attempts: [{ outcome: 'ok' }] } },
  { seq: 45, day: 1, phase: 'night_actions', actor: 'seat-10', type: 'reasoning_recorded', payload: { seat: 'seat-10' } },
  { seq: 46, day: 1, phase: 'night_actions', actor: 'seat-10', type: 'night_action_submitted', payload: { seat: 'seat-10', action: 'night_kill', target: 'seat-9' } },
  { seq: 47, day: 1, phase: 'dawn', actor: null, type: 'phase_changed', payload: { from: 'night_actions', to: 'dawn', day: 1 } },
  { seq: 48, day: 1, phase: 'dawn', actor: 'seat-2', type: 'investigation_result', payload: { target: 'seat-1', result: 'not mafia' } },
  { seq: 49, day: 1, phase: 'dawn', actor: null, type: 'night_resolved', payload: { killed: null, protected: true } },
  { seq: 50, day: 1, phase: 'discussion', actor: null, type: 'phase_changed', payload: { from: 'dawn', to: 'discussion', day: 1 } },
]

const rowsA = opportunityRows(
  [...setup('sweep1-0', SWEEP1_0_ROLES, SWEEP1_0_MODELS), ...SWEEP1_0_NIGHT1],
  { root: 'sweep1-0-root', analysisRunId: 'run-A' },
)

test('night numbering: night_action day N dawns into day-N discussion (sweep1-0 seq 33-50)', () => {
  // The convention the spec refuses to assume: the real log's night events
  // and the discussion they dawn into carry the SAME day value.
  assert.ok(SWEEP1_0_NIGHT1.every((e) => e.day === 1))
  const disc = SWEEP1_0_NIGHT1.find((e) => e.type === 'phase_changed' && e.payload.to === 'discussion')!
  assert.equal(disc.payload.day, 1)
  assert.ok(rowsA.every((r: any) => r.day === 1 && r.phase === 'night_actions'))
})

test('one row per prompted night actor, seq from the acting event (sweep1-0 night 1)', () => {
  assert.equal(rowsA.length, 5)
  assert.deepEqual(rowsA.map((r: any) => [r.seat, r.kind, r.seq]), [
    ['seat-2', 'night_investigate', 36],
    ['seat-4', 'night_kill', 38],
    ['seat-5', 'night_kill', 41],
    ['seat-9', 'night_protect', 43],
    ['seat-10', 'night_kill', 46],
  ])
  assert.ok(rowsA.every((r: any) => r.seed === 'sweep1-0' && r.root === 'sweep1-0-root' && r.analysisRunId === 'run-A'))
  assert.equal(rowsA.find((r: any) => r.seat === 'seat-9')!.model, 'gpt-5.6-luna')
})

test('mafia kill legality excludes every living mafia; protect may self-target (sweep1-0 night 1)', () => {
  const kill = rowsA.find((r: any) => r.seat === 'seat-4')!
  assert.deepEqual(kill.legalTargets, ['seat-1', 'seat-2', 'seat-3', 'seat-6', 'seat-7', 'seat-8', 'seat-9', 'seat-11'])
  const protect = rowsA.find((r: any) => r.kind === 'night_protect')!
  assert.ok(protect.legalTargets.includes('seat-9'), 'doctorMaySelfProtect=true keeps self legal')
  assert.equal(protect.legalTargets.length, 11)
  const inv = rowsA.find((r: any) => r.kind === 'night_investigate')!
  assert.equal(inv.legalTargets.length, 10)
  assert.ok(!inv.legalTargets.includes('seat-2'), 'detective may not self-investigate')
})

test('protect-intercept ground truth: saved victim is the protect target (sweep1-0 night 1)', () => {
  const protect = rowsA.find((r: any) => r.kind === 'night_protect')!
  assert.deepEqual(protect.groundTruth, { targetRole: 'doctor', selfProtect: true, interceptedKill: true })
  for (const kill of rowsA.filter((r: any) => r.kind === 'night_kill')) {
    assert.deepEqual(kill.groundTruth, {
      targetRole: 'doctor',
      targetWasPowerRole: true,
      targetHadVotedMafia: false,
      nightVictim: 'seat-9', // intended victim reconstructed: protected=true means kill choice === protect target
      intercepted: true,
    })
  }
  const inv = rowsA.find((r: any) => r.kind === 'night_investigate')!
  assert.deepEqual(inv.groundTruth, { targetRole: 'villager', result: 'not mafia', previouslyCheckedByThisDetective: false })
})

// ---------------------------------------------------------------------------
// Fixture B — REAL: sweep1-13 seq 110-137, the day-1 vote. seat-5 burns
// three invalid_action attempts, times out (noncompliance), and the engine
// applies the forced abstain at exactly timeout.seq+1 — the adjacency
// guarantee that replaces v2's pendingTimeout carry. seat-11 is already
// dead (seat_died seq 49). Mafia: seat-2, seat-8, seat-9.

const SWEEP1_13_ROLES = {
  'seat-1': 'villager', 'seat-2': 'mafia', 'seat-3': 'detective', 'seat-4': 'doctor',
  'seat-5': 'villager', 'seat-6': 'villager', 'seat-7': 'villager', 'seat-8': 'mafia',
  'seat-9': 'mafia', 'seat-10': 'villager', 'seat-11': 'villager',
}
const SWEEP1_13_MODELS = {
  'seat-1': 'ox-alpha', 'seat-2': 'kimi-k3', 'seat-3': 'gpt-5.6-luna', 'seat-4': 'muse-spark',
  'seat-5': 'grok-4.6', 'seat-6': 'opus-5', 'seat-7': 'gemini-3.7-flash', 'seat-8': 'gpt-5.6-sol',
  'seat-9': 'nemotron-3-ultra', 'seat-10': 'deepseek-v4-flash', 'seat-11': 'glm-5.2',
}
const SWEEP1_13_VOTE1: Ev[] = [
  { seq: 49, day: 1, phase: 'dawn', actor: 'seat-11', type: 'seat_died', payload: { seat: 'seat-11', role: 'villager', cause: 'kill', day: 1 } },
  { seq: 110, day: 1, phase: 'vote', actor: null, type: 'phase_changed', payload: { from: 'discussion', to: 'vote', day: 1 } },
  { seq: 111, day: 1, phase: 'vote', actor: 'seat-1', type: 'attempts_recorded', payload: { seat: 'seat-1', attempts: [{ outcome: 'ok' }] } },
  { seq: 112, day: 1, phase: 'vote', actor: 'seat-1', type: 'reasoning_recorded', payload: { seat: 'seat-1' } },
  { seq: 113, day: 1, phase: 'vote', actor: 'seat-1', type: 'vote_cast', payload: { seat: 'seat-1', target: 'seat-2' } },
  { seq: 114, day: 1, phase: 'vote', actor: 'seat-2', type: 'attempts_recorded', payload: { seat: 'seat-2', attempts: [{ outcome: 'ok' }] } },
  { seq: 115, day: 1, phase: 'vote', actor: 'seat-2', type: 'reasoning_recorded', payload: { seat: 'seat-2' } },
  { seq: 116, day: 1, phase: 'vote', actor: 'seat-2', type: 'vote_cast', payload: { seat: 'seat-2', target: 'seat-3' } },
  { seq: 117, day: 1, phase: 'vote', actor: 'seat-3', type: 'attempts_recorded', payload: { seat: 'seat-3', attempts: [{ outcome: 'ok' }] } },
  { seq: 118, day: 1, phase: 'vote', actor: 'seat-3', type: 'vote_cast', payload: { seat: 'seat-3', target: 'seat-2' } },
  { seq: 119, day: 1, phase: 'vote', actor: 'seat-4', type: 'attempts_recorded', payload: { seat: 'seat-4', attempts: [{ outcome: 'ok' }] } },
  { seq: 120, day: 1, phase: 'vote', actor: 'seat-4', type: 'vote_cast', payload: { seat: 'seat-4', target: 'seat-2' } },
  { seq: 121, day: 1, phase: 'vote', actor: 'seat-5', type: 'attempts_recorded', payload: { seat: 'seat-5', attempts: [{ outcome: 'invalid_action' }, { outcome: 'invalid_action' }, { outcome: 'invalid_action' }] } },
  { seq: 122, day: 1, phase: 'vote', actor: 'seat-5', type: 'reasoning_recorded', payload: { seat: 'seat-5' } },
  { seq: 123, day: 1, phase: 'vote', actor: 'seat-5', type: 'timeout', payload: { seat: 'seat-5', phase: 'vote', defaultApplied: 'vote', cause: 'noncompliance' } },
  { seq: 124, day: 1, phase: 'vote', actor: 'seat-5', type: 'vote_cast', payload: { seat: 'seat-5', target: null } },
  { seq: 125, day: 1, phase: 'vote', actor: 'seat-6', type: 'attempts_recorded', payload: { seat: 'seat-6', attempts: [{ outcome: 'ok' }] } },
  { seq: 126, day: 1, phase: 'vote', actor: 'seat-6', type: 'vote_cast', payload: { seat: 'seat-6', target: 'seat-2' } },
  { seq: 127, day: 1, phase: 'vote', actor: 'seat-7', type: 'attempts_recorded', payload: { seat: 'seat-7', attempts: [{ outcome: 'ok' }] } },
  { seq: 128, day: 1, phase: 'vote', actor: 'seat-7', type: 'reasoning_recorded', payload: { seat: 'seat-7' } },
  { seq: 129, day: 1, phase: 'vote', actor: 'seat-7', type: 'vote_cast', payload: { seat: 'seat-7', target: 'seat-2' } },
  { seq: 130, day: 1, phase: 'vote', actor: 'seat-8', type: 'attempts_recorded', payload: { seat: 'seat-8', attempts: [{ outcome: 'ok' }] } },
  { seq: 131, day: 1, phase: 'vote', actor: 'seat-8', type: 'vote_cast', payload: { seat: 'seat-8', target: 'seat-2' } },
  { seq: 132, day: 1, phase: 'vote', actor: 'seat-9', type: 'attempts_recorded', payload: { seat: 'seat-9', attempts: [{ outcome: 'ok' }] } },
  { seq: 133, day: 1, phase: 'vote', actor: 'seat-9', type: 'reasoning_recorded', payload: { seat: 'seat-9' } },
  { seq: 134, day: 1, phase: 'vote', actor: 'seat-9', type: 'vote_cast', payload: { seat: 'seat-9', target: 'seat-2' } },
  { seq: 135, day: 1, phase: 'vote', actor: 'seat-10', type: 'attempts_recorded', payload: { seat: 'seat-10', attempts: [{ outcome: 'ok' }] } },
  { seq: 136, day: 1, phase: 'vote', actor: 'seat-10', type: 'vote_cast', payload: { seat: 'seat-10', target: 'seat-2' } },
  { seq: 137, day: 1, phase: 'execution', actor: null, type: 'phase_changed', payload: { from: 'vote', to: 'execution', day: 1 } },
]

const rowsB = opportunityRows([...setup('sweep1-13', SWEEP1_13_ROLES, SWEEP1_13_MODELS), ...SWEEP1_13_VOTE1])

test('one ballot row per LIVING seat; the dead seat has no opportunity (sweep1-13 day 1)', () => {
  assert.equal(rowsB.length, 10)
  assert.ok(rowsB.every((r: any) => r.kind === 'day_vote' && r.phase === 'vote' && r.day === 1))
  assert.ok(!rowsB.some((r: any) => r.seat === 'seat-11'), 'seat-11 died at dawn (seq 49)')
  assert.ok(rowsB.every((r: any) => !r.legalTargets.includes('seat-11')))
  assert.ok(rowsB.every((r: any) => r.analysisRunId === 'UNBOUND'), 'no manifest binding defaults to UNBOUND')
})

test('timeout-forced ballot: engine-valid but seat-invalid, adjacency at seq+1 (sweep1-13 seq 123-124)', () => {
  const forced = rowsB.find((r: any) => r.seat === 'seat-5')!
  assert.equal(forced.seq, 124)
  assert.equal(forced.forced, true)
  assert.equal(forced.valid, false, 'the seat produced no legal action itself')
  assert.equal(forced.submitted, null, 'forced abstain is the engine acting, not the seat abstaining')
  assert.equal(forced.groundTruth, null)
  const cast = rowsB.find((r: any) => r.seat === 'seat-1')!
  assert.deepEqual([cast.submitted, cast.valid, cast.forced], ['seat-2', true, false])
  assert.deepEqual(cast.groundTruth, { targetRole: 'mafia', targetIsMafia: true })
})

// DELIBERATE pinned-test change, per docs/analysis/analysis-v3.2-amendment.md
// §5: the single "exact chance" field is replaced by TWO policy-named
// baselines, because the engine makes a self-vote legal (legal.ts:74) while
// v3.1's lone denominator excluded the voter, and because "chance" presumed a
// target-selection policy nobody had stated. `legalTargets` is unchanged — it
// was already correct — so the assertion below it stands verbatim.
test('two named chance baselines match their stated legal-target assumptions, town only (sweep1-13 day 1)', () => {
  // 10 living, mafia seat-2/8/9 all alive. Uniform over all legal targets
  // (self included) is 3/10; uniform over living non-self targets is 3/9.
  for (const r of rowsB) {
    if (r.role === 'mafia') {
      assert.equal(r.chanceUniformOverLegalTargets, null)
      assert.equal(r.chanceUniformOverLivingNonSelf, null)
      continue
    }
    assert.equal(r.chanceUniformOverLegalTargets, 3 / 10, 'denominator = every legal target, self included')
    assert.equal(r.chanceUniformOverLivingNonSelf, 3 / 9, 'denominator = living seats minus the voter')
    assert.equal(r.chance, r.chanceUniformOverLivingNonSelf, 'the v3.1 field survives only as a deprecated alias')
  }
  // Each baseline's denominator is exactly the target set its name claims.
  const cast = rowsB.find((r: any) => r.seat === 'seat-1')!
  assert.equal(cast.legalTargets.length, 10)
  assert.ok(cast.legalTargets.includes('seat-1'))
  assert.equal(cast.chanceUniformOverLegalTargets, 3 / cast.legalTargets.length)
  assert.equal(cast.chanceUniformOverLivingNonSelf, 3 / (cast.legalTargets.length - 1))
})

// ---------------------------------------------------------------------------
// Fixture C — REAL: sweep1-15 seq 152-166, night 2. The doctor (seat-5)
// died on night 1, so only mafia seat-2/3/10 and detective seat-7 are
// prompted. Mafia seat-2's provider errors out: timeout -> forced
// night_action_submitted {action:'no_action'} at seq+1.

const SWEEP1_15_ROLES = {
  'seat-1': 'villager', 'seat-2': 'mafia', 'seat-3': 'mafia', 'seat-4': 'villager',
  'seat-5': 'doctor', 'seat-6': 'villager', 'seat-7': 'detective', 'seat-8': 'villager',
  'seat-9': 'villager', 'seat-10': 'mafia', 'seat-11': 'villager',
}
const SWEEP1_15_NIGHT2: Ev[] = [
  { seq: 48, day: 1, phase: 'dawn', actor: 'seat-5', type: 'seat_died', payload: { seat: 'seat-5', role: 'doctor', cause: 'kill', day: 1 } },
  { seq: 141, day: 1, phase: 'execution', actor: 'seat-1', type: 'seat_died', payload: { seat: 'seat-1', role: 'villager', cause: 'execution', day: 1 } },
  { seq: 152, day: 2, phase: 'night_actions', actor: null, type: 'phase_changed', payload: { from: 'night_chat', to: 'night_actions', day: 2 } },
  { seq: 153, day: 2, phase: 'night_actions', actor: 'seat-2', type: 'attempts_recorded', payload: { seat: 'seat-2', attempts: [{ outcome: 'provider_error' }] } },
  { seq: 154, day: 2, phase: 'night_actions', actor: 'seat-2', type: 'timeout', payload: { seat: 'seat-2', phase: 'night_actions', defaultApplied: 'no_action', cause: 'provider_error' } },
  { seq: 155, day: 2, phase: 'night_actions', actor: 'seat-2', type: 'night_action_submitted', payload: { seat: 'seat-2', action: 'no_action', target: null } },
  { seq: 156, day: 2, phase: 'night_actions', actor: 'seat-3', type: 'attempts_recorded', payload: { seat: 'seat-3', attempts: [{ outcome: 'ok' }] } },
  { seq: 157, day: 2, phase: 'night_actions', actor: 'seat-3', type: 'night_action_submitted', payload: { seat: 'seat-3', action: 'night_kill', target: 'seat-8' } },
  { seq: 158, day: 2, phase: 'night_actions', actor: 'seat-7', type: 'attempts_recorded', payload: { seat: 'seat-7', attempts: [{ outcome: 'ok' }] } },
  { seq: 159, day: 2, phase: 'night_actions', actor: 'seat-7', type: 'reasoning_recorded', payload: { seat: 'seat-7' } },
  { seq: 160, day: 2, phase: 'night_actions', actor: 'seat-7', type: 'night_action_submitted', payload: { seat: 'seat-7', action: 'night_investigate', target: 'seat-2' } },
  { seq: 161, day: 2, phase: 'night_actions', actor: 'seat-10', type: 'attempts_recorded', payload: { seat: 'seat-10', attempts: [{ outcome: 'ok' }] } },
  { seq: 162, day: 2, phase: 'night_actions', actor: 'seat-10', type: 'night_action_submitted', payload: { seat: 'seat-10', action: 'night_kill', target: 'seat-8' } },
  { seq: 163, day: 2, phase: 'dawn', actor: null, type: 'phase_changed', payload: { from: 'night_actions', to: 'dawn', day: 2 } },
  { seq: 164, day: 2, phase: 'dawn', actor: 'seat-7', type: 'investigation_result', payload: { target: 'seat-2', result: 'mafia' } },
  { seq: 165, day: 2, phase: 'dawn', actor: 'seat-8', type: 'seat_died', payload: { seat: 'seat-8', role: 'villager', cause: 'kill', day: 2 } },
  { seq: 166, day: 2, phase: 'dawn', actor: null, type: 'night_resolved', payload: { killed: 'seat-8', protected: false } },
]

const rowsC = opportunityRows([...setup('sweep1-15', SWEEP1_15_ROLES), ...SWEEP1_15_NIGHT2])

test('dead power role owes nothing; forced night no_action is seat-invalid (sweep1-15 night 2)', () => {
  assert.deepEqual(rowsC.map((r: any) => [r.seat, r.kind]), [
    ['seat-2', 'night_kill'],
    ['seat-3', 'night_kill'],
    ['seat-7', 'night_investigate'],
    ['seat-10', 'night_kill'],
  ])
  const forced = rowsC.find((r: any) => r.seat === 'seat-2')!
  assert.deepEqual(
    [forced.seq, forced.forced, forced.valid, forced.submitted, forced.groundTruth],
    [155, true, false, null, null],
  )
  assert.ok(rowsC.every((r: any) => r.day === 2))
})

test('unprotected kill ground truth: applied victim, no intercept (sweep1-15 night 2)', () => {
  const kill = rowsC.find((r: any) => r.seat === 'seat-3')!
  assert.deepEqual(kill.groundTruth, {
    targetRole: 'villager',
    targetWasPowerRole: false,
    targetHadVotedMafia: false,
    nightVictim: 'seat-8',
    intercepted: false,
  })
  const inv = rowsC.find((r: any) => r.kind === 'night_investigate')!
  assert.deepEqual(inv.groundTruth, { targetRole: 'mafia', result: 'mafia', previouslyCheckedByThisDetective: false })
})

// ---------------------------------------------------------------------------
// Synthetic edge cases the sweep excerpts above do not cover: a voluntary
// mafia no_action (a night-1 no-kill), the doctor repeat-target exclusion
// cycling through lastProtected, a detective re-check, and a kill whose
// victim had previously balloted a true mafia seat.

const MINI_ROLES = { 'seat-1': 'mafia', 'seat-2': 'doctor', 'seat-3': 'detective', 'seat-4': 'villager' }
const MINI: Ev[] = [
  ...setup('mini', MINI_ROLES),
  // Night 1: mafia deliberately withholds the kill.
  { seq: 20, day: 1, phase: 'night_actions', actor: null, type: 'phase_changed', payload: { from: 'night_chat', to: 'night_actions', day: 1 } },
  { seq: 21, day: 1, phase: 'night_actions', actor: 'seat-1', type: 'night_action_submitted', payload: { seat: 'seat-1', action: 'no_action', target: null } },
  { seq: 22, day: 1, phase: 'night_actions', actor: 'seat-2', type: 'night_action_submitted', payload: { seat: 'seat-2', action: 'night_protect', target: 'seat-4' } },
  { seq: 23, day: 1, phase: 'night_actions', actor: 'seat-3', type: 'night_action_submitted', payload: { seat: 'seat-3', action: 'night_investigate', target: 'seat-1' } },
  { seq: 24, day: 1, phase: 'dawn', actor: 'seat-3', type: 'investigation_result', payload: { target: 'seat-1', result: 'mafia' } },
  { seq: 25, day: 1, phase: 'dawn', actor: null, type: 'night_resolved', payload: { killed: null, protected: false } },
  // Day 1 vote: seat-4 ballots the true mafia.
  { seq: 30, day: 1, phase: 'vote', actor: null, type: 'phase_changed', payload: { from: 'discussion', to: 'vote', day: 1 } },
  { seq: 31, day: 1, phase: 'vote', actor: 'seat-1', type: 'vote_cast', payload: { seat: 'seat-1', target: 'seat-4' } },
  { seq: 32, day: 1, phase: 'vote', actor: 'seat-2', type: 'vote_cast', payload: { seat: 'seat-2', target: null } },
  { seq: 33, day: 1, phase: 'vote', actor: 'seat-3', type: 'vote_cast', payload: { seat: 'seat-3', target: 'seat-2' } },
  { seq: 34, day: 1, phase: 'vote', actor: 'seat-4', type: 'vote_cast', payload: { seat: 'seat-4', target: 'seat-1' } },
  { seq: 35, day: 2, phase: 'night_chat', actor: null, type: 'phase_changed', payload: { from: 'vote', to: 'night_chat', day: 2 } },
  // Night 2: doctor may not repeat seat-4; kill lands on the prior mafia-voter.
  { seq: 40, day: 2, phase: 'night_actions', actor: null, type: 'phase_changed', payload: { from: 'night_chat', to: 'night_actions', day: 2 } },
  { seq: 41, day: 2, phase: 'night_actions', actor: 'seat-1', type: 'night_action_submitted', payload: { seat: 'seat-1', action: 'night_kill', target: 'seat-4' } },
  { seq: 42, day: 2, phase: 'night_actions', actor: 'seat-2', type: 'night_action_submitted', payload: { seat: 'seat-2', action: 'night_protect', target: 'seat-2' } },
  { seq: 43, day: 2, phase: 'night_actions', actor: 'seat-3', type: 'night_action_submitted', payload: { seat: 'seat-3', action: 'night_investigate', target: 'seat-1' } },
  { seq: 44, day: 2, phase: 'dawn', actor: 'seat-3', type: 'investigation_result', payload: { target: 'seat-1', result: 'mafia' } },
  { seq: 45, day: 2, phase: 'dawn', actor: 'seat-4', type: 'seat_died', payload: { seat: 'seat-4', role: 'villager', cause: 'kill', day: 2 } },
  { seq: 46, day: 2, phase: 'dawn', actor: null, type: 'night_resolved', payload: { killed: 'seat-4', protected: false } },
  // Night 3: lastProtected is now seat-2; seat-4's old exclusion is gone.
  { seq: 50, day: 3, phase: 'night_actions', actor: null, type: 'phase_changed', payload: { from: 'night_chat', to: 'night_actions', day: 3 } },
  { seq: 51, day: 3, phase: 'night_actions', actor: 'seat-1', type: 'night_action_submitted', payload: { seat: 'seat-1', action: 'night_kill', target: 'seat-3' } },
  { seq: 52, day: 3, phase: 'night_actions', actor: 'seat-2', type: 'night_action_submitted', payload: { seat: 'seat-2', action: 'night_protect', target: 'seat-3' } },
  { seq: 53, day: 3, phase: 'night_actions', actor: 'seat-3', type: 'night_action_submitted', payload: { seat: 'seat-3', action: 'night_investigate', target: 'seat-2' } },
  { seq: 54, day: 3, phase: 'dawn', actor: 'seat-3', type: 'investigation_result', payload: { target: 'seat-2', result: 'not mafia' } },
  { seq: 55, day: 3, phase: 'dawn', actor: null, type: 'night_resolved', payload: { killed: null, protected: true } },
]
const rowsM = opportunityRows(MINI)
const night = (day: number, kind: string) => rowsM.find((r: any) => r.day === day && r.kind === kind)!

test('voluntary no_action is the seat abstaining: valid, no kill that night', () => {
  const k1 = night(1, 'night_kill')
  assert.deepEqual([k1.submitted, k1.valid, k1.forced], ['abstain', true, false])
  assert.equal(k1.groundTruth, null, 'no target, no target facts')
  const p1 = night(1, 'night_protect')
  assert.deepEqual(p1.groundTruth, { targetRole: 'villager', selfProtect: false, interceptedKill: false })
})

test('doctor repeat-target exclusion follows lastProtected night to night', () => {
  assert.deepEqual(night(1, 'night_protect').legalTargets, ['seat-1', 'seat-2', 'seat-3', 'seat-4'])
  assert.deepEqual(night(2, 'night_protect').legalTargets, ['seat-1', 'seat-2', 'seat-3'], 'seat-4 protected on night 1')
  assert.deepEqual(night(3, 'night_protect').legalTargets, ['seat-1', 'seat-3'], 'seat-2 now excluded; dead seat-4 gone')
})

test('kill ground truth: victim had previously balloted a true mafia seat', () => {
  assert.deepEqual(night(2, 'night_kill').groundTruth, {
    targetRole: 'villager',
    targetWasPowerRole: false,
    targetHadVotedMafia: true, // seat-4 voted seat-1 (mafia) at seq 34, before the seq-41 kill
    nightVictim: 'seat-4',
    intercepted: false,
  })
  assert.deepEqual(night(3, 'night_kill').groundTruth, {
    targetRole: 'detective',
    targetWasPowerRole: true,
    targetHadVotedMafia: false, // seat-3's only ballot (seq 33) hit seat-2, a non-mafia seat
    nightVictim: 'seat-3',
    intercepted: true,
  })
})

test('detective re-check is visible in ground truth', () => {
  assert.equal(night(1, 'night_investigate').groundTruth.previouslyCheckedByThisDetective, false)
  assert.equal(night(2, 'night_investigate').groundTruth.previouslyCheckedByThisDetective, true)
  assert.equal(night(3, 'night_investigate').groundTruth.previouslyCheckedByThisDetective, false, 'seat-2 never checked before')
})

test('explicit abstain ballot is seat-valid; both baselines are stamped on it', () => {
  const votes = rowsM.filter((r: any) => r.kind === 'day_vote')
  assert.equal(votes.length, 4)
  const abstain = votes.find((r: any) => r.seat === 'seat-2')!
  assert.deepEqual([abstain.submitted, abstain.valid, abstain.forced, abstain.groundTruth], ['abstain', true, false, null])
  // 4 living, 1 mafia (v3.2 §5).
  assert.equal(abstain.chanceUniformOverLegalTargets, 1 / 4)
  assert.equal(abstain.chanceUniformOverLivingNonSelf, 1 / 3)
  const mafiaBallot = votes.find((r: any) => r.seat === 'seat-1')!
  assert.equal(mafiaBallot.chanceUniformOverLegalTargets, null, 'mafia ballots carry no baseline')
  assert.equal(mafiaBallot.chanceUniformOverLivingNonSelf, null)
})

test('a living seat missing its ballot fails closed', () => {
  const truncated = [
    ...setup('mini', MINI_ROLES),
    { seq: 30, day: 1, phase: 'vote', actor: null, type: 'phase_changed', payload: { from: 'discussion', to: 'vote', day: 1 } },
    { seq: 31, day: 1, phase: 'vote', actor: 'seat-1', type: 'vote_cast', payload: { seat: 'seat-1', target: 'seat-4' } },
    { seq: 32, day: 1, phase: 'execution', actor: null, type: 'phase_changed', payload: { from: 'vote', to: 'execution', day: 1 } },
  ]
  assert.throws(() => opportunityRows(truncated), /no ballot/)
})

test('an unresolved night fails closed', () => {
  const truncated = [
    ...setup('mini', MINI_ROLES),
    { seq: 20, day: 1, phase: 'night_actions', actor: null, type: 'phase_changed', payload: { from: 'night_chat', to: 'night_actions', day: 1 } },
    { seq: 21, day: 1, phase: 'night_actions', actor: 'seat-1', type: 'night_action_submitted', payload: { seat: 'seat-1', action: 'night_kill', target: 'seat-4' } },
  ]
  assert.throws(() => opportunityRows(truncated), /never resolved/)
})
