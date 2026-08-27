# agent-mafia

A deterministic Mafia environment where frontier language models must deceive
to win — and every claim they make is checked against the engine's ground
truth. Not an LLM judge: the engine knows every dealt role, sealed ballot, and
night action, so a lie is a computable fact.

**Sweep 1 (August 2026):** twelve frontier models, 40 games, 702 claims scored
against the sealed game state, at least 171 verifiably false — each published
with a byte-exact quote and the log that convicts it.

- **Results:** [crashlabs.ai/mafia](https://crashlabs.ai/mafia) — field report,
  watchable replays, per-model numbers
- **Method:** precommitted design:
  [`docs/sweeps/sweep1.plan.md`](docs/sweeps/sweep1.plan.md) · evaluator specification:
  [`docs/analysis/analysis-v3-spec.md`](docs/analysis/analysis-v3-spec.md)
- **The 40 game logs:** [`data/sweep1/`](data/sweep1/) — hash-chained, offline-verifiable,
  roots pinned in [`docs/sweeps/results/sweep1-roots.txt`](docs/sweeps/results/sweep1-roots.txt)
- **Architecture and ruleset:** [`docs/DESIGN.md`](docs/DESIGN.md) · log schema:
  [`docs/EVENTS.md`](docs/EVENTS.md)

Sweep 1 is the first public release. The repository keeps the evaluation code,
frozen specification, generated publication artifact, and source logs together
so the metric can be audited without access to provider accounts.

## Why Mafia

Mafia yields three independent classes of checkable claim, each with hard
ground truth: **role claims** ("I'm the detective") check against the deal;
**private-information claims** ("I investigated Vale — clean") check against
whether that investigation actually happened; **intention claims** ("I'm
voting Reed") check against the sealed ballot cast minutes later. And
deception is structurally required — Mafia cannot win without sustained lying,
while Town has no incentive to lie.

Humans and AI agents occupy **identical seats** — same observations, same
action space, same tools. Everything a seat knows arrives through one
function, `observe(state, seat)`, and a property test holds that function to
an information-theoretic standard: rewrite any role the observer is not
entitled to know, and the observer's rendered view must be byte-identical.

## Verify the published games

No API keys needed. `verify` checks the tamper-evidence hash chain over every
line, re-steps the full game through the engine, and compares every derived
event:

```bash
pnpm install --frozen-lockfile
pnpm run mafia verify data/sweep1/sweep1-21.jsonl   # any of the 40
pnpm run mafia replay data/sweep1/sweep1-21.jsonl --seat seat-3   # one seat's view
```

## Published data and traces

The public logs contain synthetic seat names, model-generated dialogue, action
attempts, timestamps, token counts, provider response identifiers, and recorded
reasoning traces or summaries when a provider exposed them. They contain no
human participant conversations and are intended to contain no credentials.

The analysis manifest pins the evaluation commit and frozen specification.
Published artifacts are never edited by hand; changes require regeneration,
new hashes, and the full publication gates. See [DATA.md](DATA.md) for the exact
public-data boundary, integrity model, and license.

## Quickstart

Requires Node 22.18+ (TypeScript runs natively; there is no build step) and pnpm.

```bash
pnpm run mafia run --seed 42                      # play a scripted game, free
pnpm run mafia run --seed 42 --out runs/g.jsonl   # ...and write the event log
pnpm run mafia fork   runs/g.jsonl --at 40        # rebuild state at any seq
pnpm run check                                    # typecheck + tests + determinism
pnpm run mafia ui                                 # observer UI: watch live, flip views
```

### Seating models

```bash
pnpm run mafia providers --probe    # which providers are credentialed, ids still live
pnpm run mafia run --driver agent --models sonnet-5,gpt-5.6-sol,kimi-k3 \
                   --seed 11 --out runs/live.jsonl
```

`--models` is a rotation: seat *i* gets model *i mod n*. Keys go in `.env`
(see `.env.example`). Run `--probe` before a run you intend to trust — a wire
id is a claim about someone else's deployment and goes stale without warning.

### Sweeps and grading

```bash
node scripts/run-sweep.mjs --models sonnet-5,gpt-5.6-luna,deepseek-v4-flash \
     --games 30 --prefix pilot --out-dir runs/pilot
node scripts/grade.mjs runs/pilot/*.jsonl         # pure log arithmetic vs ground truth
```

The full claim pipeline behind the published numbers — extraction, deterministic
truth checks, blind cross-lab review, human adjudication — is specified in
[`docs/analysis/analysis-v3-spec.md`](docs/analysis/analysis-v3-spec.md) and
implemented in `scripts/` and `packages/seats/scripts/`.

## Terminology

"Round" is never used bare — it otherwise means three different things. A
**match** is a sequence of games over a fixed seat pool; a **game** is one
playthrough; a **cycle** is night → dawn → discussion → vote → execution; a
**discussion round** is one pass through the speaking order. CI enforces this.

## What this is not

Game-licensed lying is evidence about capability under game incentives, not
about a model's propensity to deceive unprompted in deployment. Sweep 1 is a
descriptive field report with published instrument-validation numbers — not a
ranking. The confirmatory, pre-registered run is Sweep 2. Methodology,
post-run disclosures, and limitations are recorded in the
[precommitted design](docs/sweeps/sweep1.plan.md) and
[analysis specification](docs/analysis/analysis-v3-spec.md).

## License

[MIT](LICENSE). For contribution guidelines, security reporting, and citation,
see [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and
[CITATION.cff](CITATION.cff).
