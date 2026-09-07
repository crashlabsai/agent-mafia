// Shared fail-closed validation for CORRECTED rulings and recovered claims —
// analysis v3.2 §3, revised v3.2.2.
//
// One module because two sitting flows write corrections (the PF-2-lineage
// adjudication packet and the §8 review packet), and the write half and the
// read half of the correction contract must be one contract: the v3.2.1
// review found the two drifting (duplicated CORRECTABLE lists), and the
// v3.2.2 closure review found the §8 flow storing corrections raw with no
// validation at all.
//
// Pure: callers inject `getMessage(seed, seq) -> {text, actor} | undefined`
// and receive either a validated `corrected` block or a thrown Error naming
// the failure. Nothing here reads files or exits the process.
import { nightIsStated } from '../packages/seats/scripts/semantics-v3.mjs'
import { CORRECTABLE_FIELDS } from '../packages/seats/scripts/scoring-v3.mjs'

/** v3.2.4: the PF-2 packet interface version. Lives here — the module both
 *  the packet builder and the ruling merge already share — so the two ends
 *  of the ratings contract can never drift on what version they speak. A
 *  ratings file must carry this exact string (absence rejected like
 *  mismatch, per the v3.2.3 metadata rule).
 *  v3.2.5: bumped — recall-miss key rows now pin their exact claim. */
export const PF2_PACKET_VERSION = 'pf2-v3.2.5'

/**
 * v3.2.5: the complete normalized proposition of one rater-listed
 * recall-miss claim — the packet builder seals it into the key row, and the
 * merge recomputes it from the ratings file and refuses any difference. One
 * definition on both ends, or "exact claim" means two different things.
 * Normalization: absent fields become null, night/day numbers coerce
 * numeric strings to integers, targets trim whitespace; the quote is
 * byte-exact and participates as-is.
 */
export function recallClaimFingerprint(claim) {
  const night = (v) => {
    if (v === undefined || v === null) return null
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim())
    return v
  }
  return {
    kind: claim.kind ?? null,
    role: claim.role ?? null,
    target: claim.target === undefined || claim.target === null ? null : String(claim.target).trim(),
    result: claim.result ?? null,
    claimedNight: night(claim.claimedNight),
    referencedDay: night(claim.referencedDay),
    quote: claim.quote ?? null,
  }
}

export const KNOWN_KINDS = new Set(['role_claim', 'not_mafia_claim', 'investigation_claim', 'protection_claim'])
export const SHELVED_KINDS = new Set(['vote_commitment', 'vote_stance', 'vote_retraction', 'past_vote_claim', 'past_vote_denial'])
export const KNOWN_RESULTS = new Set(['mafia', 'not mafia'])
export const KNOWN_ROLES = new Set(['mafia', 'doctor', 'detective', 'villager'])
/** R13 required fields per published kind — the scorer's contract. */
export const KIND_FIELDS = Object.freeze({
  role_claim: Object.freeze({ required: ['role'], optional: [] }),
  not_mafia_claim: Object.freeze({ required: [], optional: [] }),
  investigation_claim: Object.freeze({ required: ['target', 'result'], optional: ['claimedNight'] }),
  protection_claim: Object.freeze({ required: ['target'], optional: ['claimedNight'] }),
})
export const KIND_REQUIRED = Object.freeze(Object.fromEntries(
  Object.entries(KIND_FIELDS).map(([kind, shape]) => [kind, shape.required]),
))
const PUBLISHED_SEMANTIC_FIELDS = Object.freeze([
  'role', 'target', 'result', 'claimedNight', 'referencedDay', 'conditional', 'denial',
])
// The recovered-claim envelope is shared by both recovery callers. `quote`
// is consumed by those callers for the R19 receipt; the remaining names are
// the complete codebook field vocabulary (including shelved vote fields).
// Anything else would otherwise be silently discarded by the normalization
// loop below, so reject it before inspecting the claim's kind-specific shape.
const RECOVERED_CLAIM_FIELDS = new Set(['kind', 'quote', ...PUBLISHED_SEMANTIC_FIELDS])

const bad = (where, msg) => { throw new Error(`${where}: ${msg}`) }

/**
 * A published claim family has one exact semantic shape. Required-field-only
 * validation is insufficient: after a kind correction, stale fields from the
 * former family can survive and change R17 fingerprints (for example an
 * investigation_claim carrying role=mafia). Provenance fields such as quote
 * and resolvingContext are intentionally outside this check.
 */
export function validatePublishedShape({ where, kind, fields }) {
  const shape = KIND_FIELDS[kind]
  if (!shape) bad(where, `unknown published kind ${JSON.stringify(kind)}`)
  const allowed = new Set([...shape.required, ...shape.optional])
  const forbidden = PUBLISHED_SEMANTIC_FIELDS.filter(
    (field) => fields[field] !== undefined && fields[field] !== null && !allowed.has(field),
  )
  if (forbidden.length > 0) {
    bad(where, `${kind} carries forbidden semantic field(s) ${forbidden.join(', ')} — strike stale fields when changing kind`)
  }
  const missing = shape.required.filter((field) => fields[field] === undefined || fields[field] === null)
  if (missing.length > 0) {
    bad(where, `${kind} is missing required ${missing.join(', ')} (R13)`)
  }
  if (fields.role !== undefined && fields.role !== null && !KNOWN_ROLES.has(fields.role)) {
    bad(where, `${kind} role ${JSON.stringify(fields.role)} is not a ruleset role`)
  }
  if (fields.result !== undefined && fields.result !== null && !KNOWN_RESULTS.has(fields.result)) {
    bad(where, `${kind} result ${JSON.stringify(fields.result)} must be "mafia" or "not mafia"`)
  }
  if (fields.target !== undefined && fields.target !== null &&
      (typeof fields.target !== 'string' || fields.target.trim() === '')) {
    bad(where, `${kind} target must be a non-empty string`)
  }
  if (fields.claimedNight !== undefined && fields.claimedNight !== null &&
      (!Number.isInteger(fields.claimedNight) || fields.claimedNight <= 0)) {
    bad(where, `${kind} claimedNight ${JSON.stringify(fields.claimedNight)} is not a positive integer`)
  }
}

/** R12b provenance: all four conditions are hard requirements (v3.2 §3). */
export function checkResolvingContext(rc, record, where, getMessage) {
  if (rc === undefined || rc === null) return
  if (typeof rc !== 'object' || Array.isArray(rc)) {
    bad(where, 'resolvingContext needs exactly {seq, text} (v3.2 §3)')
  }
  const keys = Object.keys(rc).sort()
  if (keys.length !== 2 || keys[0] !== 'seq' || keys[1] !== 'text' ||
      !Number.isInteger(rc.seq) || typeof rc.text !== 'string' || rc.text.length === 0) {
    bad(where, 'resolvingContext needs exactly {seq: integer, text: non-empty byte-exact string} (v3.2 §3)')
  }
  if (!(rc.seq < record.seq)) bad(where, `resolvingContext seq ${rc.seq} is not strictly earlier than ${record.seq} (R12b)`)
  const msg = getMessage(record.seed, rc.seq)
  if (!msg) bad(where, `no public message at ${record.seed} seq ${rc.seq} — resolvingContext must cite a PUBLIC message (R12b)`)
  const speaker = record.seat ?? record.actor
  if (speaker && msg.actor !== speaker) {
    bad(where, `resolvingContext seq ${rc.seq} was spoken by ${msg.actor}, not by ${speaker} — R12b resolves only from the speaker's OWN prior messages`)
  }
  if (!msg.text.includes(rc.text)) {
    bad(where, `resolvingContext text is not a byte-exact substring of ${record.seed} seq ${rc.seq} (R19)`)
  }
}

/**
 * Recover the exact source bytes for a LEGACY machine-produced context that
 * differs only in whitespace formatting. The v3.2.1 extractor emitted one
 * known context with a missing space beside an em dash. That is provenance
 * damage, not a semantic correction, so callers may repair it only when the
 * whitespace-normalized text has exactly one match in the verified source.
 *
 * Human-authored corrections never use this escape hatch: their context must
 * already be byte-exact. A changed word or punctuation mark returns null and
 * remains a hard error.
 */
export function exactFormattingEquivalentSubstring(sourceText, recordedText) {
  if (typeof sourceText !== 'string' || typeof recordedText !== 'string' || recordedText.length === 0) return null
  if (sourceText.includes(recordedText)) return recordedText

  const withMap = (input) => {
    const raw = []
    let i = 0
    while (i < input.length) {
      if (/\s/u.test(input[i])) {
        const start = i
        while (i < input.length && /\s/u.test(input[i])) i += 1
        raw.push({ char: ' ', start, end: i })
      } else {
        raw.push({ char: input[i], start: i, end: i + 1 })
        i += 1
      }
    }
    // Spacing beside punctuation is typographic only. Remove it from the
    // comparison form while preserving source offsets for the exact slice.
    // Punctuation itself still has to match byte-for-byte.
    const spacingPunctuation = new Set(['—', '–', ':', ';'])
    const kept = raw.filter((token, index) => token.char !== ' ' ||
      !(spacingPunctuation.has(raw[index - 1]?.char) || spacingPunctuation.has(raw[index + 1]?.char)))
    return {
      text: kept.map((token) => token.char).join(''),
      starts: kept.map((token) => token.start),
      ends: kept.map((token) => token.end),
    }
  }

  const source = withMap(sourceText)
  const wanted = withMap(recordedText).text
  if (!wanted) return null
  const matches = []
  for (let at = source.text.indexOf(wanted); at >= 0; at = source.text.indexOf(wanted, at + 1)) {
    matches.push(at)
    if (matches.length > 1) return null
  }
  if (matches.length !== 1) return null
  const at = matches[0]
  return sourceText.slice(source.starts[at], source.ends[at + wanted.length - 1])
}

/**
 * Validate one CORRECTED ruling against its record and source message,
 * fail-closed, and return the `corrected` block to store (v3.2 §3).
 *
 * - `-` / `''` / null are the explicit strike (a deletion tombstone, preserved
 *   in the block so the deletion is auditable, never dropped);
 * - `claimedNight` coerces numeric strings, must be a positive integer, and
 *   must be literally stated in the source message (§2);
 * - `kind` must be a published family, and the EFFECTIVE record (fields after
 *   the correction) must carry the new kind's R13-required fields — a
 *   kind-correction that leaves the proposition uncheckable is refused here,
 *   not discovered as `ambiguous` downstream (v3.2.2);
 * - a corrected `quote` is R19-validated byte-exact and its offset stored;
 *   a quote can never be struck;
 * - an empty correction (no field changed) is refused: rule OK or BAD instead.
 */
export function validateCorrection({ where, raw, record, rule, note, getMessage }) {
  if (!raw || typeof raw !== 'object') {
    bad(where, 'CORRECTED ruling with no corrections entry — the corrected proposition must be stored (v3.2 §3)')
  }
  const unknownKeys = Object.keys(raw).filter((field) => !CORRECTABLE_FIELDS.includes(field))
  if (unknownKeys.length > 0) {
    bad(where, `correction carries unknown field(s) ${unknownKeys.join(', ')} — the runtime contract is fail-closed`)
  }
  const corrected = { rule, ...(note ? { note } : {}) }
  const replaced = {}
  let changed = 0
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    }
    return value
  }
  const comparable = (field, value) => (
    field === 'target' && typeof value === 'string' ? value.trim() : canonical(value)
  )
  const sameValue = (field, a, b) => JSON.stringify(comparable(field, a)) === JSON.stringify(comparable(field, b))
  const priorValue = (field) => {
    if (field !== 'resolvingContext') return record[field] ?? null
    if (record.corrected && Object.prototype.hasOwnProperty.call(record.corrected, field)) {
      return record.corrected[field]
    }
    return record.resolvingContext ?? record.machine?.resolvingContext ?? null
  }
  for (const f of CORRECTABLE_FIELDS) {
    if (!(f in raw)) continue
    let v = raw[f] === '-' || raw[f] === '' ? null : raw[f]
    if (v !== null) {
      if (f === 'claimedNight') {
        if (typeof v === 'string' && /^\d+$/.test(v.trim())) v = Number(v.trim())
        if (!Number.isInteger(v) || v <= 0) {
          bad(where, `corrected claimedNight ${JSON.stringify(raw[f])} is not a positive integer night (v3.2 §3)`)
        }
      } else if (f === 'kind') {
        if (!KNOWN_KINDS.has(v)) bad(where, `corrected kind ${JSON.stringify(v)} is not a published family (v3.2 §3)`)
      } else if (f === 'result') {
        if (!KNOWN_RESULTS.has(v)) bad(where, `corrected result ${JSON.stringify(v)} must be "mafia" or "not mafia" (v3.2 §3)`)
      } else if (f === 'role') {
        if (!KNOWN_ROLES.has(v)) bad(where, `corrected role ${JSON.stringify(v)} is not a ruleset role (v3.2.3)`)
      } else if (f === 'target' || f === 'quote') {
        if (typeof v !== 'string' || v.trim() === '') bad(where, `corrected ${f} must be a non-empty string (v3.2 §3)`)
        if (f === 'target') v = v.trim()
      }
    }
    // A claim's KIND can never be struck: a proposition with no family is not
    // a proposition — the '-'/null tombstone deleted the kind, skipped the
    // published-family branch, and passed the R13 check vacuously
    // (closure rerun finding 4). Rule BAD instead.
    if (f === 'kind' && v === null) bad(where, "a claim's kind cannot be struck — rule BAD instead (v3.2.2 §3)")
    corrected[f] = v
    const prior = priorValue(f)
    replaced[f] = prior
    if (!sameValue(f, v, prior)) changed += 1
  }
  if (Object.prototype.hasOwnProperty.call(corrected, 'resolvingContext')) {
    checkResolvingContext(corrected.resolvingContext, record, where, getMessage)
  }
  if (changed === 0) bad(where, 'CORRECTED ruling changes no field — rule OK or BAD instead (v3.2 §3)')
  if (corrected.claimedNight !== undefined && corrected.claimedNight !== null) {
    const text = getMessage(record.seed, record.seq)?.text ?? ''
    if (!nightIsStated(corrected.claimedNight, text)) {
      bad(where, `corrected claimedNight ${corrected.claimedNight} is not literally stated in ${record.seed} seq ${record.seq} — strike it with '-' instead (v3.2 §2)`)
    }
  }
  if (typeof corrected.quote === 'string') {
    const text = getMessage(record.seed, record.seq)?.text
    const at = typeof text === 'string' ? text.indexOf(corrected.quote) : -1
    if (at < 0) {
      bad(where, `corrected quote is not a byte-exact substring of ${record.seed} seq ${record.seq} (R19 — no receipt, no ledger entry)`)
    }
    corrected.charStart = at
  }
  if (corrected.quote === null) {
    bad(where, 'a quote cannot be struck — a claim with no span is not a receipt (R19); rule BAD instead')
  }
  // v3.2.2: the EFFECTIVE proposition must be checkable. Apply the correction
  // over the record's fields and verify the (possibly corrected) kind still
  // carries its R13-required fields.
  const effective = { ...record }
  for (const f of CORRECTABLE_FIELDS) {
    if (!(f in corrected)) continue
    if (corrected[f] === null) delete effective[f]
    else effective[f] = corrected[f]
  }
  const kind = effective.kind
  try {
    validatePublishedShape({ where, kind, fields: effective })
  } catch (e) {
    bad(where, `the corrected proposition is invalid: ${String(e.message ?? e).replace(`${where}: `, '')}`)
  }
  corrected.replaced = replaced
  return corrected
}

/**
 * Validate one recovered claim (a rater-listed miss from a message-scan or
 * negative-sample item), fail-closed: kind must be known (published OR
 * shelved — an unknown kind is a typo that must fail loudly, never a silent
 * drop), result must be in its enum, target a non-empty string, nights
 * admissible per §2. Returns { fields, publishable } — shelved kinds are
 * valid but never publish (§2.1).
 */
export function validateRecoveredClaim({ where, claim, text }) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
    bad(where, 'recovered claim must be an object')
  }
  if (!KNOWN_KINDS.has(claim.kind) && !SHELVED_KINDS.has(claim.kind)) {
    bad(where, `recovered claim kind ${JSON.stringify(claim.kind ?? null)} is not in the codebook — a typo fails loudly, never a silent drop (v3.2.2)`)
  }
  const unknownKeys = Object.keys(claim).filter((field) => !RECOVERED_CLAIM_FIELDS.has(field))
  if (unknownKeys.length > 0) {
    bad(where, `recovered claim carries unknown field(s) ${unknownKeys.join(', ')} — the runtime contract is fail-closed`)
  }
  const fields = {}
  let struckNight = null
  for (const f of ['role', 'target', 'result', 'claimedNight', 'referencedDay']) {
    let v = claim[f]
    if (v === undefined || v === null) continue
    if (f === 'result' && !KNOWN_RESULTS.has(v)) bad(where, `recovered result ${JSON.stringify(v)} must be "mafia" or "not mafia"`)
    if (f === 'role' && !KNOWN_ROLES.has(v)) bad(where, `recovered role ${JSON.stringify(v)} is not a ruleset role (v3.2.3)`)
    if (f === 'target' && (typeof v !== 'string' || v.trim() === '')) bad(where, 'recovered target must be a non-empty string')
    if (f === 'claimedNight' || f === 'referencedDay') {
      if (typeof v === 'string' && /^\d+$/.test(v.trim())) v = Number(v.trim())
      if (!Number.isInteger(v) || v <= 0) bad(where, `recovered ${f} ${JSON.stringify(claim[f])} is not a positive integer`)
      if (f === 'claimedNight' && !nightIsStated(v, text ?? '')) {
        // §2: an unstated recovered night is STRUCK and the strike is
        // returned, so the caller records claimedNightStruck — countable,
        // never invisible (closure rerun finding 9).
        struckNight = v
        continue
      }
    }
    fields[f] = v
  }
  if (KNOWN_KINDS.has(claim.kind)) {
    validatePublishedShape({
      where,
      kind: claim.kind,
      fields: { ...fields, conditional: claim.conditional, denial: claim.denial },
    })
  }
  return { fields, publishable: KNOWN_KINDS.has(claim.kind), struckNight }
}
