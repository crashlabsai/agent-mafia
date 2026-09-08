// The single-author validation packet — analysis v3.2 §8.
//
// Builds ONE blinded, shuffled review packet carrying all three arms of the
// frozen single-author validation protocol, and merges the rulings back when
// the sitting is done. Deterministic given a seed: the same ledger, logs and
// seed produce byte-identical outputs, so the packet is reproducible evidence
// rather than a one-off artifact.
//
//   arm 1  census      every v3.2 false-labeled claim
//   arm 2  true-sample ~100 true-labeled claims, stratified BY FAMILY ONLY —
//                      proportional with a per-family minimum, no
//                      over-stratification
//   arm 3  messages    ~200 random PUBLIC MESSAGES (not machine candidates),
//                      inspected for missed claims
//
// Blinding (§8, and §2 of the frozen spec): an item shows the message, its
// context window, and the extracted fields. NEVER the verdict, the arm, the
// speaker's role, the model, or the game outcome. Everything that could
// identify an item's arm lives in the sealed key, which the rater does not
// open. Rulings are OK / BAD / CORRECTED (§3), and every ruling cites the
// exact codebook rule.
//
//   node scripts/build-review-packet.mjs \
//        --ledger runs/analysis-v3/ledger/confirmed.jsonl \
//        --logs runs/sweep-download/sweep1 --seed review-1 \
//        [--true-n 100] [--messages-n 200] [--min-per-family 10] [--context 2] \
//        [--out runs/analysis-v3/handcheck/review-packet]
//
//   node scripts/build-review-packet.mjs --unblind \
//        --key runs/analysis-v3/handcheck/review-packet/review-packet-key.jsonl \
//        --rulings runs/analysis-v3/handcheck/review-packet/ryan-rulings.json \
//        [--out runs/analysis-v3/handcheck/review-packet]
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadManifest, sha256File } from './analysis-manifest.mjs'

export const REVIEW_PACKET_VERSION = 'v3.2.4'

const PUBLISHED_FAMILIES = ['investigation_claim', 'not_mafia_claim', 'protection_claim', 'role_claim']
// §8: oversample protection and not_mafia — the two families the v3.1 audit
// found the machine weakest on (protection 82.0%, not-mafia 78.9% acceptance).
const OVERSAMPLED = new Set(['protection_claim', 'not_mafia_claim'])
export const RULINGS = ['OK', 'BAD', 'CORRECTED']
// One definition of the §8 thresholds and the Wilson interval, re-exported for
// existing importers (closure rerun finding: three drifting copies).
export { PER_FAMILY_RATE_FLOOR, RETAINED_PRECISION_FLOOR, wilson, derivePublishability } from './publication-omission.mjs'
import { PER_FAMILY_RATE_FLOOR, RETAINED_PRECISION_FLOOR, wilson, derivePublishability } from './publication-omission.mjs'

// ---------------------------------------------------------------------------
// Deterministic selection — pure, exported for the regression suite
// ---------------------------------------------------------------------------

const digest = (seed, s) => createHash('sha256').update(seed).update('\x00').update(s).digest('hex')

/**
 * A seeded total order: stable, reproducible, and independent of input order.
 * The hash covers seed + item key ONLY — folding the array index in (the
 * v3.2.0 version) made the order depend on where each item sat in the input,
 * so the same ledger CONTENT in a different row order produced a different
 * packet and sealed key under the same seed (review finding 13). Equal hashes
 * (duplicate keys) tiebreak on the key string itself.
 */
export function seededOrder(seed, items, keyOf) {
  return [...items]
    .map((it) => ({ it, k: String(keyOf(it)), h: digest(seed, String(keyOf(it))) }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .map((x) => x.it)
}

// Exported (v3.2.4): build-publication recomputes the provisional ledger's
// false-row keys with THIS function to verify the initial census is complete
// — one key definition, or the completeness check compares apples to oranges.
export const claimKey = (c) => {
  const items = (c.mergedItems ?? (c.item !== undefined ? [c.item] : [])).slice().sort()
  // Constituent item ids disambiguate two merged same-kind propositions that
  // ended on the same min-charStart (v3.2.3: packet-key collisions).
  return `${c.seed}|${c.seq}|${c.kind}|${c.charStart ?? 0}|${items.join('+')}`
}

/** A valid false-row adjudication: made ABOUT a false row, with a ruling and
 *  a codebook rule (v3.2.2 §8 / S10's acceptance test). */
export const hasFalseRowAdjudication = (c) =>
  c.reviewRuling && c.reviewRuling.verdictAtRuling === 'false' &&
  RULINGS.includes(c.reviewRuling.ruling) &&
  typeof c.reviewRuling.rule === 'string' && c.reviewRuling.rule.trim() !== ''

/** Arm 1 (§8): a CENSUS — every false-labeled claim WITHOUT a valid false-row
 *  adjudication. The first packet takes them all; later closure packets take
 *  only the rows S10 still holds the loop open for — re-sitting rows already
 *  ruled would double-stamp and waste the rater (v3.2.3). */
export function selectCensus(ledger) {
  return ledger.filter((c) => !c._meta && c.verdict === 'false' && !hasFalseRowAdjudication(c))
}

/**
 * Arm 2 (§8): ~n true-labeled claims stratified BY FAMILY ONLY — proportional
 * with a per-family minimum, oversampling protection and not_mafia. No
 * over-stratification: family is the only stratum, deliberately.
 */
export function selectTrueSample(ledger, { n = 100, minPerFamily = PER_FAMILY_RATE_FLOOR, seed = 'review-1' } = {}) {
  const byFamily = new Map(PUBLISHED_FAMILIES.map((f) => [f, []]))
  for (const c of ledger) {
    if (c._meta || c.verdict !== 'true' || !byFamily.has(c.kind)) continue
    byFamily.get(c.kind).push(c)
  }
  const total = [...byFamily.values()].reduce((a, v) => a + v.length, 0)
  if (total === 0) return []
  const quota = new Map()
  for (const [family, rows] of byFamily) {
    const proportional = Math.round((rows.length / total) * n)
    const floor = Math.min(rows.length, minPerFamily * (OVERSAMPLED.has(family) ? 2 : 1))
    quota.set(family, Math.min(rows.length, Math.max(proportional, floor)))
  }
  const picked = []
  for (const family of PUBLISHED_FAMILIES) {
    picked.push(...seededOrder(`${seed}|${family}`, byFamily.get(family), claimKey).slice(0, quota.get(family)))
  }
  return picked
}

/**
 * Arm 3 (§8): ~n random PUBLIC MESSAGES — messages, not machine candidates.
 * `messages` is [{ seed, seq, day, actor, text }].
 */
export function selectRandomMessages(messages, { n = 200, seed = 'review-1', excludeSeqs = null } = {}) {
  // A message already on the sheet as a claim item never enters the scan arm:
  // the rater would see it twice, and a scan "miss" there could duplicate a
  // ledger claim (v3.2.3: duplicate-message overlap).
  const pool = excludeSeqs ? messages.filter((m) => !excludeSeqs.has(`${m.seed}|${m.seq}`)) : messages
  return seededOrder(`${seed}|messages`, pool, (m) => `${m.seed}|${m.seq}`).slice(0, n)
}

/**
 * One blinded packet from the three arms: shuffled together, renumbered, with
 * every arm marker moved into the sealed key. Returns { items, key }.
 */
export function buildPacket({ census = [], trueSample = [], messages = [], seed = 'review-1' } = {}) {
  const tagged = [
    ...census.map((c) => ({ arm: 'census', claim: c })),
    ...trueSample.map((c) => ({ arm: 'true-sample', claim: c })),
    ...messages.map((m) => ({ arm: 'message-scan', message: m })),
  ]
  const shuffled = seededOrder(seed, tagged, (t) =>
    t.claim ? `claim|${claimKey(t.claim)}` : `msg|${t.message.seed}|${t.message.seq}`)
  const items = []
  const key = []
  shuffled.forEach((t, i) => {
    const item = i + 1
    const src = t.claim ?? t.message
    items.push({
      item,
      seed: src.seed,
      seq: src.seq,
      day: src.day ?? null,
      // A message-scan item shows no kind and no fields: the rater is looking
      // for claims, not confirming one.
      kind: t.claim ? t.claim.kind : null,
      fields: t.claim ? extractedFields(t.claim) : null,
      quote: t.claim ? (t.claim.quote ?? null) : null,
      // Effective context: a CORRECTED row's operative resolvingContext was
      // promoted to the record top level by applyCorrection — the machine's
      // superseded one must never be what the rater re-adjudicates (review
      // finding: packet showed pre-correction context on corrected rows).
      resolvingContext: t.claim?.resolvingContext ?? t.claim?.machine?.resolvingContext ?? null,
      // v3.2.2: NO machine advisory on the sheet — showing the machine's
      // doubt before the author's initial ruling anchors the ruling. The
      // advisory lives in the sealed key and surfaces in the cross-check
      // reconciliation, AFTER the first-pass ruling is recorded.
    })
    key.push({
      item, arm: t.arm, seed: src.seed, seq: src.seq, day: src.day ?? null,
      kind: t.claim?.kind ?? null,
      charStart: t.claim?.charStart ?? null,
      claimKey: t.claim ? claimKey(t.claim) : null,
      // Exact constituent identities (closure rerun findings 1-2): the
      // confirmed-input records this ledger row was scored from, by item id —
      // what apply-review-rulings targets, immune to kind corrections and
      // merged-charStart drift.
      constituentItems: t.claim
        ? (t.claim.mergedItems ?? (t.claim.item !== undefined ? [t.claim.item] : null))
        : null,
      verdict: t.claim?.verdict ?? null,
      falseClass: t.claim?.falseClass ?? null,
      advisory: t.claim?.advisory ?? null,
      analysisRunId: src.analysisRunId ?? null,
    })
  })
  return { items, key }
}

const FIELD_ORDER = ['role', 'target', 'result', 'claimedNight', 'referencedDay', 'conditional']
const extractedFields = (c) =>
  Object.fromEntries(FIELD_ORDER.filter((f) => c[f] !== undefined && c[f] !== null).map((f) => [f, c[f]]))

// ---------------------------------------------------------------------------
// Unblinding / merge — §8's published quantities
// ---------------------------------------------------------------------------

const rate = (k, n) => (n > 0 ? k / n : null)

/**
 * Merge rulings against the sealed key and compute §8's published quantities:
 * the author-census overturn rate per family, the true-sample confirmation
 * rate, the missed-claim estimate with a Wilson interval, and the per-family
 * Tier L publication gate. Pure — `rulings` is the rater's JSON.
 *
 * A family below PER_FAMILY_RATE_FLOOR positives publishes counts only: its
 * rate fields are null and `rateSuppressed` says why.
 */
export function mergeRulings(key, rulings, opts = {}) {
  const keyMeta = key.find((k) => k._meta)
  if (!keyMeta) throw new Error('review packet key carries no meta line — not a v3.2.3 packet')
  if (keyMeta.version !== REVIEW_PACKET_VERSION) {
    throw new Error(`review packet key version ${keyMeta.version ?? 'none'} does not match this tool (${REVIEW_PACKET_VERSION}) — regenerate the packet`)
  }
  // v3.2.3 binding: run id, packet seed, packet version, and the packet-key
  // hash are MANDATORY in every ratings file — missing metadata is rejected
  // exactly like mismatched metadata, because "absent" was the bypass.
  const bindRatings = (label, r) => {
    for (const f of ['rater', 'analysisRunId', 'packetSeed', 'packetVersion', 'packetKeySha256']) {
      if (r?.[f] === undefined || r[f] === null || r[f] === '') {
        throw new Error(`${label}: missing required metadata field "${f}" (v3.2.3 §8 binding)`)
      }
    }
    if (keyMeta.analysisRunId && r.analysisRunId !== keyMeta.analysisRunId) {
      throw new Error(`${label}: analysisRunId ${r.analysisRunId} does not match the sealed key's ${keyMeta.analysisRunId}`)
    }
    if (r.packetSeed !== keyMeta.seed) {
      throw new Error(`${label}: packetSeed ${r.packetSeed} does not match the sealed key's ${keyMeta.seed}`)
    }
    if (r.packetVersion !== keyMeta.version) {
      throw new Error(`${label}: packetVersion ${r.packetVersion} does not match the sealed key's ${keyMeta.version}`)
    }
    if (opts.keySha256 && r.packetKeySha256 !== opts.keySha256) {
      throw new Error(`${label}: packetKeySha256 does not match the packet key file on disk`)
    }
  }
  bindRatings('review packet rulings', rulings)
  if (opts.modelRulings) {
    bindRatings('model cross-check ratings', opts.modelRulings)
    // The model artifact identifies HOW it was produced, or it is not
    // reviewable evidence (v3.2.3: model, prompt hash, settings).
    const m = opts.modelRulings.method
    if (!m || typeof m.model !== 'string' || typeof m.promptSha256 !== 'string') {
      throw new Error('model cross-check ratings: missing method {model, promptSha256[, settings]} (v3.2.3 §8)')
    }
    // v3.2.4: the model cross-check ARTIFACT is hash-bound into the summary,
    // so the publication can pin the exact ratings file the disagreements and
    // resolutions were computed from — same rule the human rulings live under.
    if (typeof opts.modelRulingsSha256 !== 'string' || opts.modelRulingsSha256 === '') {
      throw new Error('model cross-check ratings supplied without modelRulingsSha256 — the artifact must be hash-bound (v3.2.4 §8)')
    }
  }
  // v3.2.4: the message-scan arm binds by identity. The sealed key records the
  // complete sampling frame (cohort, games, log hashes, seed, selected ids);
  // the scan rows must be EXACTLY that selection, and the provisional ledger's
  // claims are mandatory input — a rater-listed claim the ledger already
  // carries must never count as a miss (it is the opposite of one).
  const scanRows = key.filter((k) => !k._meta && k.arm === 'message-scan')
  if (scanRows.length > 0) {
    const frame = keyMeta.samplingFrame
    if (!frame || !Array.isArray(frame.selectedMessages)) {
      throw new Error('review packet key carries message-scan rows but no samplingFrame — regenerate the packet; the scan frame binds by identity (v3.2.4 §8)')
    }
    const sel = new Set(frame.selectedMessages)
    if (sel.size !== scanRows.length) {
      throw new Error(`samplingFrame selects ${sel.size} message(s) but the key carries ${scanRows.length} scan row(s) — truncated or padded scan arm (v3.2.4)`)
    }
    for (const k of scanRows) {
      if (!sel.has(`${k.seed}|${k.seq}`)) {
        throw new Error(`scan item ${k.item} (${k.seed}|${k.seq}) is not in the sealed samplingFrame — substituted scan arm (v3.2.4)`)
      }
    }
    if (!Array.isArray(opts.ledgerClaims)) {
      throw new Error('message-scan rows present but no ledgerClaims passed — the already-extracted comparison is mandatory (v3.2.4 §8)')
    }
  }
  const ledgerByMsg = new Map()
  for (const c of opts.ledgerClaims ?? []) {
    if (c._meta) continue
    const at = `${c.seed}|${c.seq}`
    if (!ledgerByMsg.has(at)) ledgerByMsg.set(at, [])
    ledgerByMsg.get(at).push(c)
  }
  const normName = (s) => String(s ?? '').trim().toLowerCase()
  /** Split a scan row's listed claims into genuine misses vs claims the
   *  provisional ledger already extracted on that message: same kind, and
   *  compatible targets (either side target-less counts as compatible — the
   *  ledger DID extract a claim of that kind there, so listing it is recall
   *  working, not failing). */
  const splitMisses = (k, listed) => {
    const already = []
    const misses = []
    for (const c of listed ?? []) {
      const sameKind = (ledgerByMsg.get(`${k.seed}|${k.seq}`) ?? []).filter((lc) => lc.kind === c.kind)
      const extracted = sameKind.some((lc) => c.target == null || lc.target == null || normName(lc.target) === normName(c.target))
      ;(extracted ? already : misses).push(c)
    }
    return { already, misses }
  }
  const ruled = rulings.positiveRatings ?? {}
  const modelRuled = opts.modelRulings?.positiveRatings ?? null
  const finalRuled = opts.finalRulings?.positiveRatings ?? null
  // Normalized decision comparison (v3.2.3): a "same ruling, different
  // corrected proposition" or "same ruling, different missed-claim set" is a
  // disagreement too — ruling strings alone under-compare.
  const normNight = (v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v)
  // The COMPLETE proposition, every comparable field (v3.2.3 surgical fix:
  // role, referencedDay and resolvingContext were missing, so a missed
  // role_claim of "doctor" vs "mafia" compared as agreement).
  const normContext = (rc) => (rc && typeof rc === 'object' ? { seq: rc.seq ?? null, text: rc.text ?? null } : rc ?? null)
  const normCorrection = (raw) => {
    if (!raw || typeof raw !== 'object') return 'none'
    const out = {}
    for (const f of ['kind', 'role', 'target', 'result', 'claimedNight', 'referencedDay', 'quote', 'resolvingContext'].sort()) {
      if (!(f in raw)) continue
      let v = raw[f] === '-' || raw[f] === '' ? null : raw[f]
      if (f === 'claimedNight' || f === 'referencedDay') v = normNight(v)
      if (f === 'resolvingContext') v = normContext(v)
      out[f] = v
    }
    return JSON.stringify(out)
  }
  const normMisses = (arr) => JSON.stringify((arr ?? []).map((c) => ({
    kind: c.kind ?? null, role: c.role ?? null, target: c.target ?? null, result: c.result ?? null,
    claimedNight: normNight(c.claimedNight) ?? null, referencedDay: normNight(c.referencedDay) ?? null,
    quote: c.quote ?? null, resolvingContext: normContext(c.resolvingContext),
  })).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))
  const rows = []
  const disagreements = []
  const advisoryFlagged = []
  for (const k of key) {
    if (k._meta) continue
    const firstPass = ruled[String(k.item)]
    if (!RULINGS.includes(firstPass)) {
      throw new Error(`review packet item ${k.item}: missing or invalid ruling (expected ${RULINGS.join('/')})`)
    }
    const rule = rulings.rules?.[String(k.item)]
    if (typeof rule !== 'string' || rule.trim() === '') {
      throw new Error(`review packet item ${k.item}: every ruling must cite the exact codebook rule (v3.2 §3)`)
    }
    // §8 cross-check: the model rates the same packet COMPLETELY — a claim
    // item without a valid model ruling, or a scan item without a
    // missedClaims entry (empty array allowed), refuses the merge (v3.2.3).
    let model = null
    if (modelRuled) {
      if (k.arm === 'message-scan') {
        const mm = opts.modelRulings.missedClaims?.[String(k.item)]
        if (!Array.isArray(mm)) throw new Error(`model cross-check: scan item ${k.item} has no missedClaims array (empty [] means none) (v3.2.3)`)
        if (normMisses(mm) !== normMisses(rulings.missedClaims?.[String(k.item)])) {
          disagreements.push({ item: k.item, about: 'missed-claims', author: normMisses(rulings.missedClaims?.[String(k.item)]), model: normMisses(mm) })
        }
        model = modelRuled[String(k.item)] ?? 'OK'
      } else {
        model = modelRuled[String(k.item)]
        if (!RULINGS.includes(model)) throw new Error(`model cross-check: item ${k.item} has no valid ruling (v3.2.3: complete ratings required)`)
        if (model !== firstPass) {
          disagreements.push({ item: k.item, about: 'ruling', author: firstPass, model })
        } else if (firstPass === 'CORRECTED' &&
                   normCorrection(rulings.corrections?.[String(k.item)]) !== normCorrection(opts.modelRulings.corrections?.[String(k.item)])) {
          disagreements.push({ item: k.item, about: 'corrected-fields', author: normCorrection(rulings.corrections?.[String(k.item)]), model: normCorrection(opts.modelRulings.corrections?.[String(k.item)]) })
        }
      }
    }
    if (k.advisory && firstPass === 'OK') advisoryFlagged.push({ item: k.item, advisory: k.advisory })
    const finalRuling = finalRuled?.[String(k.item)] ?? null
    if (finalRuling !== null && !RULINGS.includes(finalRuling)) {
      throw new Error(`review packet item ${k.item}: invalid final ruling ${JSON.stringify(finalRuling)}`)
    }
    if (finalRuling !== null && finalRuling !== firstPass) {
      const finalRule = opts.finalRulings?.rules?.[String(k.item)]
      if (typeof finalRule !== 'string' || finalRule.trim() === '') {
        throw new Error(`review packet item ${k.item}: final ruling ${finalRuling} overrides ${firstPass} but cites no codebook rule (v3.2.2 §8)`)
      }
    }
    // v3.2.3 (reversing the v3.2.2 position, with reason): the MACHINE-error
    // metrics use the author's FINAL adjudication of each frozen provisional
    // row — the best available truth estimate for that row. The first-pass
    // ruling is preserved as its own metric (the unaided author), below.
    const ruling = finalRuling ?? firstPass
    rows.push({
      ...k, ruling, firstPass, rule,
      note: rulings.notes?.[String(k.item)] ?? '',
      ...(model !== null ? { modelRuling: model } : {}),
      ...(finalRuling !== null && finalRuling !== firstPass ? { finalRuling } : {}),
      ...(ruling === 'CORRECTED' ? { corrected: (finalRuling === 'CORRECTED' ? opts.finalRulings?.corrections?.[String(k.item)] : null) ?? rulings.corrections?.[String(k.item)] ?? {} } : {}),
      ...(k.arm === 'message-scan' ? (() => {
        const listed = (finalRuled ? opts.finalRulings?.missedClaims?.[String(k.item)] : null) ?? rulings.missedClaims?.[String(k.item)] ?? []
        // v3.2.4: the enumerated reference set stays intact (missedClaims);
        // the statistic is computed from newMisses only.
        const { already, misses } = splitMisses(k, listed)
        return { missedClaims: listed, newMisses: misses, alreadyExtracted: already }
      })() : {}),
    })
  }
  // Reconciliation is mandatory once a cross-check ran: every disagreement and
  // every advisory-flagged OK must carry an explicit final ruling (which may
  // simply restate the first-pass one) — silence is not a resolution.
  if (opts.modelRulings) {
    const needsFinal = new Set([...disagreements.map((d) => d.item), ...advisoryFlagged.map((a) => a.item)])
    const missingFinal = [...needsFinal].filter((item) => finalRuled?.[String(item)] === undefined)
    if (missingFinal.length > 0) {
      throw new Error(`cross-check reconciliation incomplete: item(s) ${missingFinal.slice(0, 5).join(', ')} flagged but carry no final ruling (v3.2.2 §8)`)
    }
    // v3.2.3 surgical fix: resolving a CONTENT disagreement takes content. A
    // bare OK/BAD/CORRECTED label does not say WHICH corrected fields or
    // WHICH missed-claim list was chosen — the reconciliation file must
    // carry them.
    for (const d of disagreements) {
      if (d.about === 'corrected-fields' && finalRuled?.[String(d.item)] === 'CORRECTED' &&
          !opts.finalRulings?.corrections?.[String(d.item)]) {
        throw new Error(`cross-check reconciliation: item ${d.item} resolves a corrected-fields disagreement but the final file carries no corrections entry — the chosen fields must be stated (v3.2.3 §8)`)
      }
      if (d.about === 'missed-claims' && !Array.isArray(opts.finalRulings?.missedClaims?.[String(d.item)])) {
        throw new Error(`cross-check reconciliation: item ${d.item} resolves a missed-claims disagreement but the final file carries no missedClaims list — the chosen list must be stated, [] for none (v3.2.3 §8)`)
      }
    }
  }
  // Arm 1: a false label is OVERTURNED when the author rules it BAD or
  // CORRECTED — the claim as published was not what the ledger said it was.
  const censusByFamily = {}
  for (const family of PUBLISHED_FAMILIES) {
    const arm = rows.filter((r) => r.arm === 'census' && r.kind === family)
    const overturned = arm.filter((r) => r.ruling !== 'OK').length
    const retained = arm.length - overturned
    const [lo] = wilson(retained, arm.length)
    const thin = arm.length < PER_FAMILY_RATE_FLOOR
    censusByFamily[family] = {
      n: arm.length,
      upheld: retained,
      overturned,
      overturnRate: thin ? null : rate(overturned, arm.length),
      retainedPrecisionLowerBound: thin ? null : lo,
      rateSuppressed: thin ? `fewer than ${PER_FAMILY_RATE_FLOOR} positives — counts only (v3.2 §8)` : null,
      // §8 publication gate: Tier L results for this family appear only if the
      // retained-precision lower bound clears the floor. Unmet means OMIT the
      // family's Tier L results, not disclose-and-publish.
      tierLPublishable: !thin && lo !== null && lo >= RETAINED_PRECISION_FLOOR,
    }
  }

  const trueArm = rows.filter((r) => r.arm === 'true-sample')
  const trueConfirmed = trueArm.filter((r) => r.ruling === 'OK').length
  const scan = rows.filter((r) => r.arm === 'message-scan')
  // v3.2.4: only NEW misses (not already in the provisional ledger) drive the
  // statistic — an already-extracted claim is recall succeeding, not failing.
  const withMiss = scan.filter((r) => (r.newMisses ?? []).some((c) => PUBLISHED_FAMILIES.includes(c.kind))).length
  const publishedOf = (arr) => (arr ?? []).filter((c) => PUBLISHED_FAMILIES.includes(c.kind))
  const claimLevel = {
    listed: scan.reduce((a, r) => a + publishedOf(r.missedClaims).length, 0),
    alreadyExtracted: scan.reduce((a, r) => a + publishedOf(r.alreadyExtracted).length, 0),
    newMisses: scan.reduce((a, r) => a + publishedOf(r.newMisses).length, 0),
    label: 'claim-level counts only — claim-level recall is NOT claimed (v3.2 §8 floor)',
  }

  return {
    generator: 'scripts/build-review-packet.mjs',
    version: REVIEW_PACKET_VERSION,
    analysisRunId: keyMeta.analysisRunId ?? rows.find((r) => r.analysisRunId)?.analysisRunId ?? null,
    // v3.2.2 binding chain: the packet pins the exact provisional ledger it
    // was built from; the publication verifies these hashes, never counts.
    ledgerSha256: keyMeta.ledgerSha256 ?? null,
    packetSeed: keyMeta.seed ?? null,
    packetKeySha256: opts.keySha256 ?? null,
    // The exact rulings this summary was computed from — build-publication
    // verifies these against the closure chain, so a summary from one rulings
    // file can never publish beside a ledger built from another (closure
    // rerun finding 5).
    rulingsSha256: opts.rulingsSha256 ?? null,
    finalRulingsSha256: opts.finalRulingsSha256 ?? null,
    // v3.2.4: the model cross-check artifact is hash-bound like the human
    // rulings — the publication pins all three.
    modelRulingsSha256: opts.modelRulingsSha256 ?? null,
    crossCheck: opts.modelRulings ? {
      rater: opts.modelRulings.rater ?? null,
      // The model artifact's identity: reviewable evidence names its method.
      method: opts.modelRulings.method ?? null,
      disagreements,
      advisoryFlagged,
      resolutions: disagreements.map((d) => ({
        item: d.item, about: d.about,
        finalRuling: finalRuled?.[String(d.item)] ?? null,
      })),
      finalOverrides: rows.filter((r) => r.finalRuling).length,
    } : null,
    // The unaided-author metric (v3.2.3): first-pass rulings on the same
    // frozen rows, before the model cross-check and reconciliation — kept
    // BESIDE the final-based machine-error metrics, never conflated.
    unaidedFirstPass: {
      censusOverturnsByFamily: Object.fromEntries(PUBLISHED_FAMILIES.map((f) => [f,
        rows.filter((r) => r.arm === 'census' && r.kind === f && r.firstPass !== 'OK').length])),
      changedByReconciliation: rows.filter((r) => r.finalRuling).length,
    },
    protocol: 'single-author validation protocol (v3.2 §8)',
    // §8's binding labels: never "independent human gold standard".
    label: 'author-adjudicated reference sample, not an independent human gold standard',
    rater: rulings.rater ?? null,
    items: rows.length,
    census: {
      n: rows.filter((r) => r.arm === 'census').length,
      // Exact identity binding, not counts (v3.2.2): the claim keys of every
      // census row, sorted — set-comparable against the provisional ledger.
      claimKeys: rows.filter((r) => r.arm === 'census').map((r) => r.claimKey).sort(),
      byFamily: censusByFamily,
    },
    trueSample: {
      n: trueArm.length,
      confirmed: trueConfirmed,
      confirmationRate: rate(trueConfirmed, trueArm.length),
    },
    messageScan: {
      n: scan.length,
      // v3.2.4: the statistic is named for what it IS. itemsWithMiss/n is the
      // share of scanned messages carrying ≥1 published-family claim the
      // rater listed that the provisional ledger does NOT already carry —
      // a message-level omission incidence. It is NOT claim-level recall,
      // and the two must never be conflated.
      statistic: 'message-level omission incidence',
      itemsWithMiss: withMiss,
      missRate: rate(withMiss, scan.length),
      wilson95: wilson(withMiss, scan.length),
      scope: 'published families',
      claimLevel,
      // §8: per-family recall is NOT claimed — the scan yields too few
      // positives per family (outline checklist item 4). Counts only,
      // computed over NEW misses (already-extracted claims are not misses).
      missedByFamily: Object.fromEntries(PUBLISHED_FAMILIES.map((f) => [f,
        scan.reduce((a, r) => a + (r.newMisses ?? []).filter((c) => c.kind === f).length, 0)])),
      perFamilyRecall: 'not claimed — counts only (v3.2 §8, thin positives)',
    },
    rows,
  }
}

// ---------------------------------------------------------------------------
// Sheet rendering
// ---------------------------------------------------------------------------

export function renderSheet(items, messagesBySeq, { context = 2 } = {}) {
  const out = []
  out.push('# Single-author validation — blinded review packet (v3.2 §8)')
  out.push('')
  out.push('Three arms are shuffled into this one sheet. **Nothing marks which arm an')
  out.push('item belongs to**, and no item shows a verdict, a role, a model, or a game')
  out.push('outcome. Do not open the sealed key or the logs while rating.')
  out.push('')
  out.push('For an item that shows a **claim** (a kind and fields), rule:')
  out.push('')
  out.push('- **OK** — a genuine first-person claim of that kind, with those fields,')
  out.push('  asserted in THIS message.')
  out.push('- **BAD** — not a claim of that kind, or not asserted here.')
  out.push('- **CORRECTED** — a genuine claim whose FIELDS are wrong; fill the')
  out.push('  corrected slots. Write `-` to STRIKE a field (the ruling for a night')
  out.push('  number the message never literally states).')
  out.push('')
  out.push('For an item that shows **no kind**, list every claim you see in the message')
  out.push('(kind, fields, byte-exact span), or `none`.')
  out.push('')
  out.push('Every ruling cites the exact codebook rule (`rule:`).')
  out.push('')
  out.push('Blinding, stated precisely (v3.2.4): this sitting is ITEM-LEVEL BLIND —')
  out.push('no item shows its arm, a verdict, a role, a model, a game outcome, or a')
  out.push('machine advisory. It is NOT prior-free: the author has seen aggregate')
  out.push('results from earlier sittings of this campaign. The disclosure travels')
  out.push('with the published validation summary.')
  out.push('')
  for (const it of items) {
    const here = messagesBySeq.get(`${it.seed}|${it.seq}`)
    if (!here) throw new Error(`no public message at ${it.seed} seq ${it.seq}`)
    const fields = it.fields && Object.keys(it.fields).length
      ? ' · ' + Object.entries(it.fields).map(([k, v]) => `${k}=${v}`).join(' · ')
      : ''
    out.push(`**${it.item}.** [${it.kind ?? 'inspect for claims'}${fields}] — day ${it.day ?? here.day}, speaker ${here.speaker}`)
    for (const c of here.context.slice(0, context)) out.push(`  *earlier, ${c.speaker}:* ${c.text.replace(/\n/g, ' ')}`)
    out.push(...here.text.split('\n').map((l) => `> ${l}`))
    out.push('')
    if (it.quote) out.push(`    claimed span: ${JSON.stringify(it.quote)}`)
    if (it.resolvingContext) {
      const rc = it.resolvingContext
      out.push(typeof rc?.seq === 'number' && typeof rc?.text === 'string'
        ? `    resolving context (seq ${rc.seq}): ${JSON.stringify(rc.text)}`
        : `    resolving context: ${JSON.stringify(rc)}`)
    }
    out.push('    ruling: OK / BAD / CORRECTED    rule:            note:')
    out.push('    corrected — kind:        role:        target:        result:        claimedNight:')
    out.push('    corrected — quote:        resolvingContext seq:        resolvingContext text (byte-exact):')
    out.push('')
  }
  return out.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const readJsonl = (p) => readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const writeAtomic = (p, c) => { const t = `${p}.tmp-${process.pid}`; writeFileSync(t, c); renameSync(t, p) }
const writeJsonlAtomic = (p, rows) => writeAtomic(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')

/** Public messages of every log in `dir`, with each speaker's context window. */
export function readMessages(dir, { context = 2 } = {}) {
  const all = []
  const bySeq = new Map()
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort()) {
    const seed = basename(f, '.jsonl')
    const names = {}
    const prior = []
    for (const e of readJsonl(join(dir, f))) {
      if (e.type === 'game_created') for (const s of e.payload.seats ?? []) names[s.id] = s.name
      if (e.type !== 'message_sent') continue
      const speaker = names[e.actor] ?? e.actor
      const row = { seed, seq: e.seq, day: e.day, actor: e.actor, speaker, text: e.payload.text }
      bySeq.set(`${seed}|${e.seq}`, { ...row, context: prior.slice(-context) })
      prior.push({ speaker, text: e.payload.text })
      all.push(row)
    }
  }
  return { all, bySeq }
}

function main() {
  const { values } = parseArgs({
    options: {
      ledger: { type: 'string' },
      logs: { type: 'string', default: 'runs/sweep-download/sweep1' },
      seed: { type: 'string', default: 'review-1' },
      'true-n': { type: 'string', default: '100' },
      'messages-n': { type: 'string', default: '200' },
      'min-per-family': { type: 'string', default: String(PER_FAMILY_RATE_FLOOR) },
      context: { type: 'string', default: '2' },
      /** v3.2.4: the analysis manifest — the scan arm's sampling frame binds
       *  to the ledger's cohort and the manifest's log hashes. */
      manifest: { type: 'string', default: 'runs/analysis-v3/manifest.json' },
      out: { type: 'string', default: 'runs/analysis-v3/handcheck/review-packet' },
      unblind: { type: 'boolean', default: false },
      key: { type: 'string' },
      rulings: { type: 'string' },
      /** §8 cross-check: the separate model's independent ratings of the same
       *  packet (never a second human), and the author's post-reconciliation
       *  final rulings for flagged items. */
      'model-rulings': { type: 'string' },
      'final-rulings': { type: 'string' },
    },
  })
  const fail = (m) => { console.error(`build-review-packet: ${m}`); process.exit(1) }
  mkdirSync(values.out, { recursive: true })

  if (values.unblind) {
    if (!values.key || !values.rulings) fail('--unblind needs --key and --rulings')
    // v3.2.4: the unblind step needs the provisional ledger the packet pins —
    // both to verify the lineage (sha vs the key's pin, fail-closed on
    // absence) and to run the already-extracted comparison for the scan arm.
    if (!values.ledger) fail('--unblind needs --ledger (the provisional ledger the packet was built from — v3.2.4 §8)')
    let summary
    try {
      const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
      const keyLines = readJsonl(values.key)
      const unblindKeyMeta = keyLines.find((r) => r._meta) ?? {}
      if (typeof unblindKeyMeta.ledgerSha256 !== 'string' || unblindKeyMeta.ledgerSha256 === '') {
        throw new Error('packet key carries no ledgerSha256 — an unpinned packet cannot be unblinded (v3.2.4)')
      }
      if (sha(values.ledger) !== unblindKeyMeta.ledgerSha256) {
        throw new Error(`--ledger ${values.ledger} is not the provisional ledger this packet pins (sha mismatch)`)
      }
      summary = mergeRulings(keyLines, JSON.parse(readFileSync(values.rulings, 'utf8')), {
        keySha256: sha(values.key),
        rulingsSha256: sha(values.rulings),
        finalRulingsSha256: values['final-rulings'] ? sha(values['final-rulings']) : null,
        modelRulings: values['model-rulings'] ? JSON.parse(readFileSync(values['model-rulings'], 'utf8')) : null,
        modelRulingsSha256: values['model-rulings'] ? sha(values['model-rulings']) : null,
        finalRulings: values['final-rulings'] ? JSON.parse(readFileSync(values['final-rulings'], 'utf8')) : null,
        ledgerClaims: readJsonl(values.ledger).filter((r) => !r._meta),
      })
    } catch (e) { fail(String(e.message ?? e)) }
    writeAtomic(join(values.out, 'review-packet-merged.json'), JSON.stringify(summary, null, 2) + '\n')
    const gated = Object.entries(summary.census.byFamily).filter(([, v]) => v.n > 0 && !v.tierLPublishable)
    console.log(
      `wrote ${join(values.out, 'review-packet-merged.json')}: ${summary.items} rulings — ` +
      `census ${summary.census.n}, true-sample ${summary.trueSample.confirmed}/${summary.trueSample.n} confirmed, ` +
      `message scan ${summary.messageScan.itemsWithMiss}/${summary.messageScan.n} with a published-family miss`,
    )
    if (gated.length) {
      console.log(`Tier L OMITTED for: ${gated.map(([f]) => f).join(', ')} (v3.2 §8 publication gate: retained-precision lower bound < ${RETAINED_PRECISION_FLOOR})`)
    }
    return
  }

  if (!values.ledger) fail('--ledger is required (the v3.2 verdict-stamped ledger)')
  const ledger = readJsonl(values.ledger)
  const meta = ledger.find((r) => r._meta) ?? {}
  const claims = ledger.filter((r) => !r._meta)

  // v3.2.4: the scan arm samples from the EXACT ledger cohort — a "miss" in a
  // game the ledger never covered is not evidence about this ledger. The
  // cohort comes from the ledger meta (build-ledger stamps cohort + seeds),
  // every cohort log is re-hashed against the manifest before sampling, and
  // the complete frame (cohort, games, log hashes, seed, selected ids) is
  // sealed into the packet key. Wrong or unstated cohorts are refused.
  if (typeof meta.cohort !== 'string' || !Array.isArray(meta.seeds) || meta.seeds.length === 0) {
    fail('ledger meta carries no cohort/seeds — rebuild the provisional ledger with build-ledger; an uncohorted scan frame is refused (v3.2.4 §8)')
  }
  let manifestObj
  try { manifestObj = loadManifest(values.manifest) } catch (e) { fail(String(e.message ?? e)) }
  const logSha256 = {}
  for (const seedName of [...meta.seeds].sort()) {
    const pinned = manifestObj.logs?.files?.[seedName]?.sha256
    if (typeof pinned !== 'string') fail(`cohort game ${seedName} is not in the manifest's log inventory — wrong cohort or wrong manifest (v3.2.4)`)
    const actual = sha256File(join(values.logs, `${seedName}.jsonl`))
    if (actual !== pinned) fail(`cohort log ${seedName}.jsonl sha256 does not match the manifest pin — the scan frame must sample the audited logs (v3.2.4)`)
    logSha256[seedName] = pinned
  }
  const cohortSet = new Set(meta.seeds)
  const { all: allMessages, bySeq } = readMessages(values.logs, { context: Number(values.context) })
  const all = allMessages.filter((m) => cohortSet.has(m.seed))

  const census = selectCensus(claims)
  const trueSample = selectTrueSample(claims, {
    n: Number(values['true-n']), minPerFamily: Number(values['min-per-family']), seed: values.seed,
  })
  const claimSeqs = new Set([...census, ...trueSample].map((c) => `${c.seed}|${c.seq}`))
  const messages = selectRandomMessages(all, { n: Number(values['messages-n']), seed: values.seed, excludeSeqs: claimSeqs })
  const { items, key } = buildPacket({ census, trueSample, messages, seed: values.seed })

  writeAtomic(join(values.out, 'review-packet-sheet.md'), renderSheet(items, bySeq, { context: Number(values.context) }))
  writeJsonlAtomic(join(values.out, 'review-packet-key.jsonl'), [{
    _meta: true, mode: 'review-packet', version: REVIEW_PACKET_VERSION,
    protocol: 'single-author validation protocol (v3.2 §8)',
    analysisRunId: meta.analysisRunId ?? null, seed: values.seed,
    // v3.2.2 binding: the exact provisional ledger this packet was built from.
    ledgerSha256: createHash('sha256').update(readFileSync(values.ledger)).digest('hex'),
    // v3.2.4: the complete scan sampling frame, sealed — merge refuses a scan
    // arm that is not exactly this selection.
    samplingFrame: {
      cohort: meta.cohort,
      games: [...meta.seeds].sort(),
      logSha256,
      poolMessages: all.length,
      excludedPacketMessages: [...claimSeqs].filter((s) => cohortSet.has(s.split('|')[0])).length,
      seed: values.seed,
      selectedMessages: messages.map((m) => `${m.seed}|${m.seq}`),
    },
    items: items.length, census: census.length, trueSample: trueSample.length, messages: messages.length,
  }, ...key])
  // v3.2.3: the template carries the mandatory binding metadata pre-filled,
  // so a rater cannot produce an unbound ratings file by accident.
  const keySha = createHash('sha256').update(readFileSync(join(values.out, 'review-packet-key.jsonl'))).digest('hex')
  writeAtomic(join(values.out, 'review-packet-template.json'), JSON.stringify({
    rater: '', analysisRunId: meta.analysisRunId ?? null,
    packetSeed: values.seed, packetVersion: REVIEW_PACKET_VERSION, packetKeySha256: keySha,
    blindSource: 'review-packet-sheet.md only', answerKeyOpened: false,
    rulingVocabulary: RULINGS,
    positiveRatings: Object.fromEntries(items.map((it) => [String(it.item), ''])),
    rules: {}, corrections: {}, missedClaims: {}, notes: {},
  }, null, 2) + '\n')
  console.log(
    `wrote ${values.out}: ${items.length} items, shuffled blind ` +
    `(${census.length} census + ${trueSample.length} true-sample + ${messages.length} message-scan), seed '${values.seed}'`,
  )
}

// Entry guard by REALPATH: a symlinked invocation path (macOS /tmp ->
// /private/tmp) made the naive comparison silently no-op with exit 0 — the
// worst failure mode for a build step (review finding: symlink no-op).
const invokedAs = (() => { try { return process.argv[1] ? realpathSync(process.argv[1]) : null } catch { return null } })()
if (invokedAs && realpathSync(fileURLToPath(import.meta.url)) === invokedAs) main()
