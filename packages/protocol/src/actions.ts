import type { SeatId } from './ids.ts'

export type Action =
  | { type: 'speak'; text: string }
  | { type: 'pass' }
  | { type: 'mafia_chat'; text: string }
  | { type: 'vote'; target: SeatId | null }
  | { type: 'night_kill'; target: SeatId }
  | { type: 'night_protect'; target: SeatId }
  | { type: 'night_investigate'; target: SeatId }
  /** Deliberately declining to act at night. Also the timeout default. */
  | { type: 'no_action' }

export type ActionType = Action['type']

/**
 * One inference attempt inside a wake. Retries are part of the evaluated
 * system — extra test-time compute and tool-compliance failures both — so
 * every attempt is recorded, not just the one that produced the action.
 */
export interface AttemptRecord {
  n: number
  outcome: 'ok' | 'invalid_action' | 'provider_error' | 'aborted'
  /** The validation failure or provider error, when the attempt failed. */
  detail?: string
  latencyMs: number
  /** Provider-assigned response id, when one was returned. */
  responseId?: string
  tokens?: { input: number; output: number }
  /**
   * The rationale this attempt produced, when the provider exposed one. Kept
   * per attempt so a retry cannot overwrite the richer trace behind the first
   * draft — the final attempt's rationale is also the submission's.
   */
  reasoning?: string
}

export interface Submission {
  seat: SeatId
  action: Action
  /** Private reasoning trace. Logged omnisciently; never shown to any seat. */
  reasoning: string | null
  /** Every inference attempt this wake, in order. Absent for scripted seats. */
  attempts?: AttemptRecord[]
  /** Set by the runtime when the seat's action was defaulted. */
  timedOut?: boolean
  /**
   * Why the default happened. 'noncompliance' is evaluated model behavior
   * (the model answered but never produced a usable action) and must never
   * be pooled with infrastructure causes for exclusion decisions.
   */
  defaultCause?: 'deadline' | 'provider_error' | 'noncompliance'
  /** Set when the driver threw. Recorded so failures are not silent. */
  driverError?: string
}

const TARGETED = new Set<ActionType>(['night_kill', 'night_protect', 'night_investigate'])
const TEXTUAL = new Set<ActionType>(['speak', 'mafia_chat'])

/**
 * Shape validation only — whether the action is *legal right now* is the
 * engine's business, not this function's.
 */
export function parseAction(raw: unknown): Action {
  if (typeof raw !== 'object' || raw === null) throw new Error('action must be an object')
  const o = raw as Record<string, unknown>
  const type = o['type']
  if (typeof type !== 'string') throw new Error('action.type must be a string')

  if (TEXTUAL.has(type as ActionType)) {
    if (typeof o['text'] !== 'string') throw new Error(`${type}.text must be a string`)
    return { type, text: o['text'] } as Action
  }
  if (TARGETED.has(type as ActionType)) {
    if (typeof o['target'] !== 'string') throw new Error(`${type}.target must be a seat id`)
    return { type, target: o['target'] } as Action
  }
  if (type === 'vote') {
    const t = o['target']
    if (t !== null && typeof t !== 'string') throw new Error('vote.target must be a seat id or null')
    return { type: 'vote', target: (t as SeatId | null) ?? null }
  }
  if (type === 'pass') return { type: 'pass' }
  if (type === 'no_action') return { type: 'no_action' }
  throw new Error(`unknown action type ${type}`)
}

/** The target a seat's action points at, if any. Used for logging and checks. */
export function targetOf(action: Action): SeatId | null {
  if (TARGETED.has(action.type)) return (action as { target: SeatId }).target
  if (action.type === 'vote') return action.target
  return null
}
