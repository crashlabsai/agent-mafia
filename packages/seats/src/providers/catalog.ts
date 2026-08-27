import type { ReasoningFidelity } from './provider.ts'

export interface ModelEntry {
  /** Stable key used in seat configs and recorded in the log. */
  key: string
  /** Provider id that serves it. */
  provider: string
  /** Exact wire identifier sent to the provider. */
  wireId: string
  /** Human label for the Reveal. Never shown to seats mid-game. */
  label: string
}

/**
 * The model catalog.
 *
 * Anthropic wire ids are verified against the live list endpoint; every other
 * provider's ids drift as models ship and retire, so treat the rest as a
 * starting set and check them with `mafia providers --probe` before trusting a
 * leaderboard built on them. A wrong id fails loudly at session start rather
 * than silently degrading a run.
 */
export const CATALOG: ModelEntry[] = [
  // --- Anthropic (native) — probed 2026-08-22, all served ------------------
  { key: 'opus-5', provider: 'anthropic', wireId: 'claude-opus-5', label: 'Claude Opus 5' },
  { key: 'fable-5', provider: 'anthropic', wireId: 'claude-fable-5', label: 'Claude Fable 5' },
  { key: 'sonnet-5', provider: 'anthropic', wireId: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { key: 'haiku-4.5', provider: 'anthropic', wireId: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },

  // --- OpenAI (native) — probed 2026-08-22 ---------------------------------
  // 5.6 ships as three named variants; there is no bare `gpt-5.6`.
  { key: 'gpt-5.6-sol', provider: 'openai', wireId: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
  { key: 'gpt-5.6-terra', provider: 'openai', wireId: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
  { key: 'gpt-5.6-luna', provider: 'openai', wireId: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  { key: 'gpt-5.5', provider: 'openai', wireId: 'gpt-5.5', label: 'GPT-5.5' },

  // --- Fireworks (OpenAI-compatible): the open-weight tail -----------------
  // Probed 2026-08-22. Fireworks writes decimal points as `p`: glm-5p2 is
  // GLM 5.2. Every id below was returned by its own list endpoint.
  {
    key: 'deepseek-v4-pro',
    provider: 'fireworks',
    wireId: 'accounts/fireworks/models/deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
  },
  {
    key: 'deepseek-v4-flash',
    provider: 'fireworks',
    wireId: 'accounts/fireworks/models/deepseek-v4-flash-0731',
    label: 'DeepSeek V4 Flash',
  },
  {
    key: 'kimi-k3',
    provider: 'fireworks',
    wireId: 'accounts/fireworks/models/kimi-k3',
    label: 'Kimi K3',
  },
  {
    key: 'kimi-k2.6',
    provider: 'fireworks',
    wireId: 'accounts/fireworks/models/kimi-k2p6',
    label: 'Kimi K2.6',
  },
  {
    key: 'glm-5.2',
    provider: 'fireworks',
    wireId: 'accounts/fireworks/models/glm-5p2',
    label: 'GLM 5.2',
  },
  {
    key: 'qwen3.8-max',
    provider: 'fireworks',
    wireId: 'accounts/fireworks/models/qwen3p8-max',
    label: 'Qwen3.8 Max',
  },
  {
    key: 'minimax-m3',
    provider: 'fireworks',
    wireId: 'accounts/fireworks/models/minimax-m3',
    label: 'MiniMax M3',
  },
  {
    // Nemotron is reachable through Fireworks, so no separate NVIDIA
    // credential is needed to seat it.
    key: 'nemotron-3-ultra',
    provider: 'fireworks',
    wireId: 'accounts/fireworks/models/nemotron-3-ultra-nvfp4',
    label: 'Nemotron 3 Ultra',
  },
  {
    key: 'gpt-oss-120b',
    provider: 'fireworks',
    wireId: 'accounts/fireworks/models/gpt-oss-120b',
    label: 'GPT-OSS 120B',
  },
  {
    key: 'muse-glimmer',
    provider: 'fireworks',
    wireId: 'accounts/fireworks/models/muse-glimmer-30b',
    label: 'Meta Muse Glimmer 30B',
  },

  // --- Google (native) — probed 2026-08-24, both served --------------------
  { key: 'gemini-3.1-pro', provider: 'google', wireId: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { key: 'gemini-3.5-flash', provider: 'google', wireId: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { key: 'gemini-3.7-flash', provider: 'google', wireId: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },

  // --- xAI (OpenAI-compatible) — probed 2026-08-24 -------------------------
  { key: 'grok-4.6', provider: 'xai', wireId: 'grok-4.6', label: 'Grok 4.6' },

  // --- NVIDIA NIM — UNPROBED. Prefer the Fireworks-hosted Nemotron above. --
  {
    key: 'nemotron-ultra-nim',
    provider: 'nvidia',
    wireId: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    label: 'Nemotron Ultra (NIM)',
  },

  // --- OpenRouter (aggregator; stealth-only exception) — probed 2026-08-24 --
  // Ranked with an asterisk: serving backend and true identity unknown.
  {
    key: 'ox-alpha',
    provider: 'openrouter',
    wireId: 'stealth/ox-alpha',
    label: 'Ox Alpha (stealth)',
  },
  {
    // Meta's frontier line. Spark is not served by any named backend we hold
    // a credential for, so it rides the aggregator with the same asterisk as
    // the stealth seat. Glimmer (30B, Fireworks) stays catalogued for
    // small-model comparisons.
    key: 'muse-spark',
    provider: 'openrouter',
    wireId: 'meta/muse-spark-1.2',
    label: 'Meta Muse Spark 1.2',
  },
]

export function lookup(key: string): ModelEntry {
  const found = CATALOG.find((m) => m.key === key)
  if (!found) {
    throw new Error(
      `unknown model "${key}". Known: ${CATALOG.map((m) => m.key).join(', ')}`,
    )
  }
  return found
}

export function byProvider(providerId: string): ModelEntry[] {
  return CATALOG.filter((m) => m.provider === providerId)
}

/**
 * Recorded per seat in the omniscient stream at bind time.
 *
 * Without this a rating cannot be defended months later: you would not know
 * which model actually served the seat, nor whether its reasoning was visible
 * to the grader or withheld.
 */
export interface SeatBinding {
  seat: string
  modelKey: string
  provider: string
  wireId: string
  reasoningFidelity: ReasoningFidelity
  /** The system-prompt framing arm this seat played under. */
  framing: string
  /** sha256 of the exact system prompt, so no game's prompt is ambiguous. */
  promptSha256: string
  /** sha256 of the tool schema list. */
  toolsSha256: string
}
