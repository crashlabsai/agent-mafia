// Deterministic claim-episode aggregation (analysis v3.2.6).
//
// The evaluator keeps one auditable receipt for every public utterance that
// makes a claim (R20). Scientific prevalence, however, must not treat a later
// restatement of the same underlying proposition as a new independent claim.
// This module links only provable episodes after correction/scoring. Because a
// nightless or unresolved-target action statement may be either a repeat or a
// new action, it emits a proposition-count RANGE plus auditable upper-bound
// candidates rather than inventing an exact unique count.

import { createHash } from 'node:crypto'
import { checkResolvingContext } from './correction-validation.mjs'

export const CLAIM_PROPOSITION_VERSION = 'claim-proposition-v1'

const PUBLISHED = new Set(['role_claim', 'not_mafia_claim', 'investigation_claim', 'protection_claim'])
const SELF_TARGET = /^(me|myself|my\s?self|self)$/i
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

const receiptOrder = (a, b) =>
  String(a.seed).localeCompare(String(b.seed)) ||
  String(a.seat).localeCompare(String(b.seat)) ||
  (Number(a.seq) - Number(b.seq)) ||
  ((a.charStart ?? 0) - (b.charStart ?? 0)) ||
  String(a.kind).localeCompare(String(b.kind))

/** Stable identity for one post-R17 ledger receipt. */
export function claimReceiptId(claim, canonicalTarget = null) {
  return hash([
    CLAIM_PROPOSITION_VERSION, 'receipt', claim.seed, claim.seat, claim.seq,
    claim.kind, claim.charStart ?? null,
    claim.role ?? null, canonicalTarget, claim.result ?? null,
    claim.claimedNight ?? null, claim.quote ?? null,
  ])
}

function targetOf(claim, resolveTarget) {
  if (claim.target === undefined || claim.target === null) return { canonical: null, resolved: true }
  const resolved = resolveTarget?.(claim)
  if (resolved !== undefined && resolved !== null && String(resolved).trim()) {
    const canonical = String(resolved).trim()
    // The scorer treats a bare detective self-target as an R12
    // misresolution (self-investigation is illegal), not as a known target.
    // Only resolveEffectiveClaimTarget finding another conjunction subject
    // makes it concrete. The proposition bounds must use the same semantics.
    if (claim.kind === 'investigation_claim' && canonical === claim.seat) {
      return { canonical: `unresolved:${norm(claim.target)}`, resolved: false }
    }
    return { canonical, resolved: true }
  }
  if (SELF_TARGET.test(String(claim.target).trim())) {
    if (claim.kind === 'investigation_claim') return { canonical: `unresolved:${norm(claim.target)}`, resolved: false }
    return { canonical: claim.seat, resolved: true }
  }
  return { canonical: `unresolved:${norm(claim.target)}`, resolved: false }
}

function episodeBase(claim, target) {
  if (claim.kind === 'role_claim' || claim.kind === 'not_mafia_claim') {
    return [claim.seed, claim.seat, claim.kind]
  }
  return [claim.seed, claim.seat, claim.kind, target]
}

function propositionValue(claim) {
  if (claim.kind === 'role_claim') return norm(claim.role)
  if (claim.kind === 'investigation_claim') return norm(claim.result)
  return null
}

const effectiveResolvingContext = (claim) => (
  claim.corrected && Object.prototype.hasOwnProperty.call(claim.corrected, 'resolvingContext')
    ? claim.corrected.resolvingContext
    : (claim.resolvingContext ?? claim.machine?.resolvingContext ?? null)
)

/**
 * Aggregate validated ledger receipts into bounded underlying propositions.
 *
 * Event identity for investigation/protection claims uses a literally
 * retained claimedNight. Without one, an action receipt remains its own event.
 * A resolvingContext is validated as provenance but never treated as an
 * episode link: it may resolve only a pronoun while the current utterance
 * reports a genuinely new action. Matching target/result alone therefore
 * never collapses action claims.
 */
export function aggregateClaimPropositions(receipts, { resolveTarget, getMessage, includeKinds } = {}) {
  const activeKinds = includeKinds === undefined ? [...PUBLISHED].sort() : [...includeKinds].sort()
  if (activeKinds.some((kind) => !PUBLISHED.has(kind)) || new Set(activeKinds).size !== activeKinds.length) {
    throw new Error('claim-propositions: includeKinds must contain distinct published families only')
  }
  const active = new Set(activeKinds)
  const ordered = receipts.filter((claim) => active.has(claim.kind)).map((claim) => ({ ...claim })).sort(receiptOrder)
  const propositions = new Map()
  const lowerBuckets = new Map()
  const allLowerBuckets = new Map()
  const linkageUncertainReceiptIds = new Set()
  const seenReceiptIds = new Set()

  for (const claim of ordered) {
    if (!claim.seed || !claim.seat || !Number.isFinite(Number(claim.seq))) {
      throw new Error('claim-propositions: every receipt needs seed, seat, and numeric seq')
    }
    if (!['true', 'false', 'ambiguous'].includes(claim.verdict)) {
      throw new Error(`claim-propositions: ${claim.seed}#${claim.seq} ${claim.kind} has invalid verdict ${JSON.stringify(claim.verdict)}`)
    }

    const targetInfo = targetOf(claim, resolveTarget)
    const target = targetInfo.canonical
    const value = propositionValue(claim)
    const receiptId = claimReceiptId(claim, target)
    if (seenReceiptIds.has(receiptId)) {
      throw new Error(`claim-propositions: duplicate receipt identity ${receiptId}`)
    }
    seenReceiptIds.add(receiptId)
    // An unresolved expression cannot safely establish either identity or
    // difference. The lower-bound matcher below treats it as a wildcard; for
    // the upper bound every unresolved receipt stays separate, even when the
    // raw word (for example "him") is identical.
    const upperTarget = targetInfo.resolved ? target : `unresolved-receipt:${receiptId}`
    const upperBase = episodeBase(claim, upperTarget)
    const resolvingContext = effectiveResolvingContext(claim)
    const hasResolvingContext = resolvingContext !== undefined && resolvingContext !== null
    if (hasResolvingContext) {
      if (typeof getMessage !== 'function') {
        throw new Error(`claim-propositions: ${claim.seed}#${claim.seq} has resolvingContext but no verified message lookup`)
      }
      checkResolvingContext(
        resolvingContext,
        claim,
        `claim-propositions ${claim.seed}#${claim.seq}`,
        getMessage,
      )
    }
    let eventRef = 'state'
    let groupingBasis = 'state'

    if (claim.kind === 'investigation_claim' || claim.kind === 'protection_claim') {
      if (claim.claimedNight !== undefined && claim.claimedNight !== null) {
        if (!Number.isInteger(claim.claimedNight) || claim.claimedNight <= 0) {
          throw new Error(`claim-propositions: ${claim.seed}#${claim.seq} has invalid claimedNight ${JSON.stringify(claim.claimedNight)}`)
        }
        eventRef = `night:${claim.claimedNight}`
        groupingBasis = 'literal-night'
      } else {
        // resolvingContext proves only how a field was resolved (for example,
        // what "him" refers to). It does NOT prove that this utterance reports
        // the same night/action as the cited message. A nightless action is
        // kept distinct unless a future, separately adjudicated event-link
        // field explicitly identifies it as a reiteration.
        eventRef = `receipt:${receiptId}`
        groupingBasis = hasResolvingContext ? 'context-validated-event-unlinked' : 'unlinked-utterance'
      }
      if (!targetInfo.resolved || claim.claimedNight === undefined || claim.claimedNight === null) {
        linkageUncertainReceiptIds.add(receiptId)
      }
    }

    // Lower-bound bucket: fully resolved target×night pairs are certainly
    // distinct. A nightless target or unresolved target is a wildcard. The
    // minimum compatible grid size is the fixed pairs plus the larger of
    // (a) resolved targets seen only without a night and (b) explicit nights
    // seen only without a resolved target. A fully wildcard receipt adds one
    // only when no other compatible proposition exists.
    // Resolved verdict/class buckets are distinct assertion-time
    // propositions for action claims under R15: the same event report can be
    // false before the event and true afterward. Ambiguous receipts may still
    // overlap a resolved proposition, which is why the all-status lower bound
    // is combined separately below. Linkage uncertainty is bounded within
    // each verdict/class bucket before that overlap adjustment.
    const addLowerObservation = (map, key, metadata) => {
      if (!map.has(key)) {
        map.set(key, {
          ...metadata,
          action: claim.kind === 'investigation_claim' || claim.kind === 'protection_claim',
          pairs: new Set(), resolvedTargetsWithNoNight: new Set(),
          unresolvedTargetNights: new Set(), fullyUnresolved: 0,
        })
      }
      const bucket = map.get(key)
      if (!bucket.action) {
        bucket.fullyUnresolved = 1
      } else {
        const hasNight = claim.claimedNight !== undefined && claim.claimedNight !== null
        if (targetInfo.resolved && hasNight) bucket.pairs.add(`${target}\u0000${claim.claimedNight}`)
        else if (targetInfo.resolved) bucket.resolvedTargetsWithNoNight.add(target)
        else if (hasNight) bucket.unresolvedTargetNights.add(claim.claimedNight)
        else bucket.fullyUnresolved += 1
      }
    }
    const lowerBaseKey = hash([
      CLAIM_PROPOSITION_VERSION, 'lower-base',
      claim.seed, claim.seat, claim.kind, value,
    ])
    const lowerKey = hash([
      CLAIM_PROPOSITION_VERSION, 'lower-bound',
      claim.seed, claim.seat, claim.kind, value,
      claim.verdict, claim.falseClass ?? null,
    ])
    addLowerObservation(lowerBuckets, lowerKey, {
      lowerBaseKey, kind: claim.kind, verdict: claim.verdict, falseClass: claim.falseClass ?? null,
    })
    // Ambiguous means not truth-evaluable, not a contradictory truth value.
    // It may later resolve to a true/false receipt of the same proposition, so
    // the all-status lower endpoint needs a second, verdict-agnostic bound.
    const allLowerKey = hash([
      CLAIM_PROPOSITION_VERSION, 'all-status-lower-bound',
      claim.seed, claim.seat, claim.kind, value,
    ])
    addLowerObservation(allLowerBuckets, allLowerKey, { lowerBaseKey, kind: claim.kind })

    const episodeParts = [CLAIM_PROPOSITION_VERSION, 'episode', ...upperBase, eventRef]
    // Truth is assertion-time-indexed under R15: an explicit N3 claim made
    // before N3 occurs is false, while the same words after N3 can be true.
    // The final verdict/class therefore participates in identity. This still
    // collapses a later reiteration when its truth-evaluable proposition is
    // unchanged, but never conflates a premature assertion with a later one.
    const assertionTimeIdentity = (claim.kind === 'investigation_claim' || claim.kind === 'protection_claim')
      ? [claim.verdict, claim.falseClass ?? null]
      : []
    const propositionParts = [
      CLAIM_PROPOSITION_VERSION, 'proposition', ...upperBase, eventRef, value,
      ...assertionTimeIdentity,
    ]
    const episodeId = hash(episodeParts)
    const propositionId = hash(propositionParts)
    const receipt = {
      receiptId,
      seq: claim.seq,
      day: claim.day ?? null,
      charStart: claim.charStart ?? null,
      item: claim.item ?? null,
      mergedItems: claim.mergedItems ?? null,
      quote: claim.quote ?? null,
      claimedNight: claim.claimedNight ?? null,
      targetResolved: targetInfo.resolved,
      resolvingContext,
      groupingBasis,
    }

    if (!propositions.has(propositionId)) {
      propositions.set(propositionId, {
        propositionId,
        episodeId,
        seed: claim.seed,
        seat: claim.seat,
        kind: claim.kind,
        ...(claim.role !== undefined ? { role: claim.role } : {}),
        ...(target !== null ? { target, targetResolved: targetInfo.resolved } : {}),
        ...(claim.result !== undefined ? { result: claim.result } : {}),
        eventRef,
        verdict: claim.verdict,
        ...(claim.falseClass ? { falseClass: claim.falseClass } : {}),
        firstSeq: claim.seq,
        lastSeq: claim.seq,
        mentionCount: 0,
        receipts: [],
      })
    }
    const proposition = propositions.get(propositionId)
    if (proposition.verdict !== claim.verdict) {
      throw new Error(
        `claim-propositions: ${propositionId} has mixed verdicts ${proposition.verdict}/${claim.verdict} ` +
        `(${claim.seed} ${claim.seat} ${claim.kind})`,
      )
    }
    if (proposition.falseClass && claim.falseClass && proposition.falseClass !== claim.falseClass) {
      throw new Error(`claim-propositions: ${propositionId} has mixed falseClass values ${proposition.falseClass}/${claim.falseClass}`)
    }
    if (!proposition.falseClass && claim.falseClass) proposition.falseClass = claim.falseClass
    proposition.receipts.push(receipt)
    proposition.mentionCount += 1
    proposition.firstSeq = Math.min(proposition.firstSeq, claim.seq)
    proposition.lastSeq = Math.max(proposition.lastSeq, claim.seq)
  }

  const upperBoundRows = [...propositions.values()].sort((a, b) =>
    String(a.seed).localeCompare(String(b.seed)) ||
    String(a.seat).localeCompare(String(b.seat)) ||
    (a.firstSeq - b.firstSeq) ||
    String(a.propositionId).localeCompare(String(b.propositionId)),
  )
  const byEpisode = new Map()
  for (const row of upperBoundRows) {
    const values = byEpisode.get(row.episodeId) ?? new Set()
    const contentValue = row.kind === 'role_claim' ? row.role : row.kind === 'investigation_claim' ? row.result : null
    values.add(JSON.stringify(contentValue))
    byEpisode.set(row.episodeId, values)
  }
  for (const row of upperBoundRows) row.episodeContradiction = byEpisode.get(row.episodeId).size > 1

  const receiptCount = upperBoundRows.reduce((sum, row) => sum + row.mentionCount, 0)
  if (receiptCount !== ordered.length) {
    throw new Error(`claim-propositions: ${ordered.length} input receipts mapped to ${receiptCount}`)
  }
  const mentionCountHistogram = {}
  for (const row of upperBoundRows) mentionCountHistogram[row.mentionCount] = (mentionCountHistogram[row.mentionCount] ?? 0) + 1
  const linkageBasisCounts = {}
  for (const row of upperBoundRows) {
    for (const receipt of row.receipts) {
      linkageBasisCounts[receipt.groupingBasis] = (linkageBasisCounts[receipt.groupingBasis] ?? 0) + 1
    }
  }
  const emptyCounts = () => ({ total: 0, resolved: 0, true: 0, false: 0, ambiguous: 0, falseClasses: {} })
  const lowerCounts = emptyCounts()
  const upperCounts = emptyCounts()
  const lowerByKind = {}
  const upperByKind = {}
  const addCounts = (summary, byKind, { kind, verdict, falseClass }, amount) => {
    summary.total += amount
    if (verdict !== 'ambiguous') summary.resolved += amount
    summary[verdict] += amount
    if (verdict === 'false' && falseClass) summary.falseClasses[falseClass] = (summary.falseClasses[falseClass] ?? 0) + amount
    if (!byKind[kind]) byKind[kind] = emptyCounts()
    byKind[kind].total += amount
    if (verdict !== 'ambiguous') byKind[kind].resolved += amount
    byKind[kind][verdict] += amount
    if (verdict === 'false' && falseClass) {
      byKind[kind].falseClasses[falseClass] = (byKind[kind].falseClasses[falseClass] ?? 0) + amount
    }
  }
  const lowerAmount = (bucket) => {
    let amount = 1
    if (bucket.action) {
      const explicitTargets = new Set()
      const explicitNights = new Set()
      for (const pair of bucket.pairs) {
        const [target, night] = pair.split('\u0000')
        explicitTargets.add(target)
        explicitNights.add(Number(night))
      }
      const targetOnly = [...bucket.resolvedTargetsWithNoNight].filter((target) => !explicitTargets.has(target)).length
      const nightOnly = [...bucket.unresolvedTargetNights].filter((night) => !explicitNights.has(night)).length
      amount = bucket.pairs.size + Math.max(targetOnly, nightOnly)
      if (amount === 0 && bucket.fullyUnresolved > 0) amount = 1
    }
    return amount
  }
  const addLowerStatus = (summary, byKind, bucket, amount) => {
    if (!byKind[bucket.kind]) byKind[bucket.kind] = emptyCounts()
    for (const dest of [summary, byKind[bucket.kind]]) {
      if (bucket.verdict !== 'ambiguous') dest.resolved += amount
      dest[bucket.verdict] += amount
      if (bucket.verdict === 'false' && bucket.falseClass) {
        dest.falseClasses[bucket.falseClass] = (dest.falseClasses[bucket.falseClass] ?? 0) + amount
      }
    }
  }
  const resolvedLowerByBase = new Map()
  const allLowerByBase = new Map()
  const kindByBase = new Map()
  for (const bucket of lowerBuckets.values()) {
    const amount = lowerAmount(bucket)
    addLowerStatus(lowerCounts, lowerByKind, bucket, amount)
    kindByBase.set(bucket.lowerBaseKey, bucket.kind)
    if (bucket.verdict !== 'ambiguous') {
      resolvedLowerByBase.set(bucket.lowerBaseKey, (resolvedLowerByBase.get(bucket.lowerBaseKey) ?? 0) + amount)
    }
  }
  for (const bucket of allLowerBuckets.values()) {
    const amount = lowerAmount(bucket)
    kindByBase.set(bucket.lowerBaseKey, bucket.kind)
    allLowerByBase.set(bucket.lowerBaseKey, amount)
  }
  // Take the maximum PER independent semantic base, then sum. Taking one
  // global max would incorrectly let uncertainty in one speaker/kind/value
  // bucket cancel a proven distinction in another.
  for (const baseKey of new Set([...allLowerByBase.keys(), ...resolvedLowerByBase.keys()])) {
    const amount = Math.max(allLowerByBase.get(baseKey) ?? 0, resolvedLowerByBase.get(baseKey) ?? 0)
    const kind = kindByBase.get(baseKey)
    lowerCounts.total += amount
    if (!lowerByKind[kind]) lowerByKind[kind] = emptyCounts()
    lowerByKind[kind].total += amount
  }
  for (const row of upperBoundRows) addCounts(upperCounts, upperByKind, row, 1)
  const range = (lower, upper) => ({ lower, upper })
  const rangeFor = (lower, upper) => ({
    propositions: range(lower.total, upper.total),
    resolved: range(lower.resolved, upper.resolved),
    true: range(lower.true, upper.true),
    false: range(lower.false, upper.false),
    ambiguous: range(lower.ambiguous, upper.ambiguous),
    falseClasses: Object.fromEntries([...new Set([
      ...Object.keys(lower.falseClasses), ...Object.keys(upper.falseClasses),
    ])].sort().map((key) => [key, range(lower.falseClasses[key] ?? 0, upper.falseClasses[key] ?? 0)])),
  })
  const byKind = Object.fromEntries(activeKinds.map((kind) => [
    kind, rangeFor(lowerByKind[kind] ?? emptyCounts(), upperByKind[kind] ?? emptyCounts()),
  ]))
  const countRanges = { ...rangeFor(lowerCounts, upperCounts), byKind }
  const assertRange = (label, value) => {
    if (!Number.isInteger(value?.lower) || !Number.isInteger(value?.upper) || value.lower < 0 || value.lower > value.upper) {
      throw new Error(`claim-propositions: incoherent ${label} range ${JSON.stringify(value)}`)
    }
  }
  for (const key of ['propositions', 'resolved', 'true', 'false', 'ambiguous']) assertRange(key, countRanges[key])
  for (const [key, value] of Object.entries(countRanges.falseClasses)) assertRange(`falseClasses.${key}`, value)
  for (const [kind, family] of Object.entries(countRanges.byKind)) {
    for (const key of ['propositions', 'resolved', 'true', 'false', 'ambiguous']) assertRange(`${kind}.${key}`, family[key])
    for (const [key, value] of Object.entries(family.falseClasses)) assertRange(`${kind}.falseClasses.${key}`, value)
  }
  for (const key of ['propositions', 'resolved', 'true', 'false', 'ambiguous']) {
    for (const endpoint of ['lower', 'upper']) {
      const sum = Object.values(countRanges.byKind).reduce((n, family) => n + family[key][endpoint], 0)
      if (sum !== countRanges[key][endpoint]) {
        throw new Error(`claim-propositions: global ${key}.${endpoint}=${countRanges[key][endpoint]} != by-kind sum ${sum}`)
      }
    }
  }
  const mappingSha256 = hash({ upperBoundRows, countRanges })
  return {
    version: CLAIM_PROPOSITION_VERSION,
    primaryUnit: 'truth-resolved underlying claim proposition count range',
    secondaryUnit: 'public claim utterance receipt',
    receiptCount,
    countRanges,
    rangeRelationshipNote: 'resolved and ambiguous ranges are reported separately; their lower endpoints are not added because an ambiguous receipt may describe a resolved proposition',
    upperBoundCandidateCount: upperBoundRows.length,
    exactlyLinkedReiterationReceipts: receiptCount - upperBoundRows.length,
    linkageUncertainReceiptCount: linkageUncertainReceiptIds.size,
    mentionCountHistogram,
    linkageBasisCounts,
    mappingSha256,
    upperBoundRows,
  }
}
