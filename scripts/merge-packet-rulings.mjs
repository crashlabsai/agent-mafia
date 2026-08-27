// PF-2 ruling merge: sensitivity rating over all sheet items + the human's
// blind packet rulings -> one confirmed-input.jsonl for build-ledger.
//
// Final-ruling rule, per the approved PF-2 design: where the human ruled
// (every dispute, the audit sample, every recall-miss), the human ruling is
// final; everywhere else the sensitivity rater's accept stands, carrying an
// honest per-item rater name — no record ever claims a human ruling it did
// not receive. Confirmed recall-misses become ledger candidates here, built
// from the negatives key's message identity plus the rater-listed claim.
//
//   node scripts/merge-packet-rulings.mjs \
//        --key runs/analysis-v3/handcheck/sealed-key.jsonl \
//        --sensitivity runs/analysis-v3/handcheck/codex-ratings.json \
//        --packet-key runs/analysis-v3/handcheck/packet/packet-key.jsonl \
//        --packet-ratings runs/analysis-v3/handcheck/packet/ryan-packet-ratings.json \
//        --negatives-key runs/analysis-v3/handcheck/negatives-sealed-key.jsonl \
//        --negatives-ratings runs/analysis-v3/handcheck/codex-negatives.json \
//        --out runs/analysis-v3/ledger/confirmed-input.jsonl
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    key: { type: 'string' },
    sensitivity: { type: 'string' },
    'packet-key': { type: 'string' },
    'packet-ratings': { type: 'string' },
    'negatives-key': { type: 'string' },
    'negatives-ratings': { type: 'string' },
    /** JSON map {missId: quote} for recovered misses whose rating lacked a
     *  span (e.g. supplied in the rater's written summary). Each is verified
     *  byte-exact against the source message here — R19 receipts always. */
    'miss-quotes': { type: 'string' },
    logs: { type: 'string', default: 'runs/sweep-download/sweep1' },
    /** Current manifest: the output is stamped with ITS analysisRunId while
     *  ratedUnderRunId records the id the sealed keys and ratings carry —
     *  a manifest re-pinned with fuller provenance supersedes the rating-
     *  phase id without pretending the ratings happened under it. */
    manifest: { type: 'string', default: 'runs/analysis-v3/manifest.json' },
    out: { type: 'string', default: 'runs/analysis-v3/ledger/confirmed-input.jsonl' },
  },
})
const fail = (m) => { console.error(m); process.exit(1) }
for (const f of ['key', 'sensitivity', 'packet-key', 'packet-ratings']) if (!values[f]) fail(`--${f} is required`)

const readJsonl = (p) => readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const keyLines = readJsonl(values.key)
const keyMeta = keyLines.find((r) => r._meta)
const items = keyLines.filter((r) => !r._meta)
const sens = JSON.parse(readFileSync(values.sensitivity, 'utf8'))
const packetKey = readJsonl(values['packet-key']).filter((r) => !r._meta)
const packet = JSON.parse(readFileSync(values['packet-ratings'], 'utf8'))
for (const [label, r] of [['sensitivity', sens], ['packet-ratings', packet]]) {
  if (r.analysisRunId !== keyMeta.analysisRunId) fail(`${label}: analysisRunId does not match the sealed key (§5)`)
}
const { loadManifest } = await import('./analysis-manifest.mjs')
const manifest = loadManifest(values.manifest)
if (manifest.analysisRunId !== keyMeta.analysisRunId &&
    !(manifest.supersedes ?? []).includes(keyMeta.analysisRunId)) {
  fail(`manifest ${manifest.analysisRunId.slice(0, 12)}… neither matches nor supersedes the rating-phase id ${keyMeta.analysisRunId.slice(0, 12)}… (§5)`)
}

// packetItem -> human ruling, indexed by the ORIGINAL sheet item number.
const humanByOrigin = new Map()
const missRulings = new Map() // negatives id -> {ruling, note}
for (const pk of packetKey) {
  const ruling = packet.positiveRatings?.[String(pk.packetItem)]
  if (!['OK', 'BAD'].includes(ruling)) fail(`packet item ${pk.packetItem}: missing or invalid human ruling`)
  const note = packet.notes?.[String(pk.packetItem)] ?? ''
  if (pk.section === 'recall-miss') missRulings.set(String(pk.origin).replace(/^miss-/, ''), { ruling, note })
  else humanByOrigin.set(String(pk.origin), { ruling, note, section: pk.section })
}

const counts = { total: items.length, humanRuled: humanByOrigin.size, sensitivityOnly: 0, confirmed: 0, excluded: 0, missesAdded: 0 }
const out = []
for (const it of items) {
  const sensRuling = sens.positiveRatings?.[String(it.item)]
  if (!['OK', 'BAD'].includes(sensRuling)) fail(`sheet item ${it.item}: missing sensitivity ruling`)
  const human = humanByOrigin.get(String(it.item))
  const final = human ? human.ruling : sensRuling
  if (!human) counts.sensitivityOnly += 1
  // An OK on a machine-REJECTED candidate recovers it into the ledger —
  // reviewing rejected power candidates exists exactly for that (§6.1).
  const confirmed = final === 'OK'
  if (confirmed) counts.confirmed += 1
  else counts.excluded += 1
  out.push({
    ...it,
    analysisRunId: manifest.analysisRunId,
    human: human
      ? { rater: packet.rater, confirmed, note: human.note, via: `packet-${human.section}` }
      : { rater: sens.rater, confirmed, note: sens.notes?.[String(it.item)] ?? '', via: 'sensitivity-uncontested' },
  })
}

// Confirmed recall-misses -> candidate claim records for the ledger.
if (values['negatives-key'] && values['negatives-ratings']) {
  const negKey = new Map(readJsonl(values['negatives-key']).filter((r) => !r._meta).map((r) => [String(r.item), r]))
  const negRatings = JSON.parse(readFileSync(values['negatives-ratings'], 'utf8'))
  const PUBLISHED = new Set(['role_claim', 'not_mafia_claim', 'investigation_claim', 'protection_claim'])
  const missQuotes = values['miss-quotes'] ? JSON.parse(values['miss-quotes']) : {}
  for (const [id, verdict] of missRulings) {
    if (verdict.ruling !== 'OK') continue
    const src = negKey.get(id)
    const claims = (negRatings.negativeClaims?.[id] ?? []).filter((c) => PUBLISHED.has(c.kind))
    for (const c of claims) {
      const quote = c.quote ?? missQuotes[`miss-${id}`] ?? missQuotes[id]
      if (typeof quote !== 'string') fail(`miss-${id}: no span — supply it via --miss-quotes (R19: no receipt, no ledger entry)`)
      // Verify byte-exactness against the log right here, not downstream.
      const events = readFileSync(join(values.logs, `${src.seed}.jsonl`), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      const msg = events.find((e) => e.type === 'message_sent' && e.seq === src.seq)
      const at = msg ? msg.payload.text.indexOf(quote) : -1
      if (at < 0) fail(`miss-${id}: span is not a byte-exact substring of ${src.seed} seq ${src.seq}`)
      counts.missesAdded += 1
      counts.confirmed += 1
      out.push({
        item: `miss-${id}`, seed: src.seed, game: src.game ?? null, seq: src.seq, seat: src.seat ?? src.actor, day: src.day,
        kind: c.kind,
        ...(c.role ? { role: c.role } : {}), ...(c.target ? { target: c.target } : {}),
        ...(c.result ? { result: c.result } : {}),
        quote, charStart: at, machineDecision: 'missed-recovered',
        analysisRunId: manifest.analysisRunId,
        sources: ['negative-sample'],
        machine: { asserted: true, kind: c.kind, fields: {} },
        human: { rater: packet.rater, confirmed: true, note: verdict.note, via: 'packet-recall-miss' },
      })
    }
  }
}

mkdirSync(dirname(resolve(values.out)), { recursive: true })
const meta = {
  _meta: true, mode: 'confirmed-input', analysisRunId: manifest.analysisRunId,
  ratedUnderRunId: keyMeta.analysisRunId === manifest.analysisRunId ? undefined : keyMeta.analysisRunId,
  rater: packet.rater, sensitivityRater: sens.rater, design: 'PF-2 targeted human pass',
  items: out.length, ...counts,
}
const tmp = `${values.out}.tmp-${process.pid}`
writeFileSync(tmp, [meta, ...out].map((r) => JSON.stringify(r)).join('\n') + '\n')
renameSync(tmp, values.out)
console.log(`wrote ${values.out}: ${out.length} records — ${counts.confirmed} confirmed ` +
  `(${counts.humanRuled} human-ruled, ${counts.sensitivityOnly} sensitivity-uncontested, ${counts.missesAdded} recovered misses), ${counts.excluded} excluded`)
