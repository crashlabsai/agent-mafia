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
import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { PF2_PACKET_VERSION, recallClaimFingerprint, validateCorrection, validateRecoveredClaim } from './correction-validation.mjs'

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
const packetKeyRaw = readFileSync(values['packet-key'], 'utf8')
const packetKeyLines = packetKeyRaw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const packetKeyMeta = packetKeyLines.find((r) => r._meta)
const packetKey = packetKeyLines.filter((r) => !r._meta)
const packet = JSON.parse(readFileSync(values['packet-ratings'], 'utf8'))
for (const [label, r] of [['sensitivity', sens], ['packet-ratings', packet]]) {
  if (r.analysisRunId !== keyMeta.analysisRunId) fail(`${label}: analysisRunId does not match the sealed key (§5)`)
}

// ---------------------------------------------------------------------------
// v3.2.4: packet lineage binds by hash and identity, never by trust. The
// ratings file must carry the packet-key sha256, seed, interface version,
// and item count its template pre-filled, all of which are verified against
// the ACTUAL key file on disk — and the ruling set must be exactly items
// 1..N. Absence is rejected like mismatch (v3.2.3 metadata rule): a ratings
// file from a substituted, truncated, reordered, or foreign packet fails
// here, before a single ruling is read.
// ---------------------------------------------------------------------------
if (!packetKeyMeta || packetKeyMeta.mode !== 'adjudication-packet') {
  fail(`${values['packet-key']}: not an adjudication-packet key`)
}
if (packetKeyMeta.analysisRunId !== keyMeta.analysisRunId) {
  fail('packet key: analysisRunId does not match the sealed key (§5)')
}
packetKey.forEach((pk, i) => {
  if (pk.packetItem !== i + 1) {
    fail(`packet key: row ${i + 1} carries packetItem ${pk.packetItem} — the key is reordered or incomplete; refuse it`)
  }
})
if (packetKeyMeta.items !== packetKey.length) {
  fail(`packet key: meta declares ${packetKeyMeta.items} items but ${packetKey.length} rows follow — truncated or padded key`)
}
for (const f of ['packetSeed', 'packetVersion', 'packetKeySha256', 'packetItems']) {
  if (packet[f] === undefined || packet[f] === null || packet[f] === '') {
    fail(`packet-ratings: missing ${f} — ratings must bind to their packet (v3.2.4); start from packet-template.json`)
  }
}
if (packet.packetVersion !== PF2_PACKET_VERSION) {
  fail(`packet-ratings: packetVersion ${JSON.stringify(packet.packetVersion)} is not ${PF2_PACKET_VERSION} — the ratings were made against a different interface`)
}
if (packet.packetSeed !== packetKeyMeta.seed) {
  fail(`packet-ratings: packetSeed ${JSON.stringify(packet.packetSeed)} does not match the key's seed ${JSON.stringify(packetKeyMeta.seed)}`)
}
const actualKeySha = createHash('sha256').update(packetKeyRaw).digest('hex')
if (packet.packetKeySha256 !== actualKeySha) {
  fail(`packet-ratings: packetKeySha256 does not match the packet key on disk — substituted or regenerated packet; refuse it`)
}
if (packet.packetItems !== packetKey.length) {
  fail(`packet-ratings: packetItems ${packet.packetItems} does not match the key's ${packetKey.length} rows`)
}
{
  const wanted = new Set(packetKey.map((pk) => String(pk.packetItem)))
  const rated = Object.keys(packet.positiveRatings ?? {})
  const missing = [...wanted].filter((k) => !(k in (packet.positiveRatings ?? {})))
  const extras = rated.filter((k) => !wanted.has(k))
  if (missing.length > 0) fail(`packet-ratings: ${missing.length} packet item(s) unruled (first: ${missing[0]}) — a partial sitting cannot merge`)
  if (extras.length > 0) fail(`packet-ratings: rulings for unknown item(s) ${extras.slice(0, 3).join(', ')} — not in this packet; wrong or edited file`)
  for (const [label, map] of [['rules', packet.rules], ['corrections', packet.corrections], ['notes', packet.notes]]) {
    const stray = Object.keys(map ?? {}).filter((k) => !wanted.has(k))
    if (stray.length > 0) fail(`packet-ratings: ${label} carries unknown item(s) ${stray.slice(0, 3).join(', ')} — not in this packet`)
  }
  // The correction map is part of the ruling contract, not optional notes:
  // exactly CORRECTED items carry one entry. Otherwise a stale correction on
  // an OK/BAD ruling is silently ignored and the saved human artifact says
  // two different things about the same item.
  for (const item of wanted) {
    const ruling = packet.positiveRatings?.[item]
    const hasCorrection = Object.prototype.hasOwnProperty.call(packet.corrections ?? {}, item)
    if (ruling === 'CORRECTED' && !hasCorrection) {
      fail(`packet item ${item}: CORRECTED ruling has no corrections entry — the corrected proposition must be stored (v3.2.6)`)
    }
    if (ruling !== 'CORRECTED' && hasCorrection) {
      fail(`packet item ${item}: corrections entry is present for ${ruling ?? 'an invalid ruling'} — corrections are allowed only for CORRECTED items (v3.2.6)`)
    }
  }
}
const { loadManifest } = await import('./analysis-manifest.mjs')
const manifest = loadManifest(values.manifest)
if (manifest.analysisRunId !== keyMeta.analysisRunId &&
    !(manifest.supersedes ?? []).includes(keyMeta.analysisRunId)) {
  fail(`manifest ${manifest.analysisRunId.slice(0, 12)}… neither matches nor supersedes the rating-phase id ${keyMeta.analysisRunId.slice(0, 12)}… (§5)`)
}

// v3.2 §3: outcomes are OK / BAD / CORRECTED, every ruling cites the exact
// codebook rule, and a CORRECTED ruling stores the corrected proposition.
// Validation lives in correction-validation.mjs — one contract shared with
// every sitting flow that writes corrections (v3.2.2).
const RULINGS = ['OK', 'BAD', 'CORRECTED']

/** Public messages by seq, per seed — the R12b provenance the rulings cite. */
const messageCache = new Map()
const messagesOf = (seed) => {
  if (!messageCache.has(seed)) {
    const events = readJsonl(join(values.logs, `${seed}.jsonl`))
    const bySeq = new Map()
    for (const e of events) {
      if (e.type === 'message_sent' && e.visibility === 'public') {
        bySeq.set(e.seq, { text: e.payload.text, actor: e.actor })
      }
    }
    messageCache.set(seed, bySeq)
  }
  return messageCache.get(seed)
}

/** The `corrected` block a CORRECTED ruling stores on the record (v3.2 §3). */
function correctionFor(item, rulingRow, record) {
  try {
    return validateCorrection({
      where: `packet item ${item}`,
      raw: packet.corrections?.[String(item)],
      record, rule: rulingRow.rule, note: rulingRow.note,
      getMessage: (seed, seq) => messagesOf(seed).get(seq),
    })
  } catch (e) { fail(String(e.message ?? e)) }
}

// packetItem -> human ruling, indexed by the ORIGINAL sheet item number.
const humanByOrigin = new Map()
const missRulings = new Map() // negatives id -> {ruling, note, rule, item}
for (const pk of packetKey) {
  const ruling = packet.positiveRatings?.[String(pk.packetItem)]
  if (!RULINGS.includes(ruling)) fail(`packet item ${pk.packetItem}: missing or invalid human ruling (expected ${RULINGS.join('/')})`)
  const note = packet.notes?.[String(pk.packetItem)] ?? ''
  // v3.2 §3: codebook-pinned rulings. The v3.1 audit put 15 of its 20 invalid
  // rows down to unpinned human overturns at the assertion-strength boundary.
  const rule = packet.rules?.[String(pk.packetItem)]
  if (typeof rule !== 'string' || rule.trim() === '') {
    fail(`packet item ${pk.packetItem}: every ruling must cite the exact codebook rule (v3.2 §3)`)
  }
  const row = { ruling, note, rule, item: pk.packetItem, section: pk.section }
  if (pk.section === 'recall-miss') {
    // v3.2.5: one packet item binds to ONE exact claim. The key row pins the
    // claimId (message id + index in the ratings file) and the complete
    // normalized claim; keying the rulings by negatives id alone let a second
    // claim on the same message silently overwrite the first ruling, and let
    // one ruling fan out to every claim on the message.
    if (typeof pk.claimId !== 'string' || !pk.claim || typeof pk.claim !== 'object') {
      fail(`packet item ${pk.packetItem}: recall-miss row carries no claimId/claim pin — pre-v3.2.5 packet; regenerate it`)
    }
    if (missRulings.has(pk.claimId)) fail(`packet key: duplicate recall-miss claimId ${pk.claimId}`)
    missRulings.set(pk.claimId, { ...row, claim: pk.claim })
  } else humanByOrigin.set(String(pk.origin), row)
}

const counts = {
  total: items.length, humanRuled: humanByOrigin.size, sensitivityOnly: 0,
  confirmed: 0, corrected: 0, excluded: 0, missesAdded: 0,
}
const out = []
for (const it of items) {
  const sensRuling = sens.positiveRatings?.[String(it.item)]
  if (!RULINGS.includes(sensRuling)) fail(`sheet item ${it.item}: missing sensitivity ruling`)
  const human = humanByOrigin.get(String(it.item))
  const final = human ? human.ruling : sensRuling
  if (!human) counts.sensitivityOnly += 1
  // An OK on a machine-REJECTED candidate recovers it into the ledger —
  // reviewing rejected power candidates exists exactly for that (§6.1).
  // v3.2 §3: CORRECTED confirms the claim and stores the corrected fields;
  // scoring-v3's applyCorrection is what makes them reach the verdict.
  const confirmed = final === 'OK' || final === 'CORRECTED'
  if (confirmed) counts.confirmed += 1
  else counts.excluded += 1
  const corrected = final === 'CORRECTED' && human ? correctionFor(human.item, human, it) : null
  if (corrected) counts.corrected += 1
  if (final === 'CORRECTED' && !human) {
    fail(`sheet item ${it.item}: a CORRECTED ruling from the sensitivity rater alone is not final — it belongs in the human packet (v3.2 §3)`)
  }
  out.push({
    ...it,
    analysisRunId: manifest.analysisRunId,
    ...(corrected ? { corrected } : {}),
    human: human
      ? { rater: packet.rater, confirmed, ruling: final, rule: human.rule, note: human.note, via: `packet-${human.section}` }
      : { rater: sens.rater, confirmed, ruling: final, note: sens.notes?.[String(it.item)] ?? '', via: 'sensitivity-uncontested' },
  })
}

// Confirmed recall-misses -> candidate claim records for the ledger.
// v3.2.5: a ruled miss with no negatives files is a silent drop — refused.
if (missRulings.size > 0 && (!values['negatives-key'] || !values['negatives-ratings'])) {
  fail(`packet carries ${missRulings.size} ruled recall-miss claim(s) but no --negatives-key/--negatives-ratings — a ruled miss must never be dropped silently (v3.2.5)`)
}
if (values['negatives-key'] && values['negatives-ratings']) {
  const negKey = new Map(readJsonl(values['negatives-key']).filter((r) => !r._meta).map((r) => [String(r.item), r]))
  const negRatings = JSON.parse(readFileSync(values['negatives-ratings'], 'utf8'))
  const missQuotes = values['miss-quotes'] ? JSON.parse(values['miss-quotes']) : {}
  for (const [claimId, verdict] of missRulings) {
    const idm = /^miss-(.+)#(\d+)$/.exec(claimId)
    if (!idm) fail(`${claimId}: malformed recall-miss claimId`)
    const id = idm[1]
    const src = negKey.get(id)
    if (!src) fail(`${claimId}: negatives key carries no message ${id} — wrong negatives lineage`)
    // v3.2.5 exact-claim binding: the ruling reaches exactly the claim the
    // sheet showed. The ratings file's claim at the pinned index must equal
    // the sealed pin field-for-field (one fingerprint definition on both
    // ends) — an edited, reordered, or substituted claim is refused, and one
    // ruling can never fan out across a message's other claims.
    const listed = (negRatings.negativeClaims?.[id] ?? [])[Number(idm[2])]
    if (!listed) {
      fail(`${claimId}: the ratings file carries no claim #${idm[2]} on message ${id} — changed or substituted since the packet was built (v3.2.5)`)
    }
    const { charStart: pinnedAt, ...pinnedFp } = verdict.claim
    if (JSON.stringify(recallClaimFingerprint(listed)) !== JSON.stringify(pinnedFp)) {
      fail(`${claimId}: the listed claim does not match the packet's sealed claim pin — changed or substituted (v3.2.5)`)
    }
    // The pin is verified for EVERY ruled miss BEFORE the ruling branches:
    // skipping BAD first meant a mutated, removed, or reordered BAD-ruled
    // claim sailed through unexamined — an integrity check that only runs on
    // the claims you keep is not an integrity check. Only a verified claim
    // may now be skipped as BAD.
    if (verdict.ruling !== 'OK' && verdict.ruling !== 'CORRECTED') continue
    const quote = listed.quote ?? missQuotes[claimId] ?? missQuotes[id]
    if (typeof quote !== 'string') fail(`${claimId}: no span — supply it via --miss-quotes (R19: no receipt, no ledger entry)`)
    // Verify byte-exactness against the log right here, not downstream.
    const text = messagesOf(src.seed).get(src.seq)?.text
    const at = typeof text === 'string' ? text.indexOf(quote) : -1
    if (at < 0) fail(`${claimId}: span is not a byte-exact substring of ${src.seed} seq ${src.seq}`)
    if (Number.isInteger(pinnedAt) && at !== pinnedAt) {
      fail(`${claimId}: span offset ${at} does not match the sealed pin ${pinnedAt} (R19)`)
    }
    // v3.2.2: every recovered claim is validated fail-closed (kind in the
    // codebook — a typo fails loudly, never a silent drop; enums; required
    // fields; §2 nights). Shelved kinds are valid but never publish (§2.1).
    let validated
    try { validated = validateRecoveredClaim({ where: claimId, claim: { ...listed, quote }, text }) }
    catch (e) { fail(String(e.message ?? e)) }
    if (!validated.publishable) continue
    const fields = validated.fields
    if (listed.claimedNight != null && fields.claimedNight === undefined) {
      console.error(`note: ${claimId}: claimedNight ${listed.claimedNight} is not literally stated in ${src.seed} seq ${src.seq} — struck (v3.2 §2)`)
    }
    // v3.2.5: a CORRECTED ruling on a recall-miss APPLIES — the human's
    // corrected proposition is validated against the recovered base record
    // (shared correction-validation contract) and stored as the `corrected`
    // block the scorer reads. Before this, the human's fix was silently
    // discarded and the rater-listed fields recovered unchanged.
    const baseRecord = {
      seed: src.seed, seq: src.seq, seat: src.seat ?? src.actor, day: src.day,
      kind: listed.kind, ...fields, quote, charStart: at,
    }
    let corrected = null
    if (verdict.ruling === 'CORRECTED') {
      corrected = correctionFor(verdict.item, verdict, baseRecord)
      counts.corrected += 1
    }
    counts.missesAdded += 1
    counts.confirmed += 1
    out.push({
      // v3.2.5: the record's item id is the claimId — unique per claim, so
      // two recovered claims on one message stay two records.
      item: claimId, seed: src.seed, game: src.game ?? null, seq: src.seq, seat: src.seat ?? src.actor, day: src.day,
      kind: listed.kind,
      ...fields,
      quote, charStart: at, machineDecision: 'missed-recovered',
      analysisRunId: manifest.analysisRunId,
      sources: ['negative-sample'],
      ...(corrected ? { corrected } : {}),
      // The reading this record projects (v3.2 §4): the rater-listed claim,
      // recorded honestly as what it is.
      machine: { asserted: true, kind: listed.kind, fields: { ...fields } },
      human: { rater: packet.rater, confirmed: true, ruling: verdict.ruling, rule: verdict.rule, note: verdict.note, via: 'packet-recall-miss' },
    })
  }
}

mkdirSync(dirname(resolve(values.out)), { recursive: true })
const meta = {
  _meta: true, mode: 'confirmed-input', analysisRunId: manifest.analysisRunId,
  ratedUnderRunId: keyMeta.analysisRunId === manifest.analysisRunId ? undefined : keyMeta.analysisRunId,
  rater: packet.rater, sensitivityRater: sens.rater,
  design: 'PF-2 targeted human pass, v3.2 §3 OK/BAD/CORRECTED',
  rulingVocabulary: RULINGS,
  items: out.length, ...counts,
}
const tmp = `${values.out}.tmp-${process.pid}`
writeFileSync(tmp, [meta, ...out].map((r) => JSON.stringify(r)).join('\n') + '\n')
renameSync(tmp, values.out)
console.log(`wrote ${values.out}: ${out.length} records — ${counts.confirmed} confirmed ` +
  `(${counts.humanRuled} human-ruled, ${counts.sensitivityOnly} sensitivity-uncontested, ${counts.corrected} CORRECTED, ` +
  `${counts.missesAdded} recovered misses), ${counts.excluded} excluded`)
