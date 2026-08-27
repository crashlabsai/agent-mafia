import OpenAI from 'openai'
import {
  ProviderError,
  ZERO_USAGE,
  addUsage,
  resolveKey,
  type Provider,
  type ReasoningFidelity,
  type Session,
  type SessionOptions,
  type TokenUsage,
  type Turn,
} from './provider.ts'

/** What the seat reads back from its own `submit_action` call. */
const ACTION_ACCEPTED = 'Action received. The table continues below.'
const ACTION_IGNORED = 'Ignored — only the first submit_action call in a turn is used.'

/**
 * The next turn: every outstanding tool call answered, then the briefing.
 *
 * A seat ends each wake by calling submit_action, and an unanswered call makes
 * the seat's next wake a 400 — leaving it silently defaulted for the rest of
 * the game rather than visibly broken.
 */
export function composeUserTurn(
  owed: readonly string[],
  userContent: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return [
    ...owed.map((id, i) => ({
      role: 'tool' as const,
      tool_call_id: id,
      content: i === 0 ? ACTION_ACCEPTED : ACTION_IGNORED,
    })),
    { role: 'user' as const, content: userContent },
  ]
}

export interface CompatConfig {
  id: string
  envVars: readonly string[]
  baseURL: string
  reasoningFidelity: ReasoningFidelity
}

/**
 * One adapter for every provider speaking the OpenAI chat-completions format.
 *
 * OpenAI, Fireworks, xAI and NVIDIA NIM differ only in base URL, credential and
 * how much reasoning they surface — so they are configuration, not four
 * separate integrations.
 *
 * Fireworks matters beyond convenience: it serves the open-weight tail from a
 * single named backend, which is the reproducibility property that aggregator
 * routing destroys by silently varying the serving backend and quantization
 * behind one model name.
 */
export class OpenAICompatProvider implements Provider {
  readonly id: string
  readonly envVars: readonly string[]
  readonly envVar: string
  readonly reasoningFidelity: ReasoningFidelity
  private readonly baseURL: string

  constructor(cfg: CompatConfig) {
    this.id = cfg.id
    this.envVars = cfg.envVars
    this.envVar = cfg.envVars[0] as string
    this.baseURL = cfg.baseURL
    this.reasoningFidelity = cfg.reasoningFidelity
  }

  isConfigured(): boolean {
    return resolveKey(this.envVars) !== null
  }

  createSession(model: string, opts: SessionOptions): Session {
    const apiKey = resolveKey(this.envVars)
    if (!apiKey) throw new ProviderError(this.id, `set ${this.envVars.join(' or ')}`)
    return new CompatSession(this.id, apiKey, this.baseURL, model, opts)
  }

  async listModels(): Promise<string[]> {
    const apiKey = resolveKey(this.envVars)
    if (!apiKey) throw new ProviderError(this.id, `set ${this.envVars.join(' or ')}`)
    const client = new OpenAI({ apiKey, baseURL: this.baseURL, maxRetries: 2 })
    const page = await client.models.list()
    return page.data.map((m) => m.id)
  }
}

class CompatSession implements Session {
  private readonly client: OpenAI
  private readonly providerId: string
  private readonly model: string
  private readonly opts: SessionOptions
  private readonly messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  private usage: TokenUsage = ZERO_USAGE
  /** tool_call ids from the last turn, still owed a result. */
  private owed: string[] = []

  constructor(
    providerId: string,
    apiKey: string,
    baseURL: string,
    model: string,
    opts: SessionOptions,
  ) {
    this.providerId = providerId
    this.model = model
    this.opts = opts
    this.client = new OpenAI({ apiKey, baseURL, maxRetries: 3 })
    this.messages.push({ role: 'system', content: opts.system })
  }

  async send(userContent: string, signal?: AbortSignal): Promise<Turn> {
    const turn = composeUserTurn(this.owed, userContent)

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: this.opts.maxTokens ?? 4096,
      messages: [...this.messages, ...turn],
      tools: this.opts.tools.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    }, { signal })

    const choice = response.choices[0]
    if (!choice) throw new ProviderError(this.providerId, 'response had no choices', true)
    const message = choice.message
    // Committed only on success, so a failed call leaves a history a retry can
    // still be appended to.
    this.messages.push(...turn, message)
    this.owed = (message.tool_calls ?? []).map((c) => c.id)

    // Providers that expose reasoning put it on a non-standard field:
    // `reasoning_content` (DeepSeek, Fireworks) or `reasoning` (others).
    const extra = message as unknown as Record<string, unknown>
    const raw = extra['reasoning_content'] ?? extra['reasoning']
    const reasoning = typeof raw === 'string' && raw.length > 0 ? raw : null

    let toolCall: Turn['toolCall'] = null
    const first = message.tool_calls?.[0]
    if (first && first.type === 'function') {
      // Malformed arguments are the model's failure to use the tool, not a
      // provider fault: keep the exchange (and its usage) in the measurement
      // and surface it as no tool call.
      let args: unknown
      try {
        args = JSON.parse(first.function.arguments)
      } catch {
        args = null
      }
      toolCall =
        args !== null && typeof args === 'object' && !Array.isArray(args)
          ? { name: first.function.name, arguments: args as Record<string, unknown> }
          : null
    }

    const details = response.usage?.prompt_tokens_details
    const turnUsage: TokenUsage = {
      input: response.usage?.prompt_tokens ?? 0,
      output: response.usage?.completion_tokens ?? 0,
      // These providers cache prefixes automatically; nothing to opt into.
      cacheRead: details?.cached_tokens ?? 0,
      cacheWrite: 0,
    }
    this.usage = addUsage(this.usage, turnUsage)

    return {
      responseId: response.id ?? null,
      reasoning,
      reasoningAvailable: reasoning !== null,
      text: message.content ?? null,
      toolCall,
      usage: turnUsage,
    }
  }

  totals(): TokenUsage {
    return this.usage
  }
}

/**
 * The OpenAI-compatible providers. OpenAI itself is not among them: current
 * GPT models reject function tools alongside reasoning on chat completions,
 * so OpenAI has a native Responses-API adapter — see openai.ts.
 *
 * Reasoning fidelity is declared, not assumed, and travels into the log so a
 * grader can tell a withheld trace from an absent one.
 */
export const COMPAT_PROVIDERS: CompatConfig[] = [
  {
    id: 'fireworks',
    envVars: ['MAFIA_FIREWORKS_API_KEY', 'FIREWORKS_API_KEY'],
    baseURL: 'https://api.fireworks.ai/inference/v1',
    // Open-weight reasoning models return reasoning_content in the clear.
    reasoningFidelity: 'visible',
  },
  {
    id: 'xai',
    envVars: ['MAFIA_XAI_API_KEY', 'XAI_API_KEY'],
    baseURL: 'https://api.x.ai/v1',
    // grok-4.6 returns readable reasoning_content — observed across live
    // games, so the label follows the evidence.
    reasoningFidelity: 'visible',
  },
  {
    id: 'nvidia',
    envVars: ['MAFIA_NVIDIA_API_KEY', 'NVIDIA_API_KEY'],
    baseURL: 'https://integrate.api.nvidia.com/v1',
    reasoningFidelity: 'visible',
  },
  {
    // The aggregator exception. OpenRouter routes to varying backends and
    // quantizations behind one name — disqualifying for a ranked leaderboard
    // row (see DESIGN §10.2) — but it is the only wire that serves cloaked
    // stealth models, so those seats play with an asterisk: aggregator-served,
    // identity unknown.
    id: 'openrouter',
    envVars: ['MAFIA_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY'],
    baseURL: 'https://openrouter.ai/api/v1',
    reasoningFidelity: 'encrypted',
  },
]
