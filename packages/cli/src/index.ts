#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { DEFAULT_CONFIG, type SeatDriver, type SeatId, type TableConfig } from '@mafia/protocol'
import { createGame, observe } from '@mafia/engine'
import {
  JsonlFileSink,
  MemorySink,
  TeeSink,
  eventsVisibleTo,
  fixedClock,
  fork,
  readLog,
  replay,
  runGame,
  verify,
  wallClock,
} from '@mafia/room'
import {
  AgentDriver,
  CATALOG,
  FRAMINGS,
  ScriptedDriver,
  allProviders,
  alwaysPass,
  byProvider,
  firstLegal,
  lookup,
  probeProvider,
  providerById,
  resolveEnvVar,
  seededRandom,
  type Framing,
  type Policy,
  type Provider,
} from '@mafia/seats'
import type { EngineEvent } from '@mafia/protocol'
import { startViewer } from '@mafia/viewer'

const POLICIES: Record<string, Policy> = { seededRandom, firstLegal, alwaysPass }

const USAGE = `mafia — deterministic Mafia environment

  mafia run     [--seed S] [--seats N] [--out FILE] [--config FILE]
                [--fixed-ts] [--quiet]
                [--driver scripted] [--policy P]
                [--driver agent] [--models k1,k2,...]
                [--framing rules|unverified|arena] [--deadline SECONDS]
  mafia replay  <log.jsonl> [--seat seat-3]
  mafia verify  <log.jsonl>
  mafia fork    <log.jsonl> --at SEQ
  mafia providers [--probe]                        # which model providers are reachable
                                                   # --probe checks catalog ids against the API
  mafia ui      [--port 7777]                      # local observer UI: watch runs live,
                                                   # flip between views, start games

Policies: ${Object.keys(POLICIES).join(', ')}
`

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2)
  switch (cmd) {
    case 'run':
      return await cmdRun(rest)
    case 'replay':
      return cmdReplay(rest)
    case 'verify':
      return cmdVerify(rest)
    case 'fork':
      return cmdFork(rest)
    case 'providers':
      return await cmdProviders(rest)
    case 'ui':
      return await cmdUi(rest)
    default:
      process.stdout.write(USAGE)
      return cmd ? 1 : 0
  }
}

async function cmdRun(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      seed: { type: 'string', default: '42' },
      seats: { type: 'string' },
      driver: { type: 'string', default: 'scripted' },
      policy: { type: 'string', default: 'seededRandom' },
      models: { type: 'string' },
      'max-tokens': { type: 'string' },
      framing: { type: 'string', default: 'unverified' },
      deadline: { type: 'string' },
      out: { type: 'string' },
      config: { type: 'string' },
      'fixed-ts': { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
    },
  })

  if (values.driver !== 'scripted' && values.driver !== 'agent') {
    process.stderr.write(`unknown driver "${values.driver}" (scripted | agent)\n`)
    return 1
  }
  const policy = POLICIES[values.policy ?? 'seededRandom']
  if (!policy) {
    process.stderr.write(`unknown policy ${values.policy}\n`)
    return 1
  }

  let config: TableConfig = values.config
    ? (JSON.parse(readFileSync(values.config, 'utf8')) as TableConfig)
    : DEFAULT_CONFIG
  if (values.seats) {
    const n = Number(values.seats)
    config = { ...config, seatCount: n, roles: scaleRoles(n) }
  }

  const seed = values.seed ?? '42'
  const { state, events: setupEvents } = createGame({
    roomId: `room-${seed}`,
    matchSeed: seed,
    config,
  })

  const drivers: Record<SeatId, SeatDriver> = {}
  const bindingEvents: EngineEvent[] = [runMetadataEvent(values)]

  if (values.driver === 'agent') {
    const keys = (values.models ?? '').split(',').map((k) => k.trim()).filter(Boolean)
    if (keys.length === 0) {
      process.stderr.write('--driver agent needs --models k1,k2,... (see `mafia providers`)\n')
      return 1
    }
    // Fail before spending a single token if a model is unknown or its
    // provider has no credential.
    for (const key of keys) {
      const entry = lookup(key)
      if (!providerById(entry.provider).isConfigured()) {
        process.stderr.write(
          `model "${key}" needs ${providerById(entry.provider).envVar}, which is not set. ` +
            'Run `mafia providers`.\n',
        )
        return 1
      }
    }
    const framing = values.framing as Framing
    if (!FRAMINGS.includes(framing)) {
      process.stderr.write(`unknown framing "${values.framing}" (${FRAMINGS.join(' | ')})\n`)
      return 1
    }
    state.seats.forEach((seat, i) => {
      const agent = new AgentDriver({
        seat: seat.id,
        modelKey: keys[i % keys.length] as string,
        config,
        framing,
        maxTokens: values['max-tokens'] ? Number(values['max-tokens']) : undefined,
      })
      drivers[seat.id] = agent
      bindingEvents.push({
        day: 1,
        phase: 'night_chat',
        actor: seat.id,
        type: 'seat_bound',
        visibility: 'omniscient',
        payload: { ...agent.binding },
      })
    })
  } else {
    for (const s of state.seats) {
      drivers[s.id] = new ScriptedDriver({ seat: s.id, policy, seed: `${seed}:${s.id}`, explain: true })
    }
  }

  const memory = new MemorySink()
  const sink = values.out ? new TeeSink([memory, new JsonlFileSink(values.out)]) : memory

  const result = await runGame({
    state,
    drivers,
    sink,
    setupEvents: [...setupEvents, ...bindingEvents],
    deadlineMs:
      values.driver === 'agent'
        ? (values.deadline ? Number(values.deadline) * 1000 : 120_000)
        : null,
    clock: values['fixed-ts'] ? fixedClock : wallClock,
  })

  if (!values.quiet) {
    process.stdout.write(renderGame(memory.events))
    process.stdout.write(
      `\n${result.outcome.winner ? `${result.outcome.winner.toUpperCase()} WINS` : 'STALEMATE'} on day ${result.state.day} — ` +
        `${result.events.length} events, survivors: ${result.outcome.survivors.join(', ') || 'none'}\n`,
    )
    for (const s of result.state.seats) {
      const d = drivers[s.id]
      const model = d instanceof AgentDriver ? `  ${d.binding.modelKey}` : ''
      process.stdout.write(
        `  ${s.name.padEnd(6)} ${s.id.padEnd(7)} ${s.role.padEnd(10)}` +
          `${(s.alive ? 'alive' : `died d${s.diedOn?.day} (${s.diedOn?.cause})`).padEnd(22)}${model}\n`,
      )
    }

    const agents = Object.values(drivers).filter((d): d is AgentDriver => d instanceof AgentDriver)
    if (agents.length > 0) {
      let inTok = 0, outTok = 0, cached = 0, failures = 0
      const broken: string[] = []
      for (const a of agents) {
        const st = a.stats()
        inTok += st.usage.input
        outTok += st.usage.output
        cached += st.usage.cacheRead
        failures += st.failures
        if (st.errors.length > 0) {
          broken.push(`  ${a.binding.seat} (${a.binding.modelKey}): ${st.errors.length} × ${st.errors[0]}`)
        }
      }
      const hitRate = inTok > 0 ? Math.round((cached / (inTok + cached)) * 100) : 0
      process.stdout.write(
        `\ntokens: ${inTok} in, ${outTok} out, ${cached} from cache (${hitRate}% of input)\n`,
      )
      if (hitRate === 0) {
        process.stdout.write(
          'cache hit rate is zero — cost grows quadratically with game length. Worth investigating.\n',
        )
      }
      if (failures > 0) {
        process.stdout.write(`${failures} wake(s) produced no usable action and were defaulted.\n`)
      }
      if (broken.length > 0) {
        // A seat the provider kept rejecting is defaulted every wake, which in
        // the transcript is indistinguishable from a seat that chose silence.
        // Say so here, or the run reads as a finished game rather than a
        // broken one.
        process.stdout.write(
          `\n${broken.length} seat(s) hit provider errors — their turns were not played:\n` +
            `${broken.join('\n')}\n`,
        )
      }
    }
  }
  if (values.out) process.stdout.write(`\nlog: ${values.out}\n`)
  return 0
}

/**
 * Everything needed to re-run or audit this exact invocation, logged
 * omnisciently on every run. A rating that cannot name its commit, SDK
 * versions and deadline policy cannot be defended later.
 */
function runMetadataEvent(values: Record<string, unknown>): EngineEvent {
  // Read each SDK's package.json off the filesystem under the seats package
  // (which owns the deps) — modern SDKs do not export package.json through
  // their exports map, so require() cannot reach it.
  const seatsModules = fileURLToPath(new URL('../../seats/node_modules', import.meta.url))
  const sdk = (name: string): string => {
    try {
      const raw = readFileSync(join(seatsModules, name, 'package.json'), 'utf8')
      return String((JSON.parse(raw) as { version: string }).version)
    } catch {
      return 'unknown'
    }
  }
  // Hosted runs have no .git (railway up excludes it): the deploy step bakes
  // the commit into SWEEP_COMMIT instead, and Railway's own variable is the
  // final fallback.
  let commit = process.env['SWEEP_COMMIT'] ?? process.env['RAILWAY_GIT_COMMIT_SHA'] ?? 'unknown'
  let dirty = false
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0
  } catch {
    /* not a git checkout — the env fallback above stands */
  }
  return {
    day: 1,
    phase: 'night_chat',
    actor: null,
    type: 'run_metadata',
    visibility: 'omniscient',
    payload: {
      commit,
      dirtyWorkingTree: dirty,
      node: process.version,
      sdks: {
        anthropic: sdk('@anthropic-ai/sdk'),
        openai: sdk('openai'),
        google: sdk('@google/genai'),
      },
      driver: values['driver'],
      framing: values['framing'] ?? null,
      deadlineSeconds:
        values['driver'] === 'agent' ? (values['deadline'] ? Number(values['deadline']) : 120) : null,
      maxAttemptsPerWake: 3,
      maxTokens: values['max-tokens'] ? Number(values['max-tokens']) : null,
    },
  }
}

function scaleRoles(n: number): TableConfig['roles'] {
  const mafia = Math.max(1, Math.floor(n / 3.5))
  return { mafia, doctor: 1, detective: 1, villager: n - mafia - 2 }
}

function cmdReplay(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { seat: { type: 'string' } },
  })
  const path = positionals[0]
  if (!path) {
    process.stderr.write('usage: mafia replay <log.jsonl> [--seat seat-3]\n')
    return 1
  }
  const events = readLog(path)

  if (values.seat) {
    const visible = eventsVisibleTo(events, values.seat)
    const { state } = replay(events)
    const me = state.seats.find((s) => s.id === values.seat)
    process.stdout.write(`# ${values.seat} (${me?.name ?? '?'}) saw ${visible.length} of ${events.length} events\n\n`)
    process.stdout.write(renderGame(visible))
    process.stdout.write(`\n# ground truth: ${me?.name} was ${me?.role}\n`)
    return 0
  }

  process.stdout.write(renderGame(events))
  return 0
}

function cmdVerify(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { legacy: { type: 'boolean', default: false } },
  })
  const path = positionals[0]
  if (!path) {
    process.stderr.write('usage: mafia verify <log.jsonl> [--legacy]\n')
    return 1
  }
  const report = verify(readLog(path), { legacy: values.legacy })
  if (report.ok) {
    process.stdout.write(
      `OK — replayed ${report.applied} submissions, ended in ${report.finalPhase}, winner ${report.winner}\n`,
    )
    if (report.finalRoot) process.stdout.write(`root ${report.finalRoot}\n`)
    if (report.legacy) process.stdout.write('legacy log: verified WITHOUT tamper evidence\n')
    return 0
  }
  process.stdout.write(`FAILED\n${report.problems.map((p) => `  - ${p}`).join('\n')}\n`)
  return 1
}

function cmdFork(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { at: { type: 'string' } },
  })
  const path = positionals[0]
  if (!path || values.at === undefined) {
    process.stderr.write('usage: mafia fork <log.jsonl> --at SEQ\n')
    return 1
  }
  const state = fork(readLog(path), Number(values.at))
  process.stdout.write(
    `forked at seq ${values.at}: day ${state.day}, phase ${state.phase}, ` +
      `${state.seats.filter((s) => s.alive).length} alive, awaiting ${state.pending?.awaiting.join(',') ?? 'nobody'}\n`,
  )
  process.stdout.write(JSON.stringify(observe(state, state.seats[0]!.id), null, 2).slice(0, 800) + '\n...\n')
  return 0
}

async function cmdUi(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { port: { type: 'string', default: '7777' } } })
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write(`bad port ${values.port}\n`)
    return 1
  }
  try {
    await startViewer(port)
  } catch (err) {
    process.stderr.write(`could not start viewer: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
  process.stdout.write(`observer ui: http://127.0.0.1:${port}\n`)
  process.stdout.write('watching runs/ — ctrl-c to stop\n')
  // The server keeps the event loop alive; this promise never settles.
  return await new Promise<number>(() => {})
}

/**
 * Report which providers are credentialed, and how faithfully each exposes
 * reasoning — the input the deception grader depends on.
 */
async function cmdProviders(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { probe: { type: 'boolean', default: false } } })
  const providers = allProviders()
  const ready = providers.filter((p) => p.isConfigured())

  process.stdout.write('provider    key                         status         reasoning   models\n')
  process.stdout.write('----------------------------------------------------------------------------------\n')
  for (const p of providers) {
    const models = byProvider(p.id)
    const ok = p.isConfigured()
    process.stdout.write(
      `${p.id.padEnd(11)} ${(resolveEnvVar(p.envVars) ?? p.envVar).padEnd(27)} ${(ok ? 'ready' : 'missing key').padEnd(14)} ` +
        `${p.reasoningFidelity.padEnd(11)} ${models.map((m) => m.key).join(', ') || '—'}\n`,
    )
  }

  const reachable = CATALOG.filter((m) => providers.find((p) => p.id === m.provider)?.isConfigured())
  process.stdout.write(
    `\n${ready.length}/${providers.length} providers ready · ` +
      `${reachable.length}/${CATALOG.length} models reachable\n`,
  )

  if (ready.length === 0) {
    process.stdout.write(
      '\nNo providers configured. Copy .env.example to .env and fill in a key,\n' +
        'or set the variables in your environment. Scripted seats need no keys.\n' +
        '\nNote: managed environments may reserve the bare ANTHROPIC_API_KEY.\n' +
        'Use MAFIA_ANTHROPIC_API_KEY for portable configuration.\n',
    )
  }
  const encrypted = ready.filter((p) => p.reasoningFidelity !== 'visible')
  if (encrypted.length > 0) {
    process.stdout.write(
      `\nNote: ${encrypted.map((p) => p.id).join(', ')} do not return reasoning in the clear.\n` +
        'For those seats a deliberate lie and a hallucination are indistinguishable;\n' +
        'the binding is recorded per seat so the grader can tell them apart later.\n',
    )
  }

  if (values.probe) return await probeCatalog(providers)
  return 0
}

/**
 * Check every catalog wire id against what its provider currently serves.
 *
 * A stale id is invisible until a seat wakes and 404s mid-game, by which point
 * the run has already spent tokens — and a model quietly missing from a
 * leaderboard is worse than a loud failure.
 */
async function probeCatalog(providers: Provider[]): Promise<number> {
  process.stdout.write('\nprobing catalog against each provider\n')
  const reports = await Promise.all(providers.map((p) => probeProvider(p)))

  let missing = 0
  for (const report of reports) {
    for (const row of report.rows) {
      if (row.status === 'missing') missing += 1
      const mark = row.status === 'served' ? 'ok' : row.status === 'missing' ? 'MISSING' : '—'
      const note = row.note ? `  (${row.status === 'missing' ? `closest served: ${row.note}` : row.note})` : ''
      process.stdout.write(`  ${mark.padEnd(8)} ${row.key.padEnd(16)} ${row.wireId}${note}\n`)
    }
    if (report.error) process.stdout.write(`  ${report.provider}: could not list models — ${report.error}\n`)
    if (report.uncatalogued.length > 0) {
      process.stdout.write(
        `  ${report.provider} also serves, uncatalogued: ${report.uncatalogued.join(', ')}\n`,
      )
    }
  }

  const checked = reports.flatMap((r) => r.rows).filter((r) => r.status !== 'unchecked').length
  process.stdout.write(`\n${checked - missing}/${checked} checked ids served`)
  process.stdout.write(missing > 0 ? `; ${missing} stale — fix the catalog before running.\n` : '.\n')
  return missing > 0 ? 1 : 0
}

/** Human-readable rendering of whatever slice of the log it is given. */
function renderGame(events: ReturnType<typeof readLog>): string {
  const names = new Map<string, string>()
  const out: string[] = []
  const n = (id: string | null): string => (id ? (names.get(id) ?? id) : '—')

  for (const e of events) {
    const p = e.payload as Record<string, unknown>
    switch (e.type) {
      case 'game_created':
        for (const s of p['seats'] as { id: string; name: string }[]) names.set(s.id, s.name)
        out.push(`=== game ${e.roomId} (match ${e.matchId} #${e.gameIndex}) ===`)
        break
      case 'role_assigned':
        out.push(`    [truth] ${n(String(p['seat']))} is ${String(p['role'])}`)
        break
      case 'mafia_introduced':
        out.push(`    [mafia] partners: ${(p['fellowMafia'] as string[]).map(n).join(', ')}`)
        break
      case 'phase_changed':
        out.push(`\n-- day ${String(p['day'])} · ${String(p['to'])} --`)
        break
      case 'message_sent':
        out.push(`  ${n(e.actor).padEnd(6)}: ${String(p['text'])}`)
        break
      case 'mafia_message_sent':
        out.push(`  ${n(e.actor).padEnd(6)} (mafia): ${String(p['text'])}`)
        break
      case 'passed':
        out.push(`  ${n(e.actor).padEnd(6)}: (silent)`)
        break
      case 'night_action_submitted':
        out.push(`    [truth] ${n(String(p['seat']))} ${String(p['action'])} -> ${n(p['target'] as string | null)}`)
        break
      case 'investigation_result':
        out.push(`    [priv] ${n(e.actor)} learns ${n(String(p['target']))} is ${String(p['result'])}`)
        break
      case 'night_resolved':
        out.push(p['killed'] ? `  night: ${n(p['killed'] as string)} killed` : `  night: nobody died${p['protected'] ? ' (saved)' : ''}`)
        break
      case 'vote_cast':
        out.push(`    [truth] ${n(String(p['seat']))} votes ${n(p['target'] as string | null)}`)
        break
      case 'vote_tallied': {
        const t = Object.entries(p['tally'] as Record<string, number>)
          .map(([id, c]) => `${n(id)}:${c}`)
          .join(' ')
        out.push(`  vote: ${t || '(none)'} abstain:${String(p['abstain'])} -> ${p['executed'] ? n(p['executed'] as string) : p['tie'] ? 'tie, nobody' : 'nobody'}`)
        break
      }
      case 'seat_died':
        out.push(`  ** ${n(String(p['seat']))} dies (${String(p['cause'])})${p['role'] ? ` — was ${String(p['role'])}` : ''}`)
        break
      case 'timeout':
        out.push(`  ${n(e.actor).padEnd(6)}: [timeout -> ${String(p['defaultApplied'])}]`)
        break
      case 'action_rejected':
        out.push(`  ${n(e.actor).padEnd(6)}: [rejected: ${String(p['reason'])}]`)
        break
      case 'game_ended':
        out.push(
          p['winner']
            ? `\n=== ${String(p['winner']).toUpperCase()} WINS ===`
            : `\n=== STALEMATE (${String(p['cause'] ?? 'stalled')}) ===`,
        )
        break
      default:
        break
    }
  }
  return out.join('\n') + '\n'
}

process.exitCode = await main()
