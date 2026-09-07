// Inter-rater agreement for the blinded hand-check sheets.
//
// Ingests two or more rater files (JSON: positiveRatings {"1": "OK"|"BAD"|
// "UNSURE"}, nullRatings {"N1": "NO"|"YES"}, and — v3 negative sheets —
// negativeClaims {"N1": [{kind, target?...}]}) plus the answer key, and
// reports: each rater's agreement with the machine decision (for v2 keys
// every sampled claim is implicitly machine-OK; v3 sealed keys mark each
// item accepted/rejected), per-family precision breakdowns, pairwise raw
// agreement and Cohen's kappa on items both raters decided, null-section
// agreement, negative-sheet recall (rater-listed claims vs the sealed key's
// ACCEPTED machine claims, matched on kind+target — unmatched claims are
// machine misses, reported with a Wilson interval), and the disagreement
// list with quotes — the input to adjudication.
//
// v2 keys (plain claim lines, no meta) and v2 rater files keep working
// unchanged; v3 sealed keys carry a meta line whose analysisRunId is
// embedded in the JSON output for the fail-closed publication chain (§5).
//
//   node scripts/agreement.mjs --key runs/analysis/handcheck2/answer-key.jsonl \
//        runs/analysis/handcheck2/ryan-ratings.json \
//        runs/analysis/handcheck2/codex-ratings.json \
//        [--negatives-key runs/analysis-v3/handcheck/negatives-sealed-key.jsonl] \
//        [--negatives-ratings runs/analysis-v3/handcheck/codex-negatives.json] \
//        [--json out.json]
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    key: { type: 'string' },
    'negatives-key': { type: 'string' },
    'negatives-ratings': { type: 'string' },
    json: { type: 'string' },
  },
})
if (!values.key || positionals.length < 1) {
  console.error('usage: node scripts/agreement.mjs --key answer-key.jsonl rater1.json [rater2.json...] [--negatives-key negatives-key.jsonl] [--negatives-ratings negatives-rater.json] [--json out.json]')
  process.exit(1)
}

const fail = (message) => {
  console.error(`agreement: ${message}`)
  process.exit(1)
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const readBoundJson = (path) => {
  const bytes = readFileSync(path)
  return { value: JSON.parse(bytes), sha256: sha256(bytes) }
}
const readBoundJsonl = (path) => {
  const bytes = readFileSync(path)
  return {
    value: bytes.toString('utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)),
    sha256: sha256(bytes),
  }
}

const keyInput = readBoundJsonl(values.key)
const keyLines = keyInput.value
const keyMeta = keyLines.find((r) => r._meta) ?? null
if (keyMeta && typeof keyMeta.analysisRunId !== 'string') {
  fail('--key has a metadata row without analysisRunId')
}
const key = keyLines.filter((r) => !r._meta)
// v3 sealed keys carry explicit item numbers; v2 keys are keyed by line order.
const itemIndex = new Map(key.map((r, i) => [String(r.item ?? i + 1), r]))
const keyItem = (id) => itemIndex.get(String(id))
// For a v2 key the judge implicitly rates every sampled claim OK; a v3 key
// marks machine-rejected candidates, whose expected ruling is BAD.
const expected = (id) => (keyItem(id)?.machineDecision === 'rejected' ? 'BAD' : 'OK')

const raterInputs = positionals.map((path) => ({ path, ...readBoundJson(path) }))
const raters = raterInputs.map((source) => ({ ...source.value, path: source.path }))
if (keyMeta?.analysisRunId) {
  for (const rater of raters) {
    if (rater.analysisRunId !== keyMeta.analysisRunId) {
      fail(`${rater.path}: analysisRunId ${JSON.stringify(rater.analysisRunId ?? null)} does not match --key ${keyMeta.analysisRunId}`)
    }
  }
}

let separateNegativeInput = null
if (values['negatives-ratings']) {
  if (!values['negatives-key']) fail('--negatives-ratings requires --negatives-key')
  separateNegativeInput = { path: values['negatives-ratings'], ...readBoundJson(values['negatives-ratings']) }
  const negativeRatings = separateNegativeInput.value
  if (!negativeRatings || typeof negativeRatings.negativeClaims !== 'object' || Array.isArray(negativeRatings.negativeClaims)) {
    fail(`${values['negatives-ratings']}: missing negativeClaims object`)
  }
  if (typeof negativeRatings.rater !== 'string' || !negativeRatings.rater.trim()) {
    fail(`${values['negatives-ratings']}: missing rater`)
  }
  if (keyMeta?.analysisRunId && negativeRatings.analysisRunId !== keyMeta.analysisRunId) {
    fail(`${values['negatives-ratings']}: analysisRunId ${JSON.stringify(negativeRatings.analysisRunId ?? null)} does not match --key ${keyMeta.analysisRunId}`)
  }
  const matches = raters.filter((rater) => rater.rater === negativeRatings.rater)
  if (matches.length !== 1) {
    fail(`${values['negatives-ratings']}: rater ${JSON.stringify(negativeRatings.rater)} matches ${matches.length} positive-ratings inputs; expected exactly one`)
  }
  if (matches[0].negativeClaims !== undefined) {
    fail(`${values['negatives-ratings']}: matching positive-ratings input already contains negativeClaims`)
  }
  matches[0].negativeClaims = negativeRatings.negativeClaims
}

const wilson = (k, n) => {
  // 95% Wilson score interval for a proportion.
  if (n === 0) return [null, null]
  const z = 1.96, p = k / n
  const den = 1 + z * z / n
  const mid = (p + z * z / (2 * n)) / den
  const half = (z / den) * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
  return [Math.max(0, mid - half), Math.min(1, mid + half)]
}
const pct = (x) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`)

// ---- each rater vs the machine decision ----------------------------------
const perRater = raters.map((r) => {
  const entries = Object.entries(r.positiveRatings ?? {})
  const decided = entries.filter(([, v]) => v !== 'UNSURE')
  const agree = decided.filter(([k, v]) => v === expected(k)).length
  const [lo, hi] = wilson(agree, decided.length)
  return {
    rater: r.rater, items: entries.length, decided: decided.length,
    unsure: entries.length - decided.length, agreeJudge: agree,
    precisionVsJudge: decided.length ? agree / decided.length : null,
    wilson95: [lo, hi],
    badItems: decided.filter(([, v]) => v === 'BAD').map(([k]) => Number(k)).sort((a, b) => a - b),
    overturnedRejects: decided.filter(([k, v]) => expected(k) === 'BAD' && v === 'OK').map(([k]) => Number(k)).sort((a, b) => a - b),
    nullFlags: Object.entries(r.nullRatings ?? {}).filter(([, v]) => v === 'YES').map(([k]) => k),
  }
})

// ---- per-family precision breakdown --------------------------------------
// Precision of the machine per published family, taking each rater as truth:
// accepted items confirmed OK / accepted items decided. Rejected candidates
// (v3 keys only) report their overturn rate separately, same grouping.
const perFamily = raters.map((r) => {
  const groups = new Map() // `${kind}|${decision}` -> {agree, decided, disagreeItems}
  for (const [k, v] of Object.entries(r.positiveRatings ?? {})) {
    if (v === 'UNSURE') continue
    const item = keyItem(k)
    const kind = item?.kind ?? 'unknown'
    const decision = item?.machineDecision === 'rejected' ? 'rejected' : 'accepted'
    const gk = `${kind}|${decision}`
    if (!groups.has(gk)) groups.set(gk, { kind, machineDecision: decision, decided: 0, agree: 0, disagreeItems: [] })
    const g = groups.get(gk)
    g.decided++
    if (v === expected(k)) g.agree++
    else g.disagreeItems.push(Number(k))
  }
  const families = [...groups.values()]
    .map((g) => ({ ...g, rate: g.decided ? g.agree / g.decided : null, wilson95: wilson(g.agree, g.decided), disagreeItems: g.disagreeItems.sort((a, b) => a - b) }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.machineDecision.localeCompare(b.machineDecision))
  return { rater: r.rater, families }
})

// ---- pairwise raw agreement + Cohen's kappa ------------------------------
const pairs = []
for (let i = 0; i < raters.length; i++) for (let j = i + 1; j < raters.length; j++) {
  const a = raters[i], b = raters[j]
  const aPos = a.positiveRatings ?? {}, bPos = b.positiveRatings ?? {}
  const items = Object.keys(aPos)
    .filter((k) => aPos[k] !== 'UNSURE' && bPos[k] !== undefined && bPos[k] !== 'UNSURE')
  const agree = items.filter((k) => aPos[k] === bPos[k])
  const po = items.length ? agree.length / items.length : null
  const pBadA = items.filter((k) => aPos[k] === 'BAD').length / items.length
  const pBadB = items.filter((k) => bPos[k] === 'BAD').length / items.length
  const pe = pBadA * pBadB + (1 - pBadA) * (1 - pBadB)
  const kappa = po === null || pe === 1 ? null : (po - pe) / (1 - pe)
  const nullKeys = Object.keys(a.nullRatings ?? {}).filter((k) => (b.nullRatings ?? {})[k] !== undefined)
  const nullAgree = nullKeys.filter((k) => a.nullRatings[k] === b.nullRatings[k])
  pairs.push({
    raters: [a.rater, b.rater], comparedItems: items.length,
    rawAgreement: po, kappa,
    unsureExcluded: Object.keys(aPos).length - items.length,
    disagreements: items.filter((k) => aPos[k] !== bPos[k])
      .map((k) => ({
        item: Number(k),
        [a.rater]: aPos[k], [b.rater]: bPos[k],
        kind: keyItem(k)?.kind, quote: keyItem(k)?.quote,
      })).sort((x, y) => x.item - y.item),
    nullSection: { compared: nullKeys.length, agreed: nullAgree.length },
  })
}

// ---- negative-sheet recall (v3) ------------------------------------------
// The sealed negatives key lists, per sampled machine-negative message, any
// machine claims at that seq (empty by construction for a derived pool),
// each stamped with its machineDecision. Only an ACCEPTED machine claim of
// the same kind and same target counts as "the machine found it": a rater
// claim matching nothing — or only rejected candidates — is a machine miss.
const normTarget = (t) => (t == null || t === '' ? null : String(t).trim().toLowerCase())
const claimMatches = (rc, mc) => rc.kind === mc.kind && normTarget(rc.target) === normTarget(mc.target)
const canonical = (c) => `${c.kind}|${normTarget(c.target) ?? ''}`

let negatives = null
let negativeKeyInput = null
if (values['negatives-key']) {
  negativeKeyInput = readBoundJsonl(values['negatives-key'])
  const negLines = negativeKeyInput.value
  const negMeta = negLines.find((r) => r._meta) ?? null
  if (keyMeta || negMeta) {
    if (typeof keyMeta?.analysisRunId !== 'string' || typeof negMeta?.analysisRunId !== 'string') {
      fail('--key and --negatives-key must both carry analysisRunId metadata (§5)')
    }
    if (keyMeta.analysisRunId !== negMeta.analysisRunId) {
      fail('--key and --negatives-key carry different analysisRunIds (§5)')
    }
  }
  if (separateNegativeInput && separateNegativeInput.value.analysisRunId !== negMeta?.analysisRunId) {
    fail(`${separateNegativeInput.path}: analysisRunId does not match --negatives-key (§5)`)
  }
  const negItems = new Map(negLines.filter((r) => !r._meta).map((r) => [String(r.item), r]))
  if (separateNegativeInput) {
    const expectedIds = [...negItems.keys()].sort()
    const ratedIds = Object.keys(separateNegativeInput.value.negativeClaims).sort()
    if (JSON.stringify(ratedIds) !== JSON.stringify(expectedIds)) {
      const missing = expectedIds.filter((id) => !ratedIds.includes(id))
      const extra = ratedIds.filter((id) => !expectedIds.includes(id))
      fail(`${separateNegativeInput.path}: negativeClaims keys do not exactly match --negatives-key` +
        `${missing.length ? `; missing ${missing.slice(0, 5).join(', ')}` : ''}` +
        `${extra.length ? `; extra ${extra.slice(0, 5).join(', ')}` : ''}`)
    }
  }

  // Two recall figures per rater, never conflated: sweep 1 publishes four
  // families, so the published-family miss rate is the instrument number;
  // the full-codebook figure (shelved vote families included) is reported
  // beside it as sweep-2 evidence, not as this sweep's recall.
  const PUBLISHED_FAMILIES = new Set(['role_claim', 'not_mafia_claim', 'investigation_claim', 'protection_claim'])
  const negPerRater = raters.filter((r) => r.negativeClaims && typeof r.negativeClaims === 'object').map((r) => {
    const rated = Object.entries(r.negativeClaims).filter(([id]) => negItems.has(id))
    const misses = []
    const byFamily = {}
    let listedTotal = 0
    for (const [id, listed] of rated) {
      const item = negItems.get(id)
      for (const rc of listed ?? []) {
        listedTotal++
        if (!(item.machineClaims ?? []).some((mc) => mc.machineDecision === 'accepted' && claimMatches(rc, mc))) {
          misses.push({ item: id, kind: rc.kind, target: rc.target ?? null, quote: (item.text ?? '').slice(0, 70) })
          byFamily[rc.kind] = (byFamily[rc.kind] ?? 0) + 1
        }
      }
    }
    const rateOf = (list) => {
      const items = new Set(list.map((m) => m.item)).size
      const [lo, hi] = wilson(items, rated.length)
      return { misses: list.length, itemsWithMiss: items, missRate: rated.length ? items / rated.length : null, wilson95: [lo, hi] }
    }
    const full = rateOf(misses)
    const published = rateOf(misses.filter((m) => PUBLISHED_FAMILIES.has(m.kind)))
    return {
      rater: r.rater, ratedItems: rated.length, listedClaims: listedTotal,
      missedClaims: misses.length, itemsWithMiss: full.itemsWithMiss,
      missRate: full.missRate, wilson95: full.wilson95,
      publishedFamilies: published, fullCodebook: full,
      byFamily, misses,
    }
  })

  const negPairs = []
  const negRaters = raters.filter((r) => r.negativeClaims && typeof r.negativeClaims === 'object')
  for (let i = 0; i < negRaters.length; i++) for (let j = i + 1; j < negRaters.length; j++) {
    const a = negRaters[i], b = negRaters[j]
    const common = Object.keys(a.negativeClaims).filter((id) => negItems.has(id) && Array.isArray(b.negativeClaims[id]))
    const setOf = (claims) => [...(claims ?? [])].map(canonical).sort().join(';')
    const agreeExact = common.filter((id) => setOf(a.negativeClaims[id]) === setOf(b.negativeClaims[id]))
    // Kappa on the binary "listed at least one claim" signal per message.
    const anyA = common.filter((id) => (a.negativeClaims[id] ?? []).length > 0).length / (common.length || 1)
    const anyB = common.filter((id) => (b.negativeClaims[id] ?? []).length > 0).length / (common.length || 1)
    const agreeAny = common.filter((id) => ((a.negativeClaims[id] ?? []).length > 0) === ((b.negativeClaims[id] ?? []).length > 0))
    const po = common.length ? agreeAny.length / common.length : null
    const pe = anyA * anyB + (1 - anyA) * (1 - anyB)
    const kappaAny = po === null || pe === 1 ? null : (po - pe) / (1 - pe)
    negPairs.push({
      raters: [a.rater, b.rater], comparedItems: common.length,
      exactSetAgreement: common.length ? agreeExact.length / common.length : null,
      anyClaimAgreement: po, kappaAnyClaim: kappaAny,
      disagreements: common.filter((id) => setOf(a.negativeClaims[id]) !== setOf(b.negativeClaims[id]))
        .map((id) => ({
          item: id,
          [a.rater]: (a.negativeClaims[id] ?? []).map(canonical),
          [b.rater]: (b.negativeClaims[id] ?? []).map(canonical),
          quote: (negItems.get(id)?.text ?? '').slice(0, 70),
        })),
    })
  }
  negatives = { items: negItems.size, perRater: negPerRater, pairs: negPairs }
}

// ---- report --------------------------------------------------------------
console.log('=== rater vs machine decision (v2 keys: every sampled claim is machine-OK by construction) ===')
for (const r of perRater) {
  console.log(`${r.rater.padEnd(8)} ${r.agreeJudge}/${r.decided} agree (${pct(r.precisionVsJudge)}, Wilson95 ${pct(r.wilson95[0])}–${pct(r.wilson95[1])})` +
    `${r.unsure ? `, ${r.unsure} UNSURE excluded` : ''} — BAD: [${r.badItems.join(', ')}]` +
    `${r.overturnedRejects.length ? ` — rejects overturned: [${r.overturnedRejects.join(', ')}]` : ''}` +
    ` — null flags: [${r.nullFlags.join(', ')}]`)
}
console.log('\n=== per-family precision ===')
for (const r of perFamily) {
  for (const f of r.families) {
    console.log(`${r.rater.padEnd(8)} ${f.kind.padEnd(20)} [${f.machineDecision.padEnd(8)}] ${f.agree}/${f.decided} agree (${pct(f.rate)}, Wilson95 ${pct(f.wilson95[0])}–${pct(f.wilson95[1])})` +
      `${f.disagreeItems.length ? ` — disagree: [${f.disagreeItems.join(', ')}]` : ''}`)
  }
}
console.log('\n=== pairwise ===')
for (const p of pairs) {
  console.log(`${p.raters.join(' vs ')}: raw ${pct(p.rawAgreement)} on ${p.comparedItems} co-decided items, kappa ${p.kappa === null ? '—' : p.kappa.toFixed(3)}` +
    ` — nulls ${p.nullSection.agreed}/${p.nullSection.compared} agree`)
  for (const d of p.disagreements) {
    console.log(`  #${d.item} [${d.kind}] ${p.raters[0]}=${d[p.raters[0]]} ${p.raters[1]}=${d[p.raters[1]]} — "${(d.quote ?? '').slice(0, 70)}"`)
  }
}
if (negatives) {
  console.log('\n=== negative-sheet recall (rater-listed claims vs accepted machine claims, kind+target) ===')
  for (const r of negatives.perRater) {
    const fam = Object.entries(r.byFamily).map(([k, n]) => `${k} ${n}`).join(', ')
    console.log(`${r.rater.padEnd(8)} rated ${r.ratedItems}, listed ${r.listedClaims} claim(s), ${r.missedClaims} unmatched (machine misses) in ${r.itemsWithMiss} item(s)` +
      ` — miss rate ${pct(r.missRate)} (Wilson95 ${pct(r.wilson95[0])}–${pct(r.wilson95[1])})${fam ? ` — by family: ${fam}` : ''}`)
    for (const m of r.misses) console.log(`  ${m.item} [${m.kind}${m.target ? ` target=${m.target}` : ''}] — "${m.quote}"`)
  }
  for (const p of negatives.pairs) {
    console.log(`${p.raters.join(' vs ')}: exact claim-set ${pct(p.exactSetAgreement)}, any-claim ${pct(p.anyClaimAgreement)} (kappa ${p.kappaAnyClaim === null ? '—' : p.kappaAnyClaim.toFixed(3)}) on ${p.comparedItems} items`)
    for (const d of p.disagreements) {
      console.log(`  ${d.item} ${p.raters[0]}=[${d[p.raters[0]]}] ${p.raters[1]}=[${d[p.raters[1]]}] — "${d.quote}"`)
    }
  }
}

if (values.json) {
  // Content hashes bind this derivative to the exact frozen keys and rating
  // files. Paths are deliberately omitted so the artifact is deterministic
  // across worktrees containing identical bytes.
  const inputBindings = {
    key: { sha256: keyInput.sha256, analysisRunId: keyMeta?.analysisRunId ?? null },
    positiveRatings: raterInputs.map((source) => ({
      rater: source.value.rater,
      sha256: source.sha256,
      analysisRunId: source.value.analysisRunId ?? null,
    })),
    ...(negativeKeyInput ? {
      negativesKey: {
        sha256: negativeKeyInput.sha256,
        analysisRunId: negativeKeyInput.value.find((row) => row._meta)?.analysisRunId ?? null,
      },
    } : {}),
    ...(separateNegativeInput ? {
      negativesRatings: {
        rater: separateNegativeInput.value.rater,
        sha256: separateNegativeInput.sha256,
        analysisRunId: separateNegativeInput.value.analysisRunId ?? null,
      },
    } : {}),
  }
  const out = { perRater, perFamily, pairs, inputBindings }
  if (negatives) out.negatives = negatives
  // Stamped so build-publication.mjs can verify the chain (§5); absent for
  // v2 keys, which predate analysisRunId.
  if (keyMeta?.analysisRunId) out.analysisRunId = keyMeta.analysisRunId
  writeFileSync(values.json, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${values.json}`)
}
