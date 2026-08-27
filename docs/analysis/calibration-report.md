# Calibration slice report — analysis v3.1 (§3.3)

> Historical checkpoint: this report records the calibration decision at the
> time it was made. The final human-review design and disposition of the
> pending items below are documented in
> [`amendments/PF-2.md`](amendments/PF-2.md).

Games (seeded draw `calibration-v3.1`, recorded in the manifest):
sweep1-0, sweep1-15, sweep1-16, sweep1-23, sweep1-24, sweep1-30.
analysisRunId `7b7bb5c16f640c…`. Finder: claude-fable-5.

## Extraction QA

316/316 public messages processed, zero unprocessed, all locks released.
415 machine-positives (88 in the published families, 327 shelved
vote-family records), 836 machine-negatives, 1 reject. The reject is the
R13 rule working: "I abstained D1 as stated" is a targetless
past_vote_claim — correctly refused. It also flags a codebook gap for the
SHELVED families: abstention claims are checkable (`votes[seat:day] ===
null`) but currently untyped. No sweep-1 impact (vote families do not
publish); logged for sweep 2.

## Second-finder gate (§3.2)

gpt-5.6-sol ran as a second finder over the same six games (after an
endpoint fix, commit e3bbe1f; the first attempt's per-seed refusal to
write candidates files was the fail-closed path proving itself).

- Unique claims sourced only by the second finder, **published families:
  0 of 88 (0.0%)** — under the ≥2% bar.
- Unique claims, all kinds including shelved: 48 of 463 (10.4%) — all 48
  are vote-family records (40 vote_stance, 5 past_vote_claim, 2
  vote_commitment, 1 vote_retraction).
- Finder resample noise (uniques not involving the second model): 10,
  the expected single-sample variance of the primary finder.

**Ruling: the second finder is NOT added for the sweep-1 full run.** The
§3.2 bar protects recall of the ledger sweep 1 publishes, and there the
three-source union (v2 recycle ∪ validated tripwire ∪ one finder) is
saturated — explicit role/investigation/protection language is exactly
what the 98.6–100%-coverage lexicon and one strong finder already catch.
The 10.4% all-kinds number is disclosed rather than hidden because it is
a real finding: softer vote-stance language DOES benefit from finder
diversity, which is direct evidence for a multi-finder panel in sweep 2,
where the vote families are scheduled to publish. The secondtest outputs
are retained as archived instrument readings.

Interpretation note, honestly stated: §3.2's bar did not name its
denominator's family scope. This ruling reads it as published-families
(the metric the gate exists to protect); the all-kinds number crosses the
bar and is reported alongside. Ratification of this reading belongs to
the calibration amendment cycle.

## Pending before freeze

- Ryan's confirm-all ratings on the 88-item calibration sheet (the
  overturn rate and BAD-note review are the amendment-cycle input).
- Any single codebook amendment the sitting justifies, then FREEZE (spec
  hash into the manifest; §3.3).
