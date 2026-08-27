import OpenAI from 'openai'
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

/** What the seat reads back from its own `submit_action` call. */
const ACTION_ACCEPTED = 'Action received. The table continues below.'
const ACTION_IGNORED = 'Ignored — only the first submit_action call in a turn is used.'

/**
 * Native OpenAI adapter, on the Responses API.
 *
 * OpenAI could not stay on the shared chat-completions adapter: current GPT
 * models reject function tools alongside reasoning on that endpoint outright
 * ("use /v1/responses or set reasoning_effort to 'none'"). Disabling reasoning
 * would have made the seats play without thinking — a silent handicap that
 * poisons any cross-model comparison — so OpenAI gets the endpoint its models
 * actually reason on. Fireworks, xAI and NVIDIA remain on the compat adapter;
 * this defect was found by the first live cross-provider game, exactly as the
 * Anthropic adapter's four were.
 *
 * Two settings are load-bearing:
 *
 * 1. `reasoning.summary: 'auto'`. Without it the API returns no reasoning text
 *    at all and every lie from a GPT seat would grade as "reasoning withheld".
 *    With it, seats return summarized reasoning — same fidelity class as the
 *    Anthropic adapter's summarized thinking. A turn may still carry none
 *    (models skip summaries on easy turns); `reasoningAvailable` says so.
 *
 * 2. `store: false` + `include: reasoning.encrypted_content`. Sessions are
 *    kept client-side like every other adapter, so nothing about a game rests
 *    on provider-side state. Stateless reasoning models require the encrypted
 *    reasoning items to be replayed on the next turn, so they are requested
 *    and echoed back verbatim.
 */
export class OpenAIProvider implements Provider {
  readonly id = 'openai'
  readonly envVars = ['MAFIA_OPENAI_API_KEY', 'OPENAI_API_KEY'] as const
  readonly envVar = 'MAFIA_OPENAI_API_KEY'
  readonly reasoningFidelity = 'visible' as const

  isConfigured(): boolean {
    return resolveKey(this.envVars) !== null
  }

  createSession(model: string, opts: SessionOptions): Session {
    const apiKey = resolveKey(this.envVars)
    if (!apiKey) throw new ProviderError(this.id, `set ${this.envVars.join(' or ')}`)
    return new OpenAISession(apiKey, model, opts)
  }

  async listModels(): Promise<string[]> {
    const apiKey = resolveKey(this.envVars)
    if (!apiKey) throw new ProviderError(this.id, `set ${this.envVars.join(' or ')}`)
    const client = new OpenAI({ apiKey, maxRetries: 2 })
    const page = await client.models.list()
    return page.data.map((m) => m.id)
  }
}

class OpenAISession implements Session {
  private readonly client: OpenAI
  private readonly model: string
  private readonly opts: SessionOptions
  /** The whole conversation, replayed on every call. Output items included. */
  private readonly history: OpenAI.Responses.ResponseInputItem[] = []
  private usage: TokenUsage = ZERO_USAGE
  /** call_ids from the last turn, still owed a function_call_output. */
  private owed: string[] = []

  constructor(apiKey: string, model: string, opts: SessionOptions) {
    this.model = model
    this.opts = opts
    this.client = new OpenAI({ apiKey, maxRetries: 3 })
  }

  async send(userContent: string, signal?: AbortSignal): Promise<Turn> {
    const turnItems: OpenAI.Responses.ResponseInputItem[] = [
      ...this.owed.map((id, i) => ({
        type: 'function_call_output' as const,
        call_id: id,
        output: i === 0 ? ACTION_ACCEPTED : ACTION_IGNORED,
      })),
      { role: 'user' as const, content: userContent },
    ]

    const response = await this.client.responses.create({
      model: this.model,
      instructions: this.opts.system,
      input: [...this.history, ...turnItems],
      tools: this.opts.tools.map(
        (t): OpenAI.Responses.FunctionTool => ({
          type: 'function',
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          strict: false,
        }),
      ),
      parallel_tool_calls: false,
      // Reasoning draws from the same allowance as the answer. The driver's
      // default (2048) is routinely eaten whole by reasoning before the tool
      // call is emitted, which surfaces as an incomplete response — so the
      // floor is generous. Only tokens actually produced are billed.
      max_output_tokens: Math.max(this.opts.maxTokens ?? 4096, 8192),
      reasoning: { summary: 'auto' },
      store: false,
      include: ['reasoning.encrypted_content'],
    }, { signal })


    // Committed only on success: a failed exchange leaves history untouched so
    // the retry resends the same briefing. Output items (reasoning blocks
    // included, encrypted content and all) are what the next turn replays.
    this.history.push(...turnItems, ...(response.output as OpenAI.Responses.ResponseInputItem[]))
    this.owed = response.output
      .filter((item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call')
      .map((item) => item.call_id)

    let reasoning: string | null = null
    let text: string | null = null
    let toolCall: Turn['toolCall'] = null

    for (const item of response.output) {
      if (item.type === 'reasoning') {
        const summary = item.summary.map((s) => s.text).join('\n').trim()
        if (summary.length > 0) reasoning = summary
      } else if (item.type === 'message') {
        for (const part of item.content) {
          if (part.type === 'output_text' && part.text) text = part.text
          if (part.type === 'refusal') {
            // Completed, billed, model behavior — stays in the measurement.
            text = `[model declined: ${part.refusal}]`
          }
        }
      } else if (item.type === 'function_call' && !toolCall) {
        let args: unknown
        try {
          args = JSON.parse(item.arguments)
        } catch {
          args = null
        }
        // Unparseable or non-object arguments are the model's failure to use
        // the tool, not a provider fault: surface as no tool call.
        toolCall =
          args !== null && typeof args === 'object' && !Array.isArray(args)
            ? { name: item.name, arguments: args as Record<string, unknown> }
            : null
      }
    }
    if (response.status === 'incomplete') {
      // Ran out of output budget before acting — a completed, billed
      // exchange with no usable call. Keep it measurable.
      toolCall = null
      text = `[incomplete: ${response.incomplete_details?.reason ?? 'unspecified'}]`
    }

    const turnUsage: TokenUsage = {
      input: response.usage?.input_tokens ?? 0,
      output: response.usage?.output_tokens ?? 0,
      // Prefix caching is automatic on this endpoint; nothing to opt into.
      cacheRead: response.usage?.input_tokens_details?.cached_tokens ?? 0,
      cacheWrite: 0,
    }
    this.usage = addUsage(this.usage, turnUsage)

    return {
      responseId: response.id ?? null,
      reasoning,
      // Summaries are requested every turn, but models skip them on turns
      // they find easy — the same shape as adaptive thinking elsewhere.
      reasoningAvailable: reasoning !== null,
      text,
      toolCall,
      usage: turnUsage,
    }
  }

  totals(): TokenUsage {
    return this.usage
  }
}
