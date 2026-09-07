# Analysis v3.2 — amendment to the frozen v3.1 specification

**Status: adopted (pre-drafting), post-PF-2 human sitting and pre-final
ledger rebuild.** This document amends
`docs/analysis/analysis-v3-spec.md` (v3.1, FROZEN 2026-08-25) and
`docs/analysis/amendments/PF-2.md`. It is a *separate* file for the same reason
PF-2 is: the v3.1 spec's sha256 is pinned in the analysis manifest and binds
every archived instrument reading, so editing that file would orphan them.

**Spec-is-law.** The v3.1 file stays byte-identical. Its sha256 at the time this
amendment was written is

```
edbd93790ce40c96ab33de0557c1bf1d37040d2ab2b7728aee598080f1dd9f20  docs/analysis/analysis-v3-spec.md
```

and `scripts/check-semantic-gates.mjs` (gate S1) fails the acceptance check if
those bytes ever change. Everything below is stated as a delta against v3.1; a
rule not named here is unchanged and still binding.

**Cause.** A row-level audit of our own published v3.1 ledger
([`audits/false-label-audit-2026-08-29.md`](audits/false-label-audit-2026-08-29.md),
20 confirmed-invalid false labels out of 171) found five protocol defects, none
of them in the deterministic scorer: the scorer behaved correctly given its
inputs, and the inputs were built wrong. This amendment fixes the record
construction, the adjudication vocabulary, and two statistical definitions the
same audit reached. It does **not** re-adjudicate: rebuilding the ledger under
v3.2 is a separate, author-performed step, and every ledger-dependent number
stays quarantined until it happens.

**Versions.** `EXTRACTOR_VERSION` v3.1.0 → **v3.2.1**; `EVALUATOR_VERSION`
v3.1.0 → **v3.2.3** (v3.2.1 initial amendment, v3.2.2 closure fixes,
v3.2.3 claim-unit alignment). Both feed the content-addressed cache key and the
manifest, so readings under different semantics can never be mistaken for, or
silently overwrite, one another. The v3.1 publication artifact is
**superseded, not overwritten**.

**Revision v3.2.1** (2026-08-31). The first v3.2 implementation was itself
reviewed at high effort before merge, and 15 confirmed findings changed this
amendment in three load-bearing ways, disclosed here rather than absorbed
silently: (i) the §10 "bars" are **advisories, never enforcement** — the
enforced version's patterns over-fired and silently deleted legitimate claims;
(ii) there is **no v3.1 compatibility path in v3.2 code** — the "byte-for-byte
v3.1 branch" claim was false at every upstream stage, so archived v3.1
artifacts regenerate at the manifest-pinned code commit instead; (iii) the
gates were hardened from label-checks to **evidence-checks** (G5 recomputes the
§8 floors; S4 recomputes §2 from the committed logs; S8 audits a recorded
denominator, not a constant).

**Revision v3.2.2** (2026-08-31, the closure pass). A second independent review
of v3.2.1 found the §8 protocol measuring error without ever CLOSING it, and
several bindings still count-shaped. v3.2.2 adds: (i) the **closure loop** —
§8 rulings APPLY to the confirmed-input layer (`apply-review-rulings.mjs`), the
ledger is rebuilt and rescored, and gate S10 keeps the loop open until every
false row carries an adjudication; (ii) **hash-and-identity binding** across
provisional ledger → packet → rulings → final ledger (never counts);
(iii) Tier L publishability **derived** from validated counts and the frozen
Wilson floor at every consumer — a stored boolean is never trusted;
(iv) omission scrubbed from **every** publication surface including embedded
statistics and rendered HTML, with an end-to-end absence test; (v) machine
advisories **hidden until after the author's first-pass ruling**, and the
model cross-check implemented rather than promised; (vi) correction handling
fully fail-closed (effective-kind required fields, `role` correctable,
recovered-claim validation, deletion tombstones preserved, unknown kinds fail
loudly). `REVIEW_PACKET_VERSION` → v3.2.2.

**Revision v3.2.3** (2026-08-31, the focused pass after the third external
review). Ten items, all accepted — two reversing earlier positions, said
plainly: (i) machine-error metrics use the author's **final** adjudications of
the frozen provisional rows (the better truth estimate; closure cannot inflate
it), with the first-pass rulings published beside them as the **unaided-author
metric** — reversing v3.2.2's first-pass-only stance; (ii) the "independent
rerun" of v3.2.2 is relabeled a **same-model adversarial pass** with its raw
artifact and method preserved (`audits/v3.2.2-rerun-review.md`) —
"independent" is reserved for the external review. Also: mandatory ratings
metadata (absence rejected like mismatch); complete model cross-check with
typed, normalized disagreement comparison and a method-identified artifact;
`--confirmed`↔provisional-ledger lineage binding; composed repeated
corrections with `priorRules`; later census packets take only unruled false
rows; omission scrub covers the hoisted `sections.ballotAccuracy`; scan-arm
overlap exclusion, constituent-aware claim keys, empty-quote and role-enum
validation; and a full-chain e2e that exercises the REAL G5 — which
immediately caught a silently-failed import that would have crashed G5 on any
real publication. `REVIEW_PACKET_VERSION` → v3.2.3;
`EVALUATOR_VERSION` unchanged (no scorer behavior change).

**Revision v3.2.4** (2026-09-01, the pre-sitting pass). A further review of
the adjudication-phase artifacts, before the author's PF-2 sitting, found
interface and binding gaps in PF-2 and evidence gaps in §8/publication.
v3.2.4 adds: (i) the PF-2 CORRECTED interface offers `role` and collects
resolvingContext as `{seq, byte-exact text}`; a generated ratings schema and
a harmless example ship beside the packet; (ii) PF-2 ratings bind by
packet-key sha256, seed, interface version (`PF2_PACKET_VERSION`, in the
shared validation module), and the complete item identity set — missing,
reordered, substituted, or partial packet lineage is refused; (iii) a PF-2
provenance manifest content-addresses every sitting input, and the sitting is
described as **item-level blind, not prior-free**: the author saw aggregate
family-level sensitivity results before rating, and that disclosure travels
with the published validation summary; (iv) the §8 scan arm samples from the
exact ledger cohort, the complete sampling frame (cohort, games, log hashes,
seed, selected ids) is sealed in the packet key, and a rater-listed claim the
provisional ledger already carries **never counts as a miss** — the statistic
is labeled **message-level omission incidence**, never claim-level recall,
with claim-level counts published beside it; (v) the publication binds to
closure-chain position 0 plus one summary per closure iteration (an empty or
partial later packet can never substitute), verifies the initial census
equals the provisional ledger's false rows exactly (closing the n=0 bypass),
embeds and hash-binds `crossCheck`, `unaidedFirstPass`, the disagreement
resolutions, and the model cross-check artifact, and gate G5 validates the
whole §8 evidence block, not only the legacy negative sample; (vi) ambiguous
rows are disclosed beside the totals and excluded from quantitative totals;
per-model family falsity rates do not publish (author-adjudicated counts and
receipts only); the report-conditioned investigation strata are classified
Tier L and leave with an omitted investigation_claim, as does
`ledgerConfirmedClaims`; (vii) the §8 first-pass/final contradiction in this
document's body is corrected in place (the amendment log keeps the history).
`REVIEW_PACKET_VERSION` → v3.2.4; `EVALUATOR_VERSION` unchanged.

**Revision v3.2.5** (2026-09-01, the minimal pre-sitting patch). Two required
fixes and one scope decision. Fixes: (i) **every recall-miss packet item
binds to ONE exact claim** — the key row seals a unique claimId (message id +
index in the ratings file) and the complete normalized claim (fields plus
byte-exact quote and span offset; `recallClaimFingerprint`, one definition on
both ends of the contract). The merge refuses a changed, reordered, removed,
or substituted claim; one ruling can never fan out across a message's other
claims; a second claim on the same message can never overwrite the first
ruling; a ruled miss with the negatives files withheld is refused, never
silently dropped; and recovered records carry the unique claimId as their
item id. (ii) **A CORRECTED ruling on a recall-miss item now APPLIES**: the
human's corrected proposition is validated against the recovered base record
(shared correction-validation contract) and stored as the `corrected` block
the scorer reads — previously the human's fix was silently discarded and the
rater-listed fields recovered unchanged. `PF2_PACKET_VERSION` → pf2-v3.2.5;
dispute/audit key rows, item order, and the rater-facing sheet are unchanged
byte-for-byte.

**Revision v3.2.6** (2026-09-02, the author-ruling finalization). This revision
freezes a distinction the author required before the sealed key or model
cross-check was opened: (i) R20 remains an **utterance-level extraction rule**,
so a later message that genuinely repeats a claim remains a valid, auditable
claim receipt; (ii) paper-facing Tier L totals use an **underlying-proposition
count range** as their primary unit, so an exactly linked repeat does not create
a second proposition while an uncertain action link is not silently guessed.
The deterministic `claim-proposition-v1` mapping preserves both range endpoints
and every receipt; statistics and publication recompute it from the
corrected ledger, and gate G13 recomputes it again from the published receipts
and hash-verified logs. This revision also closes the correction contract over
the exact allowed field shape of each published family and preserves the human
rating chain as three separately hashed rating layers—untouched first pass,
human-ratified clarification overlay, and deterministically rebuilt final
ratings—plus the approval record and this v3.2.6 methodology addendum.
`EVALUATOR_VERSION` advances v3.2.2 → **v3.2.3** because R17 duplicate
comparison now uses the same conjunction-repaired target as truth scoring,
quote and offset move atomically when merged, and semantic message lookups are
public-only. Those changes can alter a rebuilt ledger and therefore cannot
share a version with the earlier scorer. `EXTRACTOR_VERSION` and
`PF2_PACKET_VERSION` are unchanged: no message was re-extracted and no packet
item or key changed.

**Paper scope for the exploratory campaign's v1 paper (decided 2026-09-01):**
the machinery stays in the code, but v1 does **not** run the second §8 human
sitting and publishes **no** general recall/omission-rate estimate. The six
recall-miss items are **targeted cleanup** — candidate claims recovered and
human-adjudicated one at a time — never a statistical recall sample.
Engine-derived results remain the quantitative core; semantic
(ledger-derived) results are labeled **exploratory, author-adjudicated, and
potentially incomplete**.

**Timing and independence of this decision.** The author completed the packet
without opening the sealed key or the item-level model rulings; roles, outcomes,
and ledger verdicts were absent from the rating interface. However, aggregate
model-rating summaries by family had been shown before the sitting, so this is
explicitly **item-level blind, not prior-free** and is not represented as an
independent human rating. The original submission remains byte-for-byte
preserved. The clarification is a codebook-consistency pass with an explicit
machine-readable overlay bound to the original submission and packet-key hash.

---

## 1. Classifier fields are authoritative

**v3.1 defect.** `extract-v3.mjs` merged fields as
`{ ...candidate.fields, ...machine.fields }`, and `definedFields()` dropped
`null`/`''` before the spread. Two consequences, both audited:

- **Omission was indistinguishable from agreement.** A classifier that did not
  emit `claimedNight` left the candidate's `claimedNight` standing, and the
  candidate side includes the *recycled v2 ledger* — a different evaluator's
  output. This is the sweep1-39 mechanism (audit row 4): `claimedNight=1` was
  absent from `machine.fields` and present in the derived record, and the
  deterministic R15 night guard then scored a true claim false.
- **Deletion was unrepresentable.** A classifier that judged a candidate field
  wrong had no way to say so; `null` was silently discarded.

**v3.2 rule.** The classifier's `fields` object is the **complete and
authoritative** field set for a classified candidate.

- A field the classifier **omits** is **deleted**. Any candidate value for that
  field is dropped and never reaches the record.
- A field the classifier emits as `null` or `""` is an **explicit deletion** —
  the same outcome, recorded distinctly so the two are separable in audit.
- A field the classifier emits with a value is that field's value, whatever the
  candidate said. This is a **correction**, recorded as such.
- **The candidate-fill spread merge is retired.** Candidate fields are a
  *hint to the classifier*, never a fallback in the record.
- Every dropped candidate value is written to an **audit trail** on the record:
  `fieldAudit: [{ field, candidateValue, reason }]`, with `reason` one of
  `classifier-omitted`, `classifier-deleted`, `classifier-corrected`, or
  `unstated-night` (§2).
- The post-classification dedupe merges two records **only when their field
  sets are identical** (same defined fields, same values). The v3.2.0 dedupe
  re-filled missing fields from sibling records — a second candidate-fill
  merge that produced archived readings inconsistent with their own
  `machine.fields` and re-supplied nights §2 had struck (review finding 5).
  Records that agree only partially stay separate readings; the scorer's R17
  merge still enforces one-proposition-once.

Because required fields are extraction-time (R13, unchanged), an authoritative
classifier that omits a required field now yields a **logged reject**, not a
record carrying a recycled value. That is the intended direction: v3.2 fails
toward *no claim*, never toward an unsupported one.

## 2. `claimedNight` only when a night number is literally stated

**v3.1 defect.** The classifier converted relative temporal language into a
night number. On day D, "last night" was resolved to night **1** rather than
night D. The resolver is accidentally correct on day 1 and wrong on every later
day, and it is inconsistent with itself (audit §A internal controls: sweep1-19
seq 176, day 2 → `claimedNight=2`).

**Audited damage.** Five published verdicts corrupted (audit rows 1, 2, 3, 4,
5 — four from classification, one from the §1 merge). Each was a *true* claim
scored `false` by the R15 night guard against a real logged action. Example
(audit row 1, sweep1-2 seq 181): seat-1 Josie, the real detective, said "I
investigated Liv last night: NOT MAFIA." on day 2; the real investigation is at
seq 148/157, **night 2**; the record carried `claimedNight=1`; verdict `false`.

**v3.2 rule.** `claimedNight` is populated **only when the message literally
states a night number**. Relative language never converts — not "last night",
"overnight", "tonight", "yesterday", "the other night", nor a bare past tense.
When no night is literally stated the field is absent, and R15 falls back to its
seq guard alone (`record.seq < claim.seq`), which is permissive and correct.

"Literally stated" is deterministic, implemented as
`statedNights(text)` in `packages/seats/scripts/semantics-v3.mjs`:

| form | example | admissible night |
|---|---|---|
| `night <n>` / `nights <n>` / `night #<n>` | "Night 2 result: Bryan" | 2 |
| `n<n>` token | "me and Bryan (N2 clear)" | 2 |
| `<n>(st\|nd\|rd\|th) night` | "on the 2nd night" | 2 |
| `night <word>` for one–ten | "night two" | 2 |

A `claimedNight` not in `statedNights(source message)` is **struck**: the field
is removed, the claim is scored without it, and the strike is recorded
(`claimedNightStruck`) so it is countable rather than invisible. The same rule
applies at every stage that can introduce the field — classification (§1),
miss-recovery (§3), and CORRECTED rulings (§3) — and the scorer enforces it as a
belt against its own inputs, spanning message text to record level. Strikes are
normal, counted operation. Gate S4 **recomputes** the rule from the committed
logs: for every published record carrying a `claimedNight`, the source message
must literally state that night — evidence, not a flag.

The identical discipline governs `referencedDay` for the shelved vote families.

## 3. Adjudication outcomes: OK / BAD / **CORRECTED**

**v3.1 defect.** Adjudication was binary — accept or reject the whole row. A
rater who could see that the fields were wrong but the claim was genuine had
nothing to reach for. Audit rows 2–5 were visible to the sensitivity reviewer
with message and fields on the sheet: the unsupported night number was
detectable in principle, and correction was unlikely in practice because the
protocol had no outcome for it.

**v3.2 rule.** Every adjudication ruling is one of:

- **OK** — a genuine claim of that kind with those fields, asserted in this
  message. Unchanged.
- **BAD** — not a claim of that kind, or not asserted here. The record never
  enters the ledger. Unchanged.
- **CORRECTED** — a genuine claim whose *fields* are wrong. The ruling stores
  the corrected proposition and the record enters the ledger under it.

A CORRECTED ruling stores, on the record, a `corrected` block:

```
corrected: {
  kind?, target?, result?, claimedNight?, quote?, resolvingContext?,
  rule,            // the exact codebook rule the correction cites (required)
  note?,           // free text
  replaced: { …the pre-correction values of every field the ruling changes… }
}
```

- Any of `kind`, `role`, `target`, `result`, `claimedNight`, `quote`, or
  `resolvingContext` may be corrected.
  `claimedNight: null` — or the sheet mark **`-`**, which the merge normalizes
  to `null` — is an **explicit strike** of an unstated night, the fix for audit
  rows 1–5. (The v3.2.0 merge documented `-` on the sheet and handled only
  `null`, so the literal string entered records: review finding 12.)
- Every corrected value is **type-validated fail-closed** at merge time:
  `claimedNight` must be a positive integer (a numeric string is coerced, then
  checked — the v3.2.0 path let a hand-filled `"2"` validate through `Number()`
  and then fail R15's strict equality, publishing a true claim as false:
  review finding 11); `kind` must be a published family; `result` must be
  `mafia`/`not mafia`.
- A corrected `quote` is **R19-validated like any receipt**: it must be a
  byte-exact substring of the source message, its offset (`corrected.charStart`)
  is recomputed and stored, the scorer moves `charStart` with the quote, and
  `build-ledger` re-verifies the corrected pair before scoring. A quote may
  never be struck — a claim with no span is not a receipt; rule BAD instead.
  (The v3.2.0 path validated corrected quotes nowhere: review finding 3.)
- `rule` is **required**: every ruling cites the codebook rule it applies. This
  is the discipline that would have caught the v3.1 boundary drift, where 15 of
  the 20 invalid rows entered through unpinned human overturns of reviewer
  rejections (12 of them at the assertion-strength / family-eligibility
  boundary, per the audit table).
- **(v3.2.2)** The EFFECTIVE proposition must be checkable: a kind-correction
  travels with the new kind's R13-required fields (`role` is correctable for
  exactly this reason) or is refused at merge time, never discovered as
  `ambiguous` downstream. Recovered claims are validated the same way — an
  unknown kind is a typo that fails loudly, never a silent drop. All of this
  lives in one shared module (`scripts/correction-validation.mjs`) used by
  every sitting flow, so the write half and the read half of the correction
  contract cannot drift.
- **(v3.2.6)** Required fields are not enough: each published family has an
  exact semantic shape. `role_claim` permits `role` only;
  `not_mafia_claim` has no family-specific field; `investigation_claim`
  requires `target` + `result` and optionally permits `claimedNight`;
  `protection_claim` requires `target` and optionally permits `claimedNight`.
  Quote and validated resolving context remain provenance, not proposition
  fields. A kind change must explicitly strike fields forbidden in the new
  family; stale fields, unknown correction keys, `referencedDay`, `conditional`,
  or `denial` on a published record fail closed. Recovered claims pass the same
  exact-shape validator.
- `replaced` preserves what the machine said, so no correction is silent.

**Corrections reach the scorer.** The correction is applied **inside**
`scoring-v3.mjs` (`applyCorrection`, called by `scoreGame` before R17 merging),
not by an upstream stage that could forget to. There is exactly one place a
correction is applied, and it is the deterministic layer that computes the
verdict. A `corrected` block on a ledger record is therefore, by construction,
the proposition that was scored.

**`resolvingContext` provenance is validated.** R12b lets the speaker's own
prior public messages resolve *fields* — never the existence of an assertion.
v3.1 recorded the resolving seq and text but verified neither. v3.2 requires,
and `merge-packet-rulings.mjs` enforces, all four of:

1. `resolvingContext.seq < record.seq` — strictly earlier;
2. the event at that seq is a **public** `message_sent`;
3. its actor is the **same speaker** as the record's seat;
4. `resolvingContext.text` is a **byte-exact substring** of that message.

Any failure is a hard error, not a warning.

One archived v3.2.1 machine reading omitted a space beside an em dash inside
otherwise verbatim `resolvingContext.text`. After the raw reading passes the
projection check, `build-ledger` may repair a **machine-produced** context to
the unique whitespace-formatting-equivalent substring in the already
hash-verified public message. The ledger records the before/after bytes under
`provenanceRepairs` and counts the repair in metadata. This narrow repair does
not apply to human corrections, changed words or punctuation, non-unique
matches, private messages, wrong speakers, or later messages; those remain
hard errors. The repair changes no claim family, semantic field, human ruling,
or truth verdict.

### Claim receipts and proposition-count ranges (v3.2.6)

R20 answers an extraction question: **did this public message make the claim?**
It does not answer the statistical question: **is this a new underlying claim?**
The ledger therefore preserves two explicit units:

1. A **public claim utterance receipt** is one post-R17 ledger record tied to a
   byte-exact span in one message. A genuine reassertion later in the game is
   still an OK receipt and remains auditable.
2. An **underlying-proposition count range** is the paper's primary Tier L
   counting unit. An exactly linked later receipt does not increment either
   endpoint. When action wording does not identify enough event information to
   decide whether it is a repeat, the lower endpoint allows the link and the
   upper endpoint keeps the receipt separate. The publication reports both as
   “L–U underlying propositions (M exact utterance receipts).” Receipts are not
   described as independent observations.

The content-addressed mapping is versioned `claim-proposition-v1` and runs only
after corrections and truth scoring. Identity is deterministic:

- role and self-alignment state claims group only within the same game and
  speaker; the claimed role remains part of a role proposition. Because roles
  are fixed, an exact state restatement has an exact identity;
- investigation propositions include game, speaker, resolved target, result,
  and event identity; protection propositions include game, speaker, resolved
  target, and event identity;
- event identity uses a literally stated night. A generic `resolvingContext`
  proves only how a field was resolved (for example, what “him” means); it is
  provenance, not evidence that two utterances describe the same action.
  Without a literal night—or when the target cannot be resolved—the link is
  only partially identified: compatible wildcard readings form the conservative
  lower endpoint, while each unresolved/nightless action receipt remains
  separate at the upper endpoint. Matching target/result alone is not enough to
  force a reiteration, because it could describe a genuinely new action. The
  artifact publishes linkage-basis counts and keeps every receipt;
- a different game, speaker, resolved target, result, or concrete night remains
  a different proposition. A grouped sentence naming Dylan, Sam, and Liv
  therefore contributes one proposition per named target, not one per sentence;
- truth is assertion-time-indexed for action claims. A premature explicit N3
  report and the same N3 report after the action occurs are distinct even when
  their other fields match. Exact state claims cannot change truth; mixed
  verdicts on one fixed-role state proposition fail closed. Contradictory
  results for the same event remain separate and are flagged.

Concrete example: “N1: Dylan is not mafia” and a later message that restates
that N1 result are **one proposition and two receipts**. A genuinely new N3
investigation of Dylan that identifies N3 is a different event and therefore a
different claim. If the text and validated context distinguish no event, the
artifact publishes a range that covers both “repeat” and “new event” rather
than choosing one.

The mapping also reports ambiguous receipts separately. An ambiguous action
receipt may later resolve to a proposition already represented in the
true/false subset, so the ambiguous and truth-resolved **lower endpoints are
not added**. Paper-facing quantitative totals use the truth-resolved range;
ambiguous ranges and receipts are disclosed beside it, not folded into it.

The §8 validation arms and retained-precision threshold remain explicitly
**receipt-level**: they test whether extracted utterance records are valid. They
are not relabeled as proposition-level precision. The final proposition-count
ranges are separately described as exploratory and author-adjudicated.

**Miss-recovery carries the temporal fields.** The §6.2 negative-sample recovery
path in `merge-packet-rulings.mjs` built ledger candidates from `kind`, `role`,
`target`, `result` only, dropping `claimedNight` and `referencedDay`. A
recovered claim was therefore *structurally* incapable of carrying a night, and
silently scored under the permissive seq-only guard. v3.2 carries
`claimedNight` and `referencedDay` through recovery, under the §2 stated-night
rule, and records `machine.fields` honestly for the recovered record.

## 4. Ledger records are byte-faithful projections of archived readings

**v3.1 defect.** Audit row 4's `claimedNight=1` existed **only in the derived
record**. Nothing in the pipeline compared the ledger to the archived instrument
reading it was supposed to project, so a field injected by a downstream stage
was indistinguishable from a field the instrument produced. Call this the
**downstream-injection class**; sweep1-39 is its confirmed instance.

**v3.2 rule.** Every ledger record must be a **byte-faithful projection** of the
archived instrument reading it derives from, plus explicitly recorded rulings.
Readings are looked up by `(seed, seq, kind)` **plus a scoring-field
fingerprint**, because one message can legitimately carry two same-kind claims
("I checked Bryan — mafia. Also cleared Sam.") and a bare key made the last
reading win, hard-failing the other record on faithful data (review finding 6).
For every scoring field on a ledger record — including `seat` (which selects
the entire ground-truth comparison, R18) and `denial` (which flips a gradeable
claim to RECORDED, R11); both were invisible to the v3.2.0 check (review
finding 14) — the value must be traceable to exactly one of:

- the archived reading's `machine.fields` (a classifier field, §1);
- a `corrected.<field>` from a stored CORRECTED ruling (§3);
- a recorded human recovery: a miss-recovery whose provenance is the
  negative-sample reading, or a machine-REJECTED candidate the adjudicator
  upheld (§6.1) — for those, the human ruling over the fields shown on the
  sheet is the provenance. (The reject reshape now carries `seat` through the
  sealed key; the v3.2.0 reshape dropped it, which silently discarded every
  upheld reject as unscorable — review finding 7.)

A field present on the ledger record and absent from all three is a downstream
injection and **fails the run** (`projectionErrors()` in
`packages/seats/scripts/ledger-projection-v3.mjs`; enforced by
`build-ledger.mjs` under `--extract`, and by gate S7). Values are compared by
bytes after target-spelling normalization only — the one normalization R12
already sanctions.

## 5. Two named vote-chance baselines; neither is "exact chance"

**v3.1 defect.** `opportunity-table.mjs` emitted one field, `chance`, described
in §4 of the spec as "exact: living legal mafia ÷ legal non-self targets". It is
not exact, in two independent ways:

- the engine (`packages/engine/src/legal.ts:74`,
  `{ type: 'vote', targets: livingIds(state), allowNullTarget: true }`) makes a
  **self-vote legal**, so the legal-target set is every living seat, self
  included — while the denominator excluded the voter;
- "chance" presumes a target-selection policy, and no policy was stated.

**v3.2 rule.** The table emits **two** baselines per town-ballot row, each named
for the policy it assumes, and the word "exact" is retired:

| field | policy assumption |
|---|---|
| `chanceUniformOverLegalTargets` | uniform over **all legal vote targets, self included** — the engine's actual legal set. `livingMafia ÷ livingSeats` |
| `chanceUniformOverLivingNonSelf` | uniform over **living non-self targets** — the policy a voter who never self-votes would follow. `livingMafia ÷ (livingSeats − 1)` |

Neither may be called "exact chance", in code, in output, or in prose. Both are
policy baselines and are always reported with their assumption named. Excess is
reported separately against each. `legalTargets` is **unchanged**: it was
already correct (every living seat, self included), and the pinned test
asserting so stands.

The v3.1 `chance` field is **retained as a deprecated alias** of
`chanceUniformOverLivingNonSelf` — archived v3.1 opportunity tables carry it and
must stay readable — and is marked deprecated in the table's meta line. Nothing
in the v3.2 statistics path reads it.

## 6. Report strata: both truthful result types, and a rename

**v3.1 defect.** `stats-v3.mjs` built its detective-report strata from
ledger-confirmed true investigation claims **with `result === 'mafia'` only**.
A truthful "not mafia" clear is equally a public verified investigation result
and equally changes what the table knows; dropping it (74 of 123 truthful
reports, per the outline) inflated the "before any report" stratum with ballots
cast after a real public clear.

**v3.2 rule.** `reportsBySeed` admits **both** truthful result types, `mafia`
and `not mafia`. The stratum is renamed:

| v3.1 name | v3.2 name |
|---|---|
| `pre-any-public-detective-report` / `preAnyPublicDetectiveReport` | **`before any public verified investigation result`** / `beforeAnyPublicVerifiedInvestigationResult` |
| `target-not-publicly-reported` / `targetNotPubliclyReported` | `targetNotPubliclyReported` (unchanged name; both result types now feed it) |

The stratum name must never be read as "before evidence exists": votes,
discussion, and deaths are already evidence, and the paper says so wherever the
stratum appears.

## 7. Detective metric: "first-time investigation targets"

**v3.1 defect.** The metric was named "non-redundancy" and computed as
`!previouslyCheckedByThisDetective && targetNotReported(row)`. The second
conjunct is **logically vacuous** given this ruleset.

**The vacuity argument.** There is exactly one detective per game and roles are
fixed. `targetNotReported(row)` is false only when some *confirmed true* public
detective report named this row's target earlier. A confirmed true report by the
game's only detective presupposes that same detective already investigated that
target on an earlier night (R15's seq guard is what makes the report true). So
`targetNotReported(row) = false ⇒ previouslyCheckedByThisDetective = true`,
i.e. `¬previouslyChecked ⇒ targetNotReported`. The conjunction therefore equals
its first conjunct, and the second removes nothing.

**v3.2 rule.** The metric is `!previouslyCheckedByThisDetective` alone, renamed
**`first-time investigation targets`** (`detectiveFirstTimeTargets` in the
statistics artifact). "Non-redundancy" is retired — it overclaimed, since a
first-time target may still be redundant on other public evidence.

Retiring a conjunct on a logical argument is not enough to publish a number.
`stats-v3.mjs` carries an **empirical vacuity assertion**: on every rebuild it
checks, over the whole opportunity table, that every investigate row with
`!previouslyCheckedByThisDetective` also satisfies `targetNotReported(row)`, and
**fails loudly** with the offending rows if the implication is ever violated.
The artifact records the evidence — `definitions.vacuity: {checked, violations}`
— and gate S8 audits `checked > 0 && violations === 0`; a bare boolean the
writer always sets would be a gate that can never fail (review: S8 was
tautological in v3.2.0). Until that assertion and the regenerated-table check
pass, the numerical value is **[pending]** and not reportable — the metric is
Tier E *conceptually*, and pending-verification *numerically*, at the same
time.

## 8. The single-author validation protocol (frozen)

Frozen here **before implementation**, exactly as approved in the v2.3 paper
outline, checklist item 4. Changing any parameter
below after data contact is itself an amendment event. Independent dual-human
validation is **deferred to the confirmatory campaign**; this is an author
feasibility decision and is disclosed as one.

**Scope — three arms, one packet.**

1. **Census** of **every** v3.2 false-labeled claim.
2. A **stratified sample of ~100 true-labeled claims**, stratified **by family
   only** — proportional with a minimum per family, oversampling protection and
   not_mafia. No over-stratification.
3. **~200 random public messages** — messages, *not* machine candidates —
   inspected for missed claims.

**One blinded review packet.** All three arms are shuffled into a single sheet.
An item shows the message, its context window, and the extracted fields —
**never** the verdict, the arm, the speaker's role, the model, or the game
outcome. Every ruling cites the exact codebook rule. Rulings are
**OK / BAD / CORRECTED** per §3. The packet is deterministic given its seed
(`scripts/build-review-packet.mjs`).

**Model-assisted cross-check.** A separate model — not of the finder/classifier
lineage — rates the same packet independently. It is **never counted as a second
human**. Author–model disagreements are flagged for author re-inspection before
rulings finalize; the disagreement count and its resolution outcomes are
published.

**Reporting labels.** The result is an **author-adjudicated reference sample**,
never an "independent human gold standard". Published quantities:

- author-census overturn rate on false-labeled claims, per family;
- author confirmation rate on the true-claim sample;
- missed-claim estimate on the 200-message sample with a Wilson interval,
  published-family scope.

**Per-family recall is not claimed where the arm contains too few positives.**
Floor: **≥10 positives**; below it, counts only, never a rate.

**Publication gate.** Tier L numbers appear for a published family only if, for
that family, the author-census overturn rate on false-labeled claims gives a
retained-precision lower bound **≥ 0.90**, and the overall published-family
missed-claim estimate is documented. **If unmet for a family: omit that family's
Tier L results** — omit, not disclose-and-publish. These thresholds are frozen
by this section.

**The gate consumes evidence, not labels.** `build-publication.mjs` REQUIRES
the unblinded validation summary (`--validation review-packet-merged.json`),
cross-checks its census against the ledger family-by-family (a census is a
census), embeds and hash-pins the summary under `honesty.validation`, removes
each gate-failing family's rows from the published totals with the omission
disclosed, and gate G5 recomputes the per-family floors from the embedded
evidence and fails if an omitted family still appears in the totals. A bare
protocol label satisfiable by a constant is exactly what the review found
(finding 10) and exactly what this closes.

**Closure (v3.2.2): rulings apply; measurement stays first-pass.** The §8
sitting is not only a measurement — its FINAL rulings (post cross-check
reconciliation) are APPLIED to the confirmed-input layer by
`scripts/apply-review-rulings.mjs`: BAD withdraws the row (counted, never
silent), CORRECTED attaches the validated corrected block, message-scan misses
become validated recovered records, and every touched record is stamped
`reviewRuling`. The ledger is then REBUILT and rescored. Rebuilding can create
new false rows (a correction flips a verdict; a recovered claim scores false);
gate S10 holds the loop open — PENDING blocks publication — until **every**
false row in the ledger carries an adjudication stamp, and the next census
packet is built over exactly the unruled rows. The machine-error MEASUREMENT
(v3.2.3, correcting the v3.2.2 sentence that previously stood here): the
published machine-error metrics use the author's **final** adjudications of
the frozen provisional rows — the census rows stay machine-produced, so
closure cannot inflate the metric — while the **first-pass rulings publish
beside them as the unaided-author metric**, never conflated. Both are
computed from the frozen initial packet rows, so closure can erase neither.

**Binding (v3.2.2): hashes and identities, never counts.** The packet key pins
the sha256 of the provisional ledger it was built from and the exact
`claimKey` of every census row; each apply step appends
`{packetKeySha256, rulingsSha256, finalRulingsSha256?, provisionalLedgerSha256,
confirmedInputSha256}` to the closure chain, which the ledger meta carries and
the publication verifies — including that the validation summary's
`rulingsSha256`/`finalRulingsSha256` match the chain's, so a summary computed
from one rulings file can never publish beside a ledger built from another.
Rulings apply to confirmed records by **exact constituent item id** (the
ledger row's `mergedItems`, carried into the packet key as
`constituentItems`): a ruling on an R17-merged proposition reaches every
record of it, and kind corrections or merged-offset drift can never misroute
a ruling. A rulings file binds to its packet by run id, packet seed, and
packet version. A same-count substituted ledger fails these checks by
construction.

**Blinding, stated precisely (v3.2.2).** The sitting is **outcome-blind and
verdict-blind**: no item shows a verdict, an arm marker, a role, a model, or a
game outcome, and **no machine advisory is shown before the author's
first-pass ruling** — an advisory on the sheet anchors the ruling it exists to
check. Advisories live in the sealed key and surface only in the cross-check
reconciliation. The message-scan arm is structurally distinct by necessity (it
shows no fields — the rater is finding claims, not confirming one); the
process is model-assisted by design and is never described as more blind than
this paragraph states.

**Publishability is derived, never stored (v3.2.2).** Every consumer — the
merge summary, the publication assembler, gate G5 — derives a family's Tier L
publishability from the validated `{n, upheld}` counts and the frozen Wilson
floor (`scripts/publication-omission.mjs`). A stored `tierLPublishable` flag
is checked for consistency and never trusted. An omitted family is removed
from **every** publication surface — the ledger section, the embedded
statistics (`models[].ledgerFamilies`), and the rendered page, which shows an
omission notice instead of a table — with the withheld counts disclosed once,
in `omittedFamilies`.

**Honest-limitation clause** (goes in the paper's Limitations section verbatim):
validation is author-adjudicated; the v3.1 audit showed single-adjudicator
boundary drift is this instrument's dominant historical error path, mitigated
here by blinding, codebook-pinned rulings, and the model cross-check — and
resolved by design only in the confirmatory campaign's dual-human protocol.

## 9. Lower-bound language retired

**v3.1 §6.5** required, absent a second human rater, that every count publish as
a **verified lower bound** — "at least N verifiably false statements". The audit
falsifies the premise: "at least N" is one-directional and survives only if
there are no false positives, and 20 confirmed-invalid rows out of 171 are false
positives.

**v3.2 rule.** Lower-bound ("at least N") language is **retired**. Counts are
labeled **"author-adjudicated counts"** and reported with the §8 protocol that
produced them. Gate S5 fails any v3.2 publication that asserts
`lowerBoundLanguage`.

**There is no v3.1 compatibility path in v3.2 code.** The v3.2.0 claim that
"the v3.1 path is left byte-for-byte as it was" was false at every stage above
the assembler — the statistics, the scorer, and the renderer have no protocol
switch, so a "v3.1" regeneration would have silently produced different keys,
different strata, and (through §10's then-enforced bars) different counts
(review findings 4 and 5 of the v3.2.0 review). The honest rule replaces the
false one: **archived v3.1 artifacts regenerate and render at the code commit
the analysis manifest pins** (`manifest.codeCommit`), and v3.2 code refuses
v3.1 artifacts with a pointer to that commit instead of crashing or silently
reinterpreting them.

## 10. Admissibility advisories (revised in v3.2.1 — advisory, never enforcement)

**v3.2.0 defect, and why this section changed.** The first version of this
section added four "deterministic admissibility bars" ENFORCED at extraction
(a logged reject) and again in the scorer (verdict `RECORDED`). The pre-merge
review executed them and found the patterns over-firing on affirmative
compound sentences — "I'm not lying, I'm the doctor" barred as a role denial;
"Doctor here, I must say I protected Liv last night" barred as a directive;
"Town read on me is right, I'm not mafia" barred as third-person — and found a
barred role_claim still absorbing its same-message not_mafia_claim, so one
mis-fired regex deleted two claims, one of them never examined (review
findings 1–2). Every deleted claim was invisible to the §8 census, which
selects `verdict === 'false'`. A regex that can remove a claim from the ledger
is a regex doing the adjudicator's job — the exact class of delegation this
project's postmortems keep finding at the root.

**v3.2.1 rule.** The §10 checks are **advisories**. `barFor` in
`packages/seats/scripts/semantics-v3.mjs` evaluates the stored R19 span and
attaches at most one advisory to the record at extraction
(`advisory`, `advisoryReason`); the adjudication sheet displays it as a hint
("rule on the claim, not the flag"); the scorer **ignores it entirely**. Only
a human ruling (BAD, or CORRECTED with new fields) removes or changes a claim.

| advisory | rule it points at | audit rows |
|---|---|---|
| `doctor-directive` | R10 — telling the doctor to protect X may not be a protect action by the speaker | 7 |
| `specific-role-denial` | R11 — a denial of a specific role is neither a role_claim nor a not_mafia_claim; truthful denials are never scorable false | 12, 18 |
| `non-assertion` | §2/§2.1 — conditionals, counterfactuals, and spans with no first-person subject may not be first-person assertions. Raised for `not_mafia_claim` only: the codebook's own qualifying forms in other families (R21 roster headers, R10 protection-log listings, R9 night-numbered results) carry no first-person pronoun, and flagging them all would bury the sheet in noise. An advisory miss costs rater attention, never a verdict | 9, 10, 11, 13–17 |

The binding property, asserted by the regression suite: **an advisory never
changes a verdict and never removes a record** — records score identically
with and without their advisory, and no verdict is ever `RECORDED`-by-bar.

Two ENFORCED deterministic rules remain in `semantics-v3.mjs`, both
field-level, neither claim-level: the §2 stated-night strike, and the R12
conjunction resolution from audit row 6 — an `investigation_claim` whose
target resolves to the **speaker's own seat** asserts an action the engine
makes illegal (`legal.ts:62`), so v3.2 attempts the conjunction subject first
("Confirmed town: me and Bryan (N2 clear)" → target `Bryan`) and otherwise
scores `ambiguous`, never `false`.

## 11. Semantic gates beside the publication gates

The publication gates in `scripts/check-gates.mjs` validate hashes, run ids,
coverage, artifact shape, and (as of v3.2.6) the claim-unit mapping. The original
12 integrity/provenance gates could not have caught any of the 20 invalid rows,
and the paper says so. v3.2 also adds
`scripts/check-semantic-gates.mjs`, wired into `pnpm run check`, evaluating:

| gate | assertion |
|---|---|
| S1 | the frozen v3.1 spec is byte-identical to its pinned sha256 (spec-is-law) |
| S2 | this amendment exists and codifies all eleven sections |
| S3 | no retired vocabulary on any reader-facing v3.2 surface — the scan covers the renderer and the assembler, fails on a missing file, and its patterns cover template interpolation and prose variants |
| S4 | every published `claimedNight` is literally stated in its source message — recomputed from the committed logs, never trusted from a flag (§2); strike markers are normal counted operation |
| S5 | a v3.2 publication is either backed by the full §8 evidence or explicitly `exploratory-v1` with PF-2 targeted-cleanup counts only, no recall/omission rate, and potentially-incomplete labeling; never lower-bound-labeled (§9) |
| S6 | both truthful result types feed the report strata, under the renamed key (§6) |
| S7 | every ledger record is a byte-faithful projection of an archived reading (§4) |
| S8 | the retired `targetNotReported` conjunct is empirically vacuous, evidenced by a recorded `{checked > 0, violations: 0}` denominator (§7) |
| S9 | both named chance baselines are present on every town-ballot row (§5) |
| S10 | in full §8 mode, closure requires every false ledger row to carry an adjudication stamp made ABOUT a false row (`verdictAtRuling: 'false'`); in explicit exploratory-v1 mode, the deferred closure is allowed only with the complete author-adjudicated/potentially-incomplete/no-rate disclosure |

Publication gate G13 separately enforces the author's v3.2.6 unit decision:
every published receipt maps exactly once, both proposition-count endpoints are
coherent with the exact receipt count, headline ranges recompute from the
mapping, and the embedded stats mapping matches the mapping independently
recomputed from hash-verified logs.

Gates whose artifacts do not exist yet report PENDING. PENDING blocks
publication (`--strict`, the path `build-publication.mjs` takes) exactly as FAIL
does; on a bare `pnpm run check`, which runs before any artifact exists, the
source-level gates S1–S3 still run and PENDING is not an error. The gates run
in CI as their own workflow step — a gate that only ever runs on a developer's
machine protects nothing (review finding: the v3.2.0 gates were absent from
`ci.yml`).

---

## Code deltas (v3.2 paths; v3.1 artifact regeneration is not silently altered)

| file | change |
|---|---|
| `packages/seats/scripts/semantics-v3.mjs` | **new** — `statedNights` (§2, enforced, integer-typed), the §10 advisories (advisory-only), conjunction target resolution (R12, enforced) |
| `packages/seats/scripts/ledger-projection-v3.mjs` | **new** — `projectionErrors` (§4), projecting `seat` and `denial` too, with human-recovery exemptions |
| `packages/seats/scripts/extract-v3.mjs` | authoritative merge with the `fieldAudit` trail; explicit deletion; stated-night strike; §10 advisories attached (never rejected); identical-fields dedupe; `EXTRACTOR_VERSION` v3.2.1 |
| `packages/seats/scripts/scoring-v3.mjs` | `applyCorrection` incl. corrected `charStart` (§3); stated-night belt; strike markers survive the R17 merge; self-target investigation resolution (§10); scorer/mapping target identity aligned and receipt spans atomic; `EVALUATOR_VERSION` v3.2.3 |
| `scripts/build-adjudication-packet.mjs` | OK/BAD/**CORRECTED** ruling slots, corrected-field slots, required codebook-rule citation |
| `scripts/merge-packet-rulings.mjs` | CORRECTED ingest with fail-closed type validation, the `-` strike sentinel, and R19 validation + offset recompute for corrected quotes; `CORRECTABLE_FIELDS` imported from the scorer (one contract); `resolvingContext` provenance validation; miss-recovery carries `claimedNight`/`referencedDay` |
| `scripts/handcheck-v3.mjs` | the reject reshape carries `seat`/`day`/`game`/`sources`, so §6.1 reject recovery actually reaches the scorer |
| `scripts/build-ledger.mjs` | corrections flow to the scorer; fingerprint-keyed readings; corrected-quote R19 belt; `--extract` projection check (§4); struck-night, correction, and advisory counters; one source-verified formatting-only legacy context repair recorded in provenance |
| `scripts/stats-v3.mjs` | both truthful result types; renamed stratum; first-time-targets metric with recorded vacuity evidence; two named baselines; proposition-count ranges primary and exact utterance receipts secondary (`claim-proposition-v1`) |
| `scripts/opportunity-table.mjs` | two named baselines per row; `chance` deprecated; `legalTargets` unchanged |
| `scripts/build-publication.mjs` | v3.2-only; full-validation mode requires and embeds §8 evidence; explicit `--exploratory-v1` instead requires PF-2 + amendment, publishes no recall/omission rate, and labels semantics potentially incomplete; independently rebuilds and hash-binds the proposition-range/exact-receipt mapping; binds PF-2 to the ledger's exact confirmed-input bytes; forwards this run's output directory, clean-room report, tripwire, stats, and opportunity artifacts to the gates |
| `scripts/build-review-packet.mjs` | **new** — the §8 blinded three-arm packet: order-independent seeded shuffle, realpath entry guard, effective (post-correction) fields and context on every item, unblinding/merge mode with the run id stamped |
| `scripts/check-semantic-gates.mjs` | **new** — §11, fail-closed on missing sources, log-recomputing S4, shape-filtered stats discovery; S10 closure gate (v3.2.2) |
| `scripts/correction-validation.mjs` | **new (v3.2.2)** — the one shared fail-closed contract for CORRECTED rulings and recovered claims |
| `scripts/apply-review-rulings.mjs` | **new (v3.2.2)** — applies §8 final rulings to the confirmed-input layer and extends the closure chain |
| `scripts/publication-omission.mjs` | **new (v3.2.2)** — derived publishability, stats scrubbing, and the family-leak absence check |
| `scripts/agreement.mjs` | joins separately archived positive and negative sensitivity arms only on identical rater/run identity, exact negative-item coverage, and content hashes |
| `scripts/build-pf2-validation.mjs` | **new (v3.2.6)** — derives the PF-2 sensitivity, dispute, seeded audit-confirmation, targeted-cleanup, and final-ledger-input counts from the hash-pinned artifacts; never calls the audit inter-rater agreement |
| `scripts/build-sensitivity-v3.mjs` | **new (v3.2.6)** — deterministic three-cohort and two-baseline ranges with every sign reversal explicitly enumerated |
| `scripts/build-cleanroom-v3.mjs` | **new (v3.2.6)** — rebuilds 11 post-rating artifacts in a fresh temporary directory and attests only after byte-identical comparison |
| `scripts/check-gates.mjs` | G5 audits the declared validation scope, never a bare label; G11 re-hashes the clean-room artifact inventory; G13 recomputes claim units from publication receipts + verified logs |
| `scripts/claim-propositions.mjs` | **new (v3.2.6)** — deterministic, content-addressed mapping from post-correction R20 receipts to exact repeat links plus conservative lower/upper proposition counts |
| `scripts/render-site.mjs` | v3.2-only with an explicit version guard; renamed stratum, named baselines, protocol-labeled lede; quarantined editorial quotes removed pending re-verification |
| `.github/workflows/ci.yml` | the semantic gates run as their own CI step |

## Regression suite

Committed under `packages/seats/test/`, fixture-based, no LLM or network calls:

| test | amendment |
|---|---|
| relative language never yields a `claimedNight`, message text → record | §2 |
| classifier omission clears a stale candidate field | §1 |
| explicit deletion (`null`) is representable and recorded | §1 |
| the §10 advisories never change a verdict or remove a record | §10 |
| "I told the doctor to cover Sam" carries the doctor-directive advisory for the adjudicator | §10 |
| the review's over-firing counterexamples ("I'm not lying, I'm the doctor" …) raise no advisory | §10 |
| conjunction target resolution: "me and Bryan (N2 clear)" → Bryan | §10 |
| CORRECTED rulings reach the scorer | §3 |
| miss-recovery retains night/day fields | §3 |
| `resolvingContext` provenance is enforced | §3 |
| both truthful result types enter the report strata | §6 |
| chance baselines match their stated legal-target assumptions | §5 |
| the retired `targetNotReported` conjunct is vacuous | §7 |
| ledger records are byte-faithful projections | §4 |
| no verdict is ever `RECORDED`-by-bar; a barred-in-v3.2.0 compound message now yields one countable claim, not zero | §10 |
| the review packet is byte-identical under input reordering | §8 |
| closure e2e: a BAD row disappears (withdrawn, counted), a CORRECTED row is rescored, a scan miss is added, S10 goes PENDING→PASS | §8 (v3.2.2) |
| a same-count substituted packet/ledger is refused on exact identity | §8 (v3.2.2) |
| sheet items never carry a machine advisory; a cross-check disagreement without a final ruling refuses the merge | §8/§10 (v3.2.2) |
| an omitted family appears nowhere in the publication JSON or rendered HTML outside the disclosure | §8 (v3.2.2) |
| publishability derives from counts + the frozen floor; a contradictory stored flag fails G5 | §8 (v3.2.2) |
| an explicit N1 investigation result repeated later maps to one proposition and two receipts; grouped named targets stay distinct; nightless/unresolved action links widen a range; premature-vs-later action truth stays distinct | claim units (v3.2.6) |
| forbidden stale fields and unknown correction keys fail for corrected and recovered published claims | §3 (v3.2.6) |
| the PF-2 summary re-derives the full seeded packet order, every ruling path, correction, and final-input count; artifact or lineage drift fails | PF-2 (v3.2.6) |
| separate positive/negative sensitivity files join only with matching rater, run id, complete keys, and recorded hashes | PF-2 (v3.2.6) |
| clean-room success requires 11 byte-identical regenerated artifacts; one changed byte removes/refuses the attestation | §5 (v3.2.6) |

## What this amendment does **not** change

Codebook rules R1–R21 keep their numbers and their meanings. The engine, the
logs, the hash chains, the cohorts, the bootstrap, the reliability statistics,
the blinding discipline, and the fail-closed provenance chain are untouched.
`legalTargets` in the opportunity table is unchanged because it was correct. No
number in this document is a corrected headline: no corrected count is derivable
by subtraction, and every ledger-dependent quantity stays quarantined until the
author-performed v3.2 re-extraction and re-adjudication run.

## Amendment log

- **v3.2.6** (2026-09-02) — author-ruling finalization: R20 utterance
  receipts remain valid, while underlying-proposition count ranges become the
  primary Tier L unit; exact repeat links, conservative uncertain-action bounds,
  deterministic stats/publication integration, and G13 recomputation added.
  Exact per-family correction shapes
  now fail closed. The human evidence chain preserves and hashes the untouched
  first pass, ratified overlay, and reconstructed final ratings. The fixed
  1,000-character public-message cap is disclosed as an environment limitation;
  it may encourage compressed or compound statements and is not treated as a
  model trait. `EVALUATOR_VERSION` advances v3.2.2 → v3.2.3 because R17
  conjunction-target comparison, atomic quote/span merge behavior, and
  public-only semantic lookup change deterministic scorer behavior.
  Final rebuild plumbing derives PF-2 validation and cross-cohort sensitivity
  directly from pinned inputs, calls the single-author audit a confirmation
  rate rather than agreement, binds that summary to the ledger's exact
  confirmed-input hash, and proves 11 deterministic post-rating artifacts by
  fresh-directory byte regeneration. One archived machine context with a
  missing space beside an em dash is repaired only to its unique exact source
  span and records both byte strings in ledger provenance.

- **v3.2.0** — authoritative classifier fields; literal-night rule;
  OK/BAD/CORRECTED with validated resolving context; byte-faithful ledger
  projection; two named vote-chance baselines; both truthful result types in the
  report strata with the stratum renamed; the first-time-investigation-targets
  metric with an empirical vacuity assertion; the frozen single-author
  validation protocol; lower-bound language retired; enforced admissibility
  bars; semantic gates. Cause: `audits/false-label-audit-2026-08-29.md`.
- **v3.2.5** (2026-09-01) — the minimal pre-sitting patch: recall-miss
  packet items bind to one exact claim (sealed claimId + complete normalized
  claim + byte-exact span; changed/substituted claims refused; no ruling
  fan-out or overwrite; withheld negatives files refused); CORRECTED on a
  recall-miss applies the human's corrected proposition via the shared
  validation contract. Paper scope recorded: no second §8 sitting and no
  general recall/omission-rate estimate in v1; the six recall-miss items are
  targeted cleanup, not a recall sample; engine-derived results are the
  quantitative core, semantic results exploratory/author-adjudicated/
  potentially incomplete. `PF2_PACKET_VERSION` → pf2-v3.2.5.
- **v3.2.4** (2026-09-01) — the pre-sitting pass: PF-2 interface completed
  (`role` correctable, resolvingContext as {seq, exact text}, generated
  schema + example) and hash/identity-bound end to end; PF-2 provenance
  manifest; the item-level-blind-not-prior-free disclosure; §8 scan arm
  cohort-bound with a sealed sampling frame and the already-extracted rule
  (an extracted claim is never a miss); "message-level omission incidence"
  labeling; publication bound to the complete initial census (chain position
  0, exact false-row identity, n=0 bypass closed) plus every closure
  iteration; crossCheck/unaidedFirstPass/model artifact hash-bound and
  G5-validated; ambiguous rows disclosed, not totaled; per-model falsity
  rates retired to counts; report-conditioned strata and
  ledgerConfirmedClaims classified Tier L and scrubbed with omissions; the
  §8 first-pass/final body contradiction corrected.
  `REVIEW_PACKET_VERSION` → v3.2.4.
- **v3.2.3** (2026-08-31) — the focused pass after the third external review:
  final-based machine metrics with the unaided first-pass beside them;
  mandatory ratings metadata; complete method-identified model cross-check
  with normalized comparison; confirmed↔ledger lineage binding; composed
  corrections; unruled-only closure censuses; ballotAccuracy scrub; scan-arm
  hygiene; the rerun artifact preserved and honestly labeled; a real
  assembler→G5 e2e that caught a dead import in G5 itself.
- **v3.2.2** (2026-08-31) — the closure pass, after a second independent
  review of v3.2.1: §8 rulings apply and the S10-gated closure loop runs to a
  fixpoint; hash-and-identity binding across the packet chain; derived
  publishability; omission on every surface with an absence test; advisories
  hidden until after the first-pass ruling; the model cross-check implemented
  with mandatory reconciliation; correction handling fully fail-closed via one
  shared validation module. Measurement remains first-pass; no published
  number changed by this revision.
- **v3.2.1** (2026-08-31) — pre-merge review of the v3.2.0 implementation (15
  confirmed findings). §10 bars demoted to advisories; the v3.1 compatibility
  claim replaced by pinned-commit regeneration (§9); corrected quotes
  R19-validated with moving offsets, corrections type-validated, `-` sentinel
  handled (§3); identical-fields dedupe (§1); fingerprint-keyed projection with
  `seat`/`denial` covered and reject recovery repaired (§4); S4 recomputes from
  logs, S8 audits recorded evidence, S3 fails closed over the full
  reader-facing surface, G5 audits embedded §8 evidence (§11); order-independent
  packet shuffle with effective fields (§8). No published number changed by
  this revision: every ledger-dependent quantity was already quarantined.
