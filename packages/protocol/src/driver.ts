import type { SeatId } from './ids.ts'
import type { Faction } from './roles.ts'
import type { Observation } from './observation.ts'
import type { Submission } from './actions.ts'
import type { MatchContext } from './match.ts'

/**
 * Private state a seat may carry from one game to the next inside a match.
 *
 * Reserved, not implemented. Intended for opponent models, hypotheses, evidence
 * and revisions — never a raw transcript dump, which is explicitly not the
 * benchmark. Visible only to the owning seat; must never leak through observe().
 */
export interface PersistentMemory {
  version: 1
  content: unknown
}

export interface SeatInitContext {
  seat: SeatId
  /** Every seat at the table, by generic name. Never says who is agent or human. */
  table: { seat: SeatId; name: string }[]
  match: MatchContext
}

export interface GameStartContext {
  seat: SeatId
  match: MatchContext
}

export interface GameOutcome {
  /** null when the game ended in a stalemate rather than a win. */
  winner: Faction | null
  reason: 'win' | 'stalemate'
  survivors: SeatId[]
  /** Ground truth, released only once the game is over. */
  finalRoles: { seat: SeatId; role: string }[]
}

export interface RevealRating {
  seat: SeatId
  score: number
  note: string
}

/**
 * The seat contract. A human seat and an agent seat implement the same thing;
 * only the interface layer behind it differs.
 *
 * `startGame` / `endGame` are optional and unused by the single-game runner.
 * They are the hooks where a future match runtime resets or carries persistent
 * memory. The match runtime — not the engine — owns that decision.
 */
export interface SeatDriver {
  readonly kind: 'scripted' | 'agent' | 'human'
  init(ctx: SeatInitContext): Promise<void>
  startGame?(ctx: GameStartContext): Promise<void>
  act(obs: Observation): Promise<Submission>
  notify(obs: Observation): Promise<void>
  endGame?(obs: Observation, outcome: GameOutcome): Promise<void>
  // NOTE: `outcome` is typed as specified in the design brief. It reads as
  // though it should be GameOutcome; flagged in docs/DESIGN.md §10.1 rather
  // than changed silently.
  finish(obs: Observation, outcome: RevealRating[]): Promise<RevealRating[] | null>
  close(): Promise<void>
}
