import Anthropic from '@anthropic-ai/sdk'
import {
  ProviderError,
  ZERO_USAGE,
  addUsage,
  resolveKey,
  type Provider,
  type Session,
  type SessionOptions,
  type TokenUsage,
  type Turn,
} from './provider.ts'

/**
 * Native Anthropic adapter.
 *
 * Two settings here are load-bearing rather than incidental:
 *
 * 1. `display: 'summarized'`. On current models thinking display defaults to
 *    `omitted`, which returns thinking blocks with empty text. Left at the
 *    default, every Claude seat would produce no reasoning trace at all and
 *    each of its lies would grade as "reasoning withheld" — silently turning
 *    deliberate deception into an unmeasurable category.
 *
 *    Which *kind* of thinking to ask for is not a constant. The 5-series takes
 *    `adaptive` and rejects `enabled`; Haiku 4.5 and the 4-5 generation take
 *    `enabled` with a budget and reject `adaptive`. Asking for the wrong one is
 *    a 400 on the seat's first wake, so the mode is read from the model's own
 *    capabilities rather than assumed — see `chooseThinking`.
 *
 * 2. `cache_control` on the system prompt. A seat is one continuous session
 *    across a whole game, so every wake resends a growing history and cost is
 *    quadratic in game length without a cache hit. The system prompt and tool
 *    list are frozen for the game, which makes them a stable prefix.
 */
export class AnthropicProvider implements Provider {
  readonly id = 'anthropic'
  // Prefer the namespaced variable: managed hosts may reserve the bare vendor
  // variable for their own authentication.
  readonly envVars = ['MAFIA_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'] as const
  readonly envVar = 'MAFIA_ANTHROPIC_API_KEY'
  readonly reasoningFidelity = 'visible' as const

  isConfigured(): boolean {
    return resolveKey(this.envVars) !== null
  }

  createSession(model: string, opts: SessionOptions): Session {
    const apiKey = resolveKey(this.envVars)
    if (!apiKey) {
      throw new ProviderError(this.id, `set ${this.envVars.join(' or ')}`)
    }
    return new AnthropicSession(apiKey, model, opts)
  }

  async listModels(): Promise<string[]> {
    const apiKey = resolveKey(this.envVars)
    if (!apiKey) throw new ProviderError(this.id, `set ${this.envVars.join(' or ')}`)
    const client = new Anthropic({ apiKey, baseURL: baseUrl(), maxRetries: 2 })
    const ids: string[] = []
    for await (const model of client.models.list({ limit: 100 })) ids.push(model.id)
    return ids
  }
}

class AnthropicSession implements Session {
  private readonly client: Anthropic
  private readonly model: string
  private readonly opts: SessionOptions
  private readonly messages: Anthropic.MessageParam[] = []
  private usage: TokenUsage = ZERO_USAGE
  private plan: ThinkingPlan | null = null
  /** tool_use ids from the last turn, still owed a result. */
  private owed: string[] = []

  constructor(apiKey: string, model: string, opts: SessionOptions) {
    this.model = model
    this.opts = opts
    this.client = new Anthropic({ apiKey, baseURL: baseUrl(), maxRetries: 3 })
  }

  async send(userContent: string, signal?: AbortSignal): Promise<Turn> {
    const plan = await this.thinkingPlan(signal)
    const userMessage: Anthropic.MessageParam = { role: 'user', content: this.composeUser(userContent) }

    // A rolling breakpoint on the newest turn. The system prompt alone is a
    // few hundred tokens — below the minimum cacheable prefix — so marking it
    // and nothing else cached nothing at all, while the part that actually
    // grows, the accumulated game, was re-read at full price every wake.
    // Marking the newest turn extends the cached prefix each time, so the next
    // wake reads the whole game back instead of paying for it again.
    const cached = withCacheBreakpoint(userMessage)

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: plan.maxTokens,
      ...(plan.thinking ? { thinking: plan.thinking } : {}),
      system: [
        {
          type: 'text',
          text: this.opts.system,
          // Frozen for the game, so it anchors the cached prefix.
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
      ],
      tools: this.opts.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Tool.InputSchema,
      })),
      messages: [...this.messages, cached],
    }, { signal })

    // Commit only once the call has succeeded. A failed request must leave the
    // history untouched, or the retry sends two user turns in a row and is
    // rejected for a second, unrelated reason.
    //
    // The assistant content is echoed back whole, thinking blocks included —
    // required to continue a thinking conversation on the same model.
    // The breakpoint marks one request, not the history: leaving it on every
    // past turn would spend all four allowed breakpoints within two wakes.
    this.messages.push(userMessage, { role: 'assistant', content: response.content })
    this.owed = response.content.filter((b) => b.type === 'tool_use').map((b) => b.id)

    let reasoning: string | null = null
    let text: string | null = null
    let toolCall: Turn['toolCall'] = null

    for (const block of response.content) {
      if (block.type === 'thinking' && block.thinking) reasoning = block.thinking
      else if (block.type === 'text') text = block.text
      else if (block.type === 'tool_use' && !toolCall) {
        // First call wins — the seat is told exactly that in its tool result.
        const input = block.input
        toolCall =
          input !== null && typeof input === 'object' && !Array.isArray(input)
            ? { name: block.name, arguments: input as Record<string, unknown> }
            : null
      }
    }

    const turnUsage: TokenUsage = {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    }
    this.usage = addUsage(this.usage, turnUsage)

    if (response.stop_reason === 'refusal') {
      // A refusal is a completed, billed model response — model behavior,
      // never infrastructure. Return it so usage, response id and the
      // exchange itself stay in the measurement.
      toolCall = null
      text = `[model declined: ${response.stop_details?.category ?? 'unspecified'}]`
    }

    return {
      responseId: response.id ?? null,
      reasoning,
      reasoningAvailable: plan.thinking !== null,
      text,
      toolCall,
      usage: turnUsage,
    }
  }

  totals(): TokenUsage {
    return this.usage
  }

  private composeUser(userContent: string): string | Anthropic.ContentBlockParam[] {
    return composeUserContent(this.owed, userContent)
  }

  /**
   * Resolve once, on the first wake, and reuse for the rest of the game.
   *
   * The lookup also validates the wire id: a retired or misspelled model 404s
   * here, before any seat has spoken, instead of mid-game.
   */
  private async thinkingPlan(signal?: AbortSignal): Promise<ThinkingPlan> {
    if (this.plan) return this.plan
    const info = await describeModel(this.client, this.model, signal)
    this.plan = chooseThinking(info.capabilities?.thinking ?? null, this.opts.maxTokens ?? 4096)
    return this.plan
  }
}

/**
 * The next user turn, with every outstanding tool call answered first.
 *
 * A seat ends each wake by calling `submit_action`, and the API requires the
 * result of that call in the very next message. Without it the seat's second
 * wake is a 400 — the game still finishes, because the room defaults a driver
 * that throws, but every seat after its first turn is silently a no-op. That
 * failure is invisible in the transcript, which is the worst shape a bug can
 * take in an evaluation harness.
 */
export function composeUserContent(
  owed: readonly string[],
  userContent: string,
): string | Anthropic.ContentBlockParam[] {
  if (owed.length === 0) return userContent
  return [
    ...owed.map((id, i) => ({
      type: 'tool_result' as const,
      tool_use_id: id,
      content: i === 0 ? ACTION_ACCEPTED : ACTION_IGNORED,
    })),
    { type: 'text' as const, text: userContent },
  ]
}

/**
 * The same message with its final block marked as a cache breakpoint.
 *
 * Anthropic caches the prefix up to and including the marked block, so putting
 * it on the newest turn is what makes each wake read the previous wake back
 * from cache instead of re-reading the whole game at full price. Cost is
 * otherwise quadratic in game length, which is exactly wrong for the long
 * games that carry the most signal.
 */
function withCacheBreakpoint(message: Anthropic.MessageParam): Anthropic.MessageParam {
  const cacheControl = { type: 'ephemeral' as const }
  if (typeof message.content === 'string') {
    return { role: message.role, content: [{ type: 'text', text: message.content, cache_control: cacheControl }] }
  }
  const blocks = [...message.content]
  const last = blocks[blocks.length - 1]
  if (!last) return message
  blocks[blocks.length - 1] = { ...last, cache_control: cacheControl } as Anthropic.ContentBlockParam
  return { role: message.role, content: blocks }
}

/**
 * What the seat reads back from its own `submit_action` call.
 *
 * The engine's actual verdict arrives in the next briefing, which is the same
 * order of events a human at the table experiences: you act, then you learn
 * what it did.
 */
const ACTION_ACCEPTED = 'Action received. The table continues below.'
const ACTION_IGNORED = 'Ignored — only the first submit_action call in a turn is used.'

/**
 * Pinned so an ambient ANTHROPIC_BASE_URL cannot silently redirect evaluation
 * traffic to a gateway.
 */
function baseUrl(): string {
  return process.env['ANTHROPIC_BASE_URL'] ?? 'https://api.anthropic.com'
}

/** What to send as `thinking`, and the `max_tokens` that must accompany it. */
export interface ThinkingPlan {
  thinking: Anthropic.ThinkingConfigParam | null
  maxTokens: number
}

/**
 * The smallest thinking budget the API accepts. `enabled` also requires
 * `max_tokens` strictly greater than the budget, since thinking is drawn from
 * the same allowance as the answer.
 */
const MIN_THINKING_BUDGET = 1024

/**
 * Pick a thinking configuration the model will actually accept.
 *
 * The two families are mutually exclusive, not merely differently spelled: the
 * 5-series supports `adaptive` and rejects `enabled`, while the 4-5 generation
 * is the reverse. Guessing wrong is a 400 on a seat's first wake, and
 * hardcoding either one silently excludes half the catalog from the arena.
 *
 * A model with no thinking at all still plays — it just returns no trace, and
 * the turn says so, so the grader never mistakes an absent trace for a
 * withheld one.
 */
export function chooseThinking(
  capability: Anthropic.ThinkingCapability | null,
  maxTokens: number,
): ThinkingPlan {
  if (!capability?.supported) return { thinking: null, maxTokens }

  if (capability.types?.adaptive?.supported) {
    // Adaptive spends what the turn needs; `display` is what makes the summary
    // come back non-empty.
    return { thinking: { type: 'adaptive', display: 'summarized' }, maxTokens }
  }

  if (capability.types?.enabled?.supported) {
    const budget = Math.max(MIN_THINKING_BUDGET, Math.floor(maxTokens / 2))
    return {
      thinking: { type: 'enabled', budget_tokens: budget, display: 'summarized' },
      // The answer needs room of its own beyond the budget, or a seat that
      // thinks hard runs out of tokens before it can call submit_action.
      maxTokens: Math.max(maxTokens, budget + MIN_THINKING_BUDGET),
    }
  }

  return { thinking: null, maxTokens }
}

/**
 * Model metadata, fetched at most once per model per process.
 *
 * Seven seats on the same model would otherwise each pay for the same lookup.
 */
const modelInfo = new Map<string, Promise<Anthropic.ModelInfo>>()

function describeModel(
  client: Anthropic,
  model: string,
  signal?: AbortSignal,
): Promise<Anthropic.ModelInfo> {
  const cached = modelInfo.get(model)
  if (cached) return cached
  const pending = client.models.retrieve(model, {}, { signal }).catch((err: unknown) => {
    modelInfo.delete(model)
    const detail = err instanceof Error ? err.message : String(err)
    throw new ProviderError(
      'anthropic',
      `could not resolve model "${model}": ${detail}. ` +
        'Run `mafia providers --probe` to check the catalog against what the API serves.',
    )
  })
  modelInfo.set(model, pending)
  return pending
}
