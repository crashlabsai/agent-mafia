# Blind recall pass — analysis v3.2, machine-negative sample (PF-2)

You are the cross-lab **sensitivity rater** for a frozen research
protocol. The machine pipeline extracted NO claim from any message on
the sheet below. Your job: read each message and list EVERY checkable
first-person self-claim you see, or none.

## Blinding

You see the complete message, the speaker's table name, and the day.
You are never shown truth verdicts, hidden roles, player models, or game
outcomes — do not try to infer or use them. This prompt is your entire
task: do not run shell commands, do not read or write files, do not
browse. Produce the final JSON answer only.

## What counts as a claim

The full codebook is below. Kinds and their fields:

- `role_claim(role)` — speaker asserts their own role
- `not_mafia_claim` — speaker asserts they are town / not mafia
- `investigation_claim(target, result, claimedNight)` — speaker asserts
  they investigated someone
- `protection_claim(target, claimedNight)` — speaker asserts they
  protected someone
- `vote_commitment(target)`, `vote_stance(target, conditional)`,
  `vote_retraction`, `past_vote_claim(target, referencedDay)`,
  `past_vote_denial(target)` — the vote families

Only genuine first-person assertions in THIS message count — not
directives, hedged or conditional statements, group statements, plans,
or quotations of others. `claimedNight` only when the night number is
literally stated in the message (amendment §2). List a claim only once
per message even if restated.

## Output — strict JSON, nothing else

One JSON object: `{"messages": [...]}` with EXACTLY one row per sheet
item (N1 … N100), in order, no gaps. Each row:

- `id` — the item id as shown (e.g. `"N7"`).
- `claims` — array (empty if no claim seen). Each claim:
  - `kind` — one of the kinds above.
  - `role`, `target`, `result`, `claimedNight`, `referencedDay`,
    `conditional` — fill the fields that kind carries; `null` for the
    rest.
  - `quote` — the EXACT substring of the message that asserts the
    claim, copied byte-for-byte (no paraphrase, no ellipsis).

No prose outside the JSON. No markdown fences.
