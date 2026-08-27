import {
  ACTION_EVENTS,
  isVisibleTo,
  type Action,
  type EngineEvent,
  type EventEnvelope,
  type GameState,
  type SeatId,
  type Submission,
  type TableConfig,
} from '@mafia/protocol'
import { createGame, step } from '@mafia/engine'
import { HASH_CHAIN_GENESIS, chainHash, stableStringify } from './log.ts'

/**
 * Rebuild the action an action-bearing or rejected event came from.
 *
 * Replay re-steps these with the reasoning, attempt records and timeout state
 * gathered from the adjacent events, so re-stepping regenerates the complete
 * engine event stream — which is what lets verify compare every derived event
 * rather than only the outcome.
 */
function actionOf(e: EventEnvelope): Action | null {
  const p = e.payload as Record<string, unknown>
  switch (e.type) {
    case 'message_sent':
      return { type: 'speak', text: String(p['text']) }
    case 'mafia_message_sent':
      return { type: 'mafia_chat', text: String(p['text']) }
    case 'passed':
      return { type: 'pass' }
    case 'vote_cast':
      return { type: 'vote', target: (p['target'] as SeatId | null) ?? null }
    case 'night_action_submitted': {
      const kind = String(p['action'])
      const target = p['target'] as SeatId | null
      return kind === 'no_action'
        ? { type: 'no_action' }
        : ({ type: kind, target: target as SeatId } as Action)
    }
    case 'action_rejected':
      return p['attempted'] as Action
    default:
      return null
  }
}

/** Carried context that precedes an action event in the stream. */
interface PendingContext {
  reasoning: string | null
  attempts: Submission['attempts']
  timedOut: boolean
  defaultCause: Submission['defaultCause']
  driverError: string | undefined
}
const freshContext = (): PendingContext => ({
  reasoning: null,
  attempts: undefined,
  timedOut: false,
  defaultCause: undefined,
  driverError: undefined,
})

function submissionOf(e: EventEnvelope, ctx: PendingContext): Submission | null {
  if (!ACTION_EVENTS.has(e.type) && e.type !== 'action_rejected') return null
  if (!e.actor) return null
  const action = actionOf(e)
  if (!action) return null
  return {
    seat: e.actor,
    action,
    reasoning: ctx.reasoning,
    ...(ctx.attempts ? { attempts: ctx.attempts } : {}),
    ...(ctx.timedOut ? { timedOut: true } : {}),
    ...(ctx.defaultCause ? { defaultCause: ctx.defaultCause } : {}),
    ...(ctx.driverError ? { driverError: ctx.driverError } : {}),
  }
}

export interface ReplayResult {
  state: GameState
  /** Submissions actually re-applied, in log order. */
  applied: number
  /** Every engine event the replay regenerated, when collection was asked for. */
  regenerated: EngineEvent[]
}

/**
 * Reconstruct state by feeding the log back through the engine.
 *
 * Because the engine is a pure reducer with its RNG counter held in state, the
 * result is identical to the live run.
 */
export function replay(events: EventEnvelope[], upToSeq?: number, collect = false): ReplayResult {
  const created = events.find((e) => e.type === 'game_created')
  if (!created) throw new Error('log has no game_created event')
  const p = created.payload as Record<string, unknown>

  const { state: initial, events: setupEvents } = createGame({
    roomId: created.roomId,
    matchSeed: String(p['matchSeed']),
    config: p['config'] as TableConfig,
    match: {
      matchId: created.matchId,
      gameIndex: created.gameIndex,
      gameSeed: String(p['gameSeed']),
      persistentSeats: p['persistentSeats'] as SeatId[],
    },
  })

  let state = initial
  let applied = 0
  const regenerated: EngineEvent[] = collect ? [...setupEvents] : []
  let ctx = freshContext()
  for (const e of events) {
    if (upToSeq !== undefined && e.seq > upToSeq) break
    const p = e.payload as Record<string, unknown>
    // Stash the runtime-carried context that step() will re-emit.
    if (e.type === 'reasoning_recorded') { ctx.reasoning = String(p['text']); continue }
    if (e.type === 'attempts_recorded') { ctx.attempts = p['attempts'] as Submission['attempts']; continue }
    if (e.type === 'timeout') {
      ctx.timedOut = true
      if (typeof p['cause'] === 'string') ctx.defaultCause = p['cause'] as Submission['defaultCause']
      if (typeof p['error'] === 'string') ctx.driverError = p['error']
      continue
    }
    const sub = submissionOf(e, ctx)
    if (!sub) continue
    ctx = freshContext()
    const r = step(state, sub)
    state = r.state
    if (collect) regenerated.push(...r.events)
    applied += 1
  }
  return { state, applied, regenerated }
}

/** Replay a prefix, so play can continue from that point with new drivers. */
export function fork(events: EventEnvelope[], atSeq: number): GameState {
  return replay(events, atSeq).state
}

/** Exactly the events one seat could ever have seen. */
export function eventsVisibleTo(events: EventEnvelope[], seat: SeatId): EventEnvelope[] {
  return events.filter((e) => isVisibleTo(e.visibility, seat))
}

export interface VerifyReport {
  ok: boolean
  problems: string[]
  applied: number
  finalPhase: string
  winner: string | null
  /** The last event's chain hash — publish it to pin the transcript. */
  finalRoot: string | null
  /** True when the log predates hashing and was verified in legacy mode. */
  legacy: boolean
}

/**
 * Event types the engine cannot regenerate on replay: they are attested by
 * the runtime (which model sat where), not derived from submissions.
 */
const RUNTIME_ATTESTED: ReadonlySet<string> = new Set(['seat_bound', 'run_metadata'])

/**
 * Replay a log and check it three ways:
 *
 * 1. Envelope integrity — gapless seq, match identifiers, and (when the log
 *    carries hashes) the tamper-evidence chain recomputed end to end.
 * 2. Full-stream regeneration — every engine-derived event is re-produced by
 *    re-stepping the reconstructed submissions and compared field-for-field
 *    (ts and hash excluded; runtime-attested events like seat_bound excluded,
 *    since no replay can derive which model sat where).
 * 3. Outcome — winner, survivors and final roles against game_ended.
 *
 * What this proves: the log is internally consistent and unaltered since its
 * final hash was published. What it does not prove: that providers actually
 * said what the log records — those are external inputs, attested only by
 * retained response ids.
 */
export function verify(events: EventEnvelope[], opts: { legacy?: boolean } = {}): VerifyReport {
  const problems: string[] = []

  // Hashes are mandatory for any log the current schema wrote (run_metadata
  // marks those). Stripping hashes must fail verification, never soften it —
  // a log without a chain has no tamper evidence, and only explicitly
  // acknowledged legacy logs may skip it.
  const modern = events.some((e) => e.type === 'run_metadata') || events.some((e) => typeof e.hash === 'string')
  const legacy = !modern
  if (legacy && !opts.legacy) {
    problems.push('log carries no hash chain: pass legacy mode to verify without tamper evidence')
  }

  let prevHash = HASH_CHAIN_GENESIS
  let finalRoot: string | null = null
  events.forEach((e, i) => {
    if (e.seq !== i) problems.push(`seq ${e.seq} out of order at index ${i}`)
    if (e.matchId === undefined || e.gameIndex === undefined) {
      problems.push(`event ${e.seq} is missing match identifiers`)
    }
    if (modern) {
      if (typeof e.hash !== 'string') {
        problems.push(`event ${e.seq} is missing its chain hash`)
      } else {
        const { hash, ...bare } = e
        const want = chainHash(prevHash, bare)
        if (hash !== want) problems.push(`hash chain breaks at seq ${e.seq}`)
        prevHash = hash
        finalRoot = hash
      }
    }
  })

  const { state, applied, regenerated } = replay(events, undefined, true)

  // Compare the regenerated engine stream against the log, in order.
  const norm = (e: {
    day: number; phase: string; actor: unknown; type: string; visibility: unknown; payload: unknown
  }) =>
    stableStringify({
      day: e.day, phase: e.phase, actor: e.actor ?? null,
      type: e.type, visibility: e.visibility, payload: e.payload,
    })
  const derived = events.filter((e) => !RUNTIME_ATTESTED.has(e.type))
  if (derived.length !== regenerated.length) {
    problems.push(
      `event count mismatch: log has ${derived.length} derivable events, replay regenerated ${regenerated.length}`,
    )
  }
  const n = Math.min(derived.length, regenerated.length)
  for (let i = 0; i < n; i++) {
    const logged = derived[i] as EventEnvelope
    if (norm(logged) !== norm(regenerated[i] as EngineEvent)) {
      problems.push(`event ${logged.seq} (${logged.type}) does not match its regeneration`)
      if (problems.length > 8) { problems.push('…'); break }
    }
  }
  const ended = events.find((e) => e.type === 'game_ended')

  if (!ended) {
    problems.push('log has no game_ended event')
  } else {
    const p = ended.payload as Record<string, unknown>
    if ((p['winner'] ?? null) !== state.winner) {
      problems.push(`winner mismatch: log says ${String(p['winner'])}, replay says ${String(state.winner)}`)
    }
    const survivors = state.seats.filter((s) => s.alive).map((s) => s.id).sort()
    const logged = [...(p['survivors'] as SeatId[])].sort()
    if (JSON.stringify(survivors) !== JSON.stringify(logged)) {
      problems.push(`survivor mismatch: log ${JSON.stringify(logged)}, replay ${JSON.stringify(survivors)}`)
    }
    const roles = state.seats.map((s) => `${s.id}:${s.role}`).join(',')
    const loggedRoles = (p['finalRoles'] as { seat: string; role: string }[])
      .map((r) => `${r.seat}:${r.role}`)
      .join(',')
    if (roles !== loggedRoles) problems.push('final role assignment does not match replay')
  }

  return {
    ok: problems.length === 0,
    problems,
    applied,
    finalPhase: state.phase,
    winner: state.winner,
    finalRoot,
    legacy,
  }
}
