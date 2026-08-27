import type { SeatId } from './ids.ts'
import type { Role, Faction } from './roles.ts'
import type { ActionType } from './actions.ts'
import type { ChatMessage, InvestigationResult, Phase, PublicEntry } from './state.ts'

export interface PublicSeatView {
  id: SeatId
  name: string
  alive: boolean
  /** Non-null only once the role is public: revealed on death, or at game end. */
  revealedRole: Role | null
}

export interface LegalActionSpec {
  type: ActionType
  /** Legal targets, when the action takes one. */
  targets?: SeatId[]
  /** Whether `null` (abstain) is accepted, for votes. */
  allowNullTarget?: boolean
  maxChars?: number
}

export interface ActionRecord {
  day: number
  phase: Phase
  type: ActionType
  target: SeatId | null
}

/**
 * Everything one seat can see, and nothing else.
 *
 * This is the parity object: the agent tool layer and the future browser UI are
 * both rendered from this, so a human seat and an agent seat are fed identical
 * information by construction rather than by policy.
 *
 * Scoped to the current game. It never carries cross-game persistent memory —
 * that belongs to the seat's driver, not to the engine.
 */
export interface Observation {
  you: {
    seat: SeatId
    name: string
    role: Role
    faction: Faction
    alive: boolean
  }
  table: {
    day: number
    phase: Phase
    seats: PublicSeatView[]
    /** Which pass through the speaking order is underway, 1-based. */
    discussionRound: number | null
    /** Passes per day, so a seat can tell the final pass from the first. */
    discussionRoundsTotal: number
    /** Today's speaking order. Public information: everyone hears the order. */
    discussionOrder: SeatId[] | null
  }
  publicChat: ChatMessage[]
  /** The mafia night channel, empty unless this seat is entitled to it. */
  privateChat: ChatMessage[]
  knowledge: {
    fellowMafia: SeatId[]
    investigations: InvestigationResult[]
    yourActions: ActionRecord[]
  }
  history: PublicEntry[]
  /** Empty when this seat is not on the clock. */
  legalActions: LegalActionSpec[]
  deadline: { msRemaining: number } | null
}
