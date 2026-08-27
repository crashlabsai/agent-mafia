import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CATALOG,
  allProviders,
  byProvider,
  chooseThinking,
  compareCatalog,
  composeUserContent,
  composeUserTurn,
  lookup,
  probeProvider,
  providerById,
} from '../src/providers/index.ts'

test('every catalog entry names a real provider', () => {
  const ids = new Set(allProviders().map((p) => p.id))
  for (const m of CATALOG) {
    assert.ok(ids.has(m.provider), `${m.key} names unknown provider ${m.provider}`)
  }
})

test('catalog keys and wire ids are unique', () => {
  const keys = CATALOG.map((m) => m.key)
  assert.equal(new Set(keys).size, keys.length, 'duplicate model key')
  const wire = CATALOG.map((m) => `${m.provider}:${m.wireId}`)
  assert.equal(new Set(wire).size, wire.length, 'duplicate provider/wireId pair')
})

test('lookup resolves known models and reports unknown ones usefully', () => {
  assert.equal(lookup('opus-5').provider, 'anthropic')
  assert.throws(() => lookup('not-a-model'), /unknown model/)
})

test('every provider covers at least one model', () => {
  for (const p of allProviders()) {
    assert.ok(byProvider(p.id).length > 0, `${p.id} serves no models`)
  }
})

test('providers report configuration without throwing or leaking the key', () => {
  for (const p of allProviders()) {
    const configured = p.isConfigured()
    assert.equal(typeof configured, 'boolean')
    assert.ok(p.envVars.length > 0)
    for (const v of p.envVars) assert.match(v, /^[A-Z0-9_]+$/)
    assert.ok(['visible', 'encrypted', 'none'].includes(p.reasoningFidelity))
    assert.equal(JSON.stringify(p).includes('sk-'), false, 'provider serialized a secret')
  }
})

test('creating a session without a credential fails clearly, not obscurely', () => {
  const p = providerById('anthropic')
  const saved = p.envVars.map((v) => [v, process.env[v]] as const)
  for (const v of p.envVars) delete process.env[v]
  try {
    assert.throws(
      () => p.createSession('claude-opus-5', { system: 's', tools: [], finalTool: 'submit_action' }),
      /MAFIA_ANTHROPIC_API_KEY/,
    )
  } finally {
    for (const [v, val] of saved) if (val !== undefined) process.env[v] = val
  }
})

test('a namespaced key is preferred over the bare vendor name', () => {
  // Managed hosts may reserve the bare name, so the prefixed one must win
  // wherever both happen to be present.
  const p = providerById('anthropic')
  assert.equal(p.envVars[0], 'MAFIA_ANTHROPIC_API_KEY')
  assert.ok(p.envVars.includes('ANTHROPIC_API_KEY'), 'bare name remains supported')
})

test('an unknown provider id is rejected', () => {
  assert.throws(() => providerById('nope'), /unknown provider/)
})

// --- thinking configuration ------------------------------------------------

/** The two shapes the API actually serves, plus a model with no thinking. */
const ADAPTIVE_ONLY = {
  supported: true,
  types: { adaptive: { supported: true }, enabled: { supported: false } },
}
const ENABLED_ONLY = {
  supported: true,
  types: { adaptive: { supported: false }, enabled: { supported: true } },
}

test('thinking is chosen from the model’s own capabilities, not assumed', () => {
  // Hardcoding either form is a 400 on the first wake for half the catalog:
  // the 5-series takes adaptive and rejects enabled; Haiku 4.5 is the reverse.
  const adaptive = chooseThinking(ADAPTIVE_ONLY as never, 2048)
  assert.deepEqual(adaptive.thinking, { type: 'adaptive', display: 'summarized' })

  const enabled = chooseThinking(ENABLED_ONLY as never, 2048)
  assert.equal(enabled.thinking?.type, 'enabled')
})

test('an enabled budget always leaves room for the answer', () => {
  // Thinking is drawn from the same allowance as the reply, so a budget that
  // fills max_tokens starves the submit_action call the wake exists to make.
  for (const maxTokens of [512, 1024, 2048, 8192]) {
    const plan = chooseThinking(ENABLED_ONLY as never, maxTokens)
    const budget = plan.thinking && 'budget_tokens' in plan.thinking ? plan.thinking.budget_tokens : 0
    assert.ok(plan.maxTokens > budget, `max_tokens ${plan.maxTokens} does not exceed budget ${budget}`)
    assert.ok(budget >= 1024, 'below the minimum the API accepts')
  }
})

test('a model without thinking still plays, and says its trace is absent', () => {
  // Absent and withheld are different findings for the deception grader, so
  // the turn must not claim a trace it never had.
  const plan = chooseThinking({ supported: false, types: {} } as never, 2048)
  assert.equal(plan.thinking, null)
  assert.equal(plan.maxTokens, 2048)
})

// --- answering the seat’s own tool call ------------------------------------

test('an outstanding tool call is answered before the next briefing', () => {
  // Skipping this is a 400 on every wake after a seat's first, which the room
  // absorbs as a default — the game finishes, and every seat is a silent no-op
  // from its second turn on.
  const anthropic = composeUserContent(['toolu_1'], 'Day 2 · vote')
  assert.ok(Array.isArray(anthropic))
  const blocks = anthropic as { type: string; tool_use_id?: string; text?: string }[]
  assert.equal(blocks[0]?.type, 'tool_result')
  assert.equal(blocks[0]?.tool_use_id, 'toolu_1')
  assert.equal(blocks.at(-1)?.text, 'Day 2 · vote', 'the briefing still has to arrive')

  const compat = composeUserTurn(['call_1'], 'Day 2 · vote')
  assert.equal(compat[0]?.role, 'tool')
  assert.equal(compat.at(-1)?.role, 'user')
})

test('a first wake sends the briefing with nothing to answer', () => {
  assert.equal(composeUserContent([], 'Day 1 · night'), 'Day 1 · night')
  assert.deepEqual(composeUserTurn([], 'Day 1 · night'), [{ role: 'user', content: 'Day 1 · night' }])
})

test('extra tool calls in one turn are answered too, and told they were ignored', () => {
  // The API requires a result for every call, not just the one the driver used.
  const blocks = composeUserContent(['a', 'b'], 'next') as { type: string; content?: string }[]
  assert.equal(blocks.filter((b) => b.type === 'tool_result').length, 2)
  assert.match(String(blocks[1]?.content), /[Ii]gnored/)
})

// --- catalog drift ---------------------------------------------------------

test('an id the provider no longer serves is reported, with the nearest match', () => {
  // The exact drift that broke the first live run: the undated Haiku alias is
  // not served, and the failure surfaced only mid-game as a 404.
  const rows = compareCatalog(
    [{ key: 'haiku-4.5', provider: 'anthropic', wireId: 'claude-haiku-4-5', label: 'Haiku' }],
    ['claude-opus-5', 'claude-haiku-4-5-20251001'],
  )
  assert.equal(rows[0]?.status, 'missing')
  assert.equal(rows[0]?.note, 'claude-haiku-4-5-20251001')
})

test('a served id passes clean', () => {
  const rows = compareCatalog(
    [{ key: 'opus-5', provider: 'anthropic', wireId: 'claude-opus-5', label: 'Opus' }],
    ['claude-opus-5'],
  )
  assert.deepEqual(rows[0], {
    key: 'opus-5',
    provider: 'anthropic',
    wireId: 'claude-opus-5',
    status: 'served',
    note: null,
  })
})

test('a missing id with nothing like it suggests nothing', () => {
  const rows = compareCatalog(
    [{ key: 'ghost', provider: 'xai', wireId: 'grok-9', label: 'Ghost' }],
    ['some-other-model'],
  )
  assert.equal(rows[0]?.status, 'missing')
  assert.equal(rows[0]?.note, null)
})

test('probing a provider with no credential learns nothing and says so', async () => {
  const p = providerById('nvidia')
  const saved = p.envVars.map((v) => [v, process.env[v]] as const)
  for (const v of p.envVars) delete process.env[v]
  try {
    const report = await probeProvider(p)
    assert.ok(report.rows.every((r) => r.status === 'unchecked'))
    assert.equal(report.error, null, 'no credential is not an error, it is an unknown')
  } finally {
    for (const [v, val] of saved) if (val !== undefined) process.env[v] = val
  }
})
