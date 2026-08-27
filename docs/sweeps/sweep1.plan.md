# Sweep 1 — precommitted schedule

Committed before any game in the sweep is played. Everything below is fixed in
advance so the result cannot be accused of post-hoc selection.

- **Table**: 11 seats, 3 mafia (engine role scaling), default ruleset v1 otherwise.
- **Games**: 40, indices g0–g39, run in three parallel lanes
  (a: g0–g13, b: g14–g26, c: g27–g39) sharing this single schedule.
- **Seeds**: `sweep1-<g>` — the game seed alone determines roles and names.
- **Model pool** (assignment per game comes from the frozen role-balanced
  `sweep1.schedule.json` — solved for exact mafia balance and near-exact
  doctor/detective/seat balance — NOT from simple rotation; the schedule
  JSON is the authority and the logs were audited to match it 440/440):
  1. opus-5 · 2. sonnet-5 · 3. gpt-5.6-luna · 4. gpt-5.6-sol ·
  5. gemini-3.7-flash · 6. grok-4.6 · 7. deepseek-v4-flash · 8. kimi-k3 ·
  9. glm-5.2 · 10. muse-spark · 11. ox-alpha · 12. nemotron-3-ultra
- **Framing**: `unverified` for every seat (no framing ablation in this sweep).
- **Deadline**: 300 s per wake (amended from 240 s before game zero: the
  Spark smoke showed ox-alpha exceeding 240 s on clean wakes with zero
  errors, and 11-seat contexts run longer). **Attempts**: 3 per wake, all
  logged.
- **Exclusion rule, fixed now (clarified before game zero)**: a game with any
  seat whose provider-error count or *infrastructure* timeout count
  (cause `deadline` or `provider_error`) exceeds 2 is excluded from headline
  statistics — still published in the manifest with its failure counts.
  Defaults caused by model noncompliance never exclude a game: tool
  noncompliance is evaluated behavior, and excluding it would bias the
  sample against exactly the models it describes.
- **Analysis units**: the game is the clustering unit; per-model rates are
  reported with denominators; no ranked leaderboard from this sweep alone.
- **Judging**: majority-of-3 extraction; judge model and prompt hash recorded
  in the claims file; a human hand-check of ≥50 sampled claims published as
  an agreement rate. Judging is post-hoc over frozen logs and may be re-run
  with improved judges; the logs never change.

## Post-run disclosures (audited 2026-08-25)

- **Balance after exclusions.** The 40 scheduled games satisfy the balance
  promise exactly (audited). The 38-game headline subset, after the two
  precommitted exclusions, does not: mafia exposure becomes 8 (opus, sonnet),
  9 (luna, muse-spark), 10 (all others); doctor/detective 2–4; appearances
  34–36. Published statistics state realized denominators, and no ordered
  ranking is claimed from this sweep.
- **Exclusion-wording timing.** The clarification that only infrastructure
  timeouts (not model noncompliance) count toward exclusion was committed
  147.6 s before game zero and is the rule the run was born under; audited
  as genuinely pre-run. Under the prior literal wording nine games (0, 6,
  13, 15, 21, 24, 25, 27, 38) would be excluded; results under that
  stricter 31-game reading are published as a sensitivity check.
- **"Zero failures" means zero game-process failures.** The sweep recorded
  35 provider-error attempts and 10 infrastructure timeout events across
  62.5M tokens, all captured per-attempt in the logs.
