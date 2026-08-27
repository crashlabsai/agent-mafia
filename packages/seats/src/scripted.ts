import type {
  Action,
  GameOutcome,
  GameStartContext,
  LegalActionSpec,
  Observation,
  SeatDriver,
  SeatInitContext,
  SeatId,
  Submission,
} from '@mafia/protocol'
import { hashString } from '@mafia/engine'

/** A policy sees exactly what an agent sees, and nothing more. */
export type Policy = (obs: Observation, rand: () => number) => Action

function firstSpec(obs: Observation): LegalActionSpec | null {
  return obs.legalActions[0] ?? null
}

function passLike(obs: Observation): Action {
  const types = new Set(obs.legalActions.map((s) => s.type))
  if (types.has('pass')) return { type: 'pass' }
  if (types.has('no_action')) return { type: 'no_action' }
  if (types.has('vote')) return { type: 'vote', target: null }
  return { type: 'pass' }
}

/** Never says anything, never targets anyone. The silent-table baseline. */
export const alwaysPass: Policy = (obs) => passLike(obs)

/** Takes the first legal action with its first legal target. Fully determined. */
export const firstLegal: Policy = (obs) => {
  const spec = firstSpec(obs)
  if (!spec) return passLike(obs)
  return materialize(spec, obs, () => 0)
}

/**
 * Picks uniformly among legal actions and targets.
 *
 * Randomness comes from the seat's own counter-based stream, so a table of
 * these produces a varied but exactly reproducible game.
 */
export const seededRandom: Policy = (obs, rand) => {
  const specs = obs.legalActions
  if (specs.length === 0) return passLike(obs)
  const spec = specs[Math.floor(rand() * specs.length)] as LegalActionSpec
  return materialize(spec, obs, rand)
}

function materialize(spec: LegalActionSpec, obs: Observation, rand: () => number): Action {
  switch (spec.type) {
    case 'speak':
    case 'mafia_chat': {
      const text = sampleLine(obs, rand)
      return spec.type === 'speak' ? { type: 'speak', text } : { type: 'mafia_chat', text }
    }
    case 'vote': {
      const targets = spec.targets ?? []
      // Abstaining is a real option, so it gets a share of the draw.
      if (targets.length === 0 || rand() < 0.15) return { type: 'vote', target: null }
      return { type: 'vote', target: targets[Math.floor(rand() * targets.length)] as SeatId }
    }
    case 'night_kill':
    case 'night_protect':
    case 'night_investigate': {
      const targets = spec.targets ?? []
      if (targets.length === 0) return { type: 'no_action' }
      const target = targets[Math.floor(rand() * targets.length)] as SeatId
      return { type: spec.type, target } as Action
    }
    case 'pass':
      return { type: 'pass' }
    default:
      return { type: 'no_action' }
  }
}

/**
 * Obviously synthetic filler. Scripted seats are test fixtures, not evaluated
 * agents, so canned text here does not compromise de-opinionation — no real
 * seat is ever handed a line to say.
 */
function sampleLine(obs: Observation, rand: () => number): string {
  const others = obs.table.seats.filter((s) => s.alive && s.id !== obs.you.seat)
  const who = others.length ? (others[Math.floor(rand() * others.length)] as { name: string }).name : 'nobody'
  const shapes = [
    `[scripted] I have nothing on ${who} yet.`,
    `[scripted] Watching ${who}.`,
    `[scripted] Day ${obs.table.day}: no read.`,
    `[scripted] I would rather hear from ${who}.`,
  ]
  return shapes[Math.floor(rand() * shapes.length)] as string
}

export interface ScriptedDriverOptions {
  seat: SeatId
  policy?: Policy
  /** Seeds this seat's private stream. Same seed plus same policy is reproducible. */
  seed?: string
  /** Emitted as the reasoning trace so log shape matches an agent seat's. */
  explain?: boolean
}

/**
 * A seat driven by a pure policy over the same Observation an agent gets.
 *
 * This is what makes the environment verifiable end-to-end with zero API calls,
 * and it supplies the fixed opponent policies a future matched-control
 * experiment depends on.
 */
export class ScriptedDriver implements SeatDriver {
  readonly kind = 'scripted' as const
  private readonly policy: Policy
  private readonly seed: string
  private readonly explain: boolean
  private counter = 0

  constructor(opts: ScriptedDriverOptions) {
    this.policy = opts.policy ?? seededRandom
    this.seed = opts.seed ?? `scripted:${opts.seat}`
    this.explain = opts.explain ?? false
  }

  private rand = (): number => {
    const h = hashString(`${this.seed}#${this.counter++}`)
    let t = (h + 0x6d2b79f5) | 0
    t = Math.imul(t ^ (t >>> 15), 1 | t)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  async init(_ctx: SeatInitContext): Promise<void> {}

  /** Reserved hook: a future match runtime resets or carries memory here. */
  async startGame(_ctx: GameStartContext): Promise<void> {
    this.counter = 0
  }

  async act(obs: Observation): Promise<Submission> {
    const action = this.policy(obs, this.rand)
    return {
      seat: obs.you.seat,
      action,
      reasoning: this.explain
        ? `[scripted] phase=${obs.table.phase} legal=${obs.legalActions.map((s) => s.type).join('|')} chose=${action.type}`
        : null,
    }
  }

  async notify(_obs: Observation): Promise<void> {}
  async endGame(_obs: Observation, _outcome: GameOutcome): Promise<void> {}
  async finish(): Promise<null> {
    return null
  }
  async close(): Promise<void> {}
}
