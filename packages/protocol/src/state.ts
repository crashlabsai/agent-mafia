import type { RoomId, SeatId } from './ids.ts'
import type { Role, Faction } from './roles.ts'
import type { TableConfig } from './config.ts'
import type { MatchContext } from './match.ts'

export type Phase =
  | 'night_chat'
  | 'night_actions'
  | 'dawn'
  | 'discussion'
  | 'vote'
  | 'execution'
  | 'ended'

export type DeathCause = 'kill' | 'execution'

export interface SeatState {
  id: SeatId
  name: string
  role: Role
  alive: boolean
  diedOn: { day: number; cause: DeathCause } | null
}

export interface ChatMessage {
  day: number
  channel: 'public' | 'mafia'
  seat: SeatId
  text: string
  /** Which discussion round produced this, or null for the mafia night channel. */
  discussionRound: number | null
}

export type PublicEntry =
  | { kind: 'death'; day: number; seat: SeatId; role: Role | null; cause: DeathCause }
  | { kind: 'no_death'; day: number }
  | { kind: 'silence'; day: number; seat: SeatId; discussionRound: number | null }
  | {
      kind: 'vote_tally'
      day: number
      tally: Record<SeatId, number>
      abstain: number
      executed: SeatId | null
      tie: boolean
    }

export interface InvestigationResult {
  day: number
  detective: SeatId
  target: SeatId
  result: 'mafia' | 'not mafia'
}

/** Sealed night submissions for the current night. Cleared at dawn. */
export interface NightBuffer {
  /** mafia seat -> kill target (or null for an explicit no-action). */
  kills: Record<SeatId, SeatId | null>
  protect: { seat: SeatId; target: SeatId } | null
  investigate: { seat: SeatId; target: SeatId } | null
}

/**
 * Who the engine is waiting on, and how it collects.
 *
 * `sequential` — only `awaiting[0]` is on the clock; each actor sees what the
 * previous ones did. `simultaneous` — all of `awaiting` submit sealed, and
 * nothing resolves until every one is in.
 */
export interface PendingCollection {
  mode: 'sequential' | 'simultaneous'
  awaiting: SeatId[]
}

export interface GameState {
  roomId: RoomId
  match: MatchContext
  config: TableConfig
  /** Always equal to `match.gameSeed`; role assignment depends on this alone. */
  seed: string
  /** Held in state so replay reproduces RNG position exactly. */
  rngCounter: number
  day: number
  phase: Phase
  seats: SeatState[]
  chat: ChatMessage[]
  history: PublicEntry[]
  investigations: InvestigationResult[]
  night: NightBuffer
  /** Completed passes through the mafia channel this night. */
  nightChatPass: number
  /** Which pass through the speaking order is underway, 1-based. */
  discussionRound: number | null
  /** Speaking order for the current day; the anchor rotates each day. */
  discussionOrder: SeatId[] | null
  votes: Record<SeatId, SeatId | null>
  /** Supports `doctorMayRepeatTarget: false`. */
  lastProtected: SeatId | null
  pending: PendingCollection | null
  winner: Faction | null
  /** Consecutive completed cycles in which nobody died. */
  quietDays: number
  /** Why the game stopped. 'stalemate' means nobody won. */
  endedReason: 'win' | 'stalemate' | null
}

export function seatOf(state: GameState, id: SeatId): SeatState {
  const s = state.seats.find((x) => x.id === id)
  if (!s) throw new Error(`unknown seat ${id}`)
  return s
}

export function livingSeats(state: GameState): SeatState[] {
  return state.seats.filter((s) => s.alive)
}
