import type { Role } from './roles.ts'

export interface TableConfig {
  /** Total seats. Must equal the sum of `roles`. */
  seatCount: number
  /** Role multiset dealt at setup. */
  roles: Record<Role, number>
  /** Passes through the sequential discussion order, per day. */
  discussionRounds: number
  /** Passes through the mafia private channel, per night. */
  mafiaChatPasses: number
  revealRoleOnDeath: boolean
  doctorMaySelfProtect: boolean
  /** When false, the doctor may not protect the same seat on consecutive nights. */
  doctorMayRepeatTarget: boolean
  messageMaxChars: number
  /**
   * Consecutive cycles with no death before the game is called a stalemate.
   * Without this a table that never kills and never executes runs forever.
   */
  maxQuietDays: number
  /** Hard backstop on total cycles, whatever else happens. */
  maxDays: number
  /** Reserved. Must be false in v1 — sealed voting only. */
  openSequentialVoting: boolean
  schemaVersion: number
}

export const DEFAULT_CONFIG: TableConfig = {
  seatCount: 7,
  roles: { mafia: 2, doctor: 1, detective: 1, villager: 3 },
  discussionRounds: 2,
  mafiaChatPasses: 1,
  revealRoleOnDeath: true,
  doctorMaySelfProtect: true,
  doctorMayRepeatTarget: false,
  messageMaxChars: 1000,
  maxQuietDays: 3,
  maxDays: 20,
  openSequentialVoting: false,
  schemaVersion: 1,
}

export function validateConfig(c: TableConfig): void {
  const total = Object.values(c.roles).reduce((a, b) => a + b, 0)
  if (total !== c.seatCount) {
    throw new Error(`config: roles sum to ${total} but seatCount is ${c.seatCount}`)
  }
  if (c.roles.mafia < 1) throw new Error('config: need at least 1 mafia')
  if (c.roles.mafia * 2 >= c.seatCount) {
    throw new Error('config: mafia would start at or past parity, town cannot win')
  }
  if (c.discussionRounds < 1) throw new Error('config: discussionRounds must be >= 1')
  if (c.maxQuietDays < 1) throw new Error('config: maxQuietDays must be >= 1')
  if (c.maxDays < 1) throw new Error('config: maxDays must be >= 1')
  if (c.openSequentialVoting) throw new Error('config: openSequentialVoting is reserved, not implemented')
}
