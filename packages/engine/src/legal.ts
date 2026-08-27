import {
  factionOf,
  livingSeats,
  seatOf,
  type Action,
  type GameState,
  type LegalActionSpec,
  type SeatId,
} from '@mafia/protocol'

/** Is this seat on the clock right now? */
export function isOnClock(state: GameState, seat: SeatId): boolean {
  const p = state.pending
  if (!p) return false
  return p.mode === 'sequential' ? p.awaiting[0] === seat : p.awaiting.includes(seat)
}

/** Every seat the engine is currently waiting on. */
export function pendingSeats(state: GameState): SeatId[] {
  const p = state.pending
  if (!p) return []
  return p.mode === 'sequential' ? p.awaiting.slice(0, 1) : [...p.awaiting]
}

function livingIds(state: GameState): SeatId[] {
  return livingSeats(state).map((s) => s.id)
}

export function legalActions(state: GameState, seat: SeatId): LegalActionSpec[] {
  if (!isOnClock(state, seat)) return []
  const me = seatOf(state, seat)
  if (!me.alive) return []
  const max = state.config.messageMaxChars

  switch (state.phase) {
    case 'night_chat':
      return [
        { type: 'mafia_chat', maxChars: max },
        { type: 'pass' },
      ]

    case 'night_actions': {
      const others = livingIds(state).filter((id) => id !== seat)
      if (me.role === 'mafia') {
        const mafiaIds = new Set(
          livingSeats(state).filter((s) => factionOf(s.role) === 'mafia').map((s) => s.id),
        )
        return [
          { type: 'night_kill', targets: others.filter((id) => !mafiaIds.has(id)) },
          { type: 'no_action' },
        ]
      }
      if (me.role === 'doctor') {
        let targets = livingIds(state)
        if (!state.config.doctorMaySelfProtect) targets = targets.filter((id) => id !== seat)
        if (!state.config.doctorMayRepeatTarget && state.lastProtected) {
          targets = targets.filter((id) => id !== state.lastProtected)
        }
        return [{ type: 'night_protect', targets }, { type: 'no_action' }]
      }
      if (me.role === 'detective') {
        return [{ type: 'night_investigate', targets: others }, { type: 'no_action' }]
      }
      return [{ type: 'no_action' }]
    }

    case 'discussion':
      return [
        { type: 'speak', maxChars: max },
        { type: 'pass' },
      ]

    case 'vote':
      return [{ type: 'vote', targets: livingIds(state), allowNullTarget: true }]

    default:
      return []
  }
}

/** Why this action is not legal right now, or null if it is. */
export function illegalReason(state: GameState, seat: SeatId, action: Action): string | null {
  if (!isOnClock(state, seat)) return `seat ${seat} is not on the clock in phase ${state.phase}`
  const specs = legalActions(state, seat)
  const spec = specs.find((s) => s.type === action.type)
  if (!spec) return `action ${action.type} is not legal in phase ${state.phase}`

  if (spec.maxChars !== undefined) {
    const text = (action as { text?: string }).text ?? ''
    if (text.length === 0) return 'message text must not be empty'
    if (text.length > spec.maxChars) return `message exceeds ${spec.maxChars} characters`
  }

  if (action.type === 'vote') {
    if (action.target === null) {
      return spec.allowNullTarget ? null : 'abstain is not allowed'
    }
    return spec.targets?.includes(action.target) ? null : `${action.target} is not a legal vote target`
  }

  if (spec.targets) {
    const target = (action as { target?: SeatId }).target
    if (!target) return 'action requires a target'
    if (!spec.targets.includes(target)) return `${target} is not a legal target for ${action.type}`
  }
  return null
}

/** What the runtime submits on this seat's behalf when it misses its deadline. */
export function defaultActionFor(state: GameState): Action {
  switch (state.phase) {
    case 'night_chat':
    case 'discussion':
      return { type: 'pass' }
    case 'vote':
      return { type: 'vote', target: null }
    case 'night_actions':
      return { type: 'no_action' }
    default:
      return { type: 'pass' }
  }
}
