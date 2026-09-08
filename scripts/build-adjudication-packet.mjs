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
import { KNOWN_KINDS, KNOWN_RESULTS, KNOWN_ROLES, PF2_PACKET_VERSION, recallClaimFingerprint } from './correction-validation.mjs'

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
// v3.2 §3: adjudication outcomes are OK / BAD / CORRECTED. CORRECTED is the
// outcome v3.1 lacked — a genuine claim whose FIELDS are wrong — and the one
// that would have caught audit rows 1-6, where the sheet showed an unsupported
// night number and the protocol had nothing to reach for but accept/reject.
const RULINGS = ['OK', 'BAD', 'CORRECTED']
const ruling = (it) => ratings.positiveRatings?.[String(it.item)]
if (items.some((it) => !RULINGS.includes(ruling(it)))) fail(`sensitivity ratings incomplete — packet needs a ruling in ${RULINGS.join('/')} for every item`)

const h = (s) => createHash('sha256').update(values.seed).update('\x00').update(s).digest('hex')

const disputes = items.filter((it) => ruling(it) === 'BAD' || ruling(it) === 'CORRECTED')
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
    ;(claims ?? []).forEach((c, k) => {
      if (!PUBLISHED.has(c.kind)) return
      const src = negKey.get(String(id))
      if (!src) return
      misses.push({
      // A miss has no sealed-key item number; the origin is the negatives id.
      // v3.2.5: one packet item binds to ONE exact claim — the claimId names
      // the claim's index in the ratings file (a message can carry several),
      // and srcClaim carries the complete listed proposition for the key pin.
        item: `miss-${id}`, claimId: `miss-${id}#${k}`, srcClaim: c,
        seed: src.seed, seq: src.seq, day: src.day, kind: c.kind,
        ...(c.role ? { role: c.role } : {}), ...(c.target ? { target: c.target } : {}),
        ...(c.result ? { result: c.result } : {}),
        quote: c.quote ?? null, machineDecision: 'missed',
      })
    })
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
sheet.push('# Targeted human pass — blind adjudication packet (PF-2, v3.2 §3)')
sheet.push('')
sheet.push('For each item answer exactly one of:')
sheet.push('')
sheet.push('- **OK** — a genuine first-person claim of that kind, with those fields,')
sheet.push('  asserted in THIS message.')
sheet.push('- **BAD** — not a claim of that kind, or not asserted here.')
sheet.push('- **CORRECTED** — a genuine claim whose FIELDS are wrong. Fill the')
sheet.push('  corrected slots below the item; leave a slot blank to keep the field as')
sheet.push('  shown, and write `-` to STRIKE it (the ruling for a night number the')
sheet.push('  message never literally states — v3.2 §2).')
sheet.push('')
sheet.push('Every ruling cites the exact codebook rule it applies (`rule:`). Items are')
sheet.push('shuffled; nothing marks why an item is here. Do not open sealed keys or')
sheet.push('logs while rating.')
sheet.push('')
sheet.push('Record rulings in a copy of `packet-template.json` (it pre-fills the')
sheet.push('binding metadata) saved beside it as `<rater>-packet-ratings.json`.')
sheet.push('The contract is `packet-ratings.schema.json`; a harmless filled example')
sheet.push('is `packet-ratings.example.json`. Correctable fields: kind, role,')
sheet.push('target, result, claimedNight, quote, resolvingContext. A corrected')
sheet.push('resolvingContext is `{"seq": <earlier public seq by the same speaker>,')
sheet.push('"text": "<byte-exact substring of that message>"}` (R12b/R19).')
sheet.push('')
sheet.push('Blinding, stated precisely (v3.2.4): this sitting is ITEM-LEVEL BLIND —')
sheet.push('no item shows its arm, the sensitivity ruling, a verdict, a role, a')
sheet.push('model, or a game outcome, and the sealed keys stay closed. It is NOT')
sheet.push('prior-free: the rater saw aggregate family-level sensitivity results')
sheet.push('before this sitting. That disclosure is recorded in the provenance')
sheet.push('manifest and travels with the published validation summary.')
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
  sheet.push('    ruling: OK / BAD / CORRECTED    rule:            note:')
  // v3.2.4: `role` is scorer-correctable (CORRECTABLE_FIELDS) but the v3.2.3
  // slots never offered it — a wrong-role role_claim had no interface but BAD.
  // resolvingContext takes seq AND byte-exact text: the merge validates both
  // (R12b provenance, R19 receipt), so the form must collect both.
  sheet.push('    corrected — kind:        role:        target:        result:        claimedNight:')
  sheet.push('    corrected — quote:')
  sheet.push('    corrected — resolvingContext seq:        resolvingContext text (byte-exact):')
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
// Selection, ordering and serialization are UNCHANGED from v3.2.3: a
// regeneration over the same inputs and seed reproduces every dispute and
// audit row byte-for-byte and every item in the same position. v3.2.5 adds
// ONE thing, on recall-miss rows only: the claimId and the complete
// normalized claim pin (fields + byte-exact quote + span offset), so a
// ruling can never route to a different claim than the one the sheet showed.
const keyContent = [JSON.stringify(meta), ...packet.map((p, i) => JSON.stringify({
  packetItem: i + 1, origin: p.item, seed: p.seed, seq: p.seq, kind: p.kind,
  section: typeof p.item === 'string' && p.item.startsWith('miss-') ? 'recall-miss'
    : ruling(p) === 'OK' ? 'audit' : 'dispute',
  sensitivityRuling: typeof p.item === 'string' && p.item.startsWith('miss-') ? 'CLAIMED' : ruling(p),
  analysisRunId: keyMeta.analysisRunId,
  ...(p.claimId ? (() => {
    const text = texts.get(`${p.seed}|${p.seq}`)?.text
    const fp = recallClaimFingerprint(p.srcClaim)
    if (typeof fp.quote !== 'string' || fp.quote === '') fail(`${p.claimId}: listed claim has no quote — a span-less pin is not a receipt (R19)`)
    const at = typeof text === 'string' ? text.indexOf(fp.quote) : -1
    if (at < 0) fail(`${p.claimId}: quote is not a byte-exact substring of ${p.seed} seq ${p.seq} (R19)`)
    return { claimId: p.claimId, claim: { ...fp, charStart: at } }
  })() : {}),
}))].join('\n') + '\n'
writeAtomic(join(values.out, 'packet-key.jsonl'), keyContent)
// v3.2.4: the ratings bind to THIS packet by content, not by trust — the
// template pre-fills the key file's sha256, the seed, the interface version,
// and the item count, and the merge refuses a ratings file whose binding is
// missing, mismatched, or whose ruling set is not exactly items 1..N.
const packetKeySha256 = createHash('sha256').update(keyContent).digest('hex')
// v3.2 §3: `rules` carries the codebook citation every ruling owes, and
// `corrections` the corrected fields a CORRECTED ruling stores. Both are
// keyed by packet item number, like positiveRatings.
writeAtomic(join(values.out, 'packet-template.json'), JSON.stringify({
  rater: 'ryan', analysisRunId: keyMeta.analysisRunId,
  packetSeed: values.seed, packetVersion: PF2_PACKET_VERSION,
  packetKeySha256, packetItems: packet.length,
  blindSource: 'packet-sheet.md only', answerKeyOpened: false,
  rulingVocabulary: RULINGS,
  positiveRatings: Object.fromEntries(packet.map((_, i) => [String(i + 1), ''])),
  rules: {},
  corrections: {},
  notes: {},
}, null, 2) + '\n')

// The ratings contract, stated once for the rater (the merge enforces the
// same contract fail-closed; this file documents, it does not gatekeep).
writeAtomic(join(values.out, 'packet-ratings.schema.json'), JSON.stringify({
  $comment: `PF-2 packet ratings contract (${PF2_PACKET_VERSION}). Enforced by scripts/merge-packet-rulings.mjs; strike sentinel for a corrected field is "-" (or null). A kind or quote can never be struck.`,
  type: 'object',
  required: ['rater', 'analysisRunId', 'packetSeed', 'packetVersion', 'packetKeySha256', 'packetItems', 'blindSource', 'answerKeyOpened', 'positiveRatings', 'rules', 'corrections', 'notes'],
  properties: {
    rater: { type: 'string', minLength: 1 },
    analysisRunId: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    packetSeed: { type: 'string', minLength: 1 },
    packetVersion: { const: PF2_PACKET_VERSION },
    packetKeySha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    packetItems: { type: 'integer', minimum: 1 },
    answerKeyOpened: { const: false },
    positiveRatings: {
      description: 'One ruling per packet item, keys exactly "1".."packetItems" — no gaps, no extras.',
      type: 'object', additionalProperties: { enum: RULINGS },
    },
    rules: {
      description: 'Codebook citation per ruled item (required for every item — v3.2 §3).',
      type: 'object', additionalProperties: { type: 'string', minLength: 2 },
    },
    corrections: {
      description: 'Present for every CORRECTED item and no others; only the changed fields.',
      type: 'object',
      additionalProperties: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { enum: [...KNOWN_KINDS] },
          role: { anyOf: [{ enum: [...KNOWN_ROLES] }, { const: '-' }, { type: 'null' }] },
          target: { type: ['string', 'null'] },
          result: { anyOf: [{ enum: [...KNOWN_RESULTS] }, { const: '-' }, { type: 'null' }] },
          claimedNight: { type: ['integer', 'string', 'null'] },
          quote: { type: 'string', minLength: 1 },
          resolvingContext: {
            description: 'R12b provenance: an EARLIER public seq by the same speaker plus the byte-exact text (R19). Both are validated against the logs.',
            type: ['object', 'null'],
            required: ['seq', 'text'],
            additionalProperties: false,
            properties: { seq: { type: 'integer' }, text: { type: 'string', minLength: 1 } },
          },
        },
      },
    },
    notes: { type: 'object', additionalProperties: { type: 'string' } },
  },
}, null, 2) + '\n')
writeAtomic(join(values.out, 'packet-ratings.example.json'), JSON.stringify({
  $comment: 'HARMLESS EXAMPLE — fake items, not drawn from any packet. Start from packet-template.json (it pre-fills the real binding metadata) and fill every item.',
  rater: 'ryan', analysisRunId: '0'.repeat(64),
  packetSeed: 'example-seed', packetVersion: PF2_PACKET_VERSION,
  packetKeySha256: '0'.repeat(64), packetItems: 3,
  blindSource: 'packet-sheet.md only', answerKeyOpened: false,
  rulingVocabulary: RULINGS,
  positiveRatings: { 1: 'OK', 2: 'BAD', 3: 'CORRECTED' },
  rules: { 1: '§2.1 role_claim', 2: 'R10', 3: 'amendment §2 / R12b' },
  corrections: { 3: { claimedNight: '-', role: 'doctor', resolvingContext: { seq: 12, text: 'example byte-exact prior text' } } },
  notes: { 2: 'A directive to the doctor, not an asserted protection.', 3: 'Night number never literally stated; role visible in the span.' },
}, null, 2) + '\n')
console.log(`wrote ${values.out}: ${packet.length} items (${disputes.length} disputes + ${audit.length} audit + ${misses.length} recall-miss), shuffled blind`)
console.log(`packet ${PF2_PACKET_VERSION} · key sha256 ${packetKeySha256.slice(0, 16)}… · template/schema/example beside it`)
