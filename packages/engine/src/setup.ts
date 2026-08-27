import {
  DEFAULT_CONFIG,
  deriveGameSeed,
  factionOf,
  validateConfig,
  type EngineEvent,
  type GameState,
  type MatchContext,
  type Role,
  type SeatId,
  type SeatState,
  type TableConfig,
} from '@mafia/protocol'
import { shuffle } from './rng.ts'
import { dealNames } from './names.ts'

export interface CreateGameOptions {
  roomId: string
  /** Defaults to a standalone match: matchId = roomId, gameIndex = 0. */
  match?: Partial<MatchContext>
  matchSeed: string
  config?: TableConfig
}

/**
 * Deal roles and open the game on Night 1.
 *
 * Role assignment is a function of `gameSeed` alone — never of seat identity,
 * driver type, or arrival order. That is the mechanical guarantee that roles
 * reshuffle independently of who occupies a seat, which is what a future
 * continual-learning result depends on.
 */
export function createGame(opts: CreateGameOptions): { state: GameState; events: EngineEvent[] } {
  const config = opts.config ?? DEFAULT_CONFIG
  validateConfig(config)

  const gameIndex = opts.match?.gameIndex ?? 0
  const matchId = opts.match?.matchId ?? opts.roomId
  const gameSeed = opts.match?.gameSeed ?? deriveGameSeed(opts.matchSeed, gameIndex)

  const ids: SeatId[] = Array.from({ length: config.seatCount }, (_, i) => `seat-${i + 1}`)

  const deck: Role[] = []
  for (const [role, count] of Object.entries(config.roles)) {
    for (let i = 0; i < count; i++) deck.push(role as Role)
  }

  const dealt = shuffle(deck, gameSeed, 0)
  const named = dealNames(config.seatCount, gameSeed, dealt.counter)
  const seats: SeatState[] = ids.map((id, i) => ({
    id,
    name: named.value[i] as string,
    role: dealt.value[i] as Role,
    alive: true,
    diedOn: null,
  }))

  const match: MatchContext = {
    matchId,
    gameIndex,
    matchSeed: opts.matchSeed,
    gameSeed,
    persistentSeats: opts.match?.persistentSeats ?? ids,
  }

  const state: GameState = {
    roomId: opts.roomId,
    match,
    config,
    seed: gameSeed,
    rngCounter: named.counter,
    day: 1,
    phase: 'night_chat',
    seats,
    chat: [],
    history: [],
    investigations: [],
    night: { kills: {}, protect: null, investigate: null },
    nightChatPass: 0,
    discussionRound: null,
    discussionOrder: null,
    votes: {},
    lastProtected: null,
    pending: null,
    winner: null,
    quietDays: 0,
    endedReason: null,
  }

  const mafiaIds = seats.filter((s) => factionOf(s.role) === 'mafia').map((s) => s.id)

  const events: EngineEvent[] = [
    {
      day: 1,
      phase: 'night_chat',
      actor: null,
      type: 'game_created',
      visibility: 'public',
      payload: {
        schemaVersion: config.schemaVersion,
        config,
        matchSeed: match.matchSeed,
        gameSeed: match.gameSeed,
        persistentSeats: match.persistentSeats,
        seats: seats.map((s) => ({ id: s.id, name: s.name })),
      },
    },
    ...seats.map(
      (s): EngineEvent => ({
        day: 1,
        phase: 'night_chat',
        actor: s.id,
        type: 'role_assigned',
        visibility: 'omniscient',
        payload: { seat: s.id, role: s.role, faction: factionOf(s.role) },
      }),
    ),
    {
      day: 1,
      phase: 'night_chat',
      actor: null,
      type: 'mafia_introduced',
      visibility: { seats: mafiaIds },
      payload: { fellowMafia: mafiaIds },
    },
  ]

  state.pending = { mode: 'sequential', awaiting: mafiaIds }
  return { state, events }
}
