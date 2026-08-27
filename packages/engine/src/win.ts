import { factionOf, type Faction, type GameState } from '@mafia/protocol'

/**
 * Mafia win at parity (living mafia >= living town); town win when no mafia
 * remain. Checked after dawn and after execution.
 */
export function checkWin(state: GameState): Faction | null {
  const living = state.seats.filter((s) => s.alive)
  const mafia = living.filter((s) => factionOf(s.role) === 'mafia').length
  const town = living.length - mafia
  if (mafia === 0) return 'town'
  if (mafia >= town) return 'mafia'
  return null
}
