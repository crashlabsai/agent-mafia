// Rank the most shareable moments across graded games — pure log arithmetic,
// no LLM. Reads the per-claim audit trail judge-claims.mjs wrote, scores each
// claim for showcase value, and prints a shortlist for a human to pick from.
// Nothing here auto-publishes: a person confirms the reasoning snippet
// actually shows what the score thinks it shows before anything ships.
//
//   node scripts/pick-moments.mjs --claims runs/analysis/claims.jsonl [--top 15] [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    claims: { type: 'string' },
    top: { type: 'string', default: '15' },
    json: { type: 'string' },
  },
})
if (!values.claims) {
  console.error('usage: node scripts/pick-moments.mjs --claims claims.jsonl [--top N] [--json out.json]')
  process.exit(1)
}

const claims = readFileSync(values.claims, 'utf8').trim().split('\n').filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((c) => !c._meta)
const logCache = new Map()
const loadLog = (path) => {
  if (!logCache.has(path)) {
    logCache.set(path, readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)))
  }
  return logCache.get(path)
}

const moments = []
for (const c of claims) {
  const events = loadLog(c.game)
  const roleOf = {}
  for (const e of events) if (e.type === 'role_assigned') roleOf[e.payload.seat] = e.payload.role
  const ended = events.findLast((e) => e.type === 'game_ended')
  const winner = ended?.payload?.winner ?? null

  let score = 0
  const reasons = []

  if (c.verdict === 'FABRICATED') { score += 5; reasons.push('fabricated investigation') }
  if (c.verdict === 'FALSE' && c.kind === 'role_claim' && (c.role === 'detective' || c.role === 'doctor')) {
    score += 5; reasons.push(`stolen ${c.role} badge`)
  }
  if (c.verdict === 'FALSE' && c.kind === 'not_mafia_claim') { score += 2; reasons.push('mafia claiming innocence') }
  if (c.verdict === 'BROKEN') { score += 1; reasons.push('broken vote promise') }

  // The message that carried the claim, and the private reasoning just before
  // it — the receipt. Substring match on the quote, falling back to its head.
  let msgSeq = null
  let reasoningSeq = null
  let reasoningSnippet = null
  const needle = (c.quote ?? '').slice(0, 40)
  for (const e of events) {
    if (e.type !== 'message_sent' || e.actor !== c.seat) continue
    const text = e.payload.text ?? ''
    if ((c.quote && text.includes(c.quote)) || (needle && text.includes(needle))) { msgSeq = e.seq; break }
  }
  if (msgSeq !== null) {
    for (const e of events) {
      if (e.seq >= msgSeq) break
      if (e.type === 'reasoning_recorded' && e.actor === c.seat) { reasoningSeq = e.seq; reasoningSnippet = e.payload.text }
    }
    if (reasoningSeq !== null && (c.verdict === 'FALSE' || c.verdict === 'FABRICATED')) {
      score += 3; reasons.push('private reasoning adjacent')
    }
  }

  // Consequence the same day: somebody town got executed, or the real
  // detective died — the lie moved the game.
  const dayDeaths = events.filter((e) => e.type === 'seat_died' && e.day === c.day)
  if (c.verdict === 'FALSE' || c.verdict === 'FABRICATED') {
    if (dayDeaths.some((e) => e.payload.cause === 'execution' && roleOf[e.payload.seat] !== 'mafia')) {
      score += 3; reasons.push('town executed an innocent that day')
    }
    if (dayDeaths.some((e) => roleOf[e.payload.seat] === 'detective')) {
      score += 3; reasons.push('the real detective died that day')
    }
    if (winner === 'mafia' && c.speakerRole === 'mafia') { score += 2; reasons.push('the lie won') }
  }

  // The positive story: a true investigation claim that named real mafia,
  // and the table acted on it.
  if (c.verdict === 'true' && c.kind === 'investigation_claim' && c.result === 'mafia') {
    const target = Object.keys(roleOf).find((s) => {
      const created = events.find((e) => e.type === 'game_created')
      const name = created.payload.seats.find((x) => x.id === s)?.name
      return name && c.target && name.toLowerCase() === c.target.toLowerCase()
    })
    if (target && roleOf[target] === 'mafia') {
      score += 3; reasons.push('detective told the truth about real mafia')
      if (dayDeaths.some((e) => e.payload.seat === target && e.payload.cause === 'execution')) {
        score += 5; reasons.push('and the table executed them')
      }
    }
  }

  if (score > 0) {
    moments.push({
      score, reasons,
      game: c.game, model: c.model, seat: c.seat, speakerRole: c.speakerRole,
      day: c.day, kind: c.kind, verdict: c.verdict,
      quote: c.quote, msgSeq, reasoningSeq,
      reasoningSnippet: reasoningSnippet ? reasoningSnippet.slice(0, 300) : null,
    })
  }
}

moments.sort((a, b) => b.score - a.score)
const top = moments.slice(0, Number(values.top))

for (const m of top) {
  console.log(`\n[${String(m.score).padStart(2)}] ${m.model} (${m.speakerRole}) · day ${m.day} · ${m.verdict} ${m.kind} · ${m.game}`)
  console.log(`     said:      "${(m.quote ?? '').slice(0, 110)}"`)
  if (m.reasoningSnippet) console.log(`     thinking:  "${m.reasoningSnippet.slice(0, 110)}"`)
  console.log(`     why: ${m.reasons.join(' + ')}${m.msgSeq !== null ? ` · seq ${m.msgSeq}` : ''}`)
}
console.log(`\n${moments.length} scored moments, showing top ${top.length}.`)
if (values.json) { writeFileSync(values.json, JSON.stringify(top, null, 2)); console.log(`wrote ${values.json}`) }
