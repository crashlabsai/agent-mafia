import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { EventEnvelope } from '@mafia/protocol'
import { eventsAfter, isSafeRunFile, parseJsonl, validateRunSpec } from '../src/server.ts'

test('run file names are confined to bare jsonl files', () => {
  assert.equal(isSafeRunFile('g.jsonl'), true)
  assert.equal(isSafeRunFile('ui-abc123.jsonl'), true)
  for (const bad of [
    '../etc/passwd',
    'a/b.jsonl',
    '..\\x.jsonl',
    'x.jsonl.txt',
    '.hidden.jsonl',
    'a'.repeat(100) + '.jsonl',
    '',
  ]) {
    assert.equal(isSafeRunFile(bad), false, `${bad} should be rejected`)
  }
})

test('a half-written trailing line is left for the next poll, not an error', () => {
  const good = '{"seq":0,"type":"game_created"}\n{"seq":1,"type":"phase_changed"}\n'
  const events = parseJsonl(good + '{"seq":2,"ty')
  assert.equal(events.length, 2)
  assert.equal(events[1]!.seq, 1)
})

test('eventsAfter slices strictly after the cursor', () => {
  const events = [0, 1, 2, 3].map((seq) => ({ seq }) as EventEnvelope)
  assert.deepEqual(eventsAfter(events, -1).length, 4)
  assert.deepEqual(eventsAfter(events, 1).map((e) => e.seq), [2, 3])
  assert.deepEqual(eventsAfter(events, 3), [])
})

test('launch requests are validated server-side, not trusted from the page', () => {
  const reachable = new Set(['opus-5'])

  const ok = validateRunSpec({ driver: 'agent', models: ['opus-5'] }, reachable)
  assert.equal(ok.ok, true)
  assert.ok(ok.ok && /^[A-Za-z0-9-]+$/.test(ok.spec.seed), 'a generated seed must be launchable')

  const scripted = validateRunSpec({ driver: 'scripted' }, new Set())
  assert.equal(scripted.ok, true, 'scripted runs need no credentials')

  for (const [raw, why] of [
    [{ driver: 'agent', models: [] }, 'no models'],
    [{ driver: 'agent', models: ['nope'] }, 'unknown model'],
    [{ driver: 'agent', models: ['gpt-5.5'] }, 'unreachable model'],
    [{ driver: 'agent', models: ['opus-5'], seed: 'x; rm -rf /' }, 'hostile seed'],
    [{ driver: 'human' }, 'unknown driver'],
    [null, 'no body'],
  ] as const) {
    const r = validateRunSpec(raw, reachable)
    assert.equal(r.ok, false, `should reject: ${why}`)
  }
})
