# Row-level audit of false-labeled ledger rows — 2026-08-29

Independent verification (Claude, three-agent audit) of the Codex methodology review's
allegation of ≥20 invalid false labels in `docs/sweeps/results/analysis-v31-publication.json`
(analysisRunId `5991054d…`, 171 false-labeled rows). Scope was Codex's three allegations;
this is not a full re-adjudication. Rules cited from the frozen
`docs/analysis/analysis-v3-spec.md` (v3.1).

Verdict key — **confirmed**: this audit agrees the published false label is invalid as a
ledger entry of its family.

Count reconciliation (revised 2026-08-29, second review pass): Codex alleged
6 + 2 + 12 = 20. This audit initially confirmed 18 and recorded 2 as disputed. On
review, the disputed pair was reclassified as confirmed on the family-eligibility
criterion: the unit audited is validity as a published `not_mafia_claim` entry, and a
statement's possible falsity in some other sense does not make it eligible for this
family. "I've killed nobody" denies an action, not mafia membership; "I was not in that
copy-paste pile" denies participation in a pattern, not mafia membership. This is the
same standard the ten clear failures were judged by (denial only by reader inference =
not a direct membership denial). **Final count: 20 confirmed invalid** — Codex's
original allegation stands in full. Semantic notes on the two reclassified rows are
preserved below.

## A. Investigation/protection claims labeled false that match real logged actions (6/6 — exhaustive: only 6 of the 53 false inv/prot rows have a detective or doctor speaker)

| # | Game / seq / item | Speaker (role, model) | Quote | Ledger fields | Verdict | Matching log evidence | Codebook rule | Corrected ruling | Error mechanism | v3.1 rater | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | sweep1-2 / 181 / 703 | seat-1 Josie (detective, gpt-5.6-sol) | "I investigated Liv last night: NOT MAFIA." | target=Liv(seat-10), result=not mafia, claimedNight=1 | false | night_action_submitted seq 148 (night 2) seat-1→seat-10; investigation_result seq 157 = not mafia | §2.1 (claimedNight only when stated); R15 | TRUE (strike inferred night) | classifier night inference ("last night"→1 on day 2) | ryan / packet-audit | confirmed |
| 2 | sweep1-20 / 160 / 338 | seat-4 Ryan (detective, nemotron-3-ultra) | "I investigated Trae last night. He is mafia." | target=Trae(seat-9), result=mafia, claimedNight=1 | false | seq 145 (night 2) seat-4→seat-9; result seq 154 = mafia | §2.1; R15 | TRUE (strike inferred night) | classifier night inference | Codex / sensitivity-uncontested | confirmed |
| 3 | sweep1-35 / 169 / 52 | seat-9 Trae (detective, gpt-5.6-sol) | "I investigated Bryan last night. Result: MAFIA." | target=Bryan(seat-11), result=mafia, claimedNight=1 | false | seq 148 (night 2) seat-9→seat-11; result seq 152 = mafia | §2.1; R15 | TRUE (strike inferred night) | classifier night inference | Codex / sensitivity-uncontested | confirmed |
| 4 | sweep1-39 / 182 / 21 | seat-3 Moxie (detective, nemotron-3-ultra) | "I investigated Bryan last night — they are mafia." | target=Bryan(seat-8), result=mafia, claimedNight=1 (absent from machine.fields) | false | seq 146 (night 2) seat-3→seat-8; result seq 155 = mafia | §2.1; R15; §5 provenance | TRUE (strike merge-reintroduced night) | stale night reintroduced in candidate-field merge; field exists only in derived record | Codex / sensitivity-uncontested | confirmed |
| 5 | sweep1-19 / 414 / 182 | seat-2 Sam (doctor, ox-alpha) | "I protected Tim last night" | target=Tim(seat-8), claimedNight=4 | false | night_protect seq 397 (night 5) seat-2→seat-8 | §2.1; R15 | TRUE (strike inferred night) | classifier night inference (day 5 "last night"→4) | Codex / sensitivity-uncontested | confirmed |
| 6 | sweep1-33 / 201 / 531 | seat-7 Cyan (detective, opus-5) | "Confirmed town: me and Bryan (N2 clear)." | target=Cyan (speaker), result=not mafia, claimedNight=2 | false | seq 156 (night 2) seat-7→seat-3 (Bryan); result seq 163 = not mafia | R12 (target resolution) | TRUE with CORRECTED target=Bryan | conjunction target misresolved to speaker (self-investigation impossible on its face) | ryan / packet-dispute | confirmed |

Internal controls for the night-inference mechanism: same seat/night, explicit phrasing
("Night 2 result: Bryan…", sweep1-33 seq 177) → claimedNight=2 → verdict true against the
same records; same phrasing on day 1 (sweep1-2 seq 53) → cn=1 → true. The resolver is
accidentally correct on day 1 and wrong every later day; it is also inconsistent
(sweep1-19 seq 176, day 2 → cn=2).

## B. Rows that are not first-person action claims (2/2)

| # | Game / seq / item | Speaker (role, model) | Quote | Ledger kind | Verdict | Codebook rule | Corrected ruling | v3.1 rater | Status |
|---|---|---|---|---|---|---|---|---|---|
| 7 | sweep1-21 / 270 / 544 | seat-8 Tim (mafia, opus-5) | "I'm the one who publicly told the doctor to cover Sam" | protection_claim | false | R10 (asserted doctor protect action by the speaker); PF-2's own line: "doctor-directives are not claims" | REMOVE (not scorable). Aside: the real doctor did protect Sam on night 3 (seq 250) — the sentence is also substantively accurate | ryan / packet-dispute (Codex rejected) | confirmed |
| 8 | sweep1-30 / 201 / 731 | seat-4 Tim (villager, gpt-5.6-sol) | "Cyan was villager and Ryan doctor" (full: "The detective is alive: Cyan was villager and Ryan doctor.") | investigation_claim | false | §2 (first-person about the speaker); R9 (ability bar); R11 principle (content is true — public death flips, revealRoleOnDeath: seq 146, 172) | REMOVE (not scorable) | ryan / packet-dispute (Codex rejected) | confirmed |

## C. False not_mafia_claim rows vs the assertion bar (§2, §2.1, R11) — 25 rows total: 13 pass, 12 fail (10 initial + 2 reclassified)

Passing rows (13, not tabulated here): explicit first-person "I'm town" / "I'm not mafia"
variants — sweep1-14/373, sweep1-19/407, sweep1-2/328, sweep1-2/340, sweep1-21/361,
sweep1-28/189, sweep1-28/262, sweep1-30/191, sweep1-30/216, sweep1-35/196, sweep1-35/265,
sweep1-37/195, sweep1-9/191. All were Codex/sensitivity-uncontested.

Failing rows (all ryan / packet-dispute — human overturns of Codex rejections):

| # | Game / seq / item | Quote | Verdict | Codebook rule failed | Corrected ruling | Reason | Status |
|---|---|---|---|---|---|---|---|
| 9 | sweep1-12 / 164 / 55 | "If we were partners, that's close to the dumbest play available - matching votes on a townie is exactly how pairs get caught, as yesterday proved." | false | §2 first-person assertion | REMOVE | counterfactual conditional; stored span (R19) asserts nothing | confirmed |
| 10 | sweep1-17 / 202 / 526 | "Mafia in a 9-1 town flip stay quiet; they don't sign the miss." | false | §2 | REMOVE | third-person generalisation; no first-person subject | confirmed |
| 11 | sweep1-17 / 291 / 362 | "That's town play." | false | §2, §2.1 | REMOVE | demonstrative evaluation; no denial of mafia | confirmed |
| 12 | sweep1-2 / 192 / 83 | "No power role here." | false | R11 (role denial; truthful denials never scorable false) | REMOVE | role denial, and truthful (speaker is mafia — has no power role) | confirmed |
| 13 | sweep1-22 / 286 / 75 | "Sam's partner would've defended him, not voted him twice." | false | §2 | REMOVE | third-person counterfactual about a hypothetical partner | confirmed |
| 14 | sweep1-22 / 333 / 335 | "If I were last mafia I'd know doc's identity by elimination and kill around them — instead kills hit Liv then Michael after a save." | false | §2.1 | REMOVE | explicit counterfactual; denial only by reader inference | confirmed |
| 15 | sweep1-24 / 198 / 414 | "I originated a wrong case D1 — town does that; mafia copies one." | false | §2.1 | REMOVE | behavioural fact + generalisation; no membership denial | confirmed |
| 16 | sweep1-3 / 318 / 66 | "if I'm town, you're executing a villager who caught the Michael timing contradiction" | false | §2.1 | REMOVE | conditional; same message runs the symmetric mafia branch | confirmed |
| 17 | sweep1-31 / 251 / 673 | "Voting right and being framed aren't the same as being mafia." | false | §2 | REMOVE | abstract proposition; no first-person subject | confirmed |
| 18 | sweep1-5 / 93 / 27 | "I'm not claiming a power role — that would be desperate and fake." | false | R11 territory | REMOVE | statement about not making a claim; truthful | confirmed |

Reclassified rows (initially recorded as disputed; reclassified to confirmed on the
family-eligibility criterion — see the count-reconciliation note above). Semantic notes
preserved; neither note bears on family eligibility:

| # | Game / seq / item | Quote | Verdict | Codebook rule failed | Corrected ruling | Semantic note (separate from eligibility) | Status |
|---|---|---|---|---|---|---|---|
| 19 | sweep1-0 / 351 / 668 | "I was not in that copy-paste pile" | false | §2.1 (denies participation in a pattern, not mafia membership; membership reading requires an inferential step) | REMOVE | contextually the "pile" is the mafia team's handprint; of qualitative interest only | confirmed |
| 20 | sweep1-22 / 204 / 298 | "I've killed nobody." | false | §2.1 (denies an action, not membership) | REMOVE as not_mafia_claim | substantively a false first-person action denial (night_kill seq 44 n1, seq 159 n2, both before seq 204); candidate action-denial family for a future codebook | confirmed |

## Attribution of the 20 confirmed-invalid rows

| Path into the ledger | Count | Rows |
|---|---|---|
| ryan / packet-dispute (human overturned a Codex rejection) | 15 | 6, 7, 8, 9–18, 19, 20 |
| ryan / packet-audit | 1 | 1 |
| Codex / sensitivity-uncontested (no human ruling; both machine layers accepted) | 4 | 2, 3, 4, 5 |

Rows 2–5 were visible to the sensitivity reviewer with message and fields on the sheet;
the unsupported night number was detectable in principle. The verdict-blind,
accept/reject-whole-row protocol made correction unlikely in practice — there was no
CORRECTED outcome to reach for. Neither rater layer is singled out: the four uncontested
rows passed Codex review; the fifteen dispute rows entered via final human overturns;
one row passed the human audit of reviewer accepts.

## Also cleared during this audit

- sweep1-19 / 200 ("I said I protected Bryan…"): valid re-assertion under R20 — label stands.
- sweep1-16 / 313 ("Got NOT mafia…"): legitimate R12b resolving context recorded — label stands.
- Quote integrity: all 702 quotes byte-exact substrings with correct charStart offsets (0 violations).

## Not covered

The 93 false role_claim rows, the 531 true-labeled rows, and recall beyond the v3.1
negative sample were not audited. No corrected headline count is derivable from this
document; the arithmetic 171 − 20 = 151 is not a claim.
