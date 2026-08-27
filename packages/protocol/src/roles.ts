export const ROLES = ['mafia', 'doctor', 'detective', 'villager'] as const
export type Role = (typeof ROLES)[number]

export type Faction = 'mafia' | 'town'

export function factionOf(role: Role): Faction {
  return role === 'mafia' ? 'mafia' : 'town'
}
