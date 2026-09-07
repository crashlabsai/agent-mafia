// Closure apply — analysis v3.2.2 §8.
//
// The §8 sitting produced first-pass rulings (the MEASUREMENT of machine
// error, published by build-review-packet --unblind) and, after the model
// cross-check, final rulings. This script is the other half the closure
// review found missing: it APPLIES those final rulings to the confirmed-input
// layer so the ledger can be rebuilt and rescored —
//
//   BAD        -> the record's human confirmation is withdrawn; it leaves the
//                 ledger with a reviewRuling audit block, never silently;
//   CORRECTED  -> the validated corrected block is attached (shared
//                 correction-validation contract) and the scorer rescores the
//                 corrected proposition;
//   OK         -> the record is stamped reviewRuling so gate S10 can prove
//                 closure: every false row carries an adjudication;
//   missedClaims (message-scan) -> validated recovered records are appended,
//                 exactly like §6.2 miss-recovery.
//
// Rebuilding can CREATE new false rows (a correction flips a verdict; a
// recovered claim scores false). Those carry no reviewRuling, gate S10
// reports the closure incomplete, and the operator builds the next census
// packet over exactly those rows — the loop runs until every false row is
// adjudicated. Every apply step appends to the closure chain (packet key
// sha, rulings shas, input/output shas), so the final ledger is bound to the
// sittings that produced it by hashes, not counts.
//
//   node scripts/apply-review-rulings.mjs \
//        --key runs/analysis-v3/handcheck/review-packet/review-packet-key.jsonl \
//        --rulings .../ryan-rulings.json [--final-rulings .../ryan-final.json] \
//        --confirmed runs/analysis-v3/ledger/confirmed-input.jsonl \
//        --logs data/sweep1 --manifest runs/analysis-v3/manifest.json \
//        --out runs/analysis-v3/ledger/confirmed-input-closure1.jsonl
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { validateCorrection, validateRecoveredClaim } from './correction-validation.mjs'
import { applyCorrection } from '../packages/seats/scripts/scoring-v3.mjs'
import { RULINGS, REVIEW_PACKET_VERSION } from './build-review-packet.mjs'
import { loadManifest } from './analysis-manifest.mjs'

const { values } = parseArgs({
  options: {
    key: { type: 'string' },
    rulings: { type: 'string' },
    'final-rulings': { type: 'string' },
    confirmed: { type: 'string' },
    /** The provisional ledger the packet was built from — its sha256 must
     *  match the packet key's pin (v3.2.2 binding; a tautology otherwise). */
    ledger: { type: 'string' },
    logs: { type: 'string', default: 'data/sweep1' },
    manifest: { type: 'string', default: 'runs/analysis-v3/manifest.json' },
    out: { type: 'string' },
  },
})
const fail = (m) => { console.error(`apply-review-rulings: ${m}`); process.exit(1) }
for (const f of ['key', 'rulings', 'confirmed', 'ledger', 'out']) if (!values[f]) fail(`--${f} is required`)

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const readJsonl = (p) => readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))

const keyBytes = readFileSync(values.key)
const keyLines = readJsonl(values.key)
const keyMeta = keyLines.find((r) => r._meta) ?? {}
const keyRows = keyLines.filter((r) => !r._meta)
if (keyMeta.version !== REVIEW_PACKET_VERSION) {
  fail(`packet key version ${keyMeta.version ?? 'none'} != ${REVIEW_PACKET_VERSION} — regenerate the packet before applying`)
}
const rulingsBytes = readFileSync(values.rulings)
const rulings = JSON.parse(rulingsBytes)
const finalBytes = values['final-rulings'] ? readFileSync(values['final-rulings']) : null
const finalRulings = finalBytes ? JSON.parse(finalBytes) : null
const keySha = sha256(keyBytes)
for (const [label, r] of [['rulings', rulings], ...(finalRulings ? [['final-rulings', finalRulings]] : [])]) {
  // v3.2.3: binding metadata is MANDATORY — absence is rejected exactly like
  // a mismatch, because absence was the bypass.
  for (const f of ['rater', 'analysisRunId', 'packetSeed', 'packetVersion', 'packetKeySha256']) {
    if (r?.[f] === undefined || r[f] === null || r[f] === '') fail(`${label}: missing required metadata field "${f}" (v3.2.3 §8 binding)`)
  }
  if (keyMeta.analysisRunId && r.analysisRunId !== keyMeta.analysisRunId) fail(`${label}: analysisRunId does not match the sealed key (§5)`)
  if (r.packetSeed !== keyMeta.seed) fail(`${label}: packetSeed does not match the sealed key`)
  if (r.packetVersion !== keyMeta.version) fail(`${label}: packetVersion does not match the sealed key`)
  if (r.packetKeySha256 !== keySha) fail(`${label}: packetKeySha256 does not match the packet key file on disk`)
}
const manifest = loadManifest(values.manifest)
if (keyMeta.analysisRunId && manifest.analysisRunId !== keyMeta.analysisRunId &&
    !(manifest.supersedes ?? []).includes(keyMeta.analysisRunId)) {
  fail(`manifest ${manifest.analysisRunId.slice(0, 12)}… neither matches nor supersedes the packet's ${String(keyMeta.analysisRunId).slice(0, 12)}… (§5)`)
}

// Binding: the ledger on disk must BE the provisional ledger the packet pins.
const ledgerBytes = readFileSync(values.ledger)
const ledgerSha = sha256(ledgerBytes)
// v3.2.3 surgical fix: lineage fails CLOSED — a missing hash is rejected
// exactly like a mismatch, because absence was the bypass.
if (typeof keyMeta.ledgerSha256 !== 'string' || keyMeta.ledgerSha256 === '') {
  fail(`packet key carries no ledgerSha256 — regenerate the packet with build-review-packet (${REVIEW_PACKET_VERSION}); an unpinned packet cannot be applied (v3.2.3)`)
}
if (ledgerSha !== keyMeta.ledgerSha256) {
  fail(`--ledger ${values.ledger} sha256 ${ledgerSha.slice(0, 12)}… does not match the packet key's provisional-ledger pin ${String(keyMeta.ledgerSha256).slice(0, 12)}… (v3.2.2)`)
}
const provisionalMeta = (() => {
  try { return JSON.parse(ledgerBytes.toString('utf8').split('\n').find((l) => l.trim())) } catch { return null }
})()
if (!provisionalMeta || provisionalMeta.mode !== 'ledger') fail(`--ledger ${values.ledger}: not a verdict-stamped ledger`)

const confirmedBytes = readFileSync(values.confirmed)
const confirmedLines = readJsonl(values.confirmed)
const confirmedMeta = confirmedLines.find((r) => r._meta)
if (!confirmedMeta || confirmedMeta.mode !== 'confirmed-input') fail(`${values.confirmed}: not a confirmed-input file`)
// v3.2.3 lineage: the confirmed-input being amended must be the EXACT file
// the provisional ledger was built from, and the chains must agree — a
// ruling applied to a sibling lineage would silently fork the closure.
if (typeof provisionalMeta.confirmedInputSha256 !== 'string' || provisionalMeta.confirmedInputSha256 === '') {
  fail(`provisional ledger records no confirmedInputSha256 — rebuild it with the current build-ledger; lineage never fails open (v3.2.3)`)
}
if (sha256(confirmedBytes) !== provisionalMeta.confirmedInputSha256) {
  fail(`--confirmed ${values.confirmed} is not the file the provisional ledger was built from (sha mismatch vs ledger meta.confirmedInputSha256) (v3.2.3)`)
}
if (JSON.stringify(provisionalMeta.closureChain ?? []) !== JSON.stringify(confirmedMeta.appliedPackets ?? [])) {
  fail(`closure chain mismatch between the provisional ledger and --confirmed — different lineages (v3.2.3)`)
}
const records = confirmedLines.filter((r) => !r._meta)

// Ruling/correction correspondence is exact in each human artifact. The
// first pass is complete; a reconciliation file is intentionally partial,
// but every item it does override follows the same rule: CORRECTED iff that
// same file carries the chosen corrected proposition. This prevents stale
// corrections from being silently ignored after an OK/BAD ruling.
const wantedItems = new Set(keyRows.map((k) => String(k.item)))
const validateRulingContract = (label, artifact, { complete }) => {
  const ratings = artifact?.positiveRatings ?? {}
  const ratedItems = Object.keys(ratings)
  const unknownRatings = ratedItems.filter((item) => !wantedItems.has(item))
  if (unknownRatings.length > 0) fail(`${label}: ruling(s) for unknown packet item(s) ${unknownRatings.slice(0, 5).join(', ')}`)
  if (complete) {
    const missing = [...wantedItems].filter((item) => !Object.prototype.hasOwnProperty.call(ratings, item))
    if (missing.length > 0) fail(`${label}: packet item(s) ${missing.slice(0, 5).join(', ')} have no ruling — a partial first pass cannot be applied`)
  }
  const correctionItems = Object.keys(artifact?.corrections ?? {})
  const strayCorrections = correctionItems.filter((item) => !Object.prototype.hasOwnProperty.call(ratings, item))
  if (strayCorrections.length > 0) {
    fail(`${label}: corrections for item(s) ${strayCorrections.slice(0, 5).join(', ')} have no ruling in the same artifact`)
  }
  for (const item of ratedItems) {
    const ruling = ratings[item]
    if (!RULINGS.includes(ruling)) fail(`${label}: packet item ${item} has invalid ruling ${JSON.stringify(ruling)}`)
    const hasCorrection = Object.prototype.hasOwnProperty.call(artifact?.corrections ?? {}, item)
    if (ruling === 'CORRECTED' && !hasCorrection) {
      fail(`${label}: packet item ${item} is CORRECTED but has no corrections entry`)
    }
    if (ruling !== 'CORRECTED' && hasCorrection) {
      fail(`${label}: packet item ${item} is ${ruling} but carries a corrections entry — corrections are allowed only for CORRECTED items`)
    }
  }
}
validateRulingContract('rulings', rulings, { complete: true })
if (finalRulings) validateRulingContract('final-rulings', finalRulings, { complete: false })

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

const effective = (item) => {
  const f = finalRulings?.positiveRatings?.[String(item)]
  const first = rulings.positiveRatings?.[String(item)]
  const ruling = f ?? first
  if (!RULINGS.includes(ruling)) fail(`packet item ${item}: missing or invalid ruling`)
  return ruling
}
const ruleFor = (item) => {
  const first = rulings.positiveRatings?.[String(item)]
  const final = finalRulings?.positiveRatings?.[String(item)]
  // A final ruling that CHANGES the outcome must cite its own rule — stamping
  // a reversal with the rule that justified the opposite ruling is an
  // internally inconsistent audit record (closure rerun finding 10).
  if (final !== undefined && final !== first) {
    const rule = finalRulings?.rules?.[String(item)]
    if (typeof rule !== 'string' || rule.trim() === '') {
      fail(`packet item ${item}: final ruling ${final} overrides ${first} but cites no codebook rule (v3.2.2 §8)`)
    }
    return rule
  }
  const rule = finalRulings?.rules?.[String(item)] ?? rulings.rules?.[String(item)]
  if (typeof rule !== 'string' || rule.trim() === '') fail(`packet item ${item}: every ruling must cite the exact codebook rule (v3.2 §3)`)
  return rule
}
const correctionsFor = (item) => {
  const key = String(item)
  return Object.prototype.hasOwnProperty.call(finalRulings?.positiveRatings ?? {}, key)
    ? finalRulings.corrections?.[key]
    : rulings.corrections?.[key]
}

const counts = { stamped: 0, withdrawn: 0, corrected: 0, recovered: 0, unmatched: 0 }
const out = records.map((r) => ({ ...r }))

const byItem = new Map(out.filter((r) => r.item !== undefined).map((r) => [String(r.item), r]))
for (const k of keyRows) {
  if (k.arm === 'message-scan') continue // handled below
  const ruling = effective(k.item)
  // Exact-identity matching (closure rerun findings 1-2): the key row names
  // the confirmed-input records it was scored from — every R17-merged
  // constituent, by item id. Kind corrections and merged-charStart drift
  // cannot misroute a ruling, and a merged proposition's ruling reaches ALL
  // of its records. A packet without constituentItems predates v3.2.2 and is
  // refused: regenerate it.
  if (!Array.isArray(k.constituentItems) || k.constituentItems.length === 0) {
    fail(`packet item ${k.item}: key row carries no constituentItems — pre-v3.2.2 packet; regenerate with build-review-packet (${REVIEW_PACKET_VERSION})`)
  }
  const targets = k.constituentItems.map((id) => byItem.get(String(id)))
  const missing = k.constituentItems.filter((id, i) => !targets[i])
  if (missing.length > 0) {
    fail(`packet item ${k.item} (${k.claimKey}): constituent record(s) ${missing.join(', ')} not in this confirmed-input — the packet does not belong to this lineage (v3.2.2 binding)`)
  }
  for (const r of targets) {
    r.reviewRuling = {
      ruling, rule: ruleFor(k.item), item: k.item,
      // The verdict the rater actually adjudicated: gate S10 accepts a false
      // row only when its stamp was made ABOUT a false row — a stamp from a
      // true-sample or scan sitting never closes a NEW false row
      // (closure rerun finding 3).
      verdictAtRuling: k.verdict ?? null,
      packetSeed: keyMeta.seed ?? null, via: 'review-packet',
      ...(finalRulings?.positiveRatings?.[String(k.item)] !== undefined &&
          finalRulings.positiveRatings[String(k.item)] !== rulings.positiveRatings?.[String(k.item)]
        ? { firstPass: rulings.positiveRatings?.[String(k.item)] } : {}),
    }
    counts.stamped += 1
    if (ruling === 'BAD') {
      // Withdrawn, never deleted: the row stays in confirmed-input with its
      // confirmation set false and the ruling attached, so nothing vanishes
      // without a number (build-ledger counts it unconfirmed).
      r.human = { ...(r.human ?? {}), confirmed: false, withdrawnBy: 'review-packet', ruling: 'BAD' }
      counts.withdrawn += 1
    } else if (ruling === 'CORRECTED') {
      // v3.2.3: repeated corrections COMPOSE — the new ruling is validated
      // against the EFFECTIVE prior proposition (any earlier correction
      // applied), and its fields merge over the earlier corrected fields
      // instead of silently replacing them. `replaced` therefore records the
      // effective-prior values, and priorRules preserves the audit trail.
      const effectivePrior = applyCorrection(r)
      let corrected
      try {
        corrected = validateCorrection({
          where: `packet item ${k.item}`, raw: correctionsFor(k.item), record: effectivePrior,
          rule: ruleFor(k.item), note: finalRulings?.notes?.[String(k.item)] ?? rulings.notes?.[String(k.item)],
          getMessage: (seed, seq) => messagesOf(seed).get(seq),
        })
      } catch (e) { fail(String(e.message ?? e)) }
      if (r.corrected) {
        const prior = r.corrected
        const composed = { ...corrected }
        for (const f of Object.keys(prior)) {
          if (['rule', 'note', 'replaced', 'priorRules', 'charStart'].includes(f)) continue
          if (!(f in composed)) composed[f] = prior[f]
        }
        if ('quote' in prior && !('quote' in corrected) && typeof prior.charStart === 'number') composed.charStart = prior.charStart
        composed.priorRules = [...(prior.priorRules ?? []), prior.rule].filter(Boolean)
        r.corrected = composed
      } else {
        r.corrected = corrected
      }
      counts.corrected += 1
    }
  }
}

// Message-scan misses -> recovered records, validated like §6.2 recovery.
for (const k of keyRows.filter((k) => k.arm === 'message-scan')) {
  const misses = (finalRulings?.missedClaims?.[String(k.item)] ?? rulings.missedClaims?.[String(k.item)]) ?? []
  const validatedCache = new Map()
  const validatedFieldsFor = (c, text) => {
    const ck = JSON.stringify([c, text])
    if (!validatedCache.has(ck)) {
      try { validatedCache.set(ck, validateRecoveredClaim({ where: `packet item ${k.item}`, claim: c, text })) }
      catch (e) { fail(String(e.message ?? e)) }
    }
    return validatedCache.get(ck).fields
  }
  for (const c of misses) {
    const text = messagesOf(k.seed).get(k.seq)?.text
    if (typeof c.quote !== 'string' || c.quote.trim() === '') fail(`packet item ${k.item}: recovered claim has no span — an empty quote is not a receipt (R19)`)
    const at = typeof text === 'string' ? text.indexOf(c.quote) : -1
    if (at < 0) fail(`packet item ${k.item}: recovered span is not a byte-exact substring of ${k.seed} seq ${k.seq}`)
    // v3.2.3 duplicate guard: a blind rater can legitimately list a claim the
    // ledger already carries (the scan arm excludes packet messages, but not
    // every ledgered message). Skip it, counted — never a second record of
    // one proposition, and never a hard fail that punishes a correct rater.
    // Surgical fix: seed+seq+kind was too broad — one message can carry two
    // DISTINCT same-kind claims, and the second was being discarded. A
    // duplicate is the COMPLETE validated fingerprint plus the exact span.
    const fpNorm = (f, v) => (f === 'target' ? String(v).trim().toLowerCase() : v)
    const fpOf = (kind, fields, quote) => JSON.stringify({
      kind,
      ...Object.fromEntries(['role', 'target', 'result', 'claimedNight', 'referencedDay']
        .map((f) => [f, fields[f] === undefined || fields[f] === null ? null : fpNorm(f, fields[f])])),
      quote: quote ?? null,
    })
    const candidateFp = fpOf(c.kind, validatedFieldsFor(c, text), c.quote)
    const dup = out.find((r) => r.seed === k.seed && r.seq === k.seq && r.kind === c.kind &&
      r.human?.confirmed !== false && fpOf(r.kind, r, r.quote) === candidateFp)
    if (dup) {
      console.error(`note: packet item ${k.item}: recovered ${c.kind} at ${k.seed} seq ${k.seq} duplicates existing record ${dup.item} — skipped (v3.2.3)`)
      counts.duplicateRecovered = (counts.duplicateRecovered ?? 0) + 1
      continue
    }
    // One validation per candidate — the fingerprint above already ran it.
    const validated = validatedCache.get(JSON.stringify([c, text]))
    if (!validated.publishable) continue
    if (validated.struckNight !== null) {
      console.error(`note: packet item ${k.item}: claimedNight ${validated.struckNight} is not literally stated in ${k.seed} seq ${k.seq} — struck (v3.2 §2)`)
    }
    const actor = messagesOf(k.seed).get(k.seq)?.actor
    out.push({
      item: `review-scan-${k.item}-${out.length}`, seed: k.seed, seq: k.seq, seat: actor, day: k.day ?? null,
      kind: c.kind, ...validated.fields,
      // §2: a struck recovery night is countable, never invisible.
      ...(validated.struckNight !== null ? { claimedNightStruck: validated.struckNight } : {}),
      quote: c.quote, charStart: at, machineDecision: 'missed-recovered',
      analysisRunId: manifest.analysisRunId,
      sources: ['review-packet-scan'],
      machine: { asserted: true, kind: c.kind, fields: { ...validated.fields } },
      human: { rater: rulings.rater, confirmed: true, ruling: effective(k.item), rule: ruleFor(k.item), via: 'review-packet-scan' },
      // verdictAtRuling null: the rater saw a MESSAGE, not a false row — if
      // this recovery scores false on rebuild, S10 holds the loop open.
      reviewRuling: { ruling: effective(k.item), rule: ruleFor(k.item), item: k.item, verdictAtRuling: null, packetSeed: keyMeta.seed ?? null, via: 'review-packet' },
    })
    counts.recovered += 1
  }
}

// The closure chain: every apply is appended, carrying the exact hashes of
// what was applied to what. build-ledger copies this into the ledger meta,
// and build-publication verifies the chain — hashes, never counts.
const chain = [...(confirmedMeta.appliedPackets ?? []), {
  packetKeySha256: sha256(keyBytes),
  rulingsSha256: sha256(rulingsBytes),
  ...(finalBytes ? { finalRulingsSha256: sha256(finalBytes) } : {}),
  provisionalLedgerSha256: keyMeta.ledgerSha256 ?? null,
  confirmedInputSha256: sha256(readFileSync(values.confirmed)),
  packetSeed: keyMeta.seed ?? null,
}]

const outMeta = {
  ...confirmedMeta,
  analysisRunId: manifest.analysisRunId,
  appliedPackets: chain,
  reviewApplied: { ...(confirmedMeta.reviewApplied ?? {}), [keyMeta.seed ?? `packet-${chain.length}`]: counts },
}
mkdirSync(dirname(resolve(values.out)), { recursive: true })
const tmp = `${values.out}.tmp-${process.pid}`
writeFileSync(tmp, [outMeta, ...out].map((r) => JSON.stringify(r)).join('\n') + '\n')
renameSync(tmp, values.out)
console.log(
  `wrote ${values.out}: ${out.length} records — ${counts.stamped} stamped, ${counts.withdrawn} withdrawn (BAD), ` +
  `${counts.corrected} CORRECTED, ${counts.recovered} recovered from message-scan; closure chain length ${chain.length}`,
)
