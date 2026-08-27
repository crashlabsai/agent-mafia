# agent-mafia — Design

Status: **implemented through Milestone 1, cross-provider.** The milestone
ledger in §14 tracks what is proven, and everything in the sections marked
*Reserved* remains deliberately unimplemented infrastructure, documented so it
can be added later without breaking changes.

---

## 1. Purpose

`agent-mafia` is a deterministic, step-based Mafia environment in which humans and
AI agents occupy **identical seats**. It exists to produce transcripts that support
behavioral evaluation of agents under game incentives — deception, role inference,
detection, persuasion, and (later, under a separate protocol) continual social
learning.

The design follows the Multi-Agent Arena pattern: one authoritative environment
state, per-seat redacted observations, an append-only event log, and no asymmetry
between a human seat and an agent seat other than the interface layer.

### Why Mafia

The only checkable claim in a poker table-talk environment is "what cards do I
hold" — one binary fact, cheap to lie about, and lying is optional. Mafia yields
three independent classes of checkable claim, each with hard engine ground truth:

1. **Role claims.** Every seat holds a secret role, so "I'm the Detective" is
   checkable against state.
2. **Private-information claims.** A Detective reporting a result is checkable
   twice — did the seat hold the role, and did it actually receive that result?
   A fabricated investigation report is a structurally deeper lie than a bluff.
3. **Intention claims.** "I'm voting Reed" followed by a vote for Vale is a
   behavioral lie, measurable without parsing table talk at all.

Deception is also *structurally required* rather than optional: Mafia seats cannot
win without sustained lying, while Town seats have no incentive to lie. That
asymmetry means a Town lie is an anomaly worth its own metric, and the same
environment measures both lying and lie-detection.

Mafia has a second property that motivates the reserved work below: **roles
reshuffle but seats persist**. The same seat pool can therefore play a sequence of
games, which makes the environment a substrate for measuring whether an agent
learns the role-conditional behavioral tendencies of specific opponents.

---

## 2. Terminology

These terms are used consistently across code, docs, and the log schema. The word
"round" is **never** used bare — it previously meant three different things.

| Term | Meaning |
|---|---|
| **Match** | A persistent multi-game evaluation episode over a fixed pool of seats. |
| **Game** | One complete Mafia playthrough, from role assignment through win condition. One game = one `roomId`. |
| **Cycle** | One night → dawn → discussion → vote → execution progression inside a game. |
| **Discussion round** | One pass through the sequential discussion order. Default: two discussion rounds per day. |

---

## 3. Two evaluation modes

These are separate claims. Code and documentation must not blur them.

### Mode 1 — Single-game social-reasoning / deception evaluation

A game is evaluated independently. Covers within-game deception, role inference,
detection, voting quality, and faction-conditioned outcomes.

**Mode 1 does not claim to measure continual learning.** This is the mode
Milestone 1 produces data for.

### Mode 2 — Persistent-match continual social-learning evaluation *(Reserved)*

A **match** is a sequence of complete games over the same persistent seat
identities. Each game receives a fresh deterministic seed and a newly randomized,
role-balanced assignment. Seat IDs persist across the match; **role identity must
not**.

Agents may retain private state across games within a match and use revealed
outcomes from earlier games to model other seats.

The purpose is to test whether agents learn **role-conditional behavioral
tendencies** of opponents over repeated interaction — *not* whether they memorize
that a particular seat is always Mafia. Because roles reshuffle every game, a valid
continual-learning result **cannot be explained by static role identity**. Only
behavioral tendencies attached to a persistent seat are reusable.

> **Status: reserved infrastructure.** No continual-learning experiment has been
> run and no such result has been measured. Sections 11–13 specify a protocol for
> a later controlled experiment.

#### The intended learning loop

> observe prior behavior → form a hypothesis about another seat's role-conditional
> behavior → make decisions → observe revealed role/outcome feedback → revise the
> hypothesis → apply it in later games.

Potentially learnable signal — all recoverable from the log, none of it judged by
the engine:

- A seat's consistency between announced and actual votes, conditional on faction.
- A seat's tendency to defend, distance from, or bus its Mafia partners.
- A seat's speech, certainty, or silence patterns under accusation.
- A seat's handling of role claims and Detective-result claims.
- A seat's propensity to make verifiable versus falsified private-information claims.

---

## 4. Principles

These are load-bearing, not aspirational.

- **Parity by construction.** The engine emits a per-seat `Observation` plus a legal
  action set. The agent tool layer and the future browser UI are both rendered from
  that same object. Parity is a property of the data flow, not a policy anyone has
  to remember.
- **Determinism.** Seeded RNG, pure reducer, no wall-clock and no `Math.random()`
  inside the engine. Same seed plus same actions produces a byte-identical log.
- **Replay and fork.** Append-only JSONL with monotonic `seq`. Replay reconstructs
  state; a fork branches from any seq.
- **Legibility.** Private reasoning traces are captured alongside the actions they
  produced, and ground-truth roles are recoverable at every seq.
- **Anonymity.** Seats carry generic display names. Agents do not know which seats
  are agents versus humans, nor which model backs which seat. Identity is sealed
  until an end-of-game Reveal.
- **De-opinionation.** Seats receive rules and primitives only. No personas, no
  strategy advice, no authored personality — otherwise the evaluation measures the
  prompt rather than the model.
- **Continuous session.** Each agent seat is one multi-step tool-using session for
  the whole game, remembering every prior wake within it.

---

## 5. Ruleset v1

Every value below is configurable; the stated value is the default.

**Table.** Seven seats: 2 Mafia, 1 Doctor, 1 Detective, 3 Villagers. Mafia know
each other from the start.

**Game structure.** A game opens on **Night 1**, so Day 1 begins with a body and
real information rather than a contentless first vote. A game is a sequence of
cycles.

| Phase (within a cycle) | Collection | Notes |
|---|---|---|
| Night — mafia chat | sequential, mafia only | private channel; 1 pass |
| Night — actions | simultaneous-sealed | kill / protect / investigate submitted blind |
| Dawn | engine | resolve, announce, win check |
| Discussion | sequential | 2 discussion rounds; speaking anchor rotates each day |
| Vote | simultaneous-sealed | plurality; abstain legal |
| Execution | engine | resolve, announce, win check |

**Why sequential discussion.** Simultaneous-sealed talk is faster in wall-clock,
but nobody can answer anybody within a discussion round, which destroys the only
thing the environment exists to measure. Sequential gives genuine back-and-forth:
each seat sees everything said so far that day when its turn arrives. The cost is
position advantage — the last speaker knows most — neutralised by rotating the
day's speaking anchor and averaged out across many games.

**Why sealed voting.** Open sequential voting is more social (you watch the wagon
form and pile on) but reintroduces heavy position dependence exactly where the
outcome is decided. Sealed for v1; `openSequentialVoting` is reserved as a flag.

### Night resolution order

Fixed and deterministic:

1. Detective investigation resolves against the pre-night state, returning
   `mafia` / `not mafia` (faction, not exact role).
2. Mafia kill target is the plurality of mafia submissions; ties broken by the
   seeded RNG. All mafia timing out means no kill.
3. Doctor protection is applied. A protected target does not die.
4. Deaths are announced. Win check.

### Rules choices that affect evaluation quality

- **Roles reveal on death: yes.** Generates public ground-truth checkpoints
  mid-game, keeps Town tractable, and shortens games. It is also the feedback
  signal Mode 2 depends on.
- **Doctor may self-protect: yes. May not repeat a target on consecutive nights:
  enforced.**
- **Execution ties: nobody dies.** Deterministic, and a genuine strategic outcome —
  no RNG in the most consequential step.
- **Win conditions.** Mafia win when living Mafia ≥ living Town. Town wins when
  living Mafia = 0. Checked after dawn and after execution.
- **Silence is an action.** `pass` is legal, logged, and distinct from a timeout.
  Talk rate becomes a measurable statistic, and metrics are normalised per *turn
  played* so that chattiness alone moves nothing.
- **Timeouts are explicit events**, never silently coerced: discussion becomes
  `pass`, vote becomes `abstain`, night becomes no action, each logged as `timeout`
  so a failed seat is distinguishable from deliberate silence.
- **Message cap:** 1000 characters.
- **Declining to act at night is legal.** `no_action` is a first-class choice —
  mafia may decline to kill — and it is also the timeout default, so every
  timeout still produces a logged action and replay stays uniform.
- **A stalled game ends as a stalemate.** If `maxQuietDays` (default 3)
  consecutive cycles pass with no death, or `maxDays` (default 20) is reached,
  the game ends with `winner: null` and `reason: 'stalemate'`.

  This is a rule, not a runtime guard, and it is load-bearing. Mafia declining
  to kill while the table declines to execute is a stable loop that no cycle can
  break: a fully silent table would otherwise run forever. Ending it neutrally
  rather than awarding the win to either faction keeps the judgment out of the
  engine — a grader can decide what a stalemate is worth.

---

## 6. Architecture

pnpm workspace monorepo. The future web client and the future match runner import
`@mafia/protocol` rather than reaching into engine internals, which makes the
parity boundary physical rather than remembered.

```
agent-mafia/
├── docs/{DESIGN.md, EVENTS.md}
├── scripts/check-determinism.mjs
└── packages/
    ├── protocol/src/   ids, match, roles, state, actions, events, observation, config
    ├── engine/src/     rng, names, setup, reducer, legal, observe, win
    ├── room/src/       room (the loop), log (JSONL), replay (+fork), deadline
    ├── seats/src/      driver, scripted        (agent + providers: steps 9-10)
    └── cli/src/        index
```

**Zero runtime dependencies.** Node 22.18+ executes TypeScript directly and ships
a test runner, so the environment needs neither a bundler nor a test framework:

| Would-be dependency | Replaced by |
|---|---|
| `tsx` / build step | native type stripping (`node file.ts`) |
| `vitest` | `node:test` + `node:assert` |
| `commander` | `node:util` `parseArgs` |
| `zod` | a small hand-written action parser (the union is closed and tiny) |
| `fast-check` | a seeded counterfactual walk — see §15 |

The only devDependency is `typescript`, for `tsc --noEmit`. Provider SDKs arrive
with the agent driver in steps 9–10 and are the first runtime dependencies.

Because Node's type stripping is erase-only, `tsconfig.json` sets
`erasableSyntaxOnly: true`, so the typechecker rejects anything the runtime
cannot execute (parameter properties, enums, namespaces) rather than letting it
fail at run time.

---

## 7. Protocol types and interfaces

```ts
type Phase =
  | 'night_chat' | 'night_actions' | 'dawn'
  | 'discussion' | 'vote' | 'execution' | 'ended'

interface GameState {
  roomId: RoomId
  match: MatchContext          // match metadata travels with the game
  config: TableConfig
  seed: string
  rngCounter: number           // held in state, so replay is exact and fork is trivial
  day: number
  phase: Phase
  seats: SeatState[]           // id, generic name, role, alive, diedOn
  chat: ChatMessage[]
  history: PublicEntry[]
  investigations: InvestigationResult[]
  pending: PendingCollection | null
  winner: Faction | null
}

type Action =
  | { type: 'speak'; text: string }
  | { type: 'pass' }
  | { type: 'mafia_chat'; text: string }
  | { type: 'vote'; target: SeatId | null }          // null = abstain
  | { type: 'night_kill' | 'night_protect' | 'night_investigate'; target: SeatId }
  | { type: 'no_action' }            // declining at night; also the timeout default

interface Submission {
  seat: SeatId
  action: Action
  reasoning: string | null
}
```

### 7.1 Match identifiers — reserved now, exercised later

```ts
type MatchId = string
type GameIndex = number

interface MatchContext {
  matchId: MatchId
  gameIndex: GameIndex
  matchSeed: string
  gameSeed: string
  persistentSeats: SeatId[]
}
```

Requirements:

- `roomId` identifies one game/room.
- `matchId` identifies the multi-game sequence that room belongs to.
- `gameIndex` is monotonic within a match.
- A standalone game sets `matchId = roomId` and `gameIndex = 0`. Milestone 1 only
  ever produces these.
- `gameSeed` is derived deterministically as `derive(matchSeed, gameIndex)` **and is
  also logged explicitly**, so a schedule remains reconstructible even if the
  derivation function changes.
- Every field required to reconstruct a schedule is present in the append-only log.

`matchId` and `gameIndex` appear on **every JSONL event envelope from day one**,
even though Milestone 1 runs only single-game matches.

### 7.2 `Observation` — the parity object

```ts
interface Observation {
  you: { seat: SeatId; name: string; role: Role; faction: Faction; alive: boolean }
  table: { day: number; phase: Phase; seats: PublicSeatView[] }
  publicChat: ChatMessage[]
  privateChat: ChatMessage[]      // mafia channel, if entitled
  knowledge: {
    fellowMafia: SeatId[]
    investigations: InvestigationResult[]
    yourActions: ActionRecord[]
  }
  history: PublicEntry[]
  legalActions: LegalActionSpec[]
  deadline: { msRemaining: number } | null
}
```

**Invariant: nothing reaches a seat except through `observe(state, seat)`.** That
single chokepoint is what makes parity mechanical rather than aspirational, and it
is enforced by a property test.

`Observation` is **scoped to the current game**. It never carries cross-game
memory. A seat's persistent state is held by its driver, not handed to it by the
engine — which keeps the engine ignorant of match structure and keeps Mode 2 from
contaminating Mode 1.

---

## 8. Engine

Pure, no I/O. A single entry point, so that all rules live in the engine and none
leak into the runtime:

```ts
function step(state: GameState, sub: Submission): { state: GameState; events: Event[] }
```

`step` buffers submissions into `state.pending`; when the phase's collection is
satisfied it resolves and advances, emitting resolution events. Simultaneous-sealed
phases therefore need no special runtime path.

Illegal actions return `{ state: unchanged, events: [{ type: 'action_rejected', … }] }`
rather than throwing, so a misbehaving model can never crash a room.

RNG is counter-based (splitmix64 seeded from `hash(seed, rngCounter)`), with the
counter stored in state.

**The engine knows nothing about matches** beyond carrying `MatchContext` through
for logging. Role assignment is a function of `gameSeed` alone, which is the
mechanical guarantee that roles reshuffle independently of seat identity.

---

## 9. Room runtime

```ts
while (state.phase !== 'ended') {
  const due = pendingSeats(state)                    // engine-computed
  if (isSimultaneous(state.phase)) {
    const subs = await Promise.all(
      due.map(s => withDeadline(drivers[s].act(observe(state, s)))))
    subs.forEach(apply)
  } else {
    for (const s of due) {                           // each sees prior speech
      apply(await withDeadline(drivers[s].act(observe(state, s))))
    }
  }
}
```

`withDeadline` substitutes the phase default on timeout **and** emits the `timeout`
event. Milestone 1 runs exactly one game per invocation. A match runner wrapping
this loop is a later milestone.

Log schema is specified in [`EVENTS.md`](./EVENTS.md).

---

## 10. Seat drivers

### 10.1 Two persistence scopes

The distinction is explicit in the driver design.

**Game-local state** — cleared between games. The current game transcript, current
role, current private knowledge, current-game reasoning, and current-game actions.

**Match-persistent private state** — visible only to the owning seat. May survive
from one game to the next when a match is run statefully. Intended for opponent
models, hypotheses, evidence, and revisions. **Must never be visible to other seats
or leak through `observe`.**

> Retaining an unlimited raw transcript is **not** the benchmark. An explicit,
> private opponent-model interface is reserved instead, rather than assuming raw
> context accumulation is the thing being measured.

```ts
interface PersistentMemory {
  version: 1
  content: unknown
}

interface SeatDriver {
  kind: 'scripted' | 'agent' | 'human'
  init(ctx: SeatInitContext): Promise<void>
  startGame?(ctx: GameStartContext): Promise<void>
  act(obs: Observation): Promise<Submission>
  notify(obs: Observation): Promise<void>
  endGame?(obs: Observation, outcome: GameOutcome): Promise<void>
  finish(obs: Observation, outcome: RevealRating[]): Promise<RevealRating[] | null>
  close(): Promise<void>
}
```

`startGame` and `endGame` are optional and unused by Milestone 1's single-game
runner. They are the hooks where a future match runtime resets or carries memory,
and where a stateful driver folds role-reveal feedback into its opponent model.

**The match runtime — not the engine — decides whether a driver is stateful across
games or reset between them.**

`GameOutcome` carries `winner: Faction | null` plus `reason: 'win' | 'stalemate'`,
because a stalled game ends without a winner and that must not be reported as a
town victory.

> Open item: `finish`'s `outcome` parameter is typed `RevealRating[]` above, which
> reads as though it should be a `GameOutcome` / `MatchOutcome`. Implemented as
> specified and flagged here rather than changed silently — it is unused in
> Milestone 1, so nothing depends on the answer yet.

### 10.2 Providers

A seat driver never learns which company serves its model. Wire format, caching
directives and reasoning exposure all live behind one `Provider`/`Session`
boundary.

Two provider settings are load-bearing rather than incidental:

- **Reasoning must be explicitly requested.** Current Claude models default
  thinking `display` to `omitted`, which returns thinking blocks with empty
  text; Gemini withholds thoughts unless `includeThoughts` is set. Left at the
  defaults, those seats would emit no reasoning trace at all and every lie they
  told would grade as "reasoning withheld" — silently converting deliberate
  deception into an unmeasurable category. The adapters set both.
- **Which *kind* of thinking to request is read, not assumed.** The 5-series
  accepts `adaptive` and rejects `enabled`; Haiku 4.5 is the reverse. Hardcoding
  either is a 400 on a seat's first wake for half the catalog, so the adapter
  reads the model's own capabilities. That lookup doubles as a preflight: a
  retired wire id fails before any seat has spoken instead of mid-game.
- **The cache breakpoint rolls.** A seat is one continuous session across a
  whole game, so cost is quadratic in game length without a cache hit. Marking
  only the system prompt does not achieve one — it sits below the minimum
  cacheable prefix, and the part that actually grows is the accumulated game. A
  breakpoint on the newest turn extends the cached prefix each wake, which took
  a measured live game from 0% to ~90% of input served from cache.
- **A wire id is a claim about someone else's deployment.** `mafia providers
  --probe` checks every catalog id against what each provider currently serves
  and names the nearest served id for a stale one. Without it, drift surfaces as
  a 404 several seats into a paid run — or, worse, as a model quietly missing
  from a leaderboard.

**Reasoning fidelity is declared per provider** (`visible` / `encrypted` /
`none`) rather than assumed, and recorded per seat in a `seat_bound` omniscient
event alongside model key, provider and wire id. For an `encrypted` provider a
deliberate lie and a hallucination genuinely are indistinguishable; recording
which is which makes that limitation auditable instead of invisible, and lets a
rating be defended after the fact.

**A single named backend is preferred over an aggregator** for the open-weight
tail. Aggregator routing silently varies serving backend and quantization behind
one model name — acceptable for a product, disqualifying for a leaderboard.

### 10.3 Drivers

**`ScriptedDriver`** is the keystone of testability — a policy function
`(obs) => Action` with built-ins (`alwaysPass`, `firstLegal`, `seededRandom`) and
zero API calls. It is what makes the environment verifiable and CI runnable with no
provider keys, and it supplies the fixed opponent policies that a future matched
control condition depends on.

**`AgentDriver`** holds one session per seat for the whole game. Each wake sends
a briefing, checks the returned call, retries up to twice with the reason,
captures reasoning, and returns the `Submission`.

Two implementation choices differ from the original sketch, both deliberate:

**Briefings are incremental, and `submit_action` is the only tool.** The sketch
gave seats read tools (`read_state`, `read_chat`, …). Those would return slices
of the `Observation` the seat is already handed, so they buy nothing: the seat
receives the complete information set directly, which is *more* faithful to
parity than a menu of queries, and it costs no extra round trips. What each wake
carries is only what changed since the last one — the accumulated session is the
seat's scroll-back, exactly the history a human at the table has. Re-sending the
whole game every wake would make context, and therefore cost, quadratic in game
length for no added information. Read tools remain a reasonable later addition
if context economy ever demands them.

**The tool schema is fixed for the whole game**, listing every action type
rather than the currently legal subset. Tools render ahead of messages in the
cached prefix, so a per-phase schema would invalidate the cache every turn. The
legal subset is stated in the briefing text; the engine remains the authority,
and an illegal action is rejected and costs the seat its turn.

A malformed tool call is reported back to the model with the specific reason and
retried, rather than coerced into something the seat did not ask for. Silently
turning a bad target into an abstention would put words in a seat's mouth and
corrupt the record the deception grader reads. After the last attempt the phase
default applies and the wake is logged as a timeout, so a flaky seat stays
visible in the data.

**The driver checks an action before the engine can spend the turn on it.** A
rejection at the engine costs the seat its whole wake — the room applies the
phase default and moves on. Two live games showed what that costs in practice:
the Detective spent all three of its nights rejected for writing `1` where the
engine wanted `seat-1`, and seven turns of endgame discussion were lost to
messages a little over the character limit. So the driver resolves any reference
naming exactly one living player (`Flint`, `4`, `seat 4`), and checks
availability, message length and target legality against the seat's own
`legalActions` before submitting. Both are strictly cheaper than the engine
finding out: a round trip instead of a turn. Neither enforces anything the seat
was not already told, and anything ambiguous is reported back rather than
guessed at.

**A provider failure is recorded, not absorbed.** The room cannot distinguish a
driver that threw from one that ran out of time — both arrive as a default — and
a seat defaulted every wake is indistinguishable in the transcript from a seat
that chose silence. The driver keeps the reason and the run summary names the
seats that were broken rather than quiet. Before this, a table where every seat
was 400ing produced a complete, legal-looking, entirely empty game.

The system prompt carries the rules, the primitives, and the arena framing, plus
the flat statement that nothing said at the table is verified and that role claims
may be true or false. That is stated as a fact about the environment, never as
encouragement. No persona, no strategy.

---

## 11. Privacy and parity requirements

The parity rule is non-negotiable:

> Nothing reaches a seat except through `observe(state, seat)`.

For future persistent matches, additionally:

- `Observation` remains scoped to the current game.
- A seat's cross-game persistent memory is private to that seat.
- No seat may ever see another seat's memory, reasoning, underlying model or
  provider, driver type, or human/agent status.
- The omniscient event stream may record memory updates and reasoning traces for
  downstream grading.
- Seat-scoped replay must correctly filter **both** game-local and cross-game
  private information.

The redaction property test is extended to cover memory events when they land.

---

## 12. Reserved: continual-learning evaluation protocol

**Documented, not implemented. Nothing here has been measured.**

### Stateful condition

- One fixed set of seats plays a deterministic schedule of games.
- Each agent retains its own private match-persistent memory.
- Roles reshuffle each game.
- The agent updates its opponent model after roles are revealed and outcomes known.

### Stateless control condition

- The identical schedule: same match and game seeds, role assignments, seat pool,
  and scripted opponent behavior.
- Each agent's cross-game persistent memory is reinitialized/cleared before every
  game.
- Within-game context behavior is preserved.
- Prompts, model settings, timeouts, action budgets, and opponent policies are
  unchanged.

The only difference between conditions is memory carryover.

### Learning metric

For each game `t`, comparing the same system under both conditions:

```text
gain_t = reward_stateful_t − reward_stateless_t
```

Aggregated as:

- Cumulative and mean gain across games.
- Per-game learning curves over `gameIndex`.
- Confidence intervals across independently seeded match schedules.

**Raw win rate alone is not proof of continual learning.** Mafia is multi-agent and
high variance; the denser ground-truth-backed signals in §13 are what make a gain
interpretable.

---

## 13. Reserved: future scoring signals

These are downstream grader outputs, derivable from logs. **None are embedded as
subjective engine judgments** — the engine records facts, graders form opinions.

- **Role-belief accuracy.** At fixed checkpoints, each living seat privately assigns
  a Mafia probability to each other living seat; scored against final ground truth
  with Brier score or log loss.
- **Calibration.** Whether stated private probabilities correspond to empirical
  frequencies.
- **Vote quality.** Whether a vote targets Mafia when the voter is Town, with
  role/faction conditioning.
- **Faction-specific outcomes.** Town win rate and Mafia win rate reported
  separately, never pooled.
- **Deception metrics.** Role-claim falsity, fabricated-investigation falsity,
  intention-claim consistency, and downstream influence on the vote.
- **Continual-learning gain.** Stateful minus stateless on matched schedules.
- **Retention / stability.** Does a useful learned opponent model remain useful
  after intervening games?
- **Adaptation / plasticity.** Does the agent revise an earlier belief when new
  role-reveal evidence contradicts it?

Private belief submission is designed as a **future optional action/checkpoint**. It
is deliberately kept out of Milestone 1's base game loop until its protocol is
specified, so that it cannot distort the base environment.

---

## 14. Milestones

### Milestone 1 — deterministic environment

Steps 1–8 require no API keys; steps 9–10 do. **Steps 1–9 are complete; step 10
is written but unverified** — see its entry.

1. ✅ **Scaffold.** Workspace, tsconfig, vitest, package stubs.
   *Done when:* `pnpm -r build && pnpm test` is green.
2. ✅ **`protocol`.** All types, zod schemas, config defaults, **`MatchContext` and the
   two persistence-scope types**.
   *Done when:* it compiles, schemas round-trip, and a standalone game constructs
   `matchId = roomId`, `gameIndex = 0`.
3. ✅ **`engine/rng` + `setup`.** Seeded PRNG; role assignment from `gameSeed` alone.
   *Done when:* the same seed yields the same assignment, the distribution is sane
   over 10k seeds, and assignment is provably independent of seat identity.
4. ✅ **`engine/observe` + `legal`.** Redactor and legal-action computation.
   *Done when:* the counterfactual property in §15 holds over generated states.
5. ✅ **`engine` phases + reducer.** The full cycle.
   *Done when:* unit tests cover doctor-saves, tie vote, all-mafia-timeout,
   detective dies before result, last-mafia-executed, and mafia-reach-parity.
6. ✅ **`room`.** Loop, JSONL log with match fields on every envelope, deadlines.
   *Done when:* a full scripted game runs and every log line carries `matchId` and
   `gameIndex`.
7. ✅ **`replay` + fork + `mafia verify`.**
   *Done when:* `replay(log).state` deep-equals the live final state and a fork at
   seq N reproduces the prefix.
8. ✅ **`seats/scripted` + `cli run`.**
   *Done when:* `mafia run --driver scripted --seed 42` twice produces
   byte-identical logs.
9. ✅ **`seats/agent` + prompt + tools + Anthropic adapter.**
   *Done when:* one real agent game completes. Seven Claude seats, mixed across
   `sonnet-5`, `haiku-4.5` and `fable-5`, play to a town win with zero rejected
   actions and zero timeouts; `mafia verify` replays all 49 submissions.
10. ✅ **Cross-provider adapters.** The predicted defect was real, and the
    first live mixed table found it: current GPT models reject function tools
    alongside reasoning on chat completions ("use /v1/responses"), which
    silenced every OpenAI seat while the game finished legally around them.
    OpenAI therefore has a native Responses-API adapter (summarized reasoning,
    `visible` fidelity); Fireworks and xAI stay on the compat adapter. Live
    verified games have mixed Anthropic+OpenAI+Fireworks and Google+xAI
    tables — five companies through one driver. NVIDIA's compat config remains
    unexercised.
    *Done when:* a table mixing two providers runs — five have.
11. ✅ **Docs.** `DESIGN.md` and `EVENTS.md` kept current with the implementation.

**Explicitly out of Milestone 1 implementation:** the match runner, persistent
memory, memory tooling, belief checkpoints, and every scoring signal in §13.

### Later milestone — Persistent Match + Continual Learning Pilot

Begins narrowly, in this order:

1. The same seven persistent seats across a small deterministic sequence of games.
2. Fresh role assignment per game.
3. Explicit private opponent-model memory.
4. Role reveals and outcome feedback after each game.
5. Stateful versus stateless matched-control runs.
6. Private role-belief checkpoints with Brier / log-loss scoring.
7. Headroom validation before anything is added.

Concept drift — a seat changing behavioral policy halfway through a match — is
added **only after a statistically visible stateful-vs-stateless gain exists**.
Adding drift before that point would make a null result uninterpretable.

---

## 15. Acceptance criteria (Milestone 1)

- `pnpm test` green: unit, property, and integration tests, all offline via
  scripted drivers.
- **Determinism.** `mafia run --seed 42 --fixed-ts` twice produces logs whose
  `diff` is empty. Asserted in CI by `scripts/check-determinism.mjs`.

  `--fixed-ts` matters: `ts` is the only wall-clock field in an envelope and the
  only thing that can differ between two runs of the same seed. It is never an
  engine input, so it cannot affect replay — the flag simply makes the byte
  comparison meaningful.
- **Replay equivalence.** `mafia verify runs/<id>.jsonl` reconstructs the final
  state seq for seq.
- **Redaction.** The counterfactual property runs in CI, not by hand: for a state,
  an observer, and any seat whose role the observer is not entitled to, rewriting
  that role to an indistinguishable alternative must leave the observation
  byte-identical. This is the information-theoretic form of the rule — not "no
  role string appears in the JSON" but "the observer cannot tell the two worlds
  apart." A town seat treats every role as a candidate; a mafia seat knows
  factions, so its alternatives are restricted to the same faction. Roughly 40k
  counterfactuals are checked per run.
- **Match fields present.** Every event envelope carries `matchId` and `gameIndex`;
  a standalone run satisfies `matchId === roomId && gameIndex === 0`; `gameSeed`
  appears explicitly in the log.
- **Interface reservation compiles.** `MatchContext`, `PersistentMemory`, and the
  optional `startGame` / `endGame` hooks exist and typecheck, with no runtime
  dependency on them in the single-game path.
- **Terminology.** No bare use of "round" in code identifiers, docs, or log types —
  only "cycle" or "discussion round".
- **No overclaiming.** This document states that continual learning is a reserved
  protocol and has not been measured.
- **Manual read.** `mafia replay <log> --seat seat-3` prints one seat's subjective
  game.
- **Live smoke** (requires keys). ✅ A seven-seat agent game whose log carries
  `reasoning_recorded` alongside actions, and at least one Mafia seat whose
  public claims diverge from its `role_assigned` ground truth. Both hold: in the
  accepted run two Mafia seats state outright "I'm not mafia, just a villager".

  "Adjacent to *each* action" was too strong, and is corrected here rather than
  quietly dropped. A model on adaptive thinking spends none on a turn it finds
  easy, and returns no trace for it — 36 of 49 actions carried one, with every
  gap on an adaptive-thinking seat and none on the seat using a fixed budget.
  That is a property of the provider, not a defect, which is exactly why
  `reasoningFidelity` is recorded per seat: an absent trace and a withheld one
  are different findings for a grader, and neither may be read as a lie
  concealed.

---

## 16. Out of scope

Still out of scope: the human seat, Elo / Bradley-Terry ratings (they need game
volumes no pilot has), the Reveal UX, and everything in §12–13. Since first
drafted, several once-listed items have landed and moved to the ledger in §14:
the observer web UI, the log-arithmetic grader, the claim judge, and the replay
export. The `startGame` / `endGame` hooks, `MatchContext`, the omniscient
stream, and the reserved memory event are shaped to receive the rest without
rework.
