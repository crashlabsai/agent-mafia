import type {
  Action,
  AttemptRecord,
  GameOutcome,
  GameStartContext,
  Observation,
  SeatDriver,
  SeatId,
  SeatInitContext,
  Submission,
  TableConfig,
} from '@mafia/protocol'
import { createHash } from 'node:crypto'
import { buildSystemPrompt, renderBriefing, rulesOf, type Framing } from './prompt.ts'
import { SEAT_TOOLS } from './tools.ts'
import {
  lookup,
  providerById,
  type SeatBinding,
  type Session,
  type TokenUsage,
  type Turn,
} from './providers/index.ts'
import { ZERO_USAGE, addUsage } from './providers/provider.ts'

export interface AgentDriverOptions {
  seat: SeatId
  /** Catalog key, e.g. 'opus-5'. Resolved to a provider and wire id. */
  modelKey: string
  config: TableConfig
  /** Which system-prompt framing this seat plays under. Default 'unverified'. */
  framing?: Framing
  maxTokens?: number
  /**
   * Tries per wake before the seat is defaulted.
   *
   * Three, not two: a single retry is enough for a malformed call, but an
   * over-long message often needs the model to redraft rather than trim, and a
   * lost turn is far more expensive than a round trip.
   */
  maxAttempts?: number
  /**
   * Override how the session is opened. The seam exists so the whole agent
   * path — prompt, briefing, parsing, retry, session continuity — is testable
   * end to end without spending a token, and so a provider can be swapped in
   * without touching this class.
   */
  sessionFactory?: (system: string, maxTokens: number) => Session
}

/**
 * A seat played by a model.
 *
 * One session for the whole game: the seat remembers every prior wake, every
 * briefing and its own reasoning, which is what makes it a player rather than a
 * stateless policy. Briefings are incremental — the accumulated session is the
 * seat's scroll-back.
 */
export class AgentDriver implements SeatDriver {
  readonly kind = 'agent' as const
  readonly binding: SeatBinding

  private readonly opts: AgentDriverOptions
  private session: Session | null = null
  private lastObs: Observation | null = null
  private usage: TokenUsage = ZERO_USAGE
  /** Wakes where the model returned no usable action and was defaulted. */
  private failures = 0
  /** Provider-side failures, kept so a broken seat reads as broken. */
  private readonly errors: string[] = []

  constructor(opts: AgentDriverOptions) {
    this.opts = opts
    const entry = lookup(opts.modelKey)
    const provider = providerById(entry.provider)
    const framing = opts.framing ?? 'unverified'
    this.system = buildSystemPrompt(rulesOf(opts.config), framing)
    this.binding = {
      seat: opts.seat,
      modelKey: entry.key,
      provider: entry.provider,
      wireId: entry.wireId,
      reasoningFidelity: provider.reasoningFidelity,
      framing,
      promptSha256: createHash('sha256').update(this.system).digest('hex'),
      toolsSha256: createHash('sha256').update(JSON.stringify(SEAT_TOOLS)).digest('hex'),
    }
  }

  /** The exact system prompt this seat plays under, fixed for the game. */
  private readonly system: string

  async init(_ctx: SeatInitContext): Promise<void> {}

  /** Reserved: a future match runtime resets or carries memory here. */
  async startGame(_ctx: GameStartContext): Promise<void> {
    this.session = null
    this.lastObs = null
  }

  async act(obs: Observation): Promise<Submission> {
    const session = this.ensureSession(obs)
    const attempts = this.opts.maxAttempts ?? 3

    // The driver enforces its own deadline, inside the room's, so a slow
    // wake is aborted here — with the in-flight provider request cancelled —
    // rather than abandoned by the room. An abandoned request would keep
    // running: it could commit a late exchange into the session, overlap the
    // seat's next wake, and spend tokens no attempt record ever reports.
    const wakeEndsAt =
      obs.deadline === null ? null : Date.now() + Math.max(15_000, obs.deadline.msRemaining - 10_000)

    let briefing = renderBriefing(obs, this.lastObs)
    // Retries are part of the evaluated system — extra test-time compute and
    // tool-compliance failures both — so every attempt is recorded and lands
    // in the log as an omniscient attempts_recorded event.
    const record: AttemptRecord[] = []
    let finalReasoning: string | null = null
    // Whether any attempt actually reached the model and came back. If none
    // did, the seat never saw this briefing — so lastObs must not advance,
    // or the next delta briefing would silently skip the role, the partners
    // and everything else this briefing carried.
    let sawModel = false

    for (let attempt = 0; attempt < attempts; attempt++) {
      const remaining = wakeEndsAt === null ? null : wakeEndsAt - Date.now()
      if (remaining !== null && remaining < 5_000) break // not enough time for a real attempt

      const startedAt = Date.now()
      const controller = remaining === null ? null : new AbortController()
      const timer = controller ? setTimeout(() => controller.abort(), remaining as number) : null
      let turn: Turn
      try {
        turn = await session.send(briefing, controller?.signal)
      } catch (err) {
        if (timer) clearTimeout(timer)
        if (controller?.signal.aborted) {
          record.push({
            n: attempt + 1,
            outcome: 'aborted',
            detail: 'wake deadline: in-flight request cancelled',
            latencyMs: Date.now() - startedAt,
          })
          break
        }
        // The room cannot tell a provider failure from a slow model: both
        // arrive as a default, and a seat defaulted every wake looks exactly
        // like a seat that chose to stay quiet. Recording the reason is what
        // makes a broken seat legible instead of merely silent.
        const detail = err instanceof Error ? err.message : String(err)
        this.errors.push(detail)
        record.push({
          n: attempt + 1,
          outcome: 'provider_error',
          detail: detail.slice(0, 300),
          latencyMs: Date.now() - startedAt,
        })
        // The session rolls back a failed exchange, so the same briefing is
        // still the right thing to send.
        continue
      }
      if (timer) clearTimeout(timer)
      this.usage = addUsage(this.usage, turn.usage)

      const parsed: ParseResult = turn.toolCall
        ? toAction(turn.toolCall.arguments)
        : { ok: false, reason: 'You did not call submit_action.' }

      sawModel = true
      const bound = parsed.ok ? checkLegal(bindTarget(parsed.action, obs), obs) : parsed
      const attemptRecord: AttemptRecord = {
        n: attempt + 1,
        outcome: bound.ok ? 'ok' : 'invalid_action',
        latencyMs: Date.now() - startedAt,
        ...(turn.responseId ? { responseId: turn.responseId } : {}),
        tokens: { input: turn.usage.input, output: turn.usage.output },
        ...(turn.reasoning ? { reasoning: turn.reasoning } : {}),
        ...(bound.ok ? {} : { detail: bound.reason.slice(0, 300) }),
      }
      record.push(attemptRecord)
      // The submission's rationale is the acting attempt's own, never a
      // leftover from an earlier draft — those live on their attempt records.
      finalReasoning = turn.reasoning ?? null

      if (bound.ok) {
        this.lastObs = obs
        return { seat: obs.you.seat, action: bound.action, reasoning: finalReasoning, attempts: record }
      }

      // Tell it what went wrong and let it try again. The engine would reject
      // this anyway; catching it here costs a round trip instead of a turn.
      briefing =
        `Your last call could not be used: ${bound.reason}\n\n` +
        `Call submit_action again with one of the options listed above.`
    }

    // Out of attempts or out of time. Fall through to a legal default rather
    // than hang the table; the room logs this as a timeout so a flaky seat is
    // visible. The default must be legal for the phase — a hardcoded pass is
    // rejected at night and burns a pointless rejection on a broken wake.
    this.failures += 1
    if (sawModel) this.lastObs = obs
    const cause: Submission['defaultCause'] = sawModel
      ? 'noncompliance'
      : record.some((a) => a.outcome === 'aborted')
        ? 'deadline'
        : 'provider_error'
    const types = new Set(obs.legalActions.map((s) => s.type))
    const fallback: Action = types.has('pass')
      ? { type: 'pass' }
      : types.has('no_action')
        ? { type: 'no_action' }
        : { type: 'vote', target: null }
    return {
      seat: obs.you.seat,
      action: fallback,
      reasoning: finalReasoning,
      timedOut: true,
      defaultCause: cause,
      attempts: record,
    }
  }

  async notify(_obs: Observation): Promise<void> {}

  async endGame(_obs: Observation, _outcome: GameOutcome): Promise<void> {}

  async finish(): Promise<null> {
    return null
  }

  async close(): Promise<void> {
    this.session = null
  }

  /** Cost, cache performance and breakage for this seat, for the run summary. */
  stats(): { usage: TokenUsage; failures: number; errors: string[] } {
    return { usage: this.usage, failures: this.failures, errors: [...this.errors] }
  }

  private ensureSession(_obs: Observation): Session {
    if (this.session) return this.session
    const system = this.system
    const maxTokens = this.opts.maxTokens ?? 2048
    this.session = this.opts.sessionFactory
      ? this.opts.sessionFactory(system, maxTokens)
      : providerById(this.binding.provider).createSession(this.binding.wireId, {
          system,
          tools: SEAT_TOOLS,
          finalTool: 'submit_action',
          maxTokens,
        })
    return this.session
  }
}

type ParseResult = { ok: true; action: Action } | { ok: false; reason: string }

/**
 * Map the tool arguments onto an engine action.
 *
 * Deliberately strict: a malformed call is reported back rather than coerced
 * into something the model did not ask for. Silently turning a bad target into
 * an abstention would put words in a seat's mouth and corrupt the record the
 * deception grader reads.
 */
export function toAction(args: Record<string, unknown>): ParseResult {
  const type = args['action']
  if (typeof type !== 'string') return { ok: false, reason: '"action" was missing.' }

  const rawTarget = args['target']
  const target = typeof rawTarget === 'string' && rawTarget.length > 0 ? rawTarget : null
  const rawMessage = args['message']
  const message = typeof rawMessage === 'string' ? rawMessage : null

  switch (type) {
    case 'pass':
      return { ok: true, action: { type: 'pass' } }
    case 'no_action':
      return { ok: true, action: { type: 'no_action' } }

    case 'speak':
    case 'mafia_chat':
      if (!message || message.trim().length === 0) {
        return { ok: false, reason: `"${type}" needs a non-empty "message".` }
      }
      return { ok: true, action: { type, text: message } }

    case 'vote':
      // A missing target is a real abstention here, not a parse failure.
      return { ok: true, action: { type: 'vote', target } }

    case 'night_kill':
    case 'night_protect':
    case 'night_investigate':
      if (!target) return { ok: false, reason: `"${type}" needs a "target" seat id.` }
      return { ok: true, action: { type, target } }

    default:
      return { ok: false, reason: `"${type}" is not an action type.` }
  }
}

/**
 * Resolve whatever the model called a player into the seat id the engine wants.
 *
 * Models refer to players the way the table does — "Flint", "4", "seat 4" —
 * because that is how the briefing and every message reads. The engine only
 * accepts `seat-4`, so left unresolved these are rejected, and a rejection
 * costs the seat its whole turn. In the first live game that silently cost the
 * Detective all three of its nights: the town's only information role produced
 * nothing, which corrupts the result far more than it inconveniences the seat.
 *
 * This is not the driver guessing at intent. Every accepted form names exactly
 * one living player; anything ambiguous or unmatched is reported back for the
 * model to correct, the same as any other malformed call.
 */
export function bindTarget(action: Action, obs: Observation): ParseResult {
  if (!('target' in action) || action.target === null) return { ok: true, action }

  const resolved = resolveSeat(action.target, obs.table.seats)
  if (resolved === null) {
    const roster = obs.table.seats
      .filter((s) => s.alive)
      .map((s) => `${s.name} (${s.id})`)
      .join(', ')
    return {
      ok: false,
      reason: `"${action.target}" does not name exactly one living player. Use a seat id: ${roster}.`,
    }
  }
  return { ok: true, action: { ...action, target: resolved } }
}

/** The seat a reference names, or null if it names none or several. */
function resolveSeat(raw: string, seats: readonly { id: SeatId; name: string; alive: boolean }[]): SeatId | null {
  const text = raw.trim()

  // An id, however it was written: "seat-4", "seat 4", "seat_4", "#4", "4".
  const asId = text.toLowerCase().replace(/^#/, '').replace(/^seat[\s_-]*/, '')
  const byId = seats.filter((s) => s.id === text || s.id === `seat-${asId}`)
  if (byId.length === 1) return byId[0]!.id

  // A name, possibly with the id already alongside it: "Flint (seat-7)".
  const bare = (text.split('(')[0] ?? text).trim().toLowerCase()
  const byName = seats.filter((s) => s.name.toLowerCase() === bare)
  return byName.length === 1 ? byName[0]!.id : null
}

/**
 * Check an action against what this seat was told it may do.
 *
 * The engine is the authority, but a rejection there costs the seat its entire
 * turn: the room applies the phase default and moves on. In the second live
 * game seven turns were lost that way, all to messages a few characters over
 * the limit — including most of the endgame discussion, from seats that had
 * something to say. Catching it here costs a round trip instead.
 *
 * Every check reads only the observation the seat itself holds, so this
 * enforces nothing the seat was not already told.
 */
export function checkLegal(parsed: ParseResult, obs: Observation): ParseResult {
  if (!parsed.ok) return parsed
  const action = parsed.action

  const spec = obs.legalActions.find((s) => s.type === action.type)
  if (!spec) {
    const options = obs.legalActions.map((s) => s.type).join(', ') || 'none'
    return { ok: false, reason: `"${action.type}" is not available this turn. Available: ${options}.` }
  }

  if ('text' in action && spec.maxChars !== undefined && action.text.length > spec.maxChars) {
    return {
      ok: false,
      reason:
        `your message is ${action.text.length} characters and the limit is ${spec.maxChars}. ` +
        'Say the same thing more briefly.',
    }
  }

  if ('target' in action && action.target !== null && spec.targets && !spec.targets.includes(action.target)) {
    return {
      ok: false,
      reason: `${action.target} is not a legal target for ${action.type}. Legal: ${spec.targets.join(', ')}.`,
    }
  }

  if ('target' in action && action.target === null && spec.allowNullTarget === false) {
    return { ok: false, reason: `${action.type} needs a target; abstaining is not available here.` }
  }

  return { ok: true, action }
}
