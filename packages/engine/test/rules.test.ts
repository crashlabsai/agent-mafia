import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GameState, Role, SeatId } from '@mafia/protocol'
import { checkWin, legalActions, step } from '../src/index.ts'
import { driveAll, gameWithRoles, idOf, submit } from './helpers.ts'

const TABLE: Role[] = ['mafia', 'mafia', 'doctor', 'detective', 'villager', 'villager', 'villager']

/** Advance from night_chat to the sealed night_actions phase. */
function toNightActions(state: GameState): GameState {
  return driveAll(state, () => ({ type: 'pass' }))
}

function nightWith(
  state: GameState,
  choices: (s: GameState, seat: SeatId) => Parameters<typeof submit>[2],
): GameState {
  let s = toNightActions(state)
  const actors = [...(s.pending?.awaiting ?? [])]
  for (const seat of actors) s = submit(s, seat, choices(s, seat))
  return s
}

test('doctor protection cancels the kill', () => {
  const g = gameWithRoles(TABLE)
  const victim = idOf(g, 'villager')
  const s = nightWith(g, (st, seat) => {
    const role = st.seats.find((x) => x.id === seat)!.role
    if (role === 'mafia') return { type: 'night_kill', target: victim }
    if (role === 'doctor') return { type: 'night_protect', target: victim }
    return { type: 'no_action' }
  })
  assert.equal(s.seats.find((x) => x.id === victim)!.alive, true)
  assert.ok(s.history.some((h) => h.kind === 'no_death'))
})

test('an unprotected kill lands and reveals the role', () => {
  const g = gameWithRoles(TABLE)
  const victim = idOf(g, 'villager')
  const other = idOf(g, 'villager', 1)
  const s = nightWith(g, (st, seat) => {
    const role = st.seats.find((x) => x.id === seat)!.role
    if (role === 'mafia') return { type: 'night_kill', target: victim }
    if (role === 'doctor') return { type: 'night_protect', target: other }
    return { type: 'no_action' }
  })
  assert.equal(s.seats.find((x) => x.id === victim)!.alive, false)
  const death = s.history.find((h) => h.kind === 'death')
  assert.equal(death?.kind === 'death' ? death.role : null, 'villager')
})

test('all mafia declining means nobody dies', () => {
  const g = gameWithRoles(TABLE)
  const s = nightWith(g, () => ({ type: 'no_action' }))
  assert.equal(s.seats.filter((x) => x.alive).length, TABLE.length)
  assert.ok(s.history.some((h) => h.kind === 'no_death'))
})

test('split mafia votes resolve deterministically', () => {
  const targets = ['villager', 'villager'] as const
  const runs = new Set<string>()
  for (let i = 0; i < 5; i++) {
    const g = gameWithRoles(TABLE)
    const a = idOf(g, targets[0], 0)
    const b = idOf(g, targets[1], 1)
    let n = 0
    const s = nightWith(g, (st, seat) => {
      const role = st.seats.find((x) => x.id === seat)!.role
      if (role === 'mafia') return { type: 'night_kill', target: n++ === 0 ? a : b }
      return { type: 'no_action' }
    })
    runs.add(s.seats.filter((x) => !x.alive).map((x) => x.id).join(','))
  }
  assert.equal(runs.size, 1, 'a tied mafia vote must resolve the same way every time')
})

test('the detective learns faction, and only its own results', () => {
  const g = gameWithRoles(TABLE)
  const mafia = idOf(g, 'mafia')
  const det = idOf(g, 'detective')
  const s = nightWith(g, (st, seat) => {
    const role = st.seats.find((x) => x.id === seat)!.role
    if (role === 'detective') return { type: 'night_investigate', target: mafia }
    return { type: 'no_action' }
  })
  assert.deepEqual(s.investigations, [{ day: 1, detective: det, target: mafia, result: 'mafia' }])
})

test('a detective killed the same night still recorded its result', () => {
  // Investigation resolves against the pre-night state, before the kill lands.
  const g = gameWithRoles(TABLE)
  const det = idOf(g, 'detective')
  const mafia = idOf(g, 'mafia')
  const s = nightWith(g, (st, seat) => {
    const role = st.seats.find((x) => x.id === seat)!.role
    if (role === 'mafia') return { type: 'night_kill', target: det }
    if (role === 'detective') return { type: 'night_investigate', target: mafia }
    return { type: 'no_action' }
  })
  assert.equal(s.seats.find((x) => x.id === det)!.alive, false)
  assert.equal(s.investigations.length, 1)
  assert.equal(s.investigations[0]!.result, 'mafia')
})

test('the doctor may not repeat a target on consecutive nights', () => {
  const g = gameWithRoles(TABLE)
  const doc = idOf(g, 'doctor')
  const target = idOf(g, 'villager')
  let s = nightWith(g, (st, seat) => {
    const role = st.seats.find((x) => x.id === seat)!.role
    if (role === 'doctor') return { type: 'night_protect', target }
    return { type: 'no_action' }
  })
  assert.equal(s.lastProtected, target)

  // Drive to the next night and check the spec no longer offers that target.
  s = driveAll(s, () => ({ type: 'pass' }))          // discussion round 1
  s = driveAll(s, () => ({ type: 'pass' }))          // discussion round 2
  s = driveAll(s, () => ({ type: 'vote', target: null }))
  s = driveAll(s, () => ({ type: 'pass' }))          // next night_chat
  const spec = legalActions(s, doc).find((x) => x.type === 'night_protect')
  assert.ok(spec, 'doctor should be able to protect')
  assert.ok(!spec.targets?.includes(target), 'repeat target must not be offered')
})

test('a tied execution kills nobody', () => {
  const g = gameWithRoles(TABLE)
  let s = toNightActions(g)
  s = driveAll(s, () => ({ type: 'no_action' }))
  s = driveAll(s, () => ({ type: 'pass' }))
  s = driveAll(s, () => ({ type: 'pass' }))
  assert.equal(s.phase, 'vote')

  // 7 voters cannot split evenly between two targets, so one abstains and the
  // remaining six split 3-3.
  const living = s.seats.filter((x) => x.alive).map((x) => x.id)
  let i = 0
  s = driveAll(s, () => {
    const n = i++
    return n < living.length - 1
      ? { type: 'vote', target: living[n % 2] as SeatId }
      : { type: 'vote', target: null }
  })

  const tally = s.history.find((h) => h.kind === 'vote_tally')
  assert.equal(tally?.kind === 'vote_tally' ? tally.tie : false, true)
  assert.equal(s.seats.filter((x) => x.alive).length, living.length)
})

test('unanimous votes execute and reveal', () => {
  const g = gameWithRoles(TABLE)
  let s = toNightActions(g)
  s = driveAll(s, () => ({ type: 'no_action' }))
  s = driveAll(s, () => ({ type: 'pass' }))
  s = driveAll(s, () => ({ type: 'pass' }))
  const doomed = idOf(s, 'villager', 2)
  s = driveAll(s, () => ({ type: 'vote', target: doomed }))
  assert.equal(s.seats.find((x) => x.id === doomed)!.alive, false)
  assert.equal(s.seats.find((x) => x.id === doomed)!.diedOn?.cause, 'execution')
})

test('town wins the moment the last mafia is executed', () => {
  const g = gameWithRoles(['mafia', 'doctor', 'villager', 'villager', 'villager'])
  let s = toNightActions(g)
  s = driveAll(s, () => ({ type: 'no_action' }))
  s = driveAll(s, () => ({ type: 'pass' }))
  s = driveAll(s, () => ({ type: 'pass' }))
  s = driveAll(s, () => ({ type: 'vote', target: idOf(s, 'mafia') }))
  assert.equal(s.winner, 'town')
  assert.equal(s.phase, 'ended')
  assert.equal(s.pending, null)
})

test('mafia win at parity, not only at a sweep', () => {
  const s = gameWithRoles(['mafia', 'mafia', 'villager', 'villager', 'villager'])
  assert.equal(checkWin(s), null, '2 mafia vs 3 town is still a live game')
  s.seats[2]!.alive = false
  assert.equal(checkWin(s), 'mafia', '2 mafia vs 2 town is parity — mafia can no longer be voted out')
})

test('town wins only when every mafia is gone', () => {
  const s = gameWithRoles(['mafia', 'mafia', 'villager', 'villager', 'villager'])
  s.seats[0]!.alive = false
  assert.equal(checkWin(s), null, 'one mafia still standing')
  s.seats[1]!.alive = false
  assert.equal(checkWin(s), 'town')
})

test('an illegal action is rejected without changing state or crashing', () => {
  const g = gameWithRoles(TABLE)
  const seat = g.pending!.awaiting[0] as SeatId
  const before = JSON.stringify(g)
  const r = step(g, { seat, action: { type: 'vote', target: seat }, reasoning: null })
  assert.ok(r.events.some((e) => e.type === 'action_rejected'))
  assert.equal(JSON.stringify({ ...r.state, phase: g.phase }), before)
  assert.deepEqual(r.state.pending?.awaiting, g.pending?.awaiting, 'seat stays on the clock')
})

test('a seat that is not on the clock cannot act', () => {
  const g = gameWithRoles(TABLE)
  const notUp = g.seats.find((x) => !g.pending!.awaiting.includes(x.id))!.id
  const r = step(g, { seat: notUp, action: { type: 'pass' }, reasoning: null })
  const rejected = r.events.find((e) => e.type === 'action_rejected')
  assert.match(String((rejected?.payload as { reason: string }).reason), /not on the clock/)
})

test('an over-long message is rejected', () => {
  const g = gameWithRoles(TABLE)
  const seat = g.pending!.awaiting[0] as SeatId
  const r = step(g, { seat, action: { type: 'mafia_chat', text: 'x'.repeat(1001) }, reasoning: null })
  assert.ok(r.events.some((e) => e.type === 'action_rejected'))
})

test('the discussion anchor rotates between days', () => {
  const g = gameWithRoles(TABLE)
  let s = toNightActions(g)
  s = driveAll(s, () => ({ type: 'no_action' }))
  const day1 = [...s.discussionOrder!]
  s = driveAll(s, () => ({ type: 'pass' }))
  s = driveAll(s, () => ({ type: 'pass' }))
  s = driveAll(s, () => ({ type: 'vote', target: null }))
  s = driveAll(s, () => ({ type: 'pass' }))
  s = driveAll(s, () => ({ type: 'no_action' }))
  const day2 = [...s.discussionOrder!]
  assert.notDeepEqual(day1, day2, 'speaking order must not be fixed across days')
  assert.deepEqual([...day1].sort(), [...day2].sort(), 'same seats, different anchor')
})
