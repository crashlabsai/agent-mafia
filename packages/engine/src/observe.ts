import {
  factionOf,
  seatOf,
  type ActionRecord,
  type GameState,
  type Observation,
  type PublicSeatView,
  type SeatId,
} from '@mafia/protocol'
import { legalActions } from './legal.ts'

/**
 * The redaction chokepoint.
 *
 * Nothing reaches a seat except through this function. Parity between a human
 * seat and an agent seat is a property of that fact, not of anyone remembering
 * a rule — both are rendered from the object returned here.
 *
 * A role is only ever exposed if it belongs to the observer, or if it has
 * become public (revealed on death, or at game end).
 */
export function observe(
  state: GameState,
  seatId: SeatId,
  deadlineMs: number | null = null,
): Observation {
  const me = seatOf(state, seatId)
  const gameOver = state.winner !== null
  const iAmMafia = factionOf(me.role) === 'mafia'

  const seats: PublicSeatView[] = state.seats.map((s) => ({
    id: s.id,
    name: s.name,
    alive: s.alive,
    revealedRole: roleIsPublic(state, s.id, gameOver) ? s.role : null,
  }))

  const yourActions: ActionRecord[] = []
  for (const m of state.chat) {
    if (m.seat !== seatId) continue
    yourActions.push({
      day: m.day,
      phase: m.channel === 'mafia' ? 'night_chat' : 'discussion',
      type: m.channel === 'mafia' ? 'mafia_chat' : 'speak',
      target: null,
    })
  }

  return {
    you: {
      seat: me.id,
      name: me.name,
      role: me.role,
      faction: factionOf(me.role),
      alive: me.alive,
    },
    table: {
      day: state.day,
      phase: state.phase,
      seats,
      discussionRound: state.discussionRound,
      discussionRoundsTotal: state.config.discussionRounds,
      discussionOrder: state.discussionOrder,
    },
    publicChat: state.chat.filter((m) => m.channel === 'public'),
    privateChat: iAmMafia ? state.chat.filter((m) => m.channel === 'mafia') : [],
    knowledge: {
      fellowMafia: iAmMafia
        ? state.seats.filter((s) => factionOf(s.role) === 'mafia' && s.id !== seatId).map((s) => s.id)
        : [],
      investigations: state.investigations.filter((i) => i.detective === seatId),
      yourActions,
    },
    history: state.history,
    legalActions: legalActions(state, seatId),
    deadline: deadlineMs === null ? null : { msRemaining: deadlineMs },
  }
}

function roleIsPublic(state: GameState, id: SeatId, gameOver: boolean): boolean {
  if (gameOver) return true
  const s = seatOf(state, id)
  return !s.alive && state.config.revealRoleOnDeath
}
