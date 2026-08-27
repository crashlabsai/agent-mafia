// The targeted human pass (amendment PF-2): from a completed sensitivity
// rating, build one BLIND, shuffled packet containing every disputed item
// (sensitivity rater said BAD), a seeded audit sample of its accepts, and
// any recall-miss the negative sample surfaced. The human rater sees the
// standard confirm-all presentation — full message, span, fields — and
// never which section an item belongs to or how the sensitivity rater
// ruled: dispute rulings stay unanchored, and audit items yield a clean
// human-vs-model agreement measurement from the same sitting.
//
//   node scripts/build-adjudication-packet.mjs \
//        --key runs/analysis-v3/handcheck/sealed-key.jsonl \
//        --ratings runs/analysis-v3/handcheck/codex-ratings.json \
//        --negatives-key runs/analysis-v3/handcheck/negatives-sealed-key.jsonl \
//        --logs runs/sweep-download/sweep1 --audit-n 50 --seed packet-1 \
//        --out runs/analysis-v3/handcheck/packet
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    key: { type: 'string' },
    ratings: { type: 'string' },
    'negatives-key': { type: 'string' },
    'negatives-ratings': { type: 'string' },
    logs: { type: 'string', default: 'runs/sweep-download/sweep1' },
    'audit-n': { type: 'string', default: '50' },
    seed: { type: 'string', default: 'packet-1' },
    out: { type: 'string', default: 'runs/analysis-v3/handcheck/packet' },
  },
})
const fail = (m) => { console.error(m); process.exit(1) }
if (!values.key || !values.ratings) fail('usage: build-adjudication-packet.mjs --key sealed-key.jsonl --ratings rater.json [--negatives-key k --negatives-ratings r] [--audit-n 50] [--seed s] [--out dir]')

const readJsonl = (p) => readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const keyLines = readJsonl(values.key)
const keyMeta = keyLines.find((r) => r._meta)
const items = keyLines.filter((r) => !r._meta)
const ratings = JSON.parse(readFileSync(values.ratings, 'utf8'))
if (ratings.analysisRunId && keyMeta.analysisRunId !== ratings.analysisRunId) fail('ratings/key analysisRunId mismatch')
const ruling = (it) => ratings.positiveRatings?.[String(it.item)]
if (items.some((it) => !['OK', 'BAD'].includes(ruling(it)))) fail('sensitivity ratings incomplete — packet needs a ruling for every item')

const h = (s) => createHash('sha256').update(values.seed).update('\x00').update(s).digest('hex')

const disputes = items.filter((it) => ruling(it) === 'BAD')
const auditPool = items.filter((it) => ruling(it) === 'OK' && it.machineDecision === 'accepted')
const audit = [...auditPool]
  .sort((a, b) => h(`${a.seed}|${a.seq}|${a.kind}|${a.quote ?? ''}`).localeCompare(h(`${b.seed}|${b.seq}|${b.kind}|${b.quote ?? ''}`)))
  .slice(0, Number(values['audit-n']))

// Recall misses: published-family claims the sensitivity rater listed on
// machine-negative messages become candidate items awaiting the human call.
const PUBLISHED = new Set(['role_claim', 'not_mafia_claim', 'investigation_claim', 'protection_claim'])
const misses = []
if (values['negatives-key'] && values['negatives-ratings']) {
  const negKey = new Map(readJsonl(values['negatives-key']).filter((r) => !r._meta).map((r) => [String(r.item), r]))
  const negRatings = JSON.parse(readFileSync(values['negatives-ratings'], 'utf8'))
  for (const [id, claims] of Object.entries(negRatings.negativeClaims ?? {})) {
    for (const c of claims ?? []) {
      if (!PUBLISHED.has(c.kind)) continue
      const src = negKey.get(String(id))
      if (!src) continue
      misses.push({
      // A miss has no sealed-key item number; the origin is the negatives id.
        item: `miss-${id}`, seed: src.seed, seq: src.seq, day: src.day, kind: c.kind,
        ...(c.role ? { role: c.role } : {}), ...(c.target ? { target: c.target } : {}),
        ...(c.result ? { result: c.result } : {}),
        quote: c.quote ?? null, machineDecision: 'missed',
      })
    }
  }
}

const packet = [...disputes, ...audit, ...misses]
  .sort((a, b) => h(`${a.seed}|${a.seq}|${a.kind}|${a.item}`).localeCompare(h(`${b.seed}|${b.seq}|${b.kind}|${b.item}`)))

// Message texts straight from the verified logs.
const texts = new Map() // `${seed}|${seq}` -> {text, speaker, day}
const needed = new Set(packet.map((p) => p.seed))
for (const seed of needed) {
  const events = readFileSync(join(values.logs, `${seed}.jsonl`), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const names = {}
  for (const e of events) {
    if (e.type === 'game_created') for (const s of e.payload.seats) names[s.id] = s.name
    if (e.type === 'message_sent') texts.set(`${seed}|${e.seq}`, { text: e.payload.text, speaker: names[e.actor] ?? e.actor, day: e.day })
  }
}

const FIELD_ORDER = ['role', 'target', 'result', 'claimedNight', 'referencedDay', 'conditional']
const sheet = []
sheet.push('# Targeted human pass — blind adjudication packet (PF-2)')
sheet.push('')
sheet.push('Standard confirm-all rules: for each item answer **OK** (a genuine')
sheet.push('first-person claim of that kind, with those fields, asserted in THIS')
sheet.push('message) or **BAD**, plus an optional note. Items are shuffled; nothing')
sheet.push('marks why an item is here. Do not open sealed keys or logs while rating.')
sheet.push('')
packet.forEach((p, i) => {
  const n = i + 1
  const m = texts.get(`${p.seed}|${p.seq}`)
  if (!m) fail(`no public message at ${p.seed} seq ${p.seq}`)
  const fields = FIELD_ORDER.filter((f) => p[f] !== undefined && p[f] !== null).map((f) => `${f}=${p[f]}`).join(' · ')
  sheet.push(`**${n}.** [${p.kind}${fields ? ' · ' + fields : ''}] — day ${p.day ?? m.day}, speaker ${m.speaker}`)
  sheet.push(...m.text.split('\n').map((l) => `> ${l}`))
  sheet.push('')
  if (p.quote) sheet.push(`    claimed span: ${JSON.stringify(p.quote)}`)
  if (p.machine?.resolvingContext) sheet.push(`    resolving context (seq ${p.machine.resolvingContext.seq}): ${JSON.stringify(p.machine.resolvingContext.text)}`)
  sheet.push('    verdict: OK / BAD    note:')
  sheet.push('')
})

mkdirSync(values.out, { recursive: true })
const writeAtomic = (p, c) => { const t = `${p}.tmp-${process.pid}`; writeFileSync(t, c); renameSync(t, p) }
writeAtomic(join(values.out, 'packet-sheet.md'), sheet.join('\n') + '\n')
const meta = {
  _meta: true, mode: 'adjudication-packet', analysisRunId: keyMeta.analysisRunId,
  sensitivityRater: ratings.rater, seed: values.seed,
  items: packet.length, disputes: disputes.length, audit: audit.length, misses: misses.length,
}
writeAtomic(join(values.out, 'packet-key.jsonl'),
  [JSON.stringify(meta), ...packet.map((p, i) => JSON.stringify({
    packetItem: i + 1, origin: p.item, seed: p.seed, seq: p.seq, kind: p.kind,
    section: typeof p.item === 'string' && p.item.startsWith('miss-') ? 'recall-miss'
      : ruling(p) === 'BAD' ? 'dispute' : 'audit',
    sensitivityRuling: typeof p.item === 'string' && p.item.startsWith('miss-') ? 'CLAIMED' : ruling(p),
    analysisRunId: keyMeta.analysisRunId,
  }))].join('\n') + '\n')
writeAtomic(join(values.out, 'packet-template.json'), JSON.stringify({
  rater: 'ryan', analysisRunId: keyMeta.analysisRunId, blindSource: 'packet-sheet.md only', answerKeyOpened: false,
  positiveRatings: Object.fromEntries(packet.map((_, i) => [String(i + 1), ''])),
  notes: {},
}, null, 2) + '\n')
console.log(`wrote ${values.out}: ${packet.length} items (${disputes.length} disputes + ${audit.length} audit + ${misses.length} recall-miss), shuffled blind`)
