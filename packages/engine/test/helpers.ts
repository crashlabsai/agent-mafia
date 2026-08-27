import { DEFAULT_CONFIG, type GameState, type Role, type SeatId, type Submission, type TableConfig } from '@mafia/protocol'
import { createGame, step } from '../src/index.ts'

/** A game whose roles are pinned, so rules can be tested without seed-hunting. */
export function gameWithRoles(roles: Role[], overrides: Partial<TableConfig> = {}): GameState {
  const counts: Record<Role, number> = { mafia: 0, doctor: 0, detective: 0, villager: 0 }
  for (const r of roles) counts[r] += 1
  const config: TableConfig = {
    ...DEFAULT_CONFIG,
    seatCount: roles.length,
    roles: counts,
    ...overrides,
  }
  const { state } = createGame({ roomId: 'test-room', matchSeed: 'test', config })
  state.seats.forEach((s, i) => {
    s.role = roles[i] as Role
  })
  // Night chat opens with whoever is mafia under the pinned assignment.
  state.pending = {
    mode: 'sequential',
    awaiting: state.seats.filter((s) => s.role === 'mafia').map((s) => s.id),
  }
  return state
}

export function submit(state: GameState, seat: SeatId, action: Submission['action']): GameState {
  return step(state, { seat, action, reasoning: null }).state
}

/** Push every seat currently on the clock through one action. */
export function driveAll(
  state: GameState,
  choose: (state: GameState, seat: SeatId) => Submission['action'],
): GameState {
  let s = state
  let guard = 0
  const phase = s.phase
  while (s.pending && s.phase === phase && guard++ < 200) {
    const seat = s.pending.awaiting[0] as SeatId
    s = submit(s, seat, choose(s, seat))
  }
  return s
}

export function idOf(state: GameState, role: Role, nth = 0): SeatId {
  const found = state.seats.filter((s) => s.role === role)[nth]
  if (!found) throw new Error(`no ${role} #${nth}`)
  return found.id
}
