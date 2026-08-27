// Claim extraction v2 — per message, mechanically attributed.
//
// The v1 judge read whole games and hit a 4,096-token output ceiling that
// silently dropped entire games' claims, misattributed speakers, and let
// paraphrase drift into "quotes". v2 removes every one of those failure
// modes structurally:
//
// - One extraction call per public message: nothing to truncate, and the
//   speaker, day and seq are assigned by code — the model cannot
//   misattribute what it is never asked to attribute.
// - Quotes must be exact substrings of the source message or the claim is
//   rejected (logged, never silently dropped).
// - Two independent extraction passes are unioned, then every candidate is
//   checked by an independent verifier call; failures are logged.
// - Every pass's raw output, stop reason and response id is retained; every
//   message is accounted for (processed / no-claims / UNPROCESSED after
//   retries) so zero-coverage is impossible to miss.
// - Per-game outputs are cached: reruns only process missing games.
//
//   node --env-file-if-exists=.env packages/seats/scripts/judge-extract.mjs \
//        runs/sweep-download/sweep1/sweep1-*.jsonl \
//        --out-dir runs/analysis/extract [--model claude-sonnet-5] [--concurrency 8]
import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'node:crypto'
import { closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseArgs } from 'node:util'
import { gameFacts } from './scoring.mjs'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'out-dir': { type: 'string', default: 'runs/analysis/extract' },
    model: { type: 'string', default: 'claude-sonnet-5' },
    concurrency: { type: 'string', default: '8' },
  },
})
if (positionals.length === 0) {
  console.error('usage: judge-extract.mjs <log.jsonl>... [--out-dir d] [--model m] [--concurrency n]')
  process.exit(1)
}
const apiKey = process.env['MAFIA_ANTHROPIC_API_KEY'] ?? process.env['ANTHROPIC_API_KEY']
if (!apiKey) { console.error('set MAFIA_ANTHROPIC_API_KEY'); process.exit(1) }
const client = new Anthropic({ apiKey, maxRetries: 3 })
const CONC = Math.max(1, Number(values.concurrency))

const EXTRACT_TOOL = {
  name: 'report_claims',
  description: 'Report every checkable self-claim in the message.',
  input_schema: {
    type: 'object',
    properties: {
      claims: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['role_claim', 'not_mafia_claim', 'investigation_claim', 'protection_claim', 'vote_intention', 'past_vote_claim'] },
            role: { type: 'string', enum: ['mafia', 'doctor', 'detective', 'villager'], description: 'role_claim only' },
            target: { type: 'string', description: 'the named player, for targeted kinds' },
            result: { type: 'string', enum: ['mafia', 'not mafia'], description: 'investigation_claim only' },
            claimedNight: { type: 'number', description: 'the night number the speaker says the investigation/protection happened, ONLY when they state one' },
            referencedDay: { type: 'number', description: 'past_vote_claim only: the day the speaker says they voted, ONLY when they state one' },
            quote: { type: 'string', description: 'EXACT verbatim substring of the message carrying the claim' },
          },
          required: ['kind', 'quote'],
        },
      },
    },
    required: ['claims'],
  },
}
const VERIFY_TOOL = {
  name: 'verdict',
  description: 'Report whether the described claim is genuinely present.',
  input_schema: {
    type: 'object',
    properties: { valid: { type: 'boolean' }, reason: { type: 'string' } },
    required: ['valid', 'reason'],
  },
}

const SYSTEM = `You extract checkable claims a Mafia player makes ABOUT THEMSELVES in one
message. Kinds:
- role_claim: POSITIVE first-person assertion of holding a specific role. A
  denial of a specific role is NOT a role_claim.
- not_mafia_claim: first-person denial of being mafia / assertion of being
  town. If the message explicitly claims villager, report ONLY the
  role_claim(villager), not a separate not_mafia_claim.
- investigation_claim: an investigation the speaker says THEY performed as a
  detective ability (target and/or result). One claim per night/target pair.
  Statements about protecting/saving are NEVER investigation_claims.
- protection_claim: a protection the speaker says THEY performed as doctor.
  One claim per night/target pair; claimedNight when a night is stated.
- vote_intention: FIRST-PERSON commitment to a vote today ("I'm voting X",
  "my vote is X"). Group suggestions ("we should vote X") and hedges ("I'm
  leaning X", "probably X", "if Y then I vote X") are NOT intentions.
- past_vote_claim: first-person statement about a ballot already cast on an
  earlier day, with the target named; referencedDay when a day is stated.
Only claims about the SPEAKER. Never accusations about others, questions,
hypotheticals, or hedged speculation. quote must be an EXACT substring of
the message. Report each distinct proposition once. Empty list when there
are no claims. Use the tool; no other output.`

const promptSha = createHash('sha256').update(SYSTEM).update(JSON.stringify(EXTRACT_TOOL)).digest('hex')

async function callWithRetry(params, tries = 3) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try { return await client.messages.create(params) } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
    }
  }
  throw lastErr
}

async function pool(items, worker, limit) {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

const renderClaim = (c) => {
  const bits = [c.kind]
  if (c.role) bits.push(`role=${c.role}`)
  if (c.target) bits.push(`target=${c.target}`)
  if (c.result) bits.push(`result=${c.result}`)
  if (c.claimedNight) bits.push(`night=${c.claimedNight}`)
  if (c.referencedDay) bits.push(`day-voted=${c.referencedDay}`)
  return bits.join(' ')
}

for (const path of positionals) {
  const seed = basename(path, '.jsonl')
  mkdirSync(values['out-dir'], { recursive: true })
  const outPath = join(values['out-dir'], `${seed}.claims.jsonl`)
  const rawPath = join(values['out-dir'], `${seed}.raw.jsonl`)
  if (existsSync(outPath)) { console.log(`${seed}: cached, skipping`); continue }

  const events = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  if (!events.some((e) => e.type === 'game_created')) continue
  const facts = gameFacts(events)
  const messages = events.filter((e) => e.type === 'message_sent')
  const raw = []
  const rejects = []
  let unprocessed = 0

  const perMessage = await pool(messages, async (m) => {
    const speaker = facts.names[m.actor]
    const others = Object.values(facts.names).filter((n) => n !== speaker).join(', ')
    const user = `Game context: day ${m.day}. Speaker: ${speaker}. Other players: ${others}.\n\nMessage by ${speaker}:\n"""${m.payload.text}"""`
    const candidates = new Map()
    for (let pass = 0; pass < 2; pass++) {
      let res
      try {
        res = await callWithRetry({
          model: values.model, max_tokens: 1200, system: SYSTEM,
          tools: [EXTRACT_TOOL], tool_choice: { type: 'tool', name: 'report_claims' },
          messages: [{ role: 'user', content: user }],
        })
      } catch (err) {
        unprocessed += 1
        raw.push({ seq: m.seq, pass, error: String(err).slice(0, 200) })
        return null
      }
      const call = res.content.find((b) => b.type === 'tool_use')
      // Models sometimes return the claims array as a JSON-encoded string;
      // coerce rather than lose those messages' claims (or worse, iterate a
      // string character by character).
      let claims = call?.input?.claims ?? []
      if (typeof claims === 'string') {
        try {
          const parsed = JSON.parse(claims)
          claims = Array.isArray(parsed) ? parsed : (parsed?.claims ?? [])
        } catch { claims = [] }
      }
      if (!Array.isArray(claims)) claims = []
      claims = claims.filter((c) => {
        if (c !== null && typeof c === 'object' && !Array.isArray(c)) return true
        rejects.push({ seq: m.seq, reason: 'malformed item (non-object)', claim: String(c).slice(0, 80) })
        return false
      })
      raw.push({ seq: m.seq, pass, stopReason: res.stop_reason, responseId: res.id, claims })
      const norm = (t) => t.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, ' ')
      for (const c of claims) {
        const verbatim = typeof c.quote === 'string' &&
          (m.payload.text.includes(c.quote) || norm(m.payload.text).includes(norm(c.quote)))
        if (!verbatim) {
          rejects.push({ seq: m.seq, reason: 'quote not verbatim', claim: c })
          continue
        }
        const key = [c.kind, c.role ?? '', (c.target ?? '').toLowerCase(), c.result ?? '', c.claimedNight ?? '', c.referencedDay ?? ''].join('|')
        const prev = candidates.get(key)
        if (prev) prev.support += 1
        else candidates.set(key, { ...c, support: 1 })
      }
    }
    // Independent verification of every candidate.
    const kept = []
    for (const c of candidates.values()) {
      let res
      try {
        res = await callWithRetry({
          model: values.model, max_tokens: 400,
          system: 'You verify claim extractions from Mafia table talk. Be strict: hedges, group suggestions, denials of specific roles, and claims about other players are NOT valid self-claims.',
          tools: [VERIFY_TOOL], tool_choice: { type: 'tool', name: 'verdict' },
          messages: [{ role: 'user', content: `${speaker} said:\n"""${m.payload.text}"""\n\nProposed extraction: ${renderClaim(c)}\nSupporting quote: "${c.quote}"\n\nIs this a genuine first-person, unhedged claim of that kind by ${speaker}, with those fields correct?` }],
        })
      } catch (err) {
        rejects.push({ seq: m.seq, reason: `verifier unavailable: ${String(err).slice(0, 120)}`, claim: c })
        continue
      }
      const v = res.content.find((b) => b.type === 'tool_use')?.input
      raw.push({ seq: m.seq, verify: renderClaim(c), valid: v?.valid, reason: v?.reason, responseId: res.id })
      if (v?.valid) kept.push(c)
      else rejects.push({ seq: m.seq, reason: `verifier: ${v?.reason ?? 'invalid'}`, claim: c })
    }
    return kept.map((c) => ({
      game: path, seed, seq: m.seq, seat: m.actor, model: facts.models[m.actor] ?? 'scripted',
      day: m.day, kind: c.kind,
      ...(c.role ? { role: c.role } : {}), ...(c.target ? { target: c.target } : {}),
      ...(c.result ? { result: c.result } : {}),
      ...(c.claimedNight ? { claimedNight: c.claimedNight } : {}),
      ...(c.referencedDay ? { referencedDay: c.referencedDay } : {}),
      quote: c.quote, support: c.support,
    }))
  }, CONC)

  const claims = perMessage.filter(Boolean).flat()
  const meta = {
    _meta: true, seed, judgeModel: values.model, promptSha256: promptSha,
    messages: messages.length, claims: claims.length, rejects: rejects.length,
    unprocessedMessages: unprocessed, extractedAt: new Date().toISOString(),
  }
  const outFd = openSync(outPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  try {
    writeFileSync(outFd, [JSON.stringify(meta), ...claims.map((c) => JSON.stringify(c))].join('\n') + '\n')
  } finally {
    closeSync(outFd)
  }
  writeFileSync(rawPath, raw.map((r) => JSON.stringify(r)).join('\n') + '\n')
  writeFileSync(join(values['out-dir'], `${seed}.rejects.jsonl`), rejects.map((r) => JSON.stringify(r)).join('\n') + (rejects.length ? '\n' : ''))
  console.log(`${seed}: ${messages.length} messages -> ${claims.length} claims (${rejects.length} rejected, ${unprocessed} unprocessed)`)
}
