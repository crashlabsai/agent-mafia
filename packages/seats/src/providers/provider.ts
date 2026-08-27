/**
 * The provider boundary.
 *
 * A seat driver knows nothing about which company serves its model. It opens a
 * Session, sends rendered observations, and reads back reasoning plus one tool
 * call. Everything provider-specific — wire format, caching directives, how
 * reasoning is surfaced — lives behind this interface.
 */

export interface ToolSchema {
  name: string
  description: string
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>
}

export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
}

export interface Turn {
  /** Provider-assigned response id, retained as a provenance receipt. */
  responseId: string | null
  /** The model's private reasoning, when the provider exposes it. */
  reasoning: string | null
  /** Whether reasoning was actually available, or withheld by the provider. */
  reasoningAvailable: boolean
  /** Any prose the model emitted alongside the call. */
  text: string | null
  toolCall: ToolCall | null
  usage: TokenUsage
}

export interface TokenUsage {
  input: number
  output: number
  /** Tokens served from cache. Zero means the cache missed — worth watching. */
  cacheRead: number
  cacheWrite: number
}

/**
 * One continuous conversation for one seat, for one game.
 *
 * Implementations own their own message history: a seat remembers every prior
 * wake, which is what makes it an agent rather than a stateless policy.
 */
export interface Session {
  /**
   * One exchange. The signal aborts the in-flight provider request; an
   * aborted or failed exchange must leave the session history untouched so
   * the same briefing can be resent.
   */
  send(userContent: string, signal?: AbortSignal): Promise<Turn>
  /** Cumulative usage across every turn in this session. */
  totals(): TokenUsage
}

export interface SessionOptions {
  system: string
  tools: ToolSchema[]
  /** The tool the model must end its turn by calling. */
  finalTool: string
  maxTokens?: number
}

/**
 * How faithfully a provider exposes the model's reasoning.
 *
 * This is recorded per seat because the deception grader depends on it: a false
 * claim whose reasoning shows the model knew its real role is a deliberate lie,
 * while the same claim with no visible reasoning is indistinguishable from a
 * hallucination. Conflating the two is the known limitation this field exists
 * to make auditable rather than invisible.
 */
export type ReasoningFidelity =
  /** Full or summarized reasoning text is returned. */
  | 'visible'
  /** The provider returns only an opaque or encrypted blob. */
  | 'encrypted'
  /** The model does not expose reasoning at all. */
  | 'none'

export interface Provider {
  readonly id: string
  /**
   * Env vars checked in order; the first one set wins.
   *
   * The namespaced name comes first because some managed hosts reserve bare
   * provider variables for their own authentication. A namespaced name also
   * makes it unambiguous which credential a run actually used.
   */
  readonly envVars: readonly string[]
  /** The name to show when no credential is found. */
  readonly envVar: string
  readonly reasoningFidelity: ReasoningFidelity
  /** True when the credential is present. Never logs or returns the key. */
  isConfigured(): boolean
  createSession(model: string, opts: SessionOptions): Session
  /**
   * Wire ids the provider currently serves.
   *
   * Model ids drift as models ship and retire, and a stale catalog entry
   * otherwise surfaces as a 404 several seats into a live game. `mafia
   * providers --probe` calls this to catch the drift before any tokens are
   * spent.
   */
  listModels(): Promise<string[]>
}

export const ZERO_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  }
}

/** Providers reject an unparseable tool call; the room treats it as illegal. */
export class ProviderError extends Error {
  readonly provider: string
  readonly retryable: boolean

  constructor(provider: string, message: string, retryable = false) {
    super(`[${provider}] ${message}`)
    this.name = 'ProviderError'
    this.provider = provider
    this.retryable = retryable
  }
}

/** First candidate env var that is set, or null. Never returns the value. */
export function resolveEnvVar(names: readonly string[]): string | null {
  for (const n of names) {
    if (process.env[n]) return n
  }
  return null
}

/** The credential itself, or null. */
export function resolveKey(names: readonly string[]): string | null {
  const found = resolveEnvVar(names)
  return found ? (process.env[found] ?? null) : null
}
