import {
  factionOf,
  livingSeats,
  seatOf,
  targetOf,
  type EngineEvent,
  type GameState,
  type PublicEntry,
  type SeatId,
  type Submission,
} from '@mafia/protocol'
import { illegalReason } from './legal.ts'
import { pick } from './rng.ts'
import { checkWin } from './win.ts'

export interface StepResult {
  state: GameState
  events: EngineEvent[]
}

function clone(state: GameState): GameState {
  return structuredClone(state)
}

function ev(
  s: GameState,
  type: EngineEvent['type'],
  visibility: EngineEvent['visibility'],
  payload: Record<string, unknown>,
  actor: SeatId | null = null,
): EngineEvent {
  return { day: s.day, phase: s.phase, actor, type, visibility, payload }
}

function mafiaIds(s: GameState): SeatId[] {
  return livingSeats(s).filter((x) => factionOf(x.role) === 'mafia').map((x) => x.id)
}

/**
 * The single entry point. All rules live here; the runtime only decides who to
 * ask and when to give up waiting.
 *
 * Submissions are buffered into `pending`; when the phase's collection is
 * satisfied the engine resolves it and advances, emitting resolution events.
 * Simultaneous-sealed phases therefore need no special runtime path.
 *
 * An illegal action never throws and never ends the game — it is rejected and
 * the seat stays on the clock, so a misbehaving model cannot crash a room.
 */
export function step(state: GameState, sub: Submission): StepResult {
  const s = clone(state)
  const events: EngineEvent[] = []

  if (sub.attempts && sub.attempts.length > 0) {
    events.push(
      ev(s, 'attempts_recorded', 'omniscient', { seat: sub.seat, attempts: sub.attempts }, sub.seat),
    )
  }
  if (sub.reasoning) {
    events.push(ev(s, 'reasoning_recorded', 'omniscient', { seat: sub.seat, text: sub.reasoning }, sub.seat))
  }
  if (sub.timedOut) {
    // A public timeout during a night phase would tell the table this seat
    // holds a night-capable role — the same leak class as night passes. The
    // seat itself still learns it was defaulted; the grader sees everything.
    const nightPhase = s.phase === 'night_chat' || s.phase === 'night_actions'
    events.push(
      ev(
        s,
        'timeout',
        nightPhase ? { seats: [sub.seat] } : 'public',
        {
          seat: sub.seat,
          phase: s.phase,
          defaultApplied: sub.action.type,
          ...(sub.defaultCause ? { cause: sub.defaultCause } : {}),
          ...(sub.driverError ? { error: sub.driverError } : {}),
        },
        sub.seat,
      ),
    )
  }

  const bad = illegalReason(s, sub.seat, sub.action)
  if (bad) {
    events.push(
      ev(s, 'action_rejected', { seats: [sub.seat] }, { attempted: sub.action, reason: bad }, sub.seat),
    )
    return { state: s, events }
  }

  applyAction(s, sub, events)

  if (s.pending) {
    s.pending.awaiting = s.pending.awaiting.filter((id) => id !== sub.seat)
    if (s.pending.awaiting.length === 0) s.pending = null
  }

  advance(s, events)
  return { state: s, events }
}

function applyAction(s: GameState, sub: Submission, events: EngineEvent[]): void {
  const a = sub.action
  switch (a.type) {
    case 'mafia_chat':
      s.chat.push({ day: s.day, channel: 'mafia', seat: sub.seat, text: a.text, discussionRound: null })
      events.push(ev(s, 'mafia_message_sent', { seats: mafiaIds(s) }, { text: a.text }, sub.seat))
      return

    case 'speak':
      s.chat.push({
        day: s.day,
        channel: 'public',
        seat: sub.seat,
        text: a.text,
        discussionRound: s.discussionRound,
      })
      events.push(
        ev(s, 'message_sent', 'public', { text: a.text, discussionRound: s.discussionRound }, sub.seat),
      )
      return

    case 'pass':
      if (s.phase === 'night_chat') {
        // A pass in the mafia channel is mafia-only information: stamping it
        // public would out the passer to any seat-scoped replay.
        events.push(ev(s, 'passed', { seats: mafiaIds(s) }, { discussionRound: null }, sub.seat))
        return
      }
      // Silence at the table is public and the table must actually see it —
      // it enters the history so briefings can say who said nothing.
      s.history.push({ kind: 'silence', day: s.day, seat: sub.seat, discussionRound: s.discussionRound })
      events.push(ev(s, 'passed', 'public', { discussionRound: s.discussionRound }, sub.seat))
      return

    case 'vote':
      s.votes[sub.seat] = a.target
      events.push(ev(s, 'vote_cast', 'omniscient', { seat: sub.seat, target: a.target }, sub.seat))
      return

    case 'night_kill':
      s.night.kills[sub.seat] = a.target
      events.push(
        ev(s, 'night_action_submitted', 'omniscient', { seat: sub.seat, action: a.type, target: a.target }, sub.seat),
      )
      return

    case 'night_protect':
      s.night.protect = { seat: sub.seat, target: a.target }
      events.push(
        ev(s, 'night_action_submitted', 'omniscient', { seat: sub.seat, action: a.type, target: a.target }, sub.seat),
      )
      return

    case 'night_investigate':
      s.night.investigate = { seat: sub.seat, target: a.target }
      events.push(
        ev(s, 'night_action_submitted', 'omniscient', { seat: sub.seat, action: a.type, target: a.target }, sub.seat),
      )
      return

    case 'no_action':
      if (s.phase === 'night_actions' && seatOf(s, sub.seat).role === 'mafia') {
        s.night.kills[sub.seat] = null
      }
      events.push(
        ev(s, 'night_action_submitted', 'omniscient', { seat: sub.seat, action: 'no_action', target: null }, sub.seat),
      )
      return
  }
}

function setPhase(s: GameState, phase: GameState['phase'], events: EngineEvent[]): void {
  const from = s.phase
  s.phase = phase
  events.push(ev(s, 'phase_changed', 'public', { from, to: phase, day: s.day }))
}

/** Run the phase machine forward until it needs input, or the game is over. */
function advance(s: GameState, events: EngineEvent[]): void {
  for (let guard = 0; guard < 64; guard++) {
    if (s.pending !== null || s.phase === 'ended') return

    switch (s.phase) {
      case 'night_chat': {
        s.nightChatPass += 1
        const mafia = mafiaIds(s)
        if (s.nightChatPass < s.config.mafiaChatPasses && mafia.length > 0) {
          s.pending = { mode: 'sequential', awaiting: mafia }
          return
        }
        setPhase(s, 'night_actions', events)
        s.pending = { mode: 'simultaneous', awaiting: nightActors(s) }
        return
      }

      case 'night_actions':
        setPhase(s, 'dawn', events)
        break

      case 'dawn':
        resolveDawn(s, events)
        if (endIfWon(s, events)) return
        setPhase(s, 'discussion', events)
        startDiscussion(s, 1)
        return

      case 'discussion': {
        const current = s.discussionRound
        if (current !== null && current < s.config.discussionRounds) {
          startDiscussion(s, current + 1)
          return
        }
        setPhase(s, 'vote', events)
        s.votes = {}
        s.pending = { mode: 'simultaneous', awaiting: livingSeats(s).map((x) => x.id) }
        return
      }

      case 'vote':
        setPhase(s, 'execution', events)
        break

      case 'execution':
        resolveExecution(s, events)
        if (endIfWon(s, events)) return
        if (endIfStalled(s, events)) return
        s.day += 1
        setPhase(s, 'night_chat', events)
        s.night = { kills: {}, protect: null, investigate: null }
        s.nightChatPass = 0
        s.discussionRound = null
        s.discussionOrder = null
        s.pending = { mode: 'sequential', awaiting: mafiaIds(s) }
        return

      default:
        return
    }
  }
  throw new Error('phase machine failed to settle')
}

/** Living seats that owe a sealed night submission. */
function nightActors(s: GameState): SeatId[] {
  return livingSeats(s)
    .filter((x) => x.role === 'mafia' || x.role === 'doctor' || x.role === 'detective')
    .map((x) => x.id)
}

function startDiscussion(s: GameState, discussionRound: number): void {
  const living = livingSeats(s).map((x) => x.id)
  // The speaking anchor rotates each day, so last-speaker advantage is spread
  // across seats rather than fixed to one.
  const offset = (s.day - 1) % Math.max(1, living.length)
  const order = [...living.slice(offset), ...living.slice(0, offset)]
  s.discussionRound = discussionRound
  s.discussionOrder = order
  s.pending = { mode: 'sequential', awaiting: order }
}

function resolveDawn(s: GameState, events: EngineEvent[]): void {
  // 1. Investigation resolves against the pre-night state.
  const inv = s.night.investigate
  if (inv) {
    const target = seatOf(s, inv.target)
    const result = factionOf(target.role) === 'mafia' ? 'mafia' : 'not mafia'
    s.investigations.push({ day: s.day, detective: inv.seat, target: inv.target, result })
    events.push(
      ev(s, 'investigation_result', { seats: [inv.seat] }, { target: inv.target, result }, inv.seat),
    )
  }

  // 2. Kill target is the plurality of mafia submissions; ties broken by seed.
  const votes = Object.values(s.night.kills).filter((t): t is SeatId => t !== null)
  let killed: SeatId | null = null
  if (votes.length > 0) {
    const tally = new Map<SeatId, number>()
    for (const t of votes) tally.set(t, (tally.get(t) ?? 0) + 1)
    const top = Math.max(...tally.values())
    const leaders = [...tally.entries()].filter(([, n]) => n === top).map(([id]) => id).sort()
    if (leaders.length === 1) {
      killed = leaders[0] as SeatId
    } else {
      const p = pick(leaders, s.seed, s.rngCounter)
      s.rngCounter = p.counter
      killed = p.value
    }
  }

  // 3. Doctor protection.
  const protectedSeat = s.night.protect?.target ?? null
  s.lastProtected = protectedSeat
  const saved = killed !== null && protectedSeat === killed
  if (saved) killed = null

  // 4. Announce.
  if (killed) {
    kill(s, killed, 'kill', events)
  } else {
    s.history.push({ kind: 'no_death', day: s.day })
  }
  events.push(ev(s, 'night_resolved', 'public', { killed, protected: saved }))
}

function resolveExecution(s: GameState, events: EngineEvent[]): void {
  const tally: Record<SeatId, number> = {}
  let abstain = 0
  for (const voter of livingSeats(s)) {
    const t = s.votes[voter.id] ?? null
    if (t === null) abstain += 1
    else tally[t] = (tally[t] ?? 0) + 1
  }

  const counts = Object.values(tally)
  const top = counts.length ? Math.max(...counts) : 0
  const leaders = Object.entries(tally).filter(([, n]) => n === top).map(([id]) => id)
  // A tie executes nobody: deterministic, and a genuine strategic outcome.
  const tie = leaders.length !== 1
  const executed = top > 0 && !tie ? (leaders[0] as SeatId) : null

  const entry: PublicEntry = { kind: 'vote_tally', day: s.day, tally, abstain, executed, tie }
  s.history.push(entry)
  events.push(ev(s, 'vote_tallied', 'public', { tally, abstain, executed, tie }))

  if (executed) kill(s, executed, 'execution', events)
}

function kill(s: GameState, id: SeatId, cause: 'kill' | 'execution', events: EngineEvent[]): void {
  const seat = seatOf(s, id)
  seat.alive = false
  seat.diedOn = { day: s.day, cause }
  const role = s.config.revealRoleOnDeath ? seat.role : null
  s.history.push({ kind: 'death', day: s.day, seat: id, role, cause })
  events.push(ev(s, 'seat_died', 'public', { seat: id, role, cause, day: s.day }, id))
}

/**
 * A cycle in which nobody dies moves nothing. Enough of them in a row and the
 * game cannot progress — mafia declining to kill and the table declining to
 * execute is a stable loop. Ending it as a stalemate keeps the environment
 * bounded without forcing anyone to act.
 */
function endIfStalled(s: GameState, events: EngineEvent[]): boolean {
  const diedToday = s.history.some((h) => h.kind === 'death' && h.day === s.day)
  s.quietDays = diedToday ? 0 : s.quietDays + 1

  const stalled = s.quietDays >= s.config.maxQuietDays
  const overrun = s.day >= s.config.maxDays
  if (!stalled && !overrun) return false

  s.winner = null
  s.endedReason = 'stalemate'
  s.pending = null
  setPhase(s, 'ended', events)
  events.push(
    ev(s, 'game_ended', 'public', {
      winner: null,
      reason: 'stalemate',
      cause: stalled ? `${s.quietDays} quiet cycles` : `reached day ${s.day}`,
      survivors: livingSeats(s).map((x) => x.id),
      finalRoles: s.seats.map((x) => ({ seat: x.id, role: x.role })),
    }),
  )
  return true
}

function endIfWon(s: GameState, events: EngineEvent[]): boolean {
  const winner = checkWin(s)
  if (!winner) return false
  s.winner = winner
  s.endedReason = 'win'
  s.pending = null
  setPhase(s, 'ended', events)
  events.push(
    ev(s, 'game_ended', 'public', {
      winner,
      reason: 'win',
      survivors: livingSeats(s).map((x) => x.id),
      finalRoles: s.seats.map((x) => ({ seat: x.id, role: x.role })),
    }),
  )
  return true
}
