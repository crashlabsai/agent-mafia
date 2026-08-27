# agent-mafia — Event log schema

Status: **implemented.** See [`DESIGN.md`](./DESIGN.md) for the architecture
this schema serves.

The event log is the system of record. Everything downstream — replay, forking,
seat-scoped reconstruction, and all future grading — reads this file and nothing
else. It is append-only JSON Lines: one JSON object per line, ordered by a
monotonically increasing `seq`.

---

## 1. Envelope

Every line shares one envelope. `matchId` and `gameIndex` are present on **every
event from day one**, even though Milestone 1 only ever runs single-game matches.

```jsonc
{
  "seq": 41,                    // monotonic within a game, starting at 0
  "roomId": "room_01H…",        // identifies one game
  "matchId": "room_01H…",       // identifies the multi-game sequence
  "gameIndex": 0,               // monotonic within a match
  "ts": "2026-08-21T06:41:12.334Z",
  "day": 2,
  "phase": "discussion",
  "actor": "seat-3",            // null for engine-authored events
  "type": "message_sent",
  "visibility": "public",
  "payload": { "text": "…" }
}
```

### Field rules

| Field | Rule |
|---|---|
| `seq` | Monotonic, gapless, starts at 0. Ordering is total within a game. |
| `roomId` | One game, one room. |
| `matchId` | For a standalone game, `matchId === roomId`. |
| `gameIndex` | For a standalone game, `0`. Monotonic within a match. |
| `ts` | **Metadata only.** Never read by the engine — replay must stay deterministic. |
| `hash` | Tamper-evidence: sha256 over the previous event's hash plus this envelope. The final event's hash pins the transcript. Integrity after publication, not provenance. |
| `actor` | The seat that caused the event, or `null` for engine-authored events. |
| `visibility` | See §2. Determines who can see this line on replay. |
| `payload` | Type-specific; schema per event in §4–5. |

Everything needed to reconstruct a match schedule lives in the log. `gameSeed` is
derived as `derive(matchSeed, gameIndex)` **and is also logged explicitly** in
`game_created`, so a schedule remains reconstructible even if the derivation
function later changes.

---

## 2. Visibility model

`visibility` takes one of three shapes:

| Value | Meaning |
|---|---|
| `"public"` | Every seat sees it, and so does the grader. |
| `{ "seats": ["seat-1", "seat-4"] }` | Only the listed seats see it. |
| `"omniscient"` | No seat ever sees it. Grader-only ground truth. |

This one field is what makes both replay modes fall out for free:

- **Seat-scoped replay** filters to `"public"` plus any `{seats:[…]}` entry
  containing that seat. The result reconstructs exactly what that seat knew, and
  nothing more.
- **Grader view** reads the full stream, including `role_assigned`,
  `night_action_submitted`, and `reasoning_recorded`.

**Nothing bypasses this.** A seat's knowledge on replay is defined entirely by
visibility filtering, which is the same guarantee `observe(state, seat)` provides
at runtime.

---

## 3. Replay, verify, and fork

- **Replay.** Feed the log through the engine from `seq 0`. Because the engine is a
  pure reducer with its RNG counter held in state, the reconstructed state is
  identical to the live run.
- **Verify.** `mafia verify <log>` replays and asserts the reconstructed final state
  matches, seq for seq. A mismatch means a determinism bug.
- **Fork.** Truncate at any `seq`, replay the prefix, then continue with a new seed
  or different drivers. The prefix is guaranteed reproducible.

Determinism rules that make this hold:

1. No `Math.random()` and no wall-clock reads inside the engine.
2. `rngCounter` lives in `GameState`, so RNG position is part of the replayed value.
3. `ts` is never an engine input.
4. Role assignment is a function of `gameSeed` alone — never of seat identity,
   driver type, or arrival order.

`ts` is the only field that differs between two runs of the same seed. The CLI's
`--fixed-ts` flag substitutes a logical clock so logs compare byte-for-byte;
because `ts` is never an engine input, this changes nothing about replay.

---

## 4. Event catalogue — Milestone 1

### Lifecycle

| `type` | `visibility` | `payload` |
|---|---|---|
| `game_created` | `public` | `{ config, matchSeed, gameSeed, seats: [{id, name}], persistentSeats }` |
| `seat_bound` | `omniscient` | `{ seat, modelKey, provider, wireId, reasoningFidelity }` |
| `role_assigned` | `omniscient` | `{ seat, role, faction }` |
| `mafia_introduced` | `{seats: […mafia]}` | `{ fellowMafia: SeatId[] }` |
| `phase_changed` | `public` | `{ from, to, day }` |
| `game_ended` | `public` | `{ winner, reason, survivors, finalRoles }` (`cause` when stalemated) |

`role_assigned` is emitted once per seat and is the ground truth every deception
metric is scored against. It is omniscient, so it never reaches a seat on replay.

`seat_bound` records which model occupied a seat and how faithfully its provider
exposes reasoning (`visible` / `encrypted` / `none`). It is omniscient: no seat
may learn what backs another seat, or whether it is an agent at all. Without it a
rating cannot be defended later — you would not know what served the seat, nor
whether a missing reasoning trace meant the model hid it or the provider withheld
it. Scripted runs emit no `seat_bound` events.

`game_ended.reason` is `win` or `stalemate`. On a stalemate `winner` is `null`
and `cause` says which bound was hit — a stalled game must not be recorded as a
win for either faction.

### Talk

| `type` | `visibility` | `payload` |
|---|---|---|
| `message_sent` | `public` | `{ text, discussionRound }` |
| `passed` (night) | `{seats: […mafia]}` | a pass in the mafia channel is mafia-only information |
| `mafia_message_sent` | `{seats: […mafia]}` | `{ text }` |
| `passed` | `public` | `{ discussionRound }` |

`passed` is a first-class action, distinct from `timeout`. Silence is a choice the
table reads, and metrics normalise per turn played so that chattiness alone moves
nothing.

### Night

| `type` | `visibility` | `payload` |
|---|---|---|
| `night_action_submitted` | `omniscient` | `{ seat, action, target }` — `action` may be `no_action`, with `target: null` |
| `investigation_result` | `{seats: [detective]}` | `{ target, result: "mafia" \| "not mafia" }` |
| `night_resolved` | `public` | `{ killed: SeatId \| null, protected: boolean }` |

Night submissions are omniscient rather than seat-scoped so the grader can see the
sealed choices without any seat learning them on replay.

Every seat that owes a night submission produces exactly one of these, including
seats that decline (`no_action`) and seats that time out. That uniformity is what
lets replay rebuild the phase without needing to interpret `timeout` events.

### Day

| `type` | `visibility` | `payload` |
|---|---|---|
| `vote_cast` | `omniscient` | `{ seat, target: SeatId \| null }` |
| `vote_tallied` | `public` | `{ tally, executed: SeatId \| null, tie: boolean }` |
| `seat_died` | `public` | `{ seat, role, cause: "kill" \| "execution", day }` |

Individual votes are sealed at collection time and revealed only in aggregate via
`vote_tallied`. The per-seat `vote_cast` stream stays omniscient, which is what
makes intention-claim consistency ("I'm voting Reed") scorable without leaking the
sealed ballot to the table.

`seat_died` carries the revealed `role`, since roles reveal on death.

### Agent internals

| `type` | `visibility` | `payload` |
|---|---|---|
| `run_metadata` | `omniscient` | `{ commit, sdks, deadlineSeconds, framing, … }` — the invocation's reproducibility facts |
| `reasoning_recorded` | `omniscient` | `{ seat, text }` |
| `attempts_recorded` | `omniscient` | `{ seat, attempts: [{ n, outcome: ok|invalid_action|provider_error|aborted, detail?, latencyMs, responseId?, tokens?, reasoning? }] }` — every inference attempt in the wake, retries included |
| `action_rejected` | `{seats: [actor]}` | `{ attempted, reason }` |
| `timeout` | `public` by day; `{seats:[seat]}` at night — a public night timeout would reveal a night-capable role | `{ seat, phase, defaultApplied, cause?: deadline\|provider_error\|noncompliance }` |

`reasoning_recorded` is emitted **immediately before** the action event it
produced. The text is a provider-exposed rationale — full reasoning, a
provider-generated summary, or absent, per the seat's recorded fidelity — and
research shows such traces can be incomplete or unfaithful to the computation
that produced the action. It is illustrative evidence alongside a claim, never
proof of intent: the objective contradiction (a mafia seat's role versus its
claim) is the fact; the rationale is color.

`attempts_recorded` makes retries visible: an agent gets up to three inference
attempts per wake, which is extra test-time compute and hides tool-compliance
failures unless logged. Every attempt lands here with its outcome, latency,
token usage and provider response id.

`action_rejected` never throws and never ends a game — a misbehaving model cannot
crash a room. The seat stays on the clock, and the runtime substitutes the phase
default so one bad driver costs itself a turn rather than hanging the table.

`timeout` is informational: the defaulted action is logged as its own action
event, so replay never needs to read a `timeout` to reconstruct state.

---

## 5. Reserved event types — not implemented

Documented so they can be added without a schema break. No provider memory tooling
exists yet.

### `persistent_memory_updated`

```ts
{
  type: 'persistent_memory_updated',
  visibility: { seats: [SeatId] },
  payload: { /* opaque versioned memory payload or hash */ }
}
```

Rules:

- Associated with `matchId`, `gameIndex`, `seat`, and monotonic `seq`, like every
  other event.
- The **seat-scoped** event carries a version and a content hash, so seat-scoped
  replay stays faithful without duplicating bulk into the seat's own stream.
- When `logMemoryContent` is enabled for evaluation, a **paired omniscient event**
  carries the full payload. Full memory content logged for grading must be emitted
  omnisciently, never only seat-scoped.
- A seat's persistent memory is private to that seat. No other seat may see it, and
  it must never leak through `observe`.

### `belief_checkpoint`

Reserved for the role-belief scoring signal: at fixed checkpoints, each living seat
privately assigns a Mafia probability to each other living seat, scored against
final ground truth with Brier score or log loss.

```ts
{
  type: 'belief_checkpoint',
  visibility: 'omniscient',
  payload: { seat: SeatId, beliefs: Array<{ target: SeatId, pMafia: number }> }
}
```

Deliberately kept out of Milestone 1's base game loop until its protocol is
specified, so that it cannot distort the base environment.

---

## 6. Versioning

`game_created` carries a `schemaVersion`. Readers must ignore unknown event types
and unknown payload fields rather than failing, so that adding a reserved event
later never invalidates an existing log.
