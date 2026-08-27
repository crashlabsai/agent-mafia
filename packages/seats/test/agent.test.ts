import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG, type Observation, type SeatDriver, type SeatId } from '@mafia/protocol'
import { createGame, observe, step } from '@mafia/engine'
import { MemorySink, fixedClock, runGame, verify } from '@mafia/room'
import { AgentDriver, bindTarget, checkLegal, toAction } from '../src/agent.ts'
import { buildSystemPrompt, renderBriefing, rulesFrom } from '../src/prompt.ts'
import { SUBMIT_ACTION } from '../src/tools.ts'
import { ZERO_USAGE, type Session, type Turn } from '../src/providers/provider.ts'

/** A session that answers from a script. No network, no key, no cost. */
class FakeSession implements Session {
  readonly sent: string[] = []
  readonly system: string
  private replies: (() => Turn)[]

  constructor(system: string, replies: (() => Turn)[]) {
    this.system = system
    this.replies = replies
  }
  async send(userContent: string): Promise<Turn> {
    this.sent.push(userContent)
    const next = this.replies.length > 1 ? this.replies.shift() : this.replies[0]
    return next!()
  }
  totals() {
    return ZERO_USAGE
  }
}

function turnWith(args: Record<string, unknown>, reasoning = 'thinking privately'): Turn {
  return {
    responseId: null,
    reasoning,
    reasoningAvailable: true,
    text: null,
    toolCall: { name: 'submit_action', arguments: args },
    usage: { input: 100, output: 20, cacheRead: 80, cacheWrite: 0 },
  }
}

/** Answers whatever the briefing says is legal, so a whole game can run. */
function compliantReply(obs: () => Observation): () => Turn {
  return () => {
    const o = obs()
    const spec = o.legalActions[0]
    if (!spec) return turnWith({ action: 'pass' })
    const target = spec.targets?.[0]
    switch (spec.type) {
      case 'speak':
      case 'mafia_chat':
        return turnWith({ action: spec.type, message: 'I have no read yet.' })
      case 'vote':
        return turnWith({ action: 'vote', target })
      case 'night_kill':
      case 'night_protect':
      case 'night_investigate':
        return turnWith({ action: spec.type, target })
      default:
        return turnWith({ action: spec.type })
    }
  }
}

// --- tool argument parsing -------------------------------------------------

test('parses each action shape', () => {
  assert.deepEqual(toAction({ action: 'pass' }), { ok: true, action: { type: 'pass' } })
  assert.deepEqual(toAction({ action: 'no_action' }), { ok: true, action: { type: 'no_action' } })
  assert.deepEqual(toAction({ action: 'speak', message: 'hi' }), {
    ok: true,
    action: { type: 'speak', text: 'hi' },
  })
  assert.deepEqual(toAction({ action: 'vote', target: 'seat-2' }), {
    ok: true,
    action: { type: 'vote', target: 'seat-2' },
  })
  assert.deepEqual(toAction({ action: 'night_kill', target: 'seat-3' }), {
    ok: true,
    action: { type: 'night_kill', target: 'seat-3' },
  })
})

test('a vote with no target is an abstention, not an error', () => {
  const r = toAction({ action: 'vote' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.ok && r.action, { type: 'vote', target: null })
})

test('malformed calls are reported, never coerced', () => {
  // Coercing these would put words in a seat's mouth and corrupt the record
  // the deception grader reads.
  for (const args of [
    {},
    { action: 'speak' },
    { action: 'speak', message: '   ' },
    { action: 'night_kill' },
    { action: 'not_a_thing' },
  ]) {
    const r = toAction(args as Record<string, unknown>)
    assert.equal(r.ok, false, `${JSON.stringify(args)} should not parse`)
    assert.ok(!r.ok && r.reason.length > 0)
  }
})

// --- prompt and briefing ---------------------------------------------------

test('the system prompt states the rules without coaching, per framing arm', () => {
  const { state } = createGame({ roomId: 'r', matchSeed: 'p' })
  const obs = observe(state, state.seats[0]!.id)
  // The prompt is hard-wrapped, so match against normalised whitespace —
  // otherwise a phrase straddling a newline silently fails.
  const flat = (f: Parameters<typeof buildSystemPrompt>[1]) =>
    buildSystemPrompt(rulesFrom(obs, DEFAULT_CONFIG), f).replace(/\s+/g, ' ')

  const rules = flat('rules')
  const unverified = flat('unverified')
  const arena = flat('arena')

  // The framing arms nest strictly: each adds to the previous, nothing else.
  assert.ok(!/Nothing said at the table is verified/.test(rules), 'rules arm must not prime epistemics')
  assert.ok(!/reads your silence/.test(rules))
  assert.match(unverified, /Nothing said at the table is verified/)
  assert.ok(!/reads your silence/.test(unverified), 'default arm must not prime impression management')
  assert.ok(!/arena/i.test(unverified))
  assert.match(arena, /reads your silence/)
  assert.match(arena, /part of an arena/)
  // The old false claim must never return, in any arm.
  assert.ok(!/thousands of games/.test(arena))
  assert.ok(!/other instances of you/.test(arena))

  for (const sys of [rules, unverified, arena]) {
    assert.match(sys, /Mafia win when/)
    assert.match(sys, /2 mafia,/, 'mafia is uncountable')
    // De-opinionation: no persona and no strategy advice, in every arm.
    for (const banned of [/you should/i, /strategy/i, /try to (win|deceive|lie)/i, /you are a (cunning|skilled)/i]) {
      assert.ok(!banned.test(sys), `system prompt coaches: ${banned}`)
    }
  }
  // The default is the unverified arm.
  assert.equal(flat(undefined), unverified)
})

test('the first briefing states role and table; later ones only carry the delta', () => {
  const { state } = createGame({ roomId: 'r', matchSeed: 'brief' })
  const seat = state.pending!.awaiting[0] as SeatId
  const first = observe(state, seat)

  const opening = renderBriefing(first, null)
  assert.match(opening, /Your role:/)
  assert.match(opening, /## The table/)
  assert.match(opening, /## Your options/)

  const repeat = renderBriefing(first, first)
  assert.ok(!repeat.includes('## The table'), 'table should not be restated')
  assert.ok(repeat.length < opening.length, 'a no-change briefing should be shorter')
})

test('a mafia seat sees partners in its briefing and a town seat does not', () => {
  const { state } = createGame({ roomId: 'r', matchSeed: 'partners' })
  for (const s of state.seats) {
    const text = renderBriefing(observe(state, s.id), null)
    if (s.role === 'mafia') assert.match(text, /Mafia partners:/)
    else assert.ok(!text.includes('Mafia partners:'), `${s.id} is town but saw partners`)
  }
})

test('the briefing never names another living seat’s role', () => {
  const { state } = createGame({ roomId: 'r', matchSeed: 'leak' })
  for (const me of state.seats) {
    const text = renderBriefing(observe(state, me.id), null)
    for (const other of state.seats) {
      if (other.id === me.id) continue
      if (other.role === 'mafia' && me.role === 'mafia') continue
      assert.ok(
        !new RegExp(`${other.name}[^\\n]*\\b${other.role}\\b`).test(text),
        `${me.id} briefing leaked ${other.id} as ${other.role}`,
      )
    }
  }
})

// --- the driver ------------------------------------------------------------

test('the tool schema is fixed, so the cached prefix survives phase changes', () => {
  const props = SUBMIT_ACTION.parameters['properties'] as Record<string, unknown>
  const actionProp = props['action'] as { enum: string[] }
  // Every action type, not just the currently legal ones — a per-phase schema
  // would invalidate the cache on every turn.
  assert.ok(actionProp.enum.includes('speak'))
  assert.ok(actionProp.enum.includes('night_kill'))
  assert.ok(actionProp.enum.includes('no_action'))
})

test('the driver resolves a binding without contacting the provider', () => {
  const d = new AgentDriver({
    seat: 'seat-1',
    modelKey: 'opus-5',
    config: DEFAULT_CONFIG,
    sessionFactory: (system) => new FakeSession(system, [() => turnWith({ action: 'pass' })]),
  })
  const { promptSha256, toolsSha256, ...rest } = d.binding
  assert.deepEqual(rest, {
    seat: 'seat-1',
    modelKey: 'opus-5',
    provider: 'anthropic',
    wireId: 'claude-opus-5',
    reasoningFidelity: 'visible',
    framing: 'unverified',
  })
  // The hashes pin the exact prompt and tool schema for the record.
  assert.match(promptSha256, /^[0-9a-f]{64}$/)
  assert.match(toolsSha256, /^[0-9a-f]{64}$/)
})

test('an unknown model fails at construction, before any spend', () => {
  assert.throws(
    () => new AgentDriver({ seat: 'seat-1', modelKey: 'no-such-model', config: DEFAULT_CONFIG }),
    /unknown model/,
  )
})

test('a bad tool call is retried with an explanation, then succeeds', async () => {
  const { state } = createGame({ roomId: 'r', matchSeed: 'retry' })
  const seat = state.pending!.awaiting[0] as SeatId
  let session!: FakeSession

  const d = new AgentDriver({
    seat,
    modelKey: 'opus-5',
    config: DEFAULT_CONFIG,
    sessionFactory: (system) => {
      session = new FakeSession(system, [
        () => turnWith({ action: 'speak' }), // missing message
        () => turnWith({ action: 'pass' }),
      ])
      return session
    },
  })

  const sub = await d.act(observe(state, seat))
  assert.deepEqual(sub.action, { type: 'pass' })
  assert.equal(session.sent.length, 2, 'should have retried exactly once')
  assert.match(session.sent[1]!, /could not be used/)
  assert.match(session.sent[1]!, /needs a non-empty "message"/)
  assert.equal(d.stats().failures, 0)
})

test('a seat that never returns a usable action is defaulted, not left hanging', async () => {
  const { state } = createGame({ roomId: 'r', matchSeed: 'broken' })
  const seat = state.pending!.awaiting[0] as SeatId
  const d = new AgentDriver({
    seat,
    modelKey: 'opus-5',
    config: DEFAULT_CONFIG,
    sessionFactory: (system) =>
      new FakeSession(system, [
        () => ({
          responseId: null,
          reasoning: null, reasoningAvailable: false, text: 'I refuse to use tools',
          toolCall: null, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
        }),
      ]),
  })
  const sub = await d.act(observe(state, seat))
  assert.equal(sub.timedOut, true)
  assert.equal(d.stats().failures, 1)
})

test('reasoning is carried onto the submission for the grader', async () => {
  const { state } = createGame({ roomId: 'r', matchSeed: 'trace' })
  const seat = state.pending!.awaiting[0] as SeatId
  const d = new AgentDriver({
    seat,
    modelKey: 'opus-5',
    config: DEFAULT_CONFIG,
    sessionFactory: (system) =>
      new FakeSession(system, [() => turnWith({ action: 'pass' }, 'I will claim to be the doctor')]),
  })
  const sub = await d.act(observe(state, seat))
  assert.equal(sub.reasoning, 'I will claim to be the doctor')
})

test('a full seven-seat agent game runs, and the log verifies', async () => {
  const { state, events: setupEvents } = createGame({ roomId: 'agents', matchSeed: 'full' })
  const drivers: Record<SeatId, SeatDriver> = {}
  const live: Record<SeatId, Observation> = {}

  for (const s of state.seats) {
    drivers[s.id] = new AgentDriver({
      seat: s.id,
      modelKey: 'opus-5',
      config: DEFAULT_CONFIG,
      sessionFactory: (system) => new FakeSession(system, [compliantReply(() => live[s.id]!)]),
    })
    // Snapshot the observation the driver is about to see, so the fake can
    // answer with something legal.
    const original = drivers[s.id]!.act.bind(drivers[s.id]!)
    drivers[s.id]!.act = async (obs) => {
      live[s.id] = obs
      return original(obs)
    }
  }

  const sink = new MemorySink()
  const result = await runGame({
    state, drivers, sink, setupEvents, deadlineMs: null, clock: fixedClock,
  })

  assert.equal(result.state.phase, 'ended')
  assert.equal(verify(sink.events).ok, true)
  assert.ok(sink.events.some((e) => e.type === 'reasoning_recorded'))
  assert.ok(sink.events.some((e) => e.type === 'message_sent'))
})

test('one session per seat spans the whole game', async () => {
  const { state, events: setupEvents } = createGame({ roomId: 'cont', matchSeed: 'session' })
  const drivers: Record<SeatId, SeatDriver> = {}
  const live: Record<SeatId, Observation> = {}
  const built: Record<SeatId, number> = {}

  for (const s of state.seats) {
    built[s.id] = 0
    const d = new AgentDriver({
      seat: s.id,
      modelKey: 'opus-5',
      config: DEFAULT_CONFIG,
      sessionFactory: (system) => {
        built[s.id] = (built[s.id] ?? 0) + 1
        return new FakeSession(system, [compliantReply(() => live[s.id]!)])
      },
    })
    drivers[s.id] = d
    const original = d.act.bind(d)
    d.act = async (obs) => {
      live[s.id] = obs
      return original(obs)
    }
  }

  await runGame({ state, drivers, sink: new MemorySink(), setupEvents, deadlineMs: null, clock: fixedClock })

  for (const s of state.seats) {
    assert.ok(built[s.id]! <= 1, `${s.id} opened ${built[s.id]} sessions; a seat gets exactly one`)
  }
})

// --- naming a player -------------------------------------------------------

test('a player named any way the table names them resolves to their seat', () => {
  const { state } = createGame({ roomId: 'r', matchSeed: 'targets' })
  const seat = state.pending!.awaiting[0] as SeatId
  const obs = observe(state, seat)
  const other = obs.table.seats.find((s) => s.id !== seat)!

  // Every form a model actually produced in a live game, plus the id itself.
  for (const written of [other.id, other.name, other.name.toLowerCase(), `${other.name} (${other.id})`]) {
    const r = bindTarget({ type: 'vote', target: written }, obs)
    assert.equal(r.ok, true, `"${written}" should resolve`)
    assert.deepEqual(r.ok && r.action, { type: 'vote', target: other.id })
  }

  const n = other.id.replace('seat-', '')
  for (const written of [n, `seat ${n}`, `seat_${n}`, `#${n}`]) {
    const r = bindTarget({ type: 'night_kill', target: written }, obs)
    assert.equal(r.ok, true, `"${written}" should resolve`)
    assert.deepEqual(r.ok && r.action, { type: 'night_kill', target: other.id })
  }
})

test('a target naming nobody is reported back, never guessed at', () => {
  const { state } = createGame({ roomId: 'r', matchSeed: 'targets' })
  const seat = state.pending!.awaiting[0] as SeatId
  const obs = observe(state, seat)

  const r = bindTarget({ type: 'vote', target: 'Bruno' }, obs)
  assert.equal(r.ok, false)
  // The reason has to carry the roster, or the retry is a second blind guess.
  assert.ok(!r.ok && r.reason.includes('seat-1'), r.ok ? '' : r.reason)
})

test('an abstention keeps its null target', () => {
  const { state } = createGame({ roomId: 'r', matchSeed: 'targets' })
  const seat = state.pending!.awaiting[0] as SeatId
  const r = bindTarget({ type: 'vote', target: null }, observe(state, seat))
  assert.deepEqual(r.ok && r.action, { type: 'vote', target: null })
})

test('a seat that names a target by name is not made to waste its turn', async () => {
  // The regression this guards: in the first live game the Detective spent all
  // three of its nights rejected for writing "1" instead of "seat-1", so the
  // town's only information role produced nothing at all.
  const { state } = createGame({ roomId: 'r', matchSeed: 'byname' })
  // Night chat has nothing to target; the night actions that follow do.
  let night = state
  while (night.phase === 'night_chat' && night.pending) {
    const s = night.pending.awaiting[0] as SeatId
    night = step(night, { seat: s, action: { type: 'pass' }, reasoning: null }).state
  }
  const seat = night.pending!.awaiting[0] as SeatId
  const obs = observe(night, seat)
  const spec = obs.legalActions.find((a) => a.targets && a.targets.length > 0)
  const target = spec?.targets?.[0]
  assert.ok(spec && target, 'expected a targeted action to test with')

  const named = obs.table.seats.find((s) => s.id === target)!.name
  const d = new AgentDriver({
    seat,
    modelKey: 'opus-5',
    config: DEFAULT_CONFIG,
    sessionFactory: (system) => new FakeSession(system, [() => turnWith({ action: spec.type, target: named })]),
  })

  const sub = await d.act(obs)
  assert.deepEqual(sub.action, { type: spec.type, target })
  assert.equal(sub.timedOut, undefined, 'the seat acted; it did not time out')
})

// --- a provider that fails -------------------------------------------------

test('a provider error is recorded and the same briefing retried', async () => {
  const { state } = createGame({ roomId: 'r', matchSeed: 'flaky' })
  const seat = state.pending!.awaiting[0] as SeatId
  let session!: FakeSession

  const d = new AgentDriver({
    seat,
    modelKey: 'opus-5',
    config: DEFAULT_CONFIG,
    sessionFactory: (system) => {
      session = new FakeSession(system, [
        () => {
          throw new Error('500 overloaded_error')
        },
        () => turnWith({ action: 'pass' }),
      ])
      return session
    },
  })

  const sub = await d.act(observe(state, seat))
  assert.deepEqual(sub.action, { type: 'pass' })
  assert.equal(session.sent.length, 2)
  assert.equal(session.sent[0], session.sent[1], 'a failed call must not consume the briefing')
  assert.deepEqual(d.stats().errors, ['500 overloaded_error'])
})

test('a seat the provider never serves reads as broken, not as quiet', async () => {
  // A seat defaulted every wake is indistinguishable in the transcript from a
  // seat that chose silence. The driver has to say which one it was.
  const { state } = createGame({ roomId: 'r', matchSeed: 'dead-provider' })
  const seat = state.pending!.awaiting[0] as SeatId
  const d = new AgentDriver({
    seat,
    modelKey: 'opus-5',
    config: DEFAULT_CONFIG,
    sessionFactory: (system) =>
      new FakeSession(system, [
        () => {
          throw new Error('404 model not found')
        },
      ]),
  })

  const sub = await d.act(observe(state, seat))
  assert.equal(sub.timedOut, true)
  assert.equal(d.stats().failures, 1)
  assert.equal(d.stats().errors.length, 3, 'every attempt failed, and every one was recorded')
})

// --- what the seat was told it may do --------------------------------------

test('an over-long message is sent back to be shortened, not thrown away', async () => {
  // The regression this guards: seven turns lost in one live game, all to
  // messages a little over the limit — most of the endgame discussion.
  const { state } = createGame({ roomId: 'r', matchSeed: 'verbose' })
  let day = state
  while (day.phase !== 'discussion' && day.pending) {
    const s = day.pending.awaiting[0] as SeatId
    const obs = observe(day, s)
    const spec = obs.legalActions[0]!
    day = step(day, {
      seat: s,
      action: spec.targets?.[0]
        ? ({ type: spec.type, target: spec.targets[0] } as never)
        : ({ type: 'pass' } as never),
      reasoning: null,
    }).state
  }

  const seat = day.pending!.awaiting[0] as SeatId
  const obs = observe(day, seat)
  const limit = obs.legalActions.find((a) => a.type === 'speak')!.maxChars!
  let session!: FakeSession

  const d = new AgentDriver({
    seat,
    modelKey: 'opus-5',
    config: DEFAULT_CONFIG,
    sessionFactory: (system) => {
      session = new FakeSession(system, [
        () => turnWith({ action: 'speak', message: 'x'.repeat(limit + 200) }),
        () => turnWith({ action: 'speak', message: 'briefly, then.' }),
      ])
      return session
    },
  })

  const sub = await d.act(obs)
  assert.deepEqual(sub.action, { type: 'speak', text: 'briefly, then.' })
  assert.match(session.sent[1]!, new RegExp(`${limit}`), 'the retry must state the actual limit')
  assert.match(session.sent[1]!, /characters/)
})

test('an action the seat may not take this turn is corrected, not spent', () => {
  const { state } = createGame({ roomId: 'r', matchSeed: 'wrongphase' })
  const seat = state.pending!.awaiting[0] as SeatId
  const obs = observe(state, seat)

  const r = checkLegal({ ok: true, action: { type: 'vote', target: null } }, obs)
  assert.equal(r.ok, false)
  assert.ok(!r.ok && r.reason.includes('not available this turn'))
})

test('an illegal target is named as illegal, with the legal ones', () => {
  const { state } = createGame({ roomId: 'r', matchSeed: 'badtarget' })
  let night = state
  while (night.phase === 'night_chat' && night.pending) {
    const s = night.pending.awaiting[0] as SeatId
    night = step(night, { seat: s, action: { type: 'pass' }, reasoning: null }).state
  }
  const seat = night.pending!.awaiting[0] as SeatId
  const obs = observe(night, seat)
  const spec = obs.legalActions.find((a) => a.targets && a.targets.length > 0)!
  const illegal = obs.table.seats.map((s) => s.id).find((id) => !spec.targets!.includes(id))!

  const r = checkLegal({ ok: true, action: { type: spec.type, target: illegal } as never }, obs)
  assert.equal(r.ok, false)
  assert.ok(!r.ok && r.reason.includes(spec.targets![0]!))
})

test('a legal action passes through untouched', () => {
  const { state } = createGame({ roomId: 'r', matchSeed: 'fine' })
  const seat = state.pending!.awaiting[0] as SeatId
  const obs = observe(state, seat)
  const spec = obs.legalActions[0]!
  const action = spec.type === 'mafia_chat' ? { type: 'mafia_chat', text: 'evening' } : { type: 'pass' }
  const r = checkLegal({ ok: true, action: action as never }, obs)
  assert.deepEqual(r, { ok: true, action })
})
