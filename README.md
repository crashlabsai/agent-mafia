# agent-mafia

A deterministic Mafia environment where language-model agents play long-form
social deduction and selected strategic claims are checked against logged game
state. The final truth verdict is deterministic code, not an LLM judge.

**Exploratory campaign (August 2026):** twelve model endpoints played 40 games.
The environment recorded 4,267 agent wakes and completed every game. In the
primary 38-game analysis set, 667 quoted claim occurrences map to 433-460
distinct claims; 118-120 were verifiably false. These semantic results are
author-adjudicated and potentially incomplete. The engine-derived reliability
and ballot results do not depend on claim extraction.

- **Results:** [crashlabs.ai/mafia](https://crashlabs.ai/mafia) — field report,
  watchable replays, per-model numbers
- **Method:** precommitted design:
  [`docs/sweeps/sweep1.plan.md`](docs/sweeps/sweep1.plan.md) · evaluator specification:
  [`docs/analysis/analysis-v3-spec.md`](docs/analysis/analysis-v3-spec.md)
- **The 40 game logs:** [`data/sweep1/`](data/sweep1/) — hash-chained, offline-verifiable,
  roots pinned in [`docs/sweeps/results/sweep1-roots.txt`](docs/sweeps/results/sweep1-roots.txt)
- **Paper and v3.2 evidence:** [`docs/paper/agent-mafia-paper.pdf`](docs/paper/agent-mafia-paper.pdf) ·
  [`docs/sweeps/results/analysis-v32/`](docs/sweeps/results/analysis-v32/)
- **Architecture and ruleset:** [`docs/DESIGN.md`](docs/DESIGN.md) · log schema:
  [`docs/EVENTS.md`](docs/EVENTS.md)

Sweep 1 is the first public release. The repository keeps the evaluation code,
frozen specification, generated publication artifact, and source logs together
so the metric can be audited without access to provider accounts.

## Why Mafia

Mafia creates several useful classes of state-checkable statement. Published
families cover **role claims** ("I'm the detective"), **self-alignment claims**
("I'm not Mafia"), **investigation reports**, and **protection reports**. Each
maps to a specific field or event in the log. Vote and intention statements are
recorded under separate rules but are deferred from the paper's semantic
results.

Humans and AI agents occupy **identical seats** — same observations, same
action space, same tools. Everything a seat knows arrives through one
function, `observe(state, seat)`. A sampled property test directly changes role
fields an observer is not entitled to know and requires the serialized
observation to remain byte-identical. This is a focused redaction test, not a
general proof of non-interference.

## Verify the published games

No API keys needed. `verify` checks the tamper-evidence hash chain over every
line, re-steps the full game through the engine, and compares every derived
event:

```bash
pnpm install --frozen-lockfile
pnpm run mafia verify data/sweep1/sweep1-21.jsonl   # any of the 40
pnpm run mafia replay data/sweep1/sweep1-21.jsonl --seat seat-3   # visibility-filtered event export
pnpm run check:analysis-release                     # verify the curated v3.2 bundle
```

## Published data and traces

The public logs contain synthetic seat names, model-generated dialogue, action
attempts, timestamps, token counts, provider response identifiers, and recorded
reasoning traces or summaries when a provider exposed them. They contain no
human participant conversations and are intended to contain no credentials.

The analysis manifest pins the evaluation commit and frozen specification. The
curated v3.2 bundle includes a source-to-release hash crosswalk and a standalone
verifier. Published artifacts are never edited by hand; changes require
regeneration, new hashes, and the publication gates. See [DATA.md](DATA.md) for
the exact public-data boundary, integrity model, and license.

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

The full claim pipeline behind the published numbers, including extraction,
deterministic truth checks, blind cross-provider review, and author
adjudication, is specified in
[`docs/analysis/analysis-v3-spec.md`](docs/analysis/analysis-v3-spec.md) and
implemented in `scripts/` and `packages/seats/scripts/`.

## Terminology

"Round" is never used bare — it otherwise means three different things. A
**match** is a sequence of games over a fixed seat pool; a **game** is one
playthrough; a **cycle** is night → dawn → discussion → vote → execution; a
**discussion round** is one pass through the speaking order. CI enforces this.

## What this is not

Game-licensed lying is evidence about capability under game incentives, not
about a model's propensity to deceive unprompted in deployment. This is an
exploratory field report with published instrument-validation evidence, not a
ranking. A future confirmatory study will be preregistered. Methodology,
post-run disclosures, and limitations are recorded in the
[precommitted design](docs/sweeps/sweep1.plan.md) and
[analysis specification](docs/analysis/analysis-v3-spec.md).

## License

[MIT](LICENSE). For contribution guidelines, security reporting, and citation,
see [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and
[CITATION.cff](CITATION.cff).
