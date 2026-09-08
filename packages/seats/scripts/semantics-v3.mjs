// Deterministic surface-text semantics for analysis v3.2.
// Governing document: docs/analysis/analysis-v3.2-amendment.md (§2, §10).
//
// Pure, no I/O, no LLM. Two different kinds of judgment live here, with very
// different authority, and the distinction is binding (v3.2 §10):
//
//   ENFORCED   statedNights / nightIsStated (§2) and
//              resolveConjunctionTarget (R12). These are deterministic
//              readings of the message text that the extractor and scorer
//              APPLY: an unstated night is struck, a conjunction target is
//              resolved. Both are field-level, never claim-level.
//
//   ADVISORY   the §10 bars (barFor). A bar is a machine HINT that a span may
//              not be a scorable claim of its family (a doctor-directive, a
//              specific-role denial, a non-assertion). Advisories are shown to
//              the adjudicator on the review sheet and NEVER remove, reject,
//              or re-verdict a claim by themselves — the v3.2 review of the
//              first bar implementation found the patterns over-firing on
//              affirmative compound sentences, and a regex that can delete a
//              claim from the ledger is a regex doing the adjudicator's job.
//              Only a human ruling (OK / BAD / CORRECTED) removes a claim.
//
// The regression suite asserts the advisory property directly: no advisory
// ever changes a verdict or drops a record.

export const SEMANTICS_VERSION = 'v3.2.1'

// ---------------------------------------------------------------------------
// §2 — a night number is stated, or it does not exist (ENFORCED)
// ---------------------------------------------------------------------------

const NIGHT_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
}

// Each pattern captures the night number in group 1. Nothing relative is here
// on purpose: "last night", "overnight", "tonight", "yesterday" and bare past
// tense state no number, and v3.2 never converts them (the audited failure —
// "last night" on day D resolved to night 1, corrupting five published
// verdicts: audit rows 1-5).
const NIGHT_PATTERNS = [
  /\bnights?\s*#?\s*(\d{1,2})\b/gi, // "night 2", "Night #2", "nights 2"
  /\bn\s?(\d{1,2})\b/gi, // "N2", "n 2" — the shorthand the table actually uses
  /\b(\d{1,2})\s*(?:st|nd|rd|th)\s+night\b/gi, // "2nd night"
]
const NIGHT_WORD_PATTERN = new RegExp(`\\bnights?\\s+(${Object.keys(NIGHT_WORDS).join('|')})\\b`, 'gi')

/**
 * Every night number the text LITERALLY states, ascending and deduplicated.
 * A `claimedNight` outside this set was inferred, not stated, and v3.2 strikes
 * it (§2).
 */
export function statedNights(text) {
  if (typeof text !== 'string' || text.length === 0) return []
  const found = new Set()
  for (const re of NIGHT_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const n = Number(m[1])
      if (Number.isInteger(n) && n > 0) found.add(n)
    }
  }
  for (const m of text.matchAll(NIGHT_WORD_PATTERN)) found.add(NIGHT_WORDS[m[1].toLowerCase()])
  return [...found].sort((a, b) => a - b)
}

/**
 * §2: is this claimedNight admissible against the message that carries it?
 * The value must be an INTEGER night: R15 compares with strict equality, so a
 * string "2" that slipped in through a hand-filled correction would validate
 * here and then match no record — a true claim published false. Reject the
 * type here instead of laundering it through Number().
 */
export function nightIsStated(claimedNight, text) {
  if (claimedNight === undefined || claimedNight === null) return true
  if (!Number.isInteger(claimedNight)) return false
  return statedNights(text).includes(claimedNight)
}

// ---------------------------------------------------------------------------
// §10 — admissibility advisories (ADVISORY — sheet hints, never enforcement)
// ---------------------------------------------------------------------------

// R10: a protect ACTION by the speaker. Telling, asking, or urging the doctor
// to cover someone is a directive to another seat, not a protection the
// speaker performed — PF-2's own line, and audit row 7 ("I'm the one who
// publicly told the doctor to cover Sam", scored false while the real doctor
// did protect Sam). The directive verb must GOVERN the doctor (adjacent
// object) — a loose same-clause window fired on "I needed to save Sam so I
// covered him as doc" and "Doctor here, I must say I protected Liv".
const DOCTOR_DIRECTIVE = [
  /\b(?:told|telling|tell|asked|asking|ask|urged|urging|urge|begged|advised|advising|advise)\s+(?:the\s+)?doc(?:tor)?\b/i,
  /\b(?:want|wanted|need|needed)\s+(?:the\s+)?doc(?:tor)?\s+to\b/i,
  /\b(?:the\s+)?doc(?:tor)?\s+(?:should|needs\s+to|must|has\s+to|ought\s+to|please)\b/i,
  /\b(?:doc|doctor)\s*[,:]\s*(?:cover|protect|save|guard)\b/i,
]

/** R10 advisory: the span directs the doctor rather than asserting a protect. */
export function isDoctorDirective(text) {
  if (typeof text !== 'string') return false
  return DOCTOR_DIRECTIVE.some((re) => re.test(text))
}

// R11: a denial of a SPECIFIC role is neither a role_claim nor a
// not_mafia_claim, and truthful denials must never be scorable false. Audit
// rows 12 ("No power role here.") and 18 ("I'm not claiming a power role").
// The denial must bind to the role WITHIN a clause: the windows exclude
// clause punctuation (, ; :) so "I'm not lying, I'm the doctor" — an
// affirmative role claim — does not trip on the earlier "I'm not".
const SPECIFIC_ROLES = 'doctor|detective|villager|cop|seer|medic|power[\\s-]?role'
const ROLE_DENIAL = [
  new RegExp(`\\b(?:i(?:'m| am)?\\s+not|i\\s+ain'?t|im\\s+not)\\b[^.!?,;:]{0,30}\\b(?:${SPECIFIC_ROLES})\\b`, 'i'),
  new RegExp(`\\b(?:no|not\\s+a|never\\s+(?:been|was))\\s+(?:${SPECIFIC_ROLES})\\b[^.!?,;:]{0,20}\\bhere\\b`, 'i'),
  new RegExp(`\\bno\\s+(?:${SPECIFIC_ROLES})\\s+here\\b`, 'i'),
  new RegExp(`\\bi(?:'m| am)?\\s+not\\s+claiming\\b[^.!?,;:]{0,30}\\b(?:${SPECIFIC_ROLES})\\b`, 'i'),
  new RegExp(`\\bi\\s+(?:don'?t|do not|never)\\s+(?:have|hold|claim)\\b[^.!?,;:]{0,20}\\b(?:${SPECIFIC_ROLES})\\b`, 'i'),
]

/** R11 advisory: the span denies a specific role rather than asserting one. */
export function isSpecificRoleDenial(text) {
  if (typeof text !== 'string') return false
  return ROLE_DENIAL.some((re) => re.test(text))
}

// §2/§2.1: a claim is a checkable FIRST-PERSON assertion by the speaker about
// the speaker. Conditionals, counterfactuals, third-person generalisations and
// pure hypotheticals are none of those. Audit rows 9, 10, 11, 13-17.
const CONDITIONAL = [
  /^\s*if\b/i,
  /\bif\s+(?:i|we)\s+(?:were|was|am|'m|had|were\s+to)\b/i,
  /\bwere\s+(?:i|we)\s+\b/i,
  /\b(?:would'?ve|would\s+have|wouldn'?t\s+have|would\s+not\s+have)\b/i,
  /\bsuppose\s+(?:i|we)\b/i,
  /\bhypothetically\b/i,
]
const FIRST_PERSON_SUBJECT = /\b(?:i|i'?m|i'?ve|i'?ll|i'?d|me|my|myself|we|we'?re|our)\b/i

/**
 * §2 advisory: the span makes no first-person assertion about the speaker.
 * Conservative by construction, in this order: a conditional stays flagged
 * even with a first-person subject ("If I'm town, …" asserts neither branch);
 * otherwise ANY plain first-person subject clears the span, wherever it sits —
 * "Town read on me is right, I'm not mafia" is a first-person assertion even
 * though it opens with "Town". A span with no first-person subject at all
 * ("That's town play.", "Mafia in a 9-1 town flip stay quiet") is flagged —
 * this one check subsumes the v3.2.0 third-person pattern list, whose
 * subject-first ordering and case-folded name pattern both over-fired.
 */
export function isNonAssertion(text) {
  if (typeof text !== 'string' || text.trim() === '') return true
  if (CONDITIONAL.some((re) => re.test(text))) return true
  return !FIRST_PERSON_SUBJECT.test(text)
}

/**
 * The advisory a span of this kind raises, or null. `quote` is the stored R19
 * span — the span IS the claim, so advisories read it and nothing else.
 *
 * Scope: the non-assertion advisory is raised for not_mafia_claim only. The
 * codebook's own qualifying forms — R21 roster headers ("Dylan, seat-8.
 * Villager."), R10's protection-log form ("N2: Josie"), R9's night-numbered
 * result ("Night 2 result: Bryan") — carry no first-person pronoun and are
 * genuine claims of the other families; an advisory that flagged all of them
 * would bury the sheet in noise. (Audit row 8 was an investigation_claim
 * non-assertion; as an ADVISORY miss, not an enforcement miss, that trade
 * costs rater attention on one family, never a verdict.)
 */
export function barFor(kind, { quote } = {}) {
  const span = typeof quote === 'string' ? quote : ''
  // Conservative: with no span to read, there is no surface evidence and no
  // advisory. An advisory never rests on absent text.
  if (span.trim() === '') return null
  if (kind === 'protection_claim' && isDoctorDirective(span)) return 'doctor-directive'
  if (kind === 'not_mafia_claim' || kind === 'role_claim') {
    if (isSpecificRoleDenial(span)) return 'specific-role-denial'
  }
  if (kind === 'not_mafia_claim' && isNonAssertion(span)) return 'non-assertion'
  return null
}

export const BAR_REASONS = {
  'doctor-directive': 'R10 advisory: may direct the doctor rather than assert a protect action by the speaker (v3.2 §10)',
  'specific-role-denial': 'R11 advisory: may deny a specific role rather than assert one — truthful denials are never scorable false (v3.2 §10)',
  'non-assertion': '§2 advisory: may be conditional, counterfactual, or third-person rather than a first-person assertion (v3.2 §10)',
}

// ---------------------------------------------------------------------------
// §10 — conjunction target resolution (R12, ENFORCED)
// ---------------------------------------------------------------------------

// "Confirmed town: me and Bryan (N2 clear)." — the investigation target is
// Bryan, not the speaker: the engine makes a detective self-investigation
// illegal (legal.ts:62), so a self-resolved target is a misresolution, not a
// false claim (audit row 6).
const CONJUNCTION = [
  /\b(?:me|myself|i)\s+(?:and|&|\+)\s+([A-Za-z][A-Za-z0-9_-]*)/i,
  /\b([A-Za-z][A-Za-z0-9_-]*)\s+(?:and|&|\+)\s+(?:me|myself|i)\b/i,
]

/**
 * R12: resolve a conjunctive subject that includes the speaker to the OTHER
 * named seat. `resolve(raw)` is the caller's seat resolver (scoring-v3's
 * resolveTarget bound to that game's facts). Returns a seat id or null; never
 * returns the speaker's own seat.
 */
export function resolveConjunctionTarget(text, speakerSeat, resolve) {
  if (typeof text !== 'string') return null
  for (const re of CONJUNCTION) {
    const m = text.match(re)
    if (!m) continue
    const seat = resolve(m[1])
    if (seat && seat !== speakerSeat) return seat
  }
  return null
}
