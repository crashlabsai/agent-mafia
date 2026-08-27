// Batch runner: N games with model-to-seat rotation, verify after each,
// one manifest line per game.
//
// Rotation is the fairness mechanism: game g rotates the model list by
// g mod k, so across a sweep every model cycles through every seat position
// (and therefore through the role distribution the seeds deal to each seat).
// The manifest records the seat->model binding per game so nothing about the
// schedule has to be remembered.
//
//   node scripts/run-sweep.mjs --models haiku-4.5,gpt-5.6-luna --games 12 \
//        --prefix pilot --out-dir runs/pilot
//   node scripts/run-sweep.mjs --driver scripted --games 3 --prefix dry \
//        --out-dir runs/dry            # free dry-run of the runner itself
//
// Games run sequentially, deliberately: parallel tables multiply per-provider
// rate-limit pressure and interleave their retries, which turns one throttled
// provider into many slow seats. A sweep's wall clock is dominated by model
// latency either way.
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const CLI = 'packages/cli/src/index.ts'

const { values } = parseArgs({
  options: {
    models: { type: 'string' },
    games: { type: 'string', default: '10' },
    prefix: { type: 'string', default: 'sweep' },
    'out-dir': { type: 'string', default: 'runs/sweep' },
    driver: { type: 'string', default: 'agent' },
    'max-tokens': { type: 'string' },
    seats: { type: 'string' },
    deadline: { type: 'string' },
    framing: { type: 'string' },
    /** First game index for this lane, so parallel lanes share one global
     *  rotation schedule instead of each starting from zero. */
    offset: { type: 'string', default: '0' },
    /** Hard spend backstop: stop before starting a game once this lane's
     *  cumulative in+out tokens exceed the cap. Provider-side billing limits
     *  are the real guardrail; this one fails softly and keeps the logs. */
    'abort-tokens': { type: 'string' },
    /** Frozen schedule JSON from plan-schedule.mjs. When set, each game's
     *  seed, seat map and table size come from the schedule — rotation and
     *  --models/--seats/--prefix are ignored. */
    schedule: { type: 'string' },
    /** Print each game's resolved seed and seat map without running it. */
    dry: { type: 'boolean', default: false },
  },
})

const driver = values.driver
const schedule = values.schedule
  ? JSON.parse(readFileSync(values.schedule, 'utf8'))
  : null
const models = (values.models ?? '').split(',').map((m) => m.trim()).filter(Boolean)
if (driver === 'agent' && models.length === 0 && !schedule) {
  console.error('--models k1,k2,... or --schedule file.json is required for --driver agent')
  process.exit(1)
}
const games = Number(values.games)
const offset = Number(values.offset)
const outDir = values['out-dir']
mkdirSync(outDir, { recursive: true })
const manifestPath = join(outDir, 'manifest.jsonl')

const rotate = (list, by) => [...list.slice(by % list.length), ...list.slice(0, by % list.length)]

const abortTokens = values['abort-tokens'] ? Number(values['abort-tokens']) : null
let spentTokens = 0
let failures = 0
for (let i = 0; i < games; i++) {
  const g = offset + i
  if (abortTokens !== null && spentTokens > abortTokens) {
    console.log(`\nabort: lane spent ${spentTokens} tokens, over the ${abortTokens} cap — stopping before g${g}`)
    break
  }
  const planned = schedule ? schedule.games[g] : null
  if (schedule && !planned) break // lane ran past the schedule's end
  const seed = planned ? planned.seed : `${values.prefix}-${g}`
  const logPath = join(outDir, `${seed}.jsonl`)
  const stdoutPath = join(outDir, `${seed}.stdout.txt`)
  const gameModels = planned ? planned.modelsBySeat : driver === 'agent' ? rotate(models, g) : []
  const seatArg = planned ? String(schedule.config.seatCount) : values.seats

  const args = ['--env-file-if-exists=.env', CLI, 'run', '--seed', seed, '--out', logPath]
  if (driver === 'agent') args.push('--driver', 'agent', '--models', gameModels.join(','))
  if (values['max-tokens']) args.push('--max-tokens', values['max-tokens'])
  if (seatArg) args.push('--seats', seatArg)
  if (values.deadline) args.push('--deadline', values.deadline)
  if (values.framing) args.push('--framing', values.framing)

  if (values.dry) {
    console.log(`g${g} seed=${seed} seats=${seatArg ?? 7}`)
    gameModels.forEach((m, idx) => console.log(`   seat-${idx + 1} <- ${m}${planned ? `  (${planned.rolesBySeat[idx]})` : ''}`))
    continue
  }

  // Resume semantics: a game whose log exists is never replayed — a restart
  // or redeploy continues the sweep instead of overwriting evidence.
  if (existsSync(logPath)) {
    console.log(`[${i + 1}/${games} g${g}] seed=${seed} already played — skipping`)
    continue
  }

  const startedAt = Date.now()
  process.stdout.write(`[${i + 1}/${games} g${g}] seed=${seed} models=${gameModels.join(',') || 'scripted'} ... `)
  const run = spawnSync('node', args, { encoding: 'utf8' })
  const secs = Math.round((Date.now() - startedAt) / 1000)
  writeFileSync(stdoutPath, (run.stdout ?? '') + (run.stderr ?? ''))

  const entry = {
    seed,
    log: logPath,
    driver,
    modelsBySeatOrder: gameModels,
    seconds: secs,
    exitCode: run.status,
  }

  if (run.status !== 0) {
    failures += 1
    entry.error = 'run failed — see stdout file'
    appendFileSync(manifestPath, JSON.stringify(entry) + '\n')
    process.stdout.write(`FAILED (${secs}s)\n`)
    continue
  }

  // Outcome from the log, not from stdout: the log is the record.
  const events = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const ended = events.findLast((e) => e.type === 'game_ended')
  entry.events = events.length
  entry.winner = ended?.payload?.winner ?? null
  entry.reason = ended?.payload?.reason ?? null
  entry.day = ended?.day ?? null
  entry.finalRoles = ended?.payload?.finalRoles ?? null
  entry.rejected = events.filter((e) => e.type === 'action_rejected').length
  entry.timeouts = events.filter((e) => e.type === 'timeout').length

  // Cost data lives only in the run summary.
  const tok = /tokens: (\d+) in, (\d+) out, (\d+) from cache/.exec(run.stdout ?? '')
  if (tok) entry.tokens = { input: +tok[1], output: +tok[2], cacheRead: +tok[3] }
  if (entry.tokens) spentTokens += entry.tokens.input + entry.tokens.output

  try {
    execFileSync('node', [CLI, 'verify', logPath], { encoding: 'utf8' })
    entry.verified = true
  } catch {
    entry.verified = false
    failures += 1
  }

  appendFileSync(manifestPath, JSON.stringify(entry) + '\n')
  process.stdout.write(
    `${entry.winner ? entry.winner.toUpperCase() + ' wins' : 'stalemate'} d${entry.day} ` +
      `(${secs}s, ${entry.rejected} rejected, ${entry.timeouts} timeouts` +
      `${entry.tokens ? `, ${entry.tokens.input + entry.tokens.output} tok` : ''}` +
      `${entry.verified ? '' : ', VERIFY FAILED'})\n`,
  )
}

if (values.dry) process.exit(0)
const lines = readFileSync(manifestPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const done = lines.filter((e) => e.exitCode === 0)
const wins = { mafia: 0, town: 0, stalemate: 0 }
for (const e of done) wins[e.winner ?? 'stalemate'] += 1
const totalTok = done.reduce((a, e) => a + (e.tokens ? e.tokens.input + e.tokens.output : 0), 0)
console.log(
  `\n${done.length}/${lines.length} games completed — town ${wins.town}, mafia ${wins.mafia}, ` +
    `stalemate ${wins.stalemate} — ${totalTok} total tokens — manifest: ${manifestPath}`,
)
process.exit(failures > 0 ? 1 : 0)
