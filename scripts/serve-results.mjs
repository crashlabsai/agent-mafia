// Minimal status + retrieval server for a hosted sweep. Every request must use
// `Authorization: Bearer <RESULTS_TOKEN>`; credentials never belong in URLs.
//
// GET /status          -> JSON: per-manifest progress, tokens, failures
// GET /results.tar.gz  -> tar of the runs directory, streamed
import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT ?? 8080)
const TOKEN = process.env.RESULTS_TOKEN ?? ''
const DIR = process.env.SWEEP_DIR ?? 'runs/sweep1'

const BASE_HEADERS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

export function bearerAuthorized(header, expectedToken) {
  if (!expectedToken || typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const supplied = Buffer.from(header.slice('Bearer '.length), 'utf8')
  const expected = Buffer.from(expectedToken, 'utf8')
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

function reply(res, status, body, headers = {}) {
  res.writeHead(status, { ...BASE_HEADERS, ...headers }).end(body)
}

export function createResultsServer({ token = TOKEN, dir = DIR } = {}) {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.search) {
      reply(res, 400, 'query parameters are not accepted')
      return
    }
    if (!bearerAuthorized(req.headers.authorization, token)) {
      reply(res, 401, 'unauthorized', { 'www-authenticate': 'Bearer' })
      return
    }
    if (req.method !== 'GET') {
      reply(res, 405, 'method not allowed', { allow: 'GET' })
      return
    }
    if (url.pathname === '/status') {
      const out = { dir, games: [], totals: { done: 0, tokens: 0, failures: 0 } }
      if (existsSync(`${dir}/manifest.jsonl`)) {
        for (const line of readFileSync(`${dir}/manifest.jsonl`, 'utf8').trim().split('\n').filter(Boolean)) {
          const e = JSON.parse(line)
          out.games.push({ seed: e.seed, winner: e.winner ?? null, day: e.day ?? null,
            seconds: e.seconds, verified: e.verified ?? false,
            tokens: e.tokens ? e.tokens.input + e.tokens.output : null })
          out.totals.done += 1
          if (e.tokens) out.totals.tokens += e.tokens.input + e.tokens.output
          if (e.exitCode !== 0 || e.verified === false) out.totals.failures += 1
        }
      }
      out.files = existsSync(dir) ? readdirSync(dir).length : 0
      reply(res, 200, JSON.stringify(out, null, 2), { 'content-type': 'application/json; charset=utf-8' })
      return
    }
    if (url.pathname === '/results.tar.gz') {
      res.writeHead(200, {
        ...BASE_HEADERS,
        'content-type': 'application/gzip',
        'content-disposition': 'attachment; filename="results.tar.gz"',
      })
      const tar = spawn('tar', ['-czf', '-', dir], { stdio: ['ignore', 'pipe', 'ignore'] })
      tar.stdout.pipe(res)
      tar.on('error', () => res.destroy())
      return
    }
    reply(res, 404, 'not found')
  })
}

const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
  createResultsServer().listen(PORT, () => console.log(`results server on :${PORT}`))
}
