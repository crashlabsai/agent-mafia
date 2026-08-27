import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isVisibleTo, type SeatDriver, type SeatId } from '@mafia/protocol'
import { createGame, observe } from '@mafia/engine'
import { ScriptedDriver, alwaysPass, firstLegal, seededRandom, type Policy } from '@mafia/seats'
import { MemorySink, eventsVisibleTo, fixedClock, fork, replay, runGame, verify } from '../src/index.ts'

async function play(seed: string, policy: Policy = seededRandom) {
  const { state, events: setupEvents } = createGame({ roomId: `room-${seed}`, matchSeed: seed })
  const drivers: Record<SeatId, SeatDriver> = {}
  for (const s of state.seats) {
    drivers[s.id] = new ScriptedDriver({ seat: s.id, policy, seed: `${seed}:${s.id}`, explain: true })
  }
  const sink = new MemorySink()
  const result = await runGame({
    state, drivers, sink, setupEvents, deadlineMs: null, clock: fixedClock,
  })
  return { ...result, log: sink.events }
}

test('a scripted table plays a full game to a winner', async () => {
  const { state, outcome } = await play('42')
  assert.equal(state.phase, 'ended')
  assert.ok(state.winner === 'mafia' || state.winner === 'town')
  assert.equal(outcome.winner, state.winner)
  assert.equal(outcome.finalRoles.length, 7)
})

test('games reach both outcomes across seeds', async () => {
  const winners = new Set<string>()
  for (let i = 0; i < 12; i++) winners.add((await play(`w${i}`)).state.winner!)
  assert.deepEqual([...winners].sort(), ['mafia', 'town'], 'both factions must be able to win')
})

test('the same seed produces a byte-identical log', async () => {
  const a = await play('determinism')
  const b = await play('determinism')
  assert.equal(
    a.log.map((e) => JSON.stringify(e)).join('\n'),
    b.log.map((e) => JSON.stringify(e)).join('\n'),
  )
})

test('different seeds produce different games', async () => {
  const a = await play('seed-a')
  const b = await play('seed-b')
  assert.notEqual(JSON.stringify(a.log), JSON.stringify(b.log))
})

test('every event carries match identifiers', async () => {
  const { log } = await play('match-fields')
  assert.ok(log.length > 0)
  for (const e of log) {
    assert.equal(typeof e.matchId, 'string')
    assert.equal(typeof e.gameIndex, 'number')
    assert.equal(typeof e.seq, 'number')
  }
})

test('a standalone run satisfies matchId === roomId and gameIndex === 0', async () => {
  const { log } = await play('standalone')
  for (const e of log) {
    assert.equal(e.matchId, e.roomId)
    assert.equal(e.gameIndex, 0)
  }
})

test('gameSeed is logged explicitly, not only derivable', async () => {
  const { log } = await play('explicit-seed')
  const created = log.find((e) => e.type === 'game_created')!
  const p = created.payload as Record<string, unknown>
  assert.equal(typeof p['gameSeed'], 'string')
  assert.equal(typeof p['matchSeed'], 'string')
  assert.ok(Array.isArray(p['persistentSeats']))
})

test('seq is monotonic and gapless', async () => {
  const { log } = await play('seq')
  log.forEach((e, i) => assert.equal(e.seq, i))
})

test('replaying the log reconstructs the live final state', async () => {
  const { state, log } = await play('replay')
  const { state: rebuilt } = replay(log)
  assert.equal(rebuilt.winner, state.winner)
  assert.equal(rebuilt.phase, state.phase)
  assert.equal(rebuilt.day, state.day)
  assert.deepEqual(rebuilt.seats, state.seats)
  assert.deepEqual(rebuilt.history, state.history)
  assert.deepEqual(rebuilt.chat, state.chat)
  assert.deepEqual(rebuilt.investigations, state.investigations)
  assert.equal(rebuilt.rngCounter, state.rngCounter, 'RNG position must be reproduced exactly')
})

test('verify accepts a well-formed log', async () => {
  const { log } = await play('verify')
  const report = verify(log)
  assert.deepEqual(report.problems, [])
  assert.equal(report.ok, true)
})

test('verify catches a tampered log', async () => {
  const { log } = await play('tamper')
  const tampered = structuredClone(log)
  const ended = tampered.find((e) => e.type === 'game_ended')!
  ;(ended.payload as Record<string, unknown>)['winner'] =
    ended.payload['winner'] === 'mafia' ? 'town' : 'mafia'
  assert.equal(verify(tampered).ok, false)
})

test('forking reproduces the prefix exactly', async () => {
  const { log } = await play('fork')
  const mid = Math.floor(log.length / 2)
  const a = fork(log, mid)
  const b = fork(log, mid)
  assert.deepEqual(a, b, 'forking must be reproducible')

  const full = replay(log).state
  assert.ok(a.seats.filter((s) => !s.alive).length <= full.seats.filter((s) => !s.alive).length)
  assert.deepEqual(a.chat, replay(log, mid).state.chat)
})

test('seat-scoped replay hides what the seat never saw', async () => {
  const { state, log } = await play('redaction')
  for (const seat of state.seats) {
    const visible = eventsVisibleTo(log, seat.id)
    assert.ok(visible.length < log.length, 'no seat sees the whole log')

    for (const e of visible) assert.ok(isVisibleTo(e.visibility, seat.id))

    // Ground truth, sealed submissions and reasoning are omniscient-only.
    for (const type of ['role_assigned', 'vote_cast', 'night_action_submitted', 'reasoning_recorded']) {
      assert.equal(visible.filter((e) => e.type === type).length, 0, `${seat.id} saw ${type}`)
    }

    // The mafia channel reaches mafia and nobody else.
    const chatter = visible.filter((e) => e.type === 'mafia_message_sent').length
    if (seat.role !== 'mafia') assert.equal(chatter, 0, `${seat.id} is town but saw mafia chat`)
  }
})

test('reasoning traces are captured next to the action they produced', async () => {
  const { log } = await play('traces')
  const traces = log.filter((e) => e.type === 'reasoning_recorded')
  assert.ok(traces.length > 0, 'scripted seats with explain:true should emit traces')
  for (const t of traces) {
    assert.equal(t.visibility, 'omniscient')
    const next = log[t.seq + 1]
    assert.ok(next, 'a trace must be followed by something')
    assert.equal(next.actor, t.actor, 'the trace must sit beside its own action')
  }
})

test('a silent table ends in a stalemate rather than running forever', async () => {
  // Nobody kills, nobody executes, so no cycle can ever change the board. The
  // ruleset has to bound this; the room's loop guard is a bug detector, not a
  // termination mechanism.
  const { state, outcome, log } = await play('silent', alwaysPass)
  assert.equal(state.phase, 'ended')
  assert.equal(state.winner, null)
  assert.equal(state.endedReason, 'stalemate')
  assert.equal(outcome.reason, 'stalemate')
  assert.equal(state.seats.filter((s) => s.alive).length, 7, 'nobody should have died')
  assert.equal(state.day, state.config.maxQuietDays, "ends on the third quiet cycle, before the day increments")
  assert.equal(verify(log).ok, true)
})

test('a stalemate is distinguishable from a win in the log', async () => {
  const stalled = await play('silent-2', alwaysPass)
  const won = await play('42')
  const endOf = (l: Awaited<ReturnType<typeof play>>['log']) =>
    l.find((e) => e.type === 'game_ended')!.payload as Record<string, unknown>
  assert.equal(endOf(stalled.log)['reason'], 'stalemate')
  assert.equal(endOf(stalled.log)['winner'], null)
  assert.equal(endOf(won.log)['reason'], 'win')
  assert.ok(endOf(won.log)['winner'])
})

test('a fully deterministic policy still completes', async () => {
  const { state } = await play('first-legal', firstLegal)
  assert.equal(state.phase, 'ended')
})

test('a driver that throws costs itself a turn but not the game', async () => {
  const { state, events: setupEvents } = createGame({ roomId: 'broken', matchSeed: 'broken' })
  const drivers: Record<SeatId, SeatDriver> = {}
  for (const s of state.seats) {
    drivers[s.id] = new ScriptedDriver({ seat: s.id, seed: `b:${s.id}` })
  }
  const victim = state.seats[0]!.id
  drivers[victim] = {
    kind: 'agent',
    init: async () => {},
    act: async () => {
      throw new Error('model exploded')
    },
    notify: async () => {},
    finish: async () => null,
    close: async () => {},
  }

  const sink = new MemorySink()
  const result = await runGame({
    state, drivers, sink, setupEvents, deadlineMs: 50, clock: fixedClock,
  })
  assert.equal(result.state.phase, 'ended')
  assert.ok(sink.events.some((e) => e.type === 'timeout' && e.actor === victim))
})

test('an illegal action falls back to the phase default', async () => {
  const { state, events: setupEvents } = createGame({ roomId: 'illegal', matchSeed: 'illegal' })
  const drivers: Record<SeatId, SeatDriver> = {}
  for (const s of state.seats) {
    drivers[s.id] = new ScriptedDriver({ seat: s.id, seed: `i:${s.id}` })
  }
  drivers[state.seats[0]!.id] = {
    kind: 'agent',
    init: async () => {},
    // Always votes, which is illegal in every phase except the vote.
    act: async (obs) => ({ seat: obs.you.seat, action: { type: 'vote', target: obs.you.seat }, reasoning: null }),
    notify: async () => {},
    finish: async () => null,
    close: async () => {},
  }

  const sink = new MemorySink()
  const result = await runGame({
    state, drivers, sink, setupEvents, deadlineMs: null, clock: fixedClock,
  })
  assert.equal(result.state.phase, 'ended')
  assert.ok(sink.events.some((e) => e.type === 'action_rejected'))
  assert.equal(verify(sink.events).ok, true, 'a rejected action must not corrupt the log')
})

test('observation is scoped to the current game and carries no memory', async () => {
  const { state } = await play('scope')
  const obs = observe(state, state.seats[0]!.id)
  assert.ok(!('memory' in obs))
  assert.ok(!('match' in obs), 'match structure is not a seat-visible concept')
})

test('reserved interfaces exist without being wired into the single-game path', async () => {
  const d = new ScriptedDriver({ seat: 'seat-1' })
  assert.equal(typeof d.startGame, 'function')
  assert.equal(typeof d.endGame, 'function')
  const { log } = await play('reserved')
  assert.equal(
    log.filter((e) => e.type === ('persistent_memory_updated' as never)).length,
    0,
    'milestone 1 must not emit memory events',
  )
})
