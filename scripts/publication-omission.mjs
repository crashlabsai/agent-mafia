// §8 family omission — analysis v3.2.2. Pure helpers shared by the assembler,
// the gates, and the end-to-end absence tests.
//
// The v3.2.1 omit-gate removed a gate-failing family from the false-statement
// ledger section only; the family still rode into the publication through the
// embedded statistics (models[].ledgerFamilies) and from there onto the
// rendered page (closure review, finding 4). Omission means EVERY publication
// surface, or it is disclosure theater.
// The §8 thresholds and the Wilson interval live HERE and only here: the
// closure rerun found the floors hardcoded in three places, where a frozen-
// parameter change would have turned into a fake data-corruption failure.
export const PER_FAMILY_RATE_FLOOR = 10
export const RETAINED_PRECISION_FLOOR = 0.9

/** 95% Wilson score interval — the one copy every §8 consumer imports. */
export function wilson(k, n) {
  if (n === 0) return [null, null]
  const z = 1.96, p = k / n
  const den = 1 + (z * z) / n
  const mid = (p + (z * z) / (2 * n)) / den
  const half = (z / den) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [Math.max(0, mid - half), Math.min(1, mid + half)]
}

/**
 * Derive a family's Tier L publishability from the validated census counts
 * and the frozen Wilson floor — never from a stored boolean, which a
 * substituted artifact could carry (closure review, finding 3).
 * Returns { publishable, lowerBound, thin }.
 */
export function derivePublishability({ n, upheld }) {
  const thin = !Number.isInteger(n) || n < PER_FAMILY_RATE_FLOOR
  if (!Number.isInteger(n) || n <= 0 || !Number.isInteger(upheld)) return { publishable: false, lowerBound: null, thin }
  const [lowerBound] = wilson(upheld, n)
  return { publishable: !thin && lowerBound !== null && lowerBound >= RETAINED_PRECISION_FLOOR, lowerBound, thin }
}

/**
 * Deep-copy a stats artifact with every Tier L surface of the omitted
 * families removed: per-model proposition-range and utterance-receipt entries
 * and any top-level per-family count maps. Engine-derived sections (ballots,
 * night aggregates, reliability) are untouched — omission is about
 * ledger-dependent results.
 *
 * v3.2.4: two aggregates the closure reviews missed are Tier L too and go
 * with their inputs —
 *   - the report-conditioned ballot strata are CONDITIONED on ledger-confirmed
 *     true investigation reports, so omitting investigation_claim removes the
 *     strata from every model (a stratum built on omitted evidence is the
 *     omitted evidence, worn as a denominator);
 *   - ledgerConfirmedClaims counts rows of EVERY family, omitted ones
 *     included, so any omission withholds the aggregate rather than publish a
 *     number that quietly embeds the withheld rows.
 */
export function scrubOmittedFamilies(stats, families) {
  if (!families?.length) return stats
  const omit = new Set(families)
  const out = JSON.parse(JSON.stringify(stats))
  for (const m of out.models ?? []) {
    if (m.ledgerFamilies) for (const f of omit) delete m.ledgerFamilies[f]
    if (m.ledgerReceiptFamilies) for (const f of omit) delete m.ledgerReceiptFamilies[f]
    if (omit.has('investigation_claim') && m.strata) {
      delete m.strata
      m.strataOmitted = 'report-conditioned strata are Tier L on ledger-confirmed investigation reports — omitted with the family (v3.2.4)'
    }
  }
  if (out.ledgerFamilies) for (const f of omit) delete out.ledgerFamilies[f]
  // These totals and the content-addressed mapping span every family. A
  // caller that publishes a surviving subset must recompute them from that
  // subset (build-publication does); retaining their original values would
  // quietly count the omitted family.
  for (const key of ['ledgerUniquePropositions', 'ledgerPropositionCountRange', 'ledgerResolvedPropositionCountRange', 'ledgerAmbiguousPropositionCountRange', 'ledgerClaimReceipts', 'claimPropositions']) {
    if (key in out) delete out[key]
  }
  if ('ledgerConfirmedClaims' in out) {
    delete out.ledgerConfirmedClaims
    out.ledgerConfirmedClaimsOmitted = 'aggregate withheld — it counts omitted-family rows (v3.2.4)'
  }
  out.omittedFamilies = [...omit].sort()
  return out
}

/**
 * Every path in `obj` where an omitted family still appears as a KEY of a
 * Tier L structure or inside a claims row — the absence test the closure
 * review demanded. The §8 disclosure block itself (omittedFamilies /
 * omittedCounts) is the one sanctioned mention and is skipped.
 */
export function familyLeaks(obj, family, path = '') {
  const leaks = []
  const walk = (v, p) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`)); return }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'omittedFamilies') continue // the sanctioned disclosure
        if (k === family) { leaks.push(`${p}.${k}`); continue }
        if (k === 'kind' && x === family) leaks.push(`${p}.kind`)
        walk(x, `${p}.${k}`)
      }
    }
  }
  walk(obj, path || '$')
  return leaks
}
