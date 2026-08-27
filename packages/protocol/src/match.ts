import type { GameIndex, MatchId, SeatId } from './ids.ts'

/**
 * Match-level identity. Carried on every game and stamped onto every log event
 * from day one, even though Milestone 1 only ever runs single-game matches.
 *
 * A standalone game sets `matchId = roomId` and `gameIndex = 0`.
 */
export interface MatchContext {
  matchId: MatchId
  gameIndex: GameIndex
  matchSeed: string
  gameSeed: string
  persistentSeats: SeatId[]
}

/**
 * Deterministic game seed for position `gameIndex` in a match.
 *
 * The result is also logged explicitly in `game_created`, so a schedule stays
 * reconstructible even if this function later changes.
 */
export function deriveGameSeed(matchSeed: string, gameIndex: GameIndex): string {
  return `${matchSeed}/g${gameIndex}`
}
