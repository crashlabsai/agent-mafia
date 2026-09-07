# Post-freeze amendment PF-2 — targeted human pass

**Status: adopted 2026-08-26, with the human rater's explicit approval,
before any ledger was built.** This document amends §6 and the §7 gates of
`docs/analysis/analysis-v3-spec.md` (v3.1, frozen). It lives as a separate
file because the spec's sha256 is pinned by the manifest and binds the
archived extraction readings; amending the spec file itself would orphan
them. The publication embeds this file's hash.

## What changed and why

§6.1 as frozen required the human rater to confirm every machine-positive
(759 items). The human rater was unavailable for the full sitting; the
sensitivity rater (Codex — a frontier model from a different lab than the
finder, blind to keys, roles, models, and outcomes) completed the full
confirm-all pass instead. Per its own written caveat and this project's
standing rule, a model rating cannot satisfy a human gate silently. The
approved replacement design:

1. **Full blind review of all 759 items by the cross-lab sensitivity
   rater** (finder: Anthropic claude-sonnet-5; reviewer: OpenAI-family
   Codex — no lab reviews only its own output).
2. **A blind, shuffled human packet** containing every disputed item (46),
   a seeded audit sample of the reviewer's accepts (50), and every
   published-family recall-miss from the negative sample (1) — 97 items,
   renumbered, with no marker of section or prior ruling. **The human
   ruling is final on every packet item.**
3. Everywhere else the reviewer's uncontested accept stands, with the
   rater name recorded truthfully per item (`via:
   sensitivity-uncontested`) — no record ever claims a human ruling it
   did not receive.
4. The §6.2 negative sample (100 messages) was likewise rated by the
   sensitivity rater; its single published-family miss was human-confirmed
   in the packet.

## Measured validation (see pf2-validation.json)

- Machine precision by family (reviewer as reference): role 99.5%,
  investigation 97.7%, protection 82.0%, not-mafia 78.9%. The dominant
  machine error — soft "town-like/conditional/denial" statements
  over-accepted as not_mafia claims — was contained by review: none
  publish.
- Human audit of reviewer accepts: **49/50 agreement (98%, Wilson 95%
  89.5–99.6%)** — the bound on residual reviewer error across the 663
  uncontested accepts.
- Disputes: the human upheld **18** of 46 reviewer rejections and overturned
  **28** (concentrated at the not-mafia assertion-strength boundary; the
  human's line: role denials and doctor-directives are not claims,
  conditional self-alignment assertions are). The disagreement is
  published, not smoothed. (Corrected 2026-08-30 from "17 / 29" — the
  shipped JSON artifacts are authoritative; see the erratum below. The
  parenthetical characterization of "the human's line" is itself
  contradicted by three shipped rows — a doctor-directive and two role
  denials published via overturn, audit rows 7/12/18 — see erratum (i):
  the stated line was not the applied line.)
- Recall: 1 missed published-family claim in 100 audited messages,
  human-confirmed and recovered into the ledger with a byte-exact span.

## Gate rewording (§7)

- "Every published positive is human-confirmed" becomes: **every published
  positive carries an explicit blind reviewer confirmation; every dispute,
  audit-sample item, and recall-miss is human-ruled (human final); the
  residual reviewer-error bound from the audit is published.** (G3)
- The §6.2 negative-sample rater may be the sensitivity rater under this
  design; the single-human honesty fallback (§6.5) stays asserted: all
  counts publish as verified lower bounds. (G5)
- Everything else in §7 is unchanged.

## Unchanged

Codebook rules R1–R21, all deterministic scoring, the opportunity table,
cohorts, bootstrap, reliability, blinding, and the fail-closed provenance
chain. This amendment changes who confirmed, and says so; it does not
change what a claim is or how truth is decided.

## Erratum — 2026-08-30

Two corrections to the "Measured validation" section above, both found by the
row-level audit at
[`../audits/false-label-audit-2026-08-29.md`](../audits/false-label-audit-2026-08-29.md).
No published JSON artifact is edited by this erratum; the artifacts are the
authority and the prose was wrong.

**(i) The containment claim is falsified.** This document stated that the
dominant machine error — soft "town-like / conditional / denial" statements
over-accepted as `not_mafia_claim` — "was contained by review: none publish."
The shipped ledger contradicts it. **Twelve such rows published**, and every
one entered through a final human overturn of a reviewer rejection at the
assertion-strength / family-eligibility boundary (audit §C, rows 9–20: ten
clear failures plus the two rows reclassified as confirmed on family
eligibility; all recorded `ryan / packet-dispute`). The audit's attribution
table puts 15 of the 20 confirmed-invalid rows on that same path. Review did
not contain the error; on this class, review was the entry point. The
"none publish" sentence should be read as withdrawn.

**(ii) The dispute tally was misstated.** "17 upheld / 29 overturned" is
corrected in place above to **18 upheld / 28 overturned**, per the shipped JSON
artifacts, which are authoritative over this prose.

**Artifact supersession is pending.** The v3.1 publication artifact is
**superseded, not overwritten**, and nothing derived from the ledger is
restated here: the corrected counts follow from the v3.2 re-extraction and
re-adjudication described in
[`../analysis-v3.2-amendment.md`](../analysis-v3.2-amendment.md), which has not
been run. No corrected headline is derivable from this erratum by subtraction,
and none is claimed. Until that rebuild lands, every ledger-dependent number
stays quarantined.
