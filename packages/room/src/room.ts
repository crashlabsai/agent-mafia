import {
  type EventEnvelope,
  type GameOutcome,
  type GameState,
  type SeatDriver,
  type SeatId,
  type Submission,
} from '@mafia/protocol'
import { defaultActionFor, isOnClock, observe, step } from '@mafia/engine'
import { EventWriter, type EventSink } from './log.ts'
import { withDeadline } from './deadline.ts'

export interface RunGameOptions {
  state: GameState
  drivers: Record<SeatId, SeatDriver>
  sink: EventSink
  /** Per-wake budget in ms. null disables the deadline entirely. */
  deadlineMs?: number | null
  clock: (seq: number) => string
  /** Engine events produced by createGame, written before the loop starts. */
  setupEvents?: Parameters<EventWriter['write']>[1]
}

export interface GameResult {
  state: GameState
  events: EventEnvelope[]
  outcome: GameOutcome
}

/**
 * Drive one game to completion.
 *
 * The runtime decides only who to ask and when to stop waiting. Every rule —
 * legality, resolution, phase transitions, win conditions — lives in the engine.
 */
export async function runGame(opts: RunGameOptions): Promise<GameResult> {
  const { drivers, sink, clock } = opts
  const deadlineMs = opts.deadlineMs === undefined ? 30_000 : opts.deadlineMs
  const writer = new EventWriter(sink, clock)
  const all: EventEnvelope[] = []

  let state = opts.state
  if (opts.setupEvents) all.push(...writer.write(state, opts.setupEvents))

  for (const seat of state.seats) {
    await driverFor(drivers, seat.id).init({
      seat: seat.id,
      table: state.seats.map((s) => ({ seat: s.id, name: s.name })),
      match: state.match,
    })
  }

  let guard = 0
  while (state.phase !== 'ended') {
    if (guard++ > 10_000) throw new Error('room loop did not terminate')
    const pending = state.pending
    if (!pending) throw new Error(`no pending collection in phase ${state.phase}`)

    if (pending.mode === 'sequential') {
      // Only the seat at the head is on the clock; it sees everything said by
      // the seats before it.
      const seat = pending.awaiting[0]
      if (!seat) throw new Error('sequential pending with no seats')
      const applied = await ask(state, seat, drivers, deadlineMs)
      state = commit(state, applied, writer, all)
    } else {
      // Sealed: every observation is taken from the same snapshot, before any
      // submission lands, so nobody can react to anybody within the phase.
      const snapshot = state
      const seats = [...pending.awaiting]
      const subs = await Promise.all(seats.map((s) => ask(snapshot, s, drivers, deadlineMs)))
      for (const sub of subs) state = commit(state, sub, writer, all)
    }
  }

  const outcome: GameOutcome = {
    winner: state.winner,
    reason: state.endedReason ?? 'win',
    survivors: state.seats.filter((s) => s.alive).map((s) => s.id),
    finalRoles: state.seats.map((s) => ({ seat: s.id, role: s.role })),
  }

  for (const seat of state.seats) {
    const d = driverFor(drivers, seat.id)
    const obs = observe(state, seat.id)
    await d.endGame?.(obs, outcome)
    await d.close()
  }

  return { state, events: all, outcome }
}

function driverFor(drivers: Record<SeatId, SeatDriver>, seat: SeatId): SeatDriver {
  const d = drivers[seat]
  if (!d) throw new Error(`no driver for ${seat}`)
  return d
}

async function ask(
  state: GameState,
  seat: SeatId,
  drivers: Record<SeatId, SeatDriver>,
  deadlineMs: number | null,
): Promise<Submission> {
  const obs = observe(state, seat, deadlineMs)
  const fallback = (): Submission => ({
    seat,
    action: defaultActionFor(state),
    reasoning: null,
    timedOut: true,
    defaultCause: 'deadline',
  })
  const { value, timedOut, error } = await withDeadline(
    driverFor(drivers, seat).act(obs),
    deadlineMs,
    fallback,
  )
  if (error) {
    // Surface immediately: a driver failing every wake would otherwise only
    // show up as a table that mysteriously never speaks.
    process.stderr.write(`[${seat}] driver error: ${error}\n`)
  }
  // Never trust a driver to report its own seat.
  return {
    ...value,
    seat,
    ...(timedOut || error ? { timedOut: true } : {}),
    ...(timedOut && !value.timedOut ? { defaultCause: 'deadline' as const } : {}),
    ...(error && !value.timedOut ? { defaultCause: 'provider_error' as const } : {}),
    ...(error ? { driverError: error } : {}),
  }
}

/**
 * Apply one submission. If the engine rejects it the seat is still on the
 * clock, so the phase default is applied instead — a misbehaving driver costs
 * itself a turn rather than hanging the room.
 */
function commit(
  state: GameState,
  sub: Submission,
  writer: EventWriter,
  all: EventEnvelope[],
): GameState {
  const first = step(state, sub)
  all.push(...writer.write(first.state, first.events))
  let next = first.state

  // Rejection is the only reason to force a default. "Still on the clock" is
  // not a usable signal: a seat whose action advanced the phase is often on the
  // clock again immediately, for the next one.
  const rejected = first.events.some((e) => e.type === 'action_rejected')
  if (rejected && isOnClock(next, sub.seat)) {
    const forced = step(next, {
      seat: sub.seat,
      action: defaultActionFor(next),
      reasoning: null,
      timedOut: true,
      defaultCause: 'noncompliance',
    })
    all.push(...writer.write(forced.state, forced.events))
    next = forced.state
  }
  return next
}
