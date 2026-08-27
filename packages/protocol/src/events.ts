import type { GameIndex, MatchId, RoomId, SeatId } from './ids.ts'
import type { Phase } from './state.ts'

export type Visibility = 'public' | 'omniscient' | { seats: SeatId[] }

export type EventType =
  // lifecycle
  | 'game_created'
  | 'run_metadata'
  | 'seat_bound'
  | 'role_assigned'
  | 'mafia_introduced'
  | 'phase_changed'
  | 'game_ended'
  // talk
  | 'message_sent'
  | 'mafia_message_sent'
  | 'passed'
  // night
  | 'night_action_submitted'
  | 'investigation_result'
  | 'night_resolved'
  // day
  | 'vote_cast'
  | 'vote_tallied'
  | 'seat_died'
  // agent internals
  | 'reasoning_recorded'
  | 'attempts_recorded'
  | 'action_rejected'
  | 'timeout'

/**
 * Records which model actually occupied a seat, and how faithfully that
 * provider exposes reasoning.
 *
 * Omniscient: no seat may learn what backs another seat, or whether it is an
 * agent at all. Without this a rating cannot be defended after the fact — you
 * would not know what served the seat, nor whether a missing reasoning trace
 * meant the model hid it or the provider withheld it.
 */

/** What the engine emits: no seq, no ids, no timestamp. The room stamps those. */
export interface EngineEvent {
  day: number
  phase: Phase
  actor: SeatId | null
  type: EventType
  visibility: Visibility
  payload: Record<string, unknown>
}

/** One line of the JSONL log. */
export interface EventEnvelope extends EngineEvent {
  seq: number
  roomId: RoomId
  matchId: MatchId
  gameIndex: GameIndex
  /** Metadata only — never read by the engine, so replay stays deterministic. */
  ts: string
  /**
   * Tamper-evidence: sha256 over the previous event's hash plus this
   * envelope (ts included, hash excluded). Recomputable by anyone holding
   * the file; a published final hash pins the whole transcript. This is
   * integrity after publication, not provenance — it proves a log was not
   * altered since its root was published, not that providers said what the
   * log says they said.
   */
  hash?: string
}

export function isVisibleTo(visibility: Visibility, seat: SeatId): boolean {
  if (visibility === 'public') return true
  if (visibility === 'omniscient') return false
  return visibility.seats.includes(seat)
}

/**
 * Event types that carry a seat's submitted action, in the order needed to
 * rebuild it. Replay re-steps exactly these; everything else is derived.
 */
export const ACTION_EVENTS: ReadonlySet<EventType> = new Set<EventType>([
  'message_sent',
  'mafia_message_sent',
  'passed',
  'vote_cast',
  'night_action_submitted',
])
