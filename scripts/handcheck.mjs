// Build the blinded hand-check sheet for judge validation.
//
// The rater sees: the quote, the claim kind, and the extracted fields —
// never the model, the speaker's true role, or the computed verdict. They
// judge one thing per item: is this a correct extraction (a real,
// first-person, unhedged claim of that kind, with those fields, in that
// quote)? A second section shows messages where the judge found nothing, to
// catch misses (recall), not just false extractions (precision).
//
// Sampling is deterministic (seeded hash), so the sheet is reproducible and
// cannot be quietly re-rolled until it flatters.
//
//   node scripts/handcheck.mjs --claims runs/analysis/sweep1-claims.jsonl \
//        --logs 'runs/sweep-download/sweep1' --sample 50 --nulls 10 \
//        --out runs/analysis/handcheck
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    claims: { type: 'string' },
    logs: { type: 'string' },
    sample: { type: 'string', default: '50' },
    nulls: { type: 'string', default: '10' },
    seed: { type: 'string', default: 'handcheck-1' },
    out: { type: 'string', default: 'runs/analysis/handcheck' },
  },
})
if (!values.claims) {
  console.error('usage: node scripts/handcheck.mjs --claims claims.jsonl [--logs dir] [--sample N] [--out dir]')
  process.exit(1)
}

const h = (s) => createHash('sha256').update(values.seed).update(s).digest('hex')
const claims = readFileSync(values.claims, 'utf8').trim().split('\n').filter(Boolean)
  .map((l) => JSON.parse(l)).filter((c) => !c._meta)

const sampled = [...claims]
  .sort((a, b) => h(JSON.stringify([a.game, a.seat, a.day, a.kind, a.quote]))
    .localeCompare(h(JSON.stringify([b.game, b.seat, b.day, b.kind, b.quote]))))
  .slice(0, Number(values.sample))

// Null sample: messages in which the judge extracted nothing at all.
let nulls = []
if (values.logs) {
  // Message-level exclusion: only the exact messages the judge extracted a
  // claim FROM are excluded — any other message from the same seat and day
  // stays in the null pool. (The earlier seat-day key systematically hid
  // misses.) Requires claims to carry their source seq, which v2 does.
  const claimed = new Set(claims.map((c) => `${c.seed ?? c.game}|${c.seq}`))
  const msgs = []
  for (const f of readdirSync(values.logs).filter((f) => f.endsWith('.jsonl') && f !== 'manifest.jsonl')) {
    const path = join(values.logs, f)
    const seed = f.replace('.jsonl', '')
    for (const line of readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)) {
      const e = JSON.parse(line)
      if (e.type === 'message_sent' && !claimed.has(`${seed}|${e.seq}`) && !claimed.has(`${path}|${e.seq}`)) {
        msgs.push({ game: path, day: e.day, text: e.payload.text })
      }
    }
  }
  nulls = msgs.sort((a, b) => h(a.game + a.day + a.text).localeCompare(h(b.game + b.day + b.text)))
    .slice(0, Number(values.nulls))
}

mkdirSync(values.out, { recursive: true })
const sheet = []
sheet.push('# Judge hand-check — blinded rating sheet')
sheet.push('')
sheet.push('For each item answer **OK** (a real, first-person, unhedged claim of that kind,')
sheet.push('fields correct) or **BAD** (not a claim / wrong kind / hedged / group statement /')
sheet.push('wrong fields), plus an optional note. Do not look up games while rating.')
sheet.push('')
sampled.forEach((c, i) => {
  const fields = [
    c.role ? `role=${c.role}` : null,
    c.target ? `target=${c.target}` : null,
    c.result ? `result=${c.result}` : null,
    c.night ? `night=${c.night}` : null,
  ].filter(Boolean).join(' · ')
  sheet.push(`**${i + 1}.** [${c.kind}${fields ? ' · ' + fields : ''}] — day ${c.day}`)
  sheet.push(`> "${c.quote}"`)
  sheet.push('')
  sheet.push('    verdict: OK / BAD    note:')
  sheet.push('')
})
if (nulls.length) {
  sheet.push('---')
  sheet.push('## Missed-claim check')
  sheet.push('The judge extracted nothing from these messages. Flag any that DO contain a')
  sheet.push('first-person role / not-mafia / investigation / protection / vote claim.')
  sheet.push('')
  nulls.forEach((m, i) => {
    sheet.push(`**N${i + 1}.** (day ${m.day})`)
    sheet.push(`> "${m.text}"`)
    sheet.push('')
    sheet.push('    contains a claim? NO / YES (which):')
    sheet.push('')
  })
}
writeFileSync(join(values.out, 'sheet.md'), sheet.join('\n'))
writeFileSync(join(values.out, 'answer-key.jsonl'),
  sampled.map((c) => JSON.stringify(c)).join('\n') + '\n')
console.log(`wrote ${values.out}/sheet.md (${sampled.length} claims + ${nulls.length} null checks) and answer-key.jsonl`)
