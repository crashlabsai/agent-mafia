import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { EventEnvelope } from '@mafia/protocol'
import { CATALOG, allProviders, providerById } from '@mafia/seats'
import { PAGE } from './page.ts'

/**
 * The observer UI: a local control panel over the JSONL logs.
 *
 * This is deliberately NOT a seat. It reads the append-only log — the same
 * record replay and grading read — and filters it client-side by the same
 * visibility rule the engine stamps on every event. The omniscient view is the
 * grader's view; a seat view is that seat's subjective game. Nothing here can
 * widen what a seat could know, because the page only ever sees stamped events.
 *
 * It binds to 127.0.0.1 only: it can spawn game processes and reads local
 * files, so it must never be reachable from off the machine.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..')
const RUNS_DIR = path.join(REPO_ROOT, 'runs')

/** Only bare *.jsonl names — no separators, no traversal, nothing hidden. */
export function isSafeRunFile(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.jsonl$/.test(name) && !name.includes('..')
}

/** Tolerant JSONL parse: a half-written trailing line is simply not yet ours. */
export function parseJsonl(text: string): EventEnvelope[] {
  const out: EventEnvelope[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed) as EventEnvelope)
    } catch {
      break
    }
  }
  return out
}

export function eventsAfter(events: EventEnvelope[], after: number): EventEnvelope[] {
  return events.filter((e) => e.seq > after)
}

export interface RunSpec {
  driver: 'scripted' | 'agent'
  models: string[]
  seed: string
}

/**
 * Validate a launch request from the page. Everything is checked against the
 * catalog and current credentials server-side — the browser is a convenience,
 * not an authority.
 */
export function validateRunSpec(
  raw: unknown,
  reachableKeys: ReadonlySet<string>,
): { ok: true; spec: RunSpec } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'body must be an object' }
  const o = raw as Record<string, unknown>

  const driver = o['driver'] === 'scripted' ? 'scripted' : o['driver'] === 'agent' ? 'agent' : null
  if (!driver) return { ok: false, error: 'driver must be "scripted" or "agent"' }

  const seedRaw = typeof o['seed'] === 'string' && o['seed'].length > 0 ? o['seed'] : null
  if (seedRaw && !/^[A-Za-z0-9-]{1,40}$/.test(seedRaw)) {
    return { ok: false, error: 'seed may only contain letters, digits and dashes' }
  }
  const seed = seedRaw ?? `ui-${Date.now().toString(36)}`

  let models: string[] = []
  if (driver === 'agent') {
    if (!Array.isArray(o['models']) || o['models'].length === 0) {
      return { ok: false, error: 'agent runs need at least one model' }
    }
    models = o['models'].map(String)
    for (const key of models) {
      if (!CATALOG.some((m) => m.key === key)) return { ok: false, error: `unknown model "${key}"` }
      if (!reachableKeys.has(key)) return { ok: false, error: `model "${key}" has no credential` }
    }
  }
  return { ok: true, spec: { driver, models, seed } }
}

interface RunRecord {
  pid: number
  startedAt: string
  exitCode: number | null
  stderrTail: string[]
}

const running = new Map<string, RunRecord>()

function launch(spec: RunSpec): { file: string } {
  const file = `${spec.seed}.jsonl`
  const args = [
    '--env-file-if-exists=.env',
    'packages/cli/src/index.ts',
    'run',
    '--driver', spec.driver,
    '--seed', spec.seed,
    '--out', `runs/${file}`,
    '--quiet',
  ]
  if (spec.driver === 'agent') args.push('--models', spec.models.join(','))

  const child = spawn(process.execPath, args, { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'pipe'] })
  const record: RunRecord = { pid: child.pid ?? -1, startedAt: new Date().toISOString(), exitCode: null, stderrTail: [] }
  running.set(file, record)
  child.stderr.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('.env not found')) continue
      record.stderrTail.push(t)
      if (record.stderrTail.length > 20) record.stderrTail.shift()
    }
  })
  child.on('exit', (code) => {
    record.exitCode = code ?? -1
  })
  return { file }
}

async function listRuns(): Promise<unknown[]> {
  await mkdir(RUNS_DIR, { recursive: true })
  const names = (await readdir(RUNS_DIR)).filter(isSafeRunFile)
  const rows = await Promise.all(
    names.map(async (name) => {
      const s = await stat(path.join(RUNS_DIR, name))
      const rec = running.get(name)
      return {
        file: name,
        size: s.size,
        mtimeMs: s.mtimeMs,
        live: rec ? rec.exitCode === null : false,
        exitCode: rec?.exitCode ?? null,
        stderrTail: rec?.stderrTail ?? [],
      }
    }),
  )
  return rows.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

function reachableModelKeys(): Set<string> {
  const ready = new Set(allProviders().filter((p) => p.isConfigured()).map((p) => p.id))
  return new Set(CATALOG.filter((m) => ready.has(m.provider)).map((m) => m.key))
}

function meta(): unknown {
  const reachable = reachableModelKeys()
  return {
    providers: allProviders().map((p) => ({
      id: p.id,
      ready: p.isConfigured(),
      reasoning: p.reasoningFidelity,
    })),
    models: CATALOG.map((m) => ({
      key: m.key,
      provider: m.provider,
      label: m.label,
      reachable: reachable.has(m.key),
      reasoning: providerById(m.provider).reasoningFidelity,
    })),
  }
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  const text = type === 'application/json' ? JSON.stringify(body) : String(body)
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8` })
  res.end(text)
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}')
  } catch {
    return null
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'GET' && url.pathname === '/') return send(res, 200, PAGE, 'text/html')
  if (req.method === 'GET' && url.pathname === '/api/runs') return send(res, 200, await listRuns())
  if (req.method === 'GET' && url.pathname === '/api/meta') return send(res, 200, meta())

  if (req.method === 'GET' && url.pathname === '/api/log') {
    const file = url.searchParams.get('file') ?? ''
    const after = Number(url.searchParams.get('after') ?? '-1')
    if (!isSafeRunFile(file)) return send(res, 400, { error: 'bad file name' })
    let text: string
    try {
      text = await readFile(path.join(RUNS_DIR, file), 'utf8')
    } catch {
      return send(res, 404, { error: 'no such run' })
    }
    const events = eventsAfter(parseJsonl(text), Number.isFinite(after) ? after : -1)
    return send(res, 200, { events })
  }

  if (req.method === 'POST' && url.pathname === '/api/run') {
    const verdict = validateRunSpec(await readBody(req), reachableModelKeys())
    if (!verdict.ok) return send(res, 400, { error: verdict.error })
    return send(res, 200, launch(verdict.spec))
  }

  if (req.method === 'POST' && url.pathname === '/api/stop') {
    const body = (await readBody(req)) as { file?: string } | null
    const rec = body?.file && isSafeRunFile(body.file) ? running.get(body.file) : undefined
    if (!rec || rec.exitCode !== null) return send(res, 404, { error: 'not running' })
    try {
      process.kill(rec.pid, 'SIGTERM')
    } catch {
      return send(res, 500, { error: 'could not signal process' })
    }
    return send(res, 200, { stopped: true })
  }

  send(res, 404, { error: 'not found' })
}

export function startViewer(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      send(res, 500, { error: err instanceof Error ? err.message : String(err) })
    })
  })
  return new Promise((resolve, reject) => {
    server.on('error', reject)
    // Loopback only — this server spawns processes and reads local files.
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}
