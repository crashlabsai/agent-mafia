# Codex blinded hand-check — analysis v3.2 (PF-2 sensitivity pass)

Rater: **Codex (gpt-5.6-sol, reasoning xhigh)** — frontier-model
sensitivity rater, not a human rater. Finder lineage: Anthropic
claude-sonnet-5; reviewer lineage: OpenAI — no lab reviews only its own
output.
Analysis run: `641bb60eef9a6da9216da7632efb4e88fb3678e53e74814bf16d6cb45f8b20f4`
Date: 2026-09-01.

## Method (stronger blinding than the v3.1 pass, else parallel)

- Executed headless via `codex exec` (codex-cli 0.149.1), one session per
  sheet, 9 sessions total (8 positives sheets + 1 negatives sheet).
- Blind source: each session received ONE prompt containing the task
  instructions, verbatim codebook excerpts (spec §2; amendment §2, §3,
  §10), and the sheet text. Working directory: an empty scratch dir.
  Sandbox: read-only; `--ignore-user-config`; `--ephemeral`.
- Conduct is transcript-verified, not attested: every session's `--json`
  event log contains zero command executions and zero file reads — the
  sealed keys and game logs were never accessible to the rater.
- Output was harness-constrained by a JSON Schema
  (`codex-pass/ratings-fragment.schema.json`,
  `codex-pass/negatives-fragment.schema.json`); every fragment was
  validated fail-closed on arrival: complete item coverage, ruling
  vocabulary OK/BAD/CORRECTED (v3.2 §3 — v3.1 lacked CORRECTED), a
  codebook-rule citation and note on every BAD/CORRECTED, corrections
  only on CORRECTED rows and only over the scorer's CORRECTABLE_FIELDS.
- All prompts, schemas, event logs, raw fragments, and their sha256s are
  preserved under `handcheck/codex-pass/`.

## Confirm-all positives (763 items: 760 machine-accepted + 3 machine-rejected)

| family | OK | BAD | CORRECTED | OK-rate |
|---|---|---|---|---|
| role_claim | 370 | 8 | 14 | 94.4% |
| investigation_claim | 152 | 1 | 17 | 89.4% |
| not_mafia_claim | 109 | 42 | 0 | 72.2% |
| protection_claim | 38 | 6 | 3 | 80.9% |
| (machine-rejected inv/prot) | 0 | 3 | 0 | — |
| **total** | **669** | **60** | **34** | |

- All 3 machine-rejected candidates were ruled BAD — the rater agrees
  with the machine's rejections (two future investigation plans, one
  doctor-directive).
- The dominant dispute family is again soft `not_mafia_claim`
  over-acceptance (group roster statements, behavior-defenses,
  conditional self-alignment) — the same assertion-strength boundary
  where the v3.1 human overturned 28 of 46 reviewer rejections. These
  rulings are disputes for the human packet, not final outcomes.
- CORRECTED (new in v3.2) concentrates in investigation_claim (17) and
  role_claim (14): kind-flips on compound "I'm detective, checked X"
  messages and claimedNight fixes under amendment §2's literal-night
  rule, several recovering the night number from displayed R12b
  resolving context.

## Machine-negative sample (100 messages)

- 55 messages contained at least one claim under the full codebook; 116
  claims listed, all quotes byte-exact against the source messages.
- 110 are shelved vote-family records (105 vote_stance, 3
  vote_retraction, 2 vote_commitment) — consistent with v3.1's finding;
  shelved families do not affect the published ledger.
- **6 published-family miss candidates** (2 role_claim, 4
  not_mafia_claim) vs 1 in v3.1 — each goes to the human packet for a
  final ruling.

## Blinding disclosure (v3.2.4)

Before the packet sitting, the human rater was shown the AGGREGATE
family-level results above (per-family OK/BAD/CORRECTED counts and
OK-rates) and the packet's arm sizes (94 disputes + 50 audit + 6
recall-miss). The sitting is therefore **item-level blind — not
prior-free**: no item-level ruling, arm assignment, verdict, role, model,
or outcome was visible to the rater, but family-level priors were. This
disclosure is carried in `pf2-provenance.json` and must travel with any
published validation summary.

## Methodology status

These files are the spec's **sensitivity-rater** input. They must not be
labeled "Ryan", "human-confirmed", or used to satisfy any human gate.
Every BAD/CORRECTED ruling and every recall-miss candidate routes to the
blind human adjudication packet (PF-2), where the human ruling is final.
The human rater must not open `codex-ratings.json`,
`codex-negatives.json`, or this summary's per-item artifacts before
completing the packet sitting.
