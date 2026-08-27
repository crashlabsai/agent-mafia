import { GoogleGenAI, Type, type FunctionDeclaration, type Schema } from '@google/genai'
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
 * Native Gemini adapter.
 *
 * Gemini exposes thinking as content parts flagged `thought`, so reasoning is
 * readable rather than opaque — but only when a thinking budget is requested
 * and thoughts are explicitly included.
 */
export class GoogleProvider implements Provider {
  readonly id = 'google'
  readonly envVars = ['MAFIA_GEMINI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'] as const
  readonly envVar = 'MAFIA_GEMINI_API_KEY'
  readonly reasoningFidelity = 'visible' as const

  isConfigured(): boolean {
    return resolveKey(this.envVars) !== null
  }

  createSession(model: string, opts: SessionOptions): Session {
    const apiKey = resolveKey(this.envVars)
    if (!apiKey) throw new ProviderError(this.id, `set ${this.envVars.join(' or ')}`)
    return new GoogleSession(apiKey, model, opts)
  }

  async listModels(): Promise<string[]> {
    const apiKey = resolveKey(this.envVars)
    if (!apiKey) throw new ProviderError(this.id, `set ${this.envVars.join(' or ')}`)
    const client = new GoogleGenAI({ apiKey })
    const ids: string[] = []
    for await (const model of await client.models.list()) {
      // Gemini reports fully qualified names; the catalog carries the bare id.
      if (model.name) ids.push(model.name.replace(/^models\//, ''))
    }
    return ids
  }
}

interface GeminiContent {
  role: string
  parts: Record<string, unknown>[]
}

class GoogleSession implements Session {
  private readonly client: GoogleGenAI
  private readonly model: string
  private readonly opts: SessionOptions
  private readonly history: GeminiContent[] = []
  private usage: TokenUsage = ZERO_USAGE
  private pendingFunctionName: string | null = null

  constructor(apiKey: string, model: string, opts: SessionOptions) {
    this.client = new GoogleGenAI({ apiKey })
    this.model = model
    this.opts = opts
  }

  async send(userContent: string, signal?: AbortSignal): Promise<Turn> {
    const outgoing: Record<string, unknown>[] = []
    const owedFunction = this.pendingFunctionName
    if (owedFunction) {
      outgoing.push({
        functionResponse: { name: owedFunction, response: { result: 'Action recorded.' } },
      })
    }
    outgoing.push({ text: userContent })
    const userTurn = { role: 'user', parts: outgoing } as GeminiContent

    const response = await this.client.models.generateContent({
      model: this.model,
      // Committed only on success: a failed or aborted exchange must leave
      // the history untouched, or the retry double-sends the user turn.
      contents: [...this.history, userTurn] as never,
      config: {
        systemInstruction: this.opts.system,
        maxOutputTokens: this.opts.maxTokens ?? 4096,
        abortSignal: signal,
        // Ask for thoughts back; without this the trace is unavailable and
        // every lie would grade as "reasoning withheld".
        thinkingConfig: { includeThoughts: true },
        tools: [{ functionDeclarations: this.opts.tools.map(toDeclaration) }],
      },
    })
    this.history.push(userTurn)
    this.pendingFunctionName = null

    const candidate = response.candidates?.[0]
    const parts = (candidate?.content?.parts ?? []) as Record<string, unknown>[]
    if (candidate?.content) this.history.push(candidate.content as GeminiContent)

    let reasoning: string | null = null
    let text: string | null = null
    let toolCall: Turn['toolCall'] = null

    for (const part of parts) {
      const asText = typeof part['text'] === 'string' ? part['text'] : null
      if (part['thought'] === true && asText) reasoning = asText
      else if (asText) text = asText
      const fn = part['functionCall'] as { name?: string; args?: unknown } | undefined
      if (fn?.name && !toolCall) {
        // First call wins, matching what the seat is told; non-object args
        // are the model failing the tool, surfaced as no call.
        const args = fn.args ?? {}
        if (args !== null && typeof args === 'object' && !Array.isArray(args)) {
          toolCall = { name: fn.name, arguments: args as Record<string, unknown> }
          this.pendingFunctionName = fn.name
        }
      }
    }

    const meta = response.usageMetadata
    const turnUsage: TokenUsage = {
      input: meta?.promptTokenCount ?? 0,
      output: meta?.candidatesTokenCount ?? 0,
      cacheRead: meta?.cachedContentTokenCount ?? 0,
      cacheWrite: 0,
    }
    this.usage = addUsage(this.usage, turnUsage)

    return {
      responseId: response.responseId ?? null,
      reasoning,
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

/** JSON Schema to Gemini's Schema shape, for the shapes our tools actually use. */
function toDeclaration(t: {
  name: string
  description: string
  parameters: Record<string, unknown>
}): FunctionDeclaration {
  return {
    name: t.name,
    description: t.description,
    parameters: convert(t.parameters) as Schema,
  }
}

function convert(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const type = schema['type']
  if (typeof type === 'string') {
    const map: Record<string, unknown> = {
      object: Type.OBJECT,
      string: Type.STRING,
      number: Type.NUMBER,
      integer: Type.INTEGER,
      boolean: Type.BOOLEAN,
      array: Type.ARRAY,
    }
    out['type'] = map[type] ?? Type.STRING
  }
  if (typeof schema['description'] === 'string') out['description'] = schema['description']
  if (Array.isArray(schema['enum'])) out['enum'] = schema['enum']
  if (Array.isArray(schema['required'])) out['required'] = schema['required']
  const props = schema['properties'] as Record<string, Record<string, unknown>> | undefined
  if (props) {
    out['properties'] = Object.fromEntries(
      Object.entries(props).map(([k, v]) => [k, convert(v)]),
    )
  }
  const items = schema['items'] as Record<string, unknown> | undefined
  if (items) out['items'] = convert(items)
  return out
}
