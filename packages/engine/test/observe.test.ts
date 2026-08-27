import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROLES, factionOf, type GameState, type Role, type SeatId } from '@mafia/protocol'
import { createGame, drawInt, legalActions, observe, pendingSeats, step } from '../src/index.ts'

/** Walk a game forward with seeded-arbitrary legal choices. */
function walk(seed: string, maxSteps: number): GameState[] {
  const { state } = createGame({ roomId: 'r', matchSeed: seed })
  const states: GameState[] = [state]
  let s = state
  let c = 0
  for (let i = 0; i < maxSteps && s.phase !== 'ended' && s.pending; i++) {
    const seat = s.pending.awaiting[0] as SeatId
    const specs = legalActions(s, seat)
    if (specs.length === 0) break
    const d = drawInt(seed, c++, specs.length)
    const spec = specs[d.value]!
    const targets = spec.targets ?? []
    let action
    if (spec.type === 'speak' || spec.type === 'mafia_chat') action = { type: spec.type, text: `m${i}` }
    else if (spec.type === 'vote') action = { type: 'vote' as const, target: targets[i % Math.max(1, targets.length)] ?? null }
    else if (targets.length > 0) action = { type: spec.type, target: targets[i % targets.length]! }
    else action = { type: spec.type }
    s = step(s, { seat, action: action as never, reasoning: 'private thought' }).state
    states.push(s)
  }
  return states
}

/**
 * Roles an observer cannot distinguish between for a given target.
 *
 * A town seat knows nothing, so every role is a candidate. A mafia seat knows
 * who its partners are, so faction is fixed but the specific town role is not.
 */
function indistinguishableRoles(state: GameState, me: SeatId, target: SeatId): Role[] {
  const meRole = state.seats.find((s) => s.id === me)!.role
  const targetRole = state.seats.find((s) => s.id === target)!.role
  if (factionOf(meRole) !== 'mafia') return [...ROLES]
  return ROLES.filter((r) => factionOf(r) === factionOf(targetRole))
}

test('PROPERTY: a hidden role cannot change what another seat observes', () => {
  // The information-theoretic form of the redaction rule: if two worlds differ
  // only in a role the observer is not entitled to, the observer must not be
  // able to tell them apart.
  let checked = 0

  for (let g = 0; g < 25; g++) {
    for (const state of walk(`prop-${g}`, 60)) {
      for (const me of state.seats) {
        const baseline = JSON.stringify(observe(state, me.id))

        for (const other of state.seats) {
          if (other.id === me.id) continue
          // A dead seat's role is public when reveal-on-death is on, and every
          // role is public once the game has ended.
          if (state.winner !== null) continue
          if (!other.alive && state.config.revealRoleOnDeath) continue

          for (const alt of indistinguishableRoles(state, me.id, other.id)) {
            if (alt === other.role) continue
            const counterfactual = structuredClone(state)
            counterfactual.seats.find((s) => s.id === other.id)!.role = alt
            assert.equal(
              JSON.stringify(observe(counterfactual, me.id)),
              baseline,
              `${me.id} (${me.role}) can distinguish ${other.id} being ${other.role} vs ${alt} in phase ${state.phase}`,
            )
            checked += 1
          }
        }
      }
    }
  }
  assert.ok(checked > 5000, `only ${checked} counterfactuals checked`)
})

test('PROPERTY: an observation never names another seat as mafia unfairly', () => {
  for (let g = 0; g < 20; g++) {
    for (const state of walk(`fm-${g}`, 50)) {
      for (const me of state.seats) {
        const obs = observe(state, me.id)

        // fellowMafia is populated only for mafia, and only with real mafia.
        if (factionOf(me.role) !== 'mafia') {
          assert.deepEqual(obs.knowledge.fellowMafia, [], `${me.id} is town but got partners`)
          assert.deepEqual(obs.privateChat, [], `${me.id} is town but saw the mafia channel`)
        } else {
          for (const id of obs.knowledge.fellowMafia) {
            assert.equal(state.seats.find((s) => s.id === id)!.role, 'mafia')
            assert.notEqual(id, me.id)
          }
        }

        // Investigation results belong to the detective that ran them.
        for (const i of obs.knowledge.investigations) {
          assert.equal(i.detective, me.id, 'observation leaked another seat’s investigation')
        }

        // A revealed role is only ever a dead seat, or the end of the game.
        for (const view of obs.table.seats) {
          if (view.revealedRole === null || view.id === me.id) continue
          assert.ok(!view.alive || state.winner !== null, `${view.id} role revealed while alive mid-game`)
        }

        // The observer's own role is always its true role.
        assert.equal(obs.you.role, me.role)
      }
    }
  }
})

test('a seat not on the clock is offered no actions', () => {
  // Under sequential collection only the head of `awaiting` is on the clock —
  // the seats queued behind it can see the table but cannot act yet.
  for (let g = 0; g < 10; g++) {
    for (const state of walk(`clock-${g}`, 40)) {
      const onClock = new Set(pendingSeats(state))
      for (const s of state.seats) {
        const obs = observe(state, s.id)
        if (onClock.has(s.id)) {
          assert.ok(obs.legalActions.length > 0, `${s.id} is on the clock but has no legal actions`)
        } else {
          assert.deepEqual(obs.legalActions, [], `${s.id} is not on the clock but was offered actions`)
        }
      }
    }
  }
})

test('sequential collection puts exactly one seat on the clock', () => {
  for (let g = 0; g < 10; g++) {
    for (const state of walk(`seq-${g}`, 40)) {
      if (state.pending?.mode !== 'sequential') continue
      assert.equal(pendingSeats(state).length, 1)
    }
  }
})

test('reasoning traces are omniscient and never surface in an observation', () => {
  const { state } = createGame({ roomId: 'r', matchSeed: 'trace' })
  const seat = state.pending!.awaiting[0] as SeatId
  const r = step(state, { seat, action: { type: 'pass' }, reasoning: 'SECRET-PLAN' })
  const trace = r.events.find((e) => e.type === 'reasoning_recorded')
  assert.equal(trace?.visibility, 'omniscient')
  for (const s of r.state.seats) {
    assert.ok(!JSON.stringify(observe(r.state, s.id)).includes('SECRET-PLAN'))
  }
})
