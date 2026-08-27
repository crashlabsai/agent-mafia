import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG, deriveGameSeed, factionOf, validateConfig, type Role } from '@mafia/protocol'
import { createGame } from '../src/index.ts'

const rolesOf = (seed: string): Role[] =>
  createGame({ roomId: 'r', matchSeed: seed }).state.seats.map((s) => s.role)

test('the same seed deals the same roles', () => {
  assert.deepEqual(rolesOf('42'), rolesOf('42'))
})

test('different seeds deal different roles', () => {
  const distinct = new Set(Array.from({ length: 40 }, (_, i) => rolesOf(`s${i}`).join(',')))
  assert.ok(distinct.size > 25, `only ${distinct.size} distinct deals in 40 seeds`)
})

test('every deal matches the configured role multiset', () => {
  for (let i = 0; i < 500; i++) {
    const counts: Record<string, number> = {}
    for (const r of rolesOf(`m${i}`)) counts[r] = (counts[r] ?? 0) + 1
    assert.deepEqual(counts, DEFAULT_CONFIG.roles)
  }
})

test('role assignment depends on gameSeed alone, not on seat identity', () => {
  // Same gameSeed reached via different matchSeed/gameIndex pairs must deal
  // identically. This is what stops a persistent seat from being predictive.
  const a = createGame({ roomId: 'roomA', matchSeed: 'ignored', match: { gameSeed: 'fixed' } })
  const b = createGame({
    roomId: 'roomB',
    matchSeed: 'different',
    match: { gameSeed: 'fixed', matchId: 'mB', gameIndex: 9 },
  })
  assert.deepEqual(
    a.state.seats.map((s) => s.role),
    b.state.seats.map((s) => s.role),
  )
})

test('a persistent seat does not keep a role across a match', () => {
  // seat-1 across 200 games of one match should hold a spread of roles.
  const seen = new Set<Role>()
  for (let g = 0; g < 200; g++) {
    const { state } = createGame({
      roomId: `r${g}`,
      matchSeed: 'match-1',
      match: { matchId: 'match-1', gameIndex: g },
    })
    seen.add(state.seats[0]!.role)
  }
  assert.deepEqual([...seen].sort(), ['detective', 'doctor', 'mafia', 'villager'])
})

test('a standalone game is a one-game match', () => {
  const { state } = createGame({ roomId: 'solo', matchSeed: 'z' })
  assert.equal(state.match.matchId, 'solo')
  assert.equal(state.match.gameIndex, 0)
  assert.equal(state.match.gameSeed, deriveGameSeed('z', 0))
})

test('game opens on night 1 with mafia on the clock', () => {
  const { state } = createGame({ roomId: 'r', matchSeed: '1' })
  assert.equal(state.day, 1)
  assert.equal(state.phase, 'night_chat')
  const mafia = state.seats.filter((s) => factionOf(s.role) === 'mafia').map((s) => s.id)
  assert.deepEqual(state.pending?.awaiting, mafia)
})

test('setup emits omniscient ground truth for every seat', () => {
  const { state, events } = createGame({ roomId: 'r', matchSeed: '1' })
  const truth = events.filter((e) => e.type === 'role_assigned')
  assert.equal(truth.length, state.seats.length)
  assert.ok(truth.every((e) => e.visibility === 'omniscient'))
})

test('config validation rejects unwinnable and malformed tables', () => {
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, seatCount: 8 }), /roles sum/)
  assert.throws(
    () => validateConfig({ ...DEFAULT_CONFIG, seatCount: 4, roles: { mafia: 2, doctor: 1, detective: 1, villager: 0 } }),
    /parity/,
  )
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, openSequentialVoting: true }), /reserved/)
})
