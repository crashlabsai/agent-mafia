import { AnthropicProvider } from './anthropic.ts'
import { GoogleProvider } from './google.ts'
import { OpenAIProvider } from './openai.ts'
import { COMPAT_PROVIDERS, OpenAICompatProvider } from './openai-compat.ts'
import type { Provider } from './provider.ts'

export * from './provider.ts'
export * from './catalog.ts'
export * from './probe.ts'
export { AnthropicProvider, chooseThinking, composeUserContent, type ThinkingPlan } from './anthropic.ts'
export { GoogleProvider } from './google.ts'
export { OpenAIProvider } from './openai.ts'
export { OpenAICompatProvider, COMPAT_PROVIDERS, composeUserTurn } from './openai-compat.ts'

/** Every provider the arena can reach, whether or not it is credentialed. */
export function allProviders(): Provider[] {
  return [
    new AnthropicProvider(),
    new GoogleProvider(),
    new OpenAIProvider(),
    ...COMPAT_PROVIDERS.map((c) => new OpenAICompatProvider(c)),
  ]
}

export function providerById(id: string): Provider {
  const found = allProviders().find((p) => p.id === id)
  if (!found) throw new Error(`unknown provider "${id}"`)
  return found
}
