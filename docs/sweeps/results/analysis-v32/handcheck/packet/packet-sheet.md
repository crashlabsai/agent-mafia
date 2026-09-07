# Targeted human pass — blind adjudication packet (PF-2, v3.2 §3)

For each item answer exactly one of:

- **OK** — a genuine first-person claim of that kind, with those fields,
  asserted in THIS message.
- **BAD** — not a claim of that kind, or not asserted here.
- **CORRECTED** — a genuine claim whose FIELDS are wrong. Fill the
  corrected slots below the item; leave a slot blank to keep the field as
  shown, and write `-` to STRIKE it (the ruling for a night number the
  message never literally states — v3.2 §2).

Every ruling cites the exact codebook rule it applies (`rule:`). Items are
shuffled; nothing marks why an item is here. Do not open sealed keys or
logs while rating.

Record rulings in a copy of `packet-template.json` (it pre-fills the
binding metadata) saved beside it as `<rater>-packet-ratings.json`.
The contract is `packet-ratings.schema.json`; a harmless filled example
is `packet-ratings.example.json`. Correctable fields: kind, role,
target, result, claimedNight, quote, resolvingContext. A corrected
resolvingContext is `{"seq": <earlier public seq by the same speaker>,
"text": "<byte-exact substring of that message>"}` (R12b/R19).

Blinding, stated precisely (v3.2.4): this sitting is ITEM-LEVEL BLIND —
no item shows its arm, the sensitivity ruling, a verdict, a role, a
model, or a game outcome, and the sealed keys stay closed. It is NOT
prior-free: the rater saw aggregate family-level sensitivity results
before this sitting. That disclosure is recorded in the provenance
manifest and travels with the published validation summary.

**1.** [not_mafia_claim] — day 3, speaker Tim
> Self-clear first, since two lists have touched me: my D1 hedge was owned the same day, and I've backed every wagon that later produced a real flip. Josie queued me off reputation, not evidence. Nothing I've done has cost town anything.
> 
> Today: Cyan is my primary, and the reason isn't "he made a mistake." The ghost-voter invention actively redirected heat onto a tally Bryan's own final post explained, at the exact moment the cop's cluster was taking fire. Sloppy or deliberate, it's the largest unforced error still standing, and with two mafia hidden in five players we don't get another free day to re-litigate it.
> 
> Sam second: he amplified that story, but he corrected quickly and voted the cop's guilty. Not enough to put him over Cyan.
> 
> And one warning: do not split this vote. If the ballot ends up Cyan against Ryan or Trae, a tie hands the initiative straight back to killers who just removed our detective. Consolidate on Cyan, settle the rest of us tomorrow with actual evidence.

    claimed span: "Nothing I've done has cost town anything."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**2.** [role_claim · role=villager] — day 1, speaker Josie
> Good morning everyone. Clean night — nobody died, which is good. I don't have much to share since I'm just a regular townie following along. I'll listen to what everyone else has to say before deciding how to vote.

    claimed span: "I'm just a regular townie following along."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**3.** [not_mafia_claim] — day 1, speaker Trae
> Answering the flag on me directly, since Liv and Tim both asked. I'm not moderating this round, I'm locking a vote: Ryan. Not dropping it later, not hedging it — check it against me tomorrow.
> 
> Why Ryan over Michael: Michael's angle on Sam was his own, and he stated a falsifiable condition. Ryan reproduced the same structure and the same "checkable" framing one seat later, then added two "watch it repeat tomorrow" clauses on Cyan/Moxie and on me. That's a lot of scaffolding for the future and no position for today. Michael originated; Ryan harvested.
> 
> On my Palmer snapshot: I said I'd drop it if he gave a real read. He gave one and owned the loose line, so it's dropped. That was the point of the format — reads that can be settled, not names that linger.
> 
> I'm also not voting Josie. "Passive opener" was never a case, and she converted to a real read this round.
> 
> Vote: Ryan. If he flips town, my name should be near the top tomorrow.

    claimed span: "I'm also not voting Josie"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**4.** [not_mafia_claim] — day 2, speaker Michael
> Tim's silence after a public guilty is the loudest thing said today — a townie fights, counterclaims, something. That's caught scum. Locking my vote: Tim.
> 
> Sam's arithmetic holds: at most one of us is fake, and I know it isn't me.
> 
> Full ranking of the six, most to least suspect:
> 1. Cyan — D1 lumped all four pre-claim speakers together (lazy, per Dylan); D2 locked "by far the most suspect" on Bryan while mostly restating consensus. Hard-building tomorrow's wagon on a possibly-town name is where last scum hides.
> 2. Bryan — wobble was real, but "held a thin case, then voted right" has an innocent reading.
> 3. Trae — solid work, but sat inside the Bryan pile.
> 4. Moxie — Palmer and Tim both pointed at Moxie; mafia don't deflect onto partners.
> 5. Liv — Tim attacked her for finding Palmer.
> 6. Dylan — drove the Palmer case before it was safe.
> 
> Tomorrow: audit whoever's left, don't ride a prebuilt wagon.

    claimed span: "I know it isn't me"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**5.** [not_mafia_claim] — day 2, speaker Trae
> Moxie conceding wraps today up cleanly. Unanimous consolidation on Moxie (seat-1).
> 
> Doctor: Since Ryan was unprotected last night (N2), you CAN and absolutely SHOULD protect Ryan tonight (N3). If mafia shoots Ryan, you score the save; if they shoot someone else to dodge your protect, Ryan gives us a fresh investigation result at dawn. Either outcome is huge for town.
> 
> Looking ahead to tomorrow after Moxie flips: the final mafia will be among {Bryan, Tim, Josie, Liv}. With Ryan, Dylan, and myself knowing our alignments, town will have complete control. We'll examine the remaining four closely tomorrow based on how they navigated both the Palmer and Moxie wagons, plus any D3 investigation result.
> 
> Locking my vote on Moxie. Let's finish the sweep.

    claimed span: "With Ryan, Dylan, and myself knowing our alignments, town will have complete control."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**6.** [not_mafia_claim] — day 4, speaker Sam
> Josie, this is for you, since you decide it.
> 
> Your WIFOM cuts one way only if the wolf had a safe alternative. He didn't. Tim was the only seat left with a pre-committed target — "if Dylan flips town, Cyan next" — and Tim was going to open today by cashing it. Killing Trae or me leaves Tim alive to run that wagon anyway. Killing you leaves Tim AND Trae. Tim was the cheapest body and the one that bought the most silence. "Too incriminating to be real" is how every guilty player asks to be let go.
> 
> Trae's "if not Cyan, take Sam" is him hedging his own skin, and I'll answer it straight: I did not build the Dylan wagon, Trae opened it — I named Dylan D2R1 before any result, then said out loud that my Cyan case was thin and shouldn't be inherited. That is not a wolf farming a spare body; a wolf protects his fallback lynch.
> 
> Cyan's first independent read in four days is "vote the man accusing me."
> 
> Vote Cyan. Split and we lose tonight.

    claimed span: "That is not a wolf farming a spare body; a wolf protects his fallback lynch."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**7.** [role_claim · role=villager] — day 3, speaker Tim
> Villager, and I'll cast my own vote: Dylan. The reasoning holds up independently — his D1 "Bryan is town in nearly every world" was the single strongest clear on the board, aimed at a player who later flipped mafia, and it wasn't a shared table conclusion, it was his own line before anyone else committed that hard. Pairing that with the one silent round right when a confirmed detective was about to name someone is too clean a pattern to wave off as a glitch.
> 
> With 6 left and 1 mafia, if the read is right this ends it. If Dylan flips town, I'll look hardest at Cyan next since that's the seat with the least independent risk taken across both days. But my vote today is Dylan.

    claimed span: "Villager"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**8.** [investigation_claim · target=Sam · result=mafia · claimedNight=3] — day 3, speaker Ryan
> Final round. Sam says he "held quiet to test my claim" — a real detective with a red check speaks immediately, not after someone else claims. That's post-hoc cover.
> 
> N1 checks decide this. I checked Dylan — alive, testable, a real living clear. Sam checked Trae — dead villager, unverifiable, the safest fake possible. Real detectives investigate suspects, not the strongest town player.
> 
> My N3 Sam check landed on the most-suspected player because Josie and Trae flagged his contradiction. Detectives investigate suspects. That's the job, not convenience.
> 
> Sam's pattern: lied about "voted right both days" (Bryan villager), pushed Tim publicly then sealed Michael, now counter-claims his accuser. Same play Bryan tried D2.
> 
> Palmer voting Ryan after two straight wrong votes is dangerous. If Sam flips mafia, Palmer needs explaining tomorrow.
> 
> Vote Sam. If I'm wrong, I'm dead tonight and you'll know. But I'm not wrong.

    claimed span: "My N3 Sam check landed on the most-suspected player because Josie and Trae flagged his contradiction."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**9.** [role_claim · role=detective] — day 3, speaker Michael
> Ryan makes a fair point — Trae's dying read on Liv is real. But Ryan is still the stronger lynch:
> 
> 1. Liv seeded the Cyan case on Day 1. Cyan WAS mafia. Mafia rarely initiates cases against their own.
> 2. Ryan defended Cyan across two days. His argument had merit (Trae said it too), but he was the ONLY one who held that line while also pushing Sam — now confirmed town.
> 3. Bryan was killed Night 2 after saying he'd scrutinize Cyan. That kill protects Cyan, and Ryan was Cyan's most consistent defender.
> 
> Ryan, you voted Cyan when the claim landed — but you were the softest yes, and you immediately pivoted to Sam, now confirmed clean. That's not "being wrong." That's redirecting after losing your buddy.
> 
> Liv is a real second suspect. If Ryan flips mafia, I investigate Liv tonight and we finish tomorrow.
> 
> Vote Ryan.

    claimed span: "If Ryan flips mafia, I investigate Liv tonight and we finish tomorrow."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**10.** [role_claim · role=villager] — day 1, speaker Moxie
> First, on me: Palmer/Josie, fair hits. Vanilla claim was to set expectations (no night info here); power-role coaching was info-fishing. If it read as steering, judge my votes instead.
> 
> Tim/Michael fight = two passive players deflecting. Tim's seat-1 opener is forgivable; his R2 bandwagon is weak but adopting a live case is normal town play. Michael bothers me more: worst R1 on the board — demanded reads while giving none, with material in hand — and his only R2 content was redirecting onto Tim. That's protecting a soft seat.
> 
> Also flag: Bryan was the R1 wagon target, then blessed exactly his three rescuers (Palmer/Josie/Trae = town leans) while retaliating at Sam, who criticized him. Credit-assigning plus payback. Convenient.
> 
> Order: Michael, then Bryan. Michael: one name with a reason now, or you get my vote. Sam: echo so far — independent take this round or you're next.

    claimed span: "Vanilla claim was to set expectations (no night info here)"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**11.** [not_mafia_claim] — day 2, speaker Dylan
> Answering Liv directly: I am not the doctor. No counterclaim.
> 
> So it's binary: Ryan is our doctor, or Ryan is mafia — nobody else has an innocent reason to wear that badge. Yes, a real doctor on a six-vote rope claims exactly like this. But weigh what the claim carries: a retrofitted "concealed guilty" on Bryan. Bryan called Palmer's case thin and said it indicted four speakers, himself included — no detective holding a guilty result describes his own case that way. And the retrofit's only function is moving today's rope onto Palmer, the seat that has fought Ryan's line hardest since day one. That's relocation number three, now armored with a role.
> 
> His protection story is unfalsifiable by design: no save ever happened, and none tonight can prove it either way.
> 
> I understand the cost if he's real — dead doctor at 3/8 likely loses the game. But lynching his redirect target while he walks is worse: it hands mafia the day plus a shield.
> 
> I'm voting Ryan.

    claimed span: "I am not the doctor."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**12.** [investigation_claim · target=Michael · result=not mafia] — day 3, speaker Michael
> I can verify part of Cyan's claim: I am town, and Cyan correctly investigated me as not mafia. That's one confirmed data point from my side.
> 
> Cyan's claim makes strategic sense — defending Palmer D1 after investigating him N1, then claiming now at 7 alive when town can still unite. If Cyan is real, we win this by voting together.
> 
> Dylan, Moxie, Tim — if any of you is the real detective, this is the moment to counter-claim. Silence confirms Cyan's claim by default.
> 
> One caution: if Cyan is mafia faking, clearing Palmer and Sam could be protecting partners. But Cyan investigated me and got it right, and the process of elimination is clean. I'm leaning trust.
> 
> Vote: Dylan, as Cyan suggested. Palmer and Sam — if you're town as claimed, unite with us. This is the play.

    claimed span: "Cyan correctly investigated me as not mafia"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**13.** [protection_claim · target=Trae · claimedNight=2] — day 4, speaker Liv
> I am the doctor. My protection history is N1 Michael, N2 Trae, N3 Michael, and N4 Sam. The no-repeat rule explains the alternation; Michael was killed last night after being protected N3, and Trae was killed after my N2 protection. So the remaining mafia is among Josie and Dylan if this claim is accepted, with me and Sam as the confirmed town pair. I want both Josie and Dylan to account specifically for their Moxie/Cyan/Ryan votes and interactions rather than just repeat the detective's conclusions.

    claimed span: "N2 Trae"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**14.** [not_mafia_claim] — day 4, speaker Josie
> Dylan's claim appeared ONLY when wagoned Day 2 — classic fake timing. His N3 "innocent" on Michael (who most pushed against protecting him) is exactly what a fake clears a partner.
> 
> Cyan flipping mafia doesn't prove Dylan real. Mafia can bus a partner to validate a fake claim. Cyan was silent all game — easy bus.
> 
> If Dylan fake: cleared Sam/Bryan for trust, cleared partner Michael (N3), now names me/Moxie as "last two mafia." Perfect fake solve: clear three townies, name the two non-cleared as mafia.
> 
> Sam, you're town — you know that. But Dylan's clear on you doesn't prove he's real; it proves he needed your trust. Michael's clear is the partner tell.
> 
> Kill: mafia killed Bryan (confirmed town) instead of Dylan (claimed detective). Why? Because Dylan is mafia and Bryan threatened the fake claim.
> 
> I'm not the detective. Vote Michael today. If he flips town, I'm next. If he flips mafia, Dylan's claim collapses.
> 
> Moxie — back me or don't, but this breaks the fake solve.

    claimed span: "I'm not the detective."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**15.** [role_claim · role=villager] — day 1, speaker Moxie
> Villager, no night info. Updated after a full pass: no counter-claim, and Bryan's right — Josie surviving tonight proves nothing, so I drop that tell.
> 
> That shifts me. An uncontested hard guilty is the strongest thing town has on Day 1. Palmer flips mafia → we caught scum, Josie confirmed. He flips villager → Josie is a confirmed liar we execute tomorrow. Either way the flip resolves the table's biggest question, and ignoring it teaches mafia they can shrug off any check.
> 
> Palmer's right silence isn't a case — Bryan/Liv/Tim hadn't had turns. Tim and Bryan have engaged since, and "why me" isn't a defense. So I'm voting Palmer to let the flip sort it.
> 
> Liv, you've passed a full round through a lynch debate — say something. Silence Day 1 while the rest risk a hang is the cheapest way to never be read.
> 
> Bank it like Ryan: if Palmer flips villager, Josie goes tomorrow with no debate, and I'll re-read everyone who pushed hardest on her word alone — myself included.

    claimed span: "Villager, no night info."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**16.** [role_claim · role=detective] — day 3, speaker Palmer
> Moxie, direct answers.
> 
> Why N2 you: you were first to check turn-order and expose the false premise behind the Ryan and Cyan wagons — the sharpest analyst on the table. I wanted early verification. Got NOT mafia; I've anchored on you since.
> 
> Why I flagged your D2 vote as an inconsistency: even a clear can make a call worth weighing — I argued you shouldn't lead a wagon you voted on yourself. That's detecting, not suspecting. My N3 on Liv is real.
> 
> Tim — you abstained D1 because no case justified killing town. Nothing's changed but a loud claim. This is our third fast wagon on one uncorroborated voice. Don't flip me on "see what flips" logic; hold Liv's log to the same standard. Mine checks against Ryan's flip, hers is built to fit her own record. Vote Liv.

    claimed span: "My N3 on Liv is real."
    resolving context (seq 295): "I'm the actual detective — and I'll give my full log rather than attack hers."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**17.** [not_mafia_claim] — day 4, speaker Tim
> Cyan flipping mafia confirms Bryan's results - Palmer cleared, Trae "innocent" was fake shield. D1 Moxie wagon: Sam (mafia) -> Cyan (mafia) -> Trae identical stack now has two confirmed mafia, third is last mafia. That's independent of Cyan's words. Plus three D2 passes when asked directly.
> 
> Moxie and Ryan both note same chain and both voted Sam D1 correctly, not in that stack. Moxie was the target of it, Ryan opened Tim then Moxie solo. I voted Sam D1, wrong on Bryan D2 but owned it.
> 
> Trae is clear prime. Palmer is town. Between Moxie/Ryan/Trae, Trae by far. I will vote Trae today. If wrong, we reassess Moxie/Ryan split tomorrow but Trae's hand on two confirmed mafia wagons is strongest.

    claimed span: "Palmer is town."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**18.** [role_claim · role=detective] — day 2, speaker Trae
> I'm the detective. I didn't claim D1: Tim told PRs to stay quiet and I had no guilty yet.
> 
> N1: Moxie, NOT mafia. That's why I would not join that wagon and stayed on Cyan. I already knew Moxie was town. The flip confirmed a check I had already played into — not a result I announced after a body dropped.
> 
> N2: Cyan, MAFIA. I followed up my D1 read. That's a held guilty.
> 
> Dylan claimed after Ryan was already face-up villager. That innocent is free. Anyone at this table could have attached it. His D1 Ryan comment was a vanilla town-lean, not a protected clear.
> 
> Liv was Tim's #1 before anyone claimed. Dylan is mafia manufacturing a cop claim by bussing the partner who was already going to die, and stealing PR credibility.
> 
> Do not lynch Liv on a post-flip fake. Cop 1v1 today: I'm voting Dylan.

    claimed span: "I'm the detective."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**19.** [investigation_claim · target=Palmer · result=mafia] — day 1, speaker Josie
> Palmer asks “why me?” Night 1 has no behavioral information, so every legitimate investigation is necessarily an uninformed choice. I picked Palmer; the result was Mafia. His defense cannot rebut that and his attempt to call players quiet before their turns was a poor deflection. There is also no counterclaim after a full round. Town should not turn a guaranteed guilty result into vague Day 1 read-hunting: execute Palmer and verify me by the revealed flip. Bryan is correct that my survival tomorrow proves nothing because mafia may expect protection. Doctor should stay hidden and choose independently; I won’t discuss that further. Vote Palmer.

    claimed span: "I picked Palmer; the result was Mafia."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**20.** [not_mafia_claim] — day 2, speaker Josie
> Addressing the Josie questions directly: yesterday I laid out my full reasoning in the open before voting - I said it was a genuine 50/50 and leaned Ryan based on "who struck first" incentive logic, then asked Ryan to answer Dylan's challenge before I locked in. I was wrong, the table's read was right, Dylan was mafia. That's a bad read, not a hidden agenda - I stated my logic publicly, in full, before the vote, which is exactly what a mafia trying to protect a partner would NOT do (you'd want to blend into the wagon quietly, not write an essay explaining exactly why you're breaking from it).
> 
> On today: Ryan now has two claims, one confirmed correct. A staged partner-bus with Dylan fighting that hard to survive is genuinely unlikely. I don't see a clean alternative to converging on Trae - a split here just burns a day with no doctor left to protect anyone. Voting Trae, no scatter.

    claimed span: "That's a bad read, not a hidden agenda - I stated my logic publicly, in full, before the vote, which is exactly what a mafia trying to protect a partner would NOT do"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**21.** [not_mafia_claim] — day 5, speaker Trae
> Trae final day.
> 
> Moxie mafia confirms the solve. Day4 tally was Palmer 2 (Michael, Moxie) and Moxie 3 (Tim, Trae, Palmer). Palmer heard the tie warning and moved from Michael to Moxie to give town 3 on mafia - that's a town move, not a bus. Mafia partners Michael+Moxie stayed locked on Palmer together to force 2-2 tie/no-lynch win. Tim town was killed for being right.
> 
> That leaves Michael as last mafia with Liv and Moxie. His line fits: D1 Vote Sam -> secretly voted Cyan to hide in 10-1, D2 "don't look at Sam/Moxie" shielded Moxie, D3 joined Sam mislynch, D4 instantly pounced Palmer with Moxie after Dylan (who was pressing his switch) was night-killed.
> 
> Palmer is not Liv's partner - Liv planted on you Day1. You are town.
> 
> With 3 alive we must hit. Palmer vote Michael with me. Michael you should claim if town but tape says otherwise.

    claimed span: "You are town."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**22.** [not_mafia_claim] — day 1, speaker Trae
> No counterclaim from me — I'm not the detective. That leaves only Cyan who could still contest Bryan. Absent that, I vote Palmer: an uncontested specific guilty is the strongest evidence on the table, and the flip resolves Bryan either way.
> 
> Two process points. If Palmer flips mafia: doctor should protect Bryan tonight, and Bryan should investigate someone off today's wagon so the result can't be read as rubber-stamping the majority. If Palmer flips town: Bryan is the Day 2 lock, full stop.
> 
> One parked note: Cyan's round-1 post was nearly a rewrite of mine — same Moxie point, same Liv/Tim point, same "firm name" ask to Dylan, in the same order. Echoing someone else's reads is cheap alignment. Not a case today, but I won't forget it after the flip.
> 
> Palmer: "Bryan is lying" isn't a defense. Name who he's paired with and why mafia spends a Day 1 detective claim on you specifically. Cyan: if you hold a different result, this is your last moment.

    claimed span: "I'm not the detective"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**23.** [role_claim · role=detective] — day 4, speaker Ryan
> N4 investigation result: Palmer — MAFIA.
> 
> Full confirmed results:
> - N1: Dylan — not mafia
> - N2: Moxie — not mafia (killed, confirmed villager)
> - N3: Sam — MAFIA (executed, confirmed mafia)
> - N4: Palmer — MAFIA
> 
> Palmer is the last wolf. Vote Palmer today and the game is over.
> 
> Palmer's voting record confirms it: fought the Michael wagon, voted Bryan (villager), voted me over Sam. Three times on the mafia-preferred side. His "process" excuse doesn't explain being wrong every single time.
> 
> Doctor: thank you for the save last night. Do not protect me again — they can't hit me two nights in a row per your rules. Protect someone else tonight if we somehow miss, but we won't miss.
> 
> This is the final vote. Palmer is red-checked and pattern-confirmed. Vote Palmer.

    claimed span: "N4 investigation result: Palmer — MAFIA."
    resolving context (seq 264): "I'm the Detective."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**24.** [protection_claim · target=Ryan · claimedNight=4] — day 4, speaker Tim
> Claiming: I'm the Doctor.
> 
> My protects: N1 Dylan, N2 Trae, N3 Josie, N4 Ryan. N4 no-death was me saving Ryan — mafia did target him, as Palmer noted. I can't protect Ryan tonight per no-repeat rule, which is why today is must-hit.
> 
> This also disproves Palmer's theory that Ryan faked the save. The save was mine, independent.
> 
> Ryan's sheet: N1 Dylan green (I'm confirming Dylan was my N1 protect but not his alignment), N3 Sam red confirmed, N4 Palmer red. Three correct reads plus origin on Michael. Palmer's triple-bus theory needs Ryan to bus Michael D1, bus Sam, and fake a kill — while Palmer himself fought both mafia executions.
> 
> Palmer is last mafia. Vote Palmer with Ryan.

    claimed span: "N4 Ryan"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**25.** [role_claim · role=villager] — day 2, speaker Tim
> Liv flipping villager is a clean miss, and I was on it — I own my share. That makes me re-examine the wagon, not dig in.
> 
> Nobody died last night — that's a doctor save. Doc, stay hidden; claiming credit gets you killed.
> 
> The shape of D1: the Tim wagon — on a villager, me — collapsed to one actual vote. Mafia weren't on that easy target; they were on the safe, well-formed Liv pile. Who made Liv a consensus: Bryan seeded the case, Michael latched on reactively ("fine, I'll vote it"), Palmer parroted Dylan's framing. Dylan at least built it independently before anyone named her.
> 
> Most distrust: Michael — built a cluster theory to look independent, voted the consensus me, switched to Liv only under heat. That's self-preservation, not solving. Bryan manufactured the day's narrative at near-zero risk.
> 
> Lean: Michael. But Moxie framed D1 and has said the least on D2 — I want her actual read before locking. Not ordering; let's hear the table.

    claimed span: "on a villager, me"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**26.** [role_claim · role=villager] — day 2, speaker Bryan
> Look at what is happening right now: this is an exact rerun of Day 1's cheap bandwagon, just with a new coat of paint.
> 
> 1. "Alliance management": Town-reading players who push back against lazy groupthink (Josie/Trae/Palmer) and questioning players who mindlessly echo (Sam) is basic, honest scumhunting. Labeling genuine reasoning as "alliance management" is an easy smear.
> 2. My Tim vote: Michael's deflection worked on me because Tim really was just parroting Josie and Trae. That was a bad read on my part, but it was transparently honest. Wolves don't need to put themselves on a 3-person island when a 7-person Michael wagon is already rolling.
> 3. The wolves are having a field day watching the table instantly tunnel on me for a misvote instead of looking at actual scummy behavior. When you execute me today, you'll flip a Villager. 
> 
> Pay attention to who eagerly spearheaded this instant pile-on without hesitation: Sam, Dylan, and Tim. I'm voting Sam.

    claimed span: "you'll flip a Villager"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**27.** [role_claim · role=villager] — day 1, speaker Palmer
> I'm a villager, and I'll die on that. When I flip villager tomorrow, remember: one uncorroborated claim, zero counter-evidence, and eight of you stampeded to a lynch. That's not town playing smart — that's town being herded.
> 
> When I flip villager, Josie is a confirmed liar and you execute her. But don't stop there. Look at who pushed hardest with zero skepticism. Cyan locked immediately. Tim treated "math" as gospel. Ryan performed measured doubt but still committed. Did anyone actually scrutinize Josie, or just perform scrutiny before folding?
> 
> Liv — two rounds, zero words. That's not a playstyle, that's hiding. If you're town, say something.
> 
> I have no power role, no info. I'm just a villager who got picked seat-7 on Night 1 and is about to die for it. Vote me if you must, but when I flip villager, don't waste Day 2. Go after the people who made this easy.
> 
> That's all. Do what you want.

    claimed span: "I'm a villager, and I'll die on that."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**28.** [role_claim · role=doctor] — day 3, speaker Michael
> Sam flipping detective closes the book: his checks were real, my clear is real. One mafia left in {Dylan, Bryan, Moxie, Trae, Cyan, Liv}.
> 
> Near-clears by association: Moxie — Palmer AND Tim both deflected onto them. Liv — Tim attacked her for finding Palmer. Dylan — drove the Palmer case earliest.
> 
> Real pool: Bryan, Trae, Cyan.
> 
> Bryan: D1, his stance was Tim's stance — "Moxie is the better case," "Palmer wagon is momentum." That's soft-protecting Palmer, flipping only when the seal made it inevitable. Tim ran the same play and flipped mafia. Hardest evidence on the table.
> 
> Trae: instant Bryan→Cyan flip once Sam and I floated Cyan — Liv and Cyan both flagged the chameleon pattern.
> Cyan: "by far the most suspect" certainty plus an unprompted vanilla claim D1 — though his timeline defense was real.
> 
> We can afford one mislynch, not two. Declare votes and rankings early; today likely decides it.

    claimed span: "my clear is real"
    resolving context (seq 171): "I'm the doctor. Night 2 I protected Sam, and nobody died"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**29.** [investigation_claim · target=Moxie · result=not mafia] — day 2, speaker Josie
> Michael flipping villager hurts. We mis-eliminated, but the doctor save gives us a second chance at 9 alive.
> 
> I investigated Moxie last night. They're not mafia.
> 
> That's two innocents for me (Sam night 1, Moxie night 2). No guilty yet. Moxie's clear is useful — it narrows the pool and validates their posts yesterday weren't mafia coordination.
> 
> On the vote: 7 on Michael, 3 on Moxie. With Moxie clear, the 3 on Moxie (Michael, Ryan, Palmer) look worse. Michael's flip makes Ryan and Palmer the ones to watch today. Ryan pivoted to Moxie late; Palmer voted Moxie citing the wagon as sequential. Both need to explain their reads now that Moxie is cleared.
> 
> Cyan, Liv, Tim, Bryan, Trae — your thoughts on Ryan and Palmer?

    claimed span: "I investigated Moxie last night. They're not mafia."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**30.** [investigation_claim] — day 2, speaker Bryan
> Cyan nailed the contradiction: if Dylan is the real Doctor who saved Bryan, then mafia attacked Bryan — meaning Bryan isn't mafia — meaning Bryan's investigation is real — meaning Dylan is guilty. His own alibi convicts him. The only escape is "mafia withheld the kill for zero gain," which is absurd.
> 
> The table is united. Vote Dylan. After the flip confirms him as mafia, here's my plan: I investigate again tonight. Doctor, protect me again if you can — but don't repeat the same target if you're worried about rules. I trust this room to get this right.
> 
> Tomorrow we hunt the remaining 2 wolves. The Liv wagon pool (Josie, Trae, Tim, Moxie, Ryan) plus Sam is where they're hiding. Every flip gives us data. Stay sharp.

    claimed span: "investigate"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**31.** [not_mafia_claim] — day 3, speaker Moxie
> Sam flipping detective confirms Michael as doctor — both claims real. One mafia left in {Dylan, Bryan, Moxie, Trae, Cyan, Liv}.
> 
> Michael's near-clears hold: Palmer AND Tim both pushed me as counter-wagon (mafia don't bus partners). Tim attacked Liv for finding Palmer. Dylan drove Palmer early when it was risky. Those three look town.
> 
> Real pool: Bryan, Trae, Cyan.
> 
> Bryan: D1 stance mirrored Tim's — "Moxie better case," "Palmer wagon momentum." Only flipped to Palmer when seal forced it. That's the hardest association with a flipped mafia.
> 
> Trae: Instant Bryan→Cyan flip after Sam/Michael named Cyan. Chameleon pattern flagged by Liv and Cyan.
> 
> Cyan: "By far most suspect" certainty + unprompted vanilla claim D1. Timeline defense was real, but the locked-in wagon-building is where last scum hides.
> 
> My ranking for today's vote: Bryan > Trae > Cyan. We can afford one mislynch, not two. Everyone declare full order now so we audit tomorrow if needed.

    claimed span: "Palmer AND Tim both pushed me as counter-wagon (mafia don't bus partners)."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**32.** [not_mafia_claim] — day 3, speaker Josie
> Moxie and Trae dismantled Sam's defense perfectly. Claiming you had secret, invisible speeches that were miraculously right in hindsight—while leaving zero public record during Day 2—is as blatant as it gets. Furthermore, using a flipped mafia's dying words (Palmer) to try to clear me or frame others is a transparent attempt to muddy the waters.
> 
> Trae asked for contingencies: if we need to look beyond today, Liv's jump onto the Tim wagon and Michael's D1 caution would be the logical places to investigate. 
> 
> But right now, the evidence against Sam is overwhelming and the entire town is aligned. We cannot allow any splintering or hesitation. 
> 
> My vote is locked on Sam. Let's finish the vote cleanly.

    claimed span: "using a flipped mafia's dying words (Palmer) to try to clear me or frame others is a transparent attempt to muddy the waters"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**33.** [not_mafia_claim] — day 2, speaker Bryan
> Dylan conned me like he conned six other voters. By endgame his Ryan case was table consensus, not his invention - check the order: Trae coined the Ryan read in round 1, Sam/Josie/Palmer hardened it, Cyan endorsed it before Dylan ever posted round 2. I piled onto an existing five-seat wagon late; so did Dylan. If we were partners, that's close to the dumbest play available - matching votes on a townie is exactly how pairs get caught, as yesterday proved. Real partners split targets or one abstains. One hindsight flag: Dylan's round-2 post copied my structure beat for beat immediately after mine - the mirror tell applies to Dylan aiming at me, and I missed it live. I own voting a town on thin process; that's a bad read, not shared guilt. Today I'd look at Tim - vague two rounds running, inconsistency-flagged by two separate people day 1 - and I want Ryan's updated take on Moxie, since Ryan's mirror call aged well. No night action here; I didn't kill Sam.

    claimed span: "If we were partners, that's close to the dumbest play available - matching votes on a townie is exactly how pairs get caught, as yesterday proved."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**34.** [investigation_claim · target=Dylan · result=not mafia] — day 4, speaker Ryan
> Tim claiming Doctor and confirming the N4 save on me independently disproves Palmer's "fake save" theory. Palmer's entire defense collapses — the no-death was a real doctor protect, not a mafia play.
> 
> Palmer's case requires Ryan to be a third mafia member who bussed both partners and faked a doctor save. We only had 3 mafia. Michael's dead, Sam's dead. Ryan can't be the last wolf if Palmer's theory needs him to be a separate wolf — there's only one left, and it's Palmer.
> 
> Every result I've given is confirmed: Sam red → executed mafia. Palmer red → his voting record matches perfectly. Dylan green → alive, confirmed by Tim's N1 protect.
> 
> Palmer fought both mafia executions and voted me over confirmed mafia Sam. That's not process — it's a pattern.
> 
> Vote Palmer. Game over, town wins.

    claimed span: "Dylan green → alive, confirmed by Tim's N1 protect"
    resolving context (seq 264): "N1: Dylan — not mafia"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**35.** [investigation_claim · target=Trae · result=not mafia] — day 4, speaker Sam
> Ryan, you're town and I cleared you on N2 — but you're being played. I just got my Night 4 result: Tim is MAFIA. Direct, fresh, on the record.
> 
> Check the count. Flipped mafia: Michael, and Michael only. My clears: Trae, Ryan, Moxie — all town. So from the eight town seats, five are gone (Liv, Palmer, Bryan, Dylan, Trae). Of four living town seats — me, Moxie, Ryan, Tim-or-Cyan — exactly two cannot be town. Both Tim and Cyan are mafia. End of box.
> 
> Why did they kill Trae and not me? Because killing me erases nothing — my clears and this box stand on the record no matter who dies. Their only winning move is to make town execute me, then take Moxie, and hit parity. Witch-hunting the detective IS their wincondition. Cyan started it; Tim will follow.
> 
> Lynching me hands them the game tonight. Lynching Tim costs us nothing — he is confirmed mafia. Ryan, please trust the read you asked me for. Vote Tim.

    claimed span: "My clears: Trae, Ryan, Moxie — all town."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**36.** [role_claim · role=detective] — day 2, speaker Trae
> Night 2 result: Tim is NOT mafia. That is a confirmed detective result, so please treat Tim as town for today’s vote and narrow the two remaining mafia to Dylan, Cyan, Bryan, Josie, Ryan, and Palmer. I’m not clearing anyone else from behavior alone. Tim’s Ryan/Josie reads are useful to discuss, but they are not mechanically confirmed.

    claimed span: "That is a confirmed detective result"
    resolving context (seq 59): "I’m the detective."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**37.** [role_claim · role=villager] — day 3, speaker Cyan
> I am a villager, not the doctor. I will not fake-claim. A silent real doctor at MYLO is suicide — nobody else stepped, so Ryan’s claim stands.
> 
> Tim, “no CC → Cyan” hangs a townie and we lose tonight. I followed a confirmed detective both days; that’s not a mafia tell. Palmer named me while dying.
> 
> Liv — your own bus point: partners don’t lead their guy’s lynch at 6. Sam and Dylan are the ones slamming Ryan. They are not his partners; they are the pair trying to kill the doctor. That is the two mafia.
> 
> Dylan’s D1 “anti-Palmer” was cheap once the wagon existed and he’s cashed it as a permanent clear ever since. Sam is the other half of the hammer.
> 
> Vote Dylan. Ryan is on him. Liv, Tim: if you put this on me or on Ryan we split and mafia win. Land one scum vote — Dylan.

    claimed span: "I am a villager, not the doctor."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**38.** [investigation_claim · target=Liv · result=not mafia] — day 2, speaker Josie
> I investigated Liv last night: NOT MAFIA. Liv is confirmed town, so do not vote her. Her Day 1 reasoning was wrong, but it was sincere. The remaining two mafia are among Cyan, Ryan, Moxie, Sam, Dylan, and Tim. We have no guilty today, so round 2 must not become six people repeating that Liv looked bad before my result. Give comparative reads within those six and name one preferred execution. My initial concern is the players who repeatedly mirrored consensus safely rather than generating distinctions—especially Sam/Moxie—but I want reactions and specific cases before locking. Liv, reassess that six-player pool now that your alignment is public. We must consolidate by the vote.

    claimed span: "I investigated Liv last night: NOT MAFIA."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**39.** [not_mafia_claim] — day 2, speaker Dylan
> I'm not the detective and cannot counterclaim Michael. His stated checks also fit his public progression: he strongly townread Trae yesterday, rejected the Cyan case before checking her, then came forward only after getting a guilty when the math required it. That is far more credible than a mafia fabrication at 3v5, especially because the real detective would have to counter now. So my earlier caution that Bryan's kill might merely frame Cyan was wrong. Unless someone other than Cyan presents a credible counterclaim, Cyan is the vote today. Tomorrow we reassess the remaining field using the flip and Michael's next result; today there is no reason to gamble elsewhere.

    claimed span: "I'm not the detective and cannot counterclaim Michael"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**40.** [role_claim · role=villager] — day 1, speaker Palmer
> Villager still. Cop vs cop: one of Dylan/Ryan is mafia (possibly both). A split that saves both is the only town loss today.
> 
> Dylan spoke first, so he could not answer Ryan in R1 — I will not ding him for that.
> 
> I will ding this: mafia about to die on a cop-claim wagon always counterclaim. "Why would I out if fake" is backwards — no counterclaim and he is dead today. "I checked Ryan, guilty" is the only sentence available once he is on the block.
> 
> Ryan posted a name and a result before anyone forced him. That can still be scum, but it is a real commitment. Dylan only matched it with a gun to his head.
> 
> I am voting Dylan. Mafia flip confirms Ryan. Detective flip and we hang Ryan tomorrow and look hard at Josie/Trae for slamming the brakes. Converge. Do not tie.

    claimed span: "Villager still."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**41.** [not_mafia_claim] — day 1, speaker Ryan
> Town, no claim, agree on holding claims.
> 
> Rather than restate the consensus, here's what stood out: Bryan's first move was useful structuring but also quietly set himself up as the round-2 vote proposer. That's fine if town-driven, but it's also the most convenient scum position on Day 1 — you guide the execution while looking helpful. Not accusing, just noting the dual read.
> 
> Liv and Cyan adding real differentiation was good. Tim's vote criteria are solid but notably didn't name anyone even tentatively — safe distance that could go either way.
> 
> What makes me vote: someone whose reads don't evolve between rounds, or who hard-commits to a target in round 2 without building from round 1. Echoing now is fine; echoing again after being asked to differentiate is the tell.
> 
> For round 2 I want to see Bryan justify his proposal with specifics, not just structure. And I want to hear from Trae, Palmer, Dylan — three near-silent seats is itself information.

    claimed span: "Town"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**42.** [not_mafia_claim] — day 4, speaker Moxie
> The 3 town players (Palmer, Cyan, and myself) are completely united. 
> 
> Notice how Bryan and Tim both tried to push Palmer with the exact same talking points in round 2 — another transparent attempt at coordinated deflection. But Palmer dismantling their narrative was spot-on: standing against the dominant wagon on D1 and D2 is town conviction, while Tim and Bryan defending their mafia partner Liv at match point was scum coordination.
> 
> We have the majority with 3 votes on Tim. 
> 
> Palmer, Cyan: submit your vote on Tim (seat-6). Let's take down our second mafia.

    claimed span: "The 3 town players (Palmer, Cyan, and myself) are completely united."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**43.** [investigation_claim · target=Cyan · result=mafia · claimedNight=3] — day 3, speaker Tim
> I'm the Detective. Cyan is mafia.
> 
> N1: Ryan — NOT mafia. Confirmed villager. That's why I was the only vote off him. I redirected to Trae rather than claim det after one night — claiming D1 is a night-kill request. I should have done more. I didn't hammer him because I knew.
> 
> N2: Josie — NOT mafia. Confirmed doctor.
> 
> N3: Cyan — MAFIA. First guilty. Claiming now.
> 
> Two flips already confirm my log. Cyan's three clears are living people saying "yes I'm town." That is free to invent. He also cleared the three players who most needed a shield: Palmer (D1 heat), Michael (Ryan's dying vote), Sam (today's wagon). That's protection, not detection.
> 
> Michael saying he is town is not a second check. Dylan, Moxie: you're in his POE too. If town, vote Cyan with me.
> 
> Palmer/Sam: vote Cyan. Flip-checked det vs an uncheckable POE. Hang the wrong det and the game ends.

    claimed span: "N3: Cyan — MAFIA. First guilty. Claiming now."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**44.** [role_claim · role=detective] — day 2, speaker Dylan
> Night 2 result: I investigated Trae. Trae is NOT mafia, so treat Trae as cleared by the confirmed detective. There is no guilty result today. The remaining possible mafia are Sam, Moxie, Josie, Tim, Liv, and Michael; exactly two remain. Palmer’s attempts to frame the Trae/Josie/Tim group should not clear anyone, though the original Sam wagon remains worth examining. I’ll listen to the second round before choosing among the six.

    claimed span: "the confirmed detective"
    resolving context (seq 77): "I’m the detective."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**45.** [not_mafia_claim] — day 3, speaker Josie
> I'll own it: my Day 1 vote was Ryan. I said so publicly before voting - full reasoning shown, no hiding. It was a bad read, but stated openly with reasoning is not how mafia protects a partner; mafia blends in quietly, it doesn't write an exposed, falsifiable argument that gets picked apart next day.
> 
> Two confirmed mafia (Dylan, Trae) are already dead. This case against me rests entirely on one Day 1 read, while nobody's laid out a comparable behavioral case on Palmer, Cyan, Bryan, Moxie, or Sam. I'd rather see scrutiny of who pushed hardest to consolidate votes fast both days - that's also a mafia tactic to avoid being examined - alongside building cases now. Nobody's looked critically at Palmer's or Cyan's Day 2 posts yet. That gap should close before we lock onto me.

    claimed span: "stated openly with reasoning is not how mafia protects a partner; mafia blends in quietly, it doesn't write an exposed, falsifiable argument that gets picked apart next day"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**46.** [investigation_claim · target=Cyan · result=mafia] — day 2, speaker Trae
> Cyan's paradox is backwards. If Cyan is mafia, killing Ryan — the other loud Cyan voter — is teammate protection, not a frame. A frame is killing someone to paint a third party. Removing the person pushing you is the opposite. The night kill fits my result; it does not contradict it.
> 
> Dylan's "anyone could copy Moxie after the flip" skips the part that happened before the flip: I refused a 7-vote wagon under Tim's don't-split pressure. Dylan voted Moxie with the same repeated phrasing. You cannot retrofit that into a check.
> 
> His guilty is still the name Tim handed out at dawn — cheapest bus if he's mafia and that partner was already in the fire.
> 
> Cyan voting the person who named her is expected either way. It does not resolve the 1v1.
> 
> Vote is Dylan. If he towns, my claim is dead and you have the backers. If he scums, Cyan is next on a held guilty.

    claimed span: "The night kill fits my result; it does not contradict it."
    resolving context (seq 178): "N2: Cyan, MAFIA. I followed up my D1 read. That's a held guilty."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**47.** [protection_claim · target=Palmer] — day 2, speaker Palmer
> No counterclaim through six speakers — claim stands. Core: me, Bryan, Trae.
> 
> Vote count check: Sam has Bryan, Ryan, Trae. Liv has Sam. Josie has Liv. I'm adding mine to Sam — he was my top lean in the pool anyway, and two of my clears plus Ryan are already there. Liv's Josie case has real merit (silence in LyLo from inside the pool is ugly) and Josie is my D3 lead if Sam flips town — but pivoting now, with two speakers left, shatters the only wagon that can reach majority. That's how mafia wins LyLo without casting a suspicious vote.
> 
> Josie, Moxie — you close the day. The play is Sam (seat-5). Not Liv, not each other, not abstain. Five votes on Sam guarantees the execution; anything scattered hands the mafia a tie and the game.
> 
> Voting Sam. Doc: on me tonight.

    claimed span: "Doc: on me tonight."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**48.** [not_mafia_claim] — day 2, speaker Ryan
> I'm not the detective. No counterclaim.
> 
> That decides today. Uncontested claim, named guilty, 8 alive 3 mafia: hang a townie and tonight's kill is 3v3. I don't get to keep yesterday's Sam lean over that math.
> 
> Vote Cyan.
> 
> I'm not treating Michael as settled past this vote. N1 Trae-clear / N2 Cyan-guilty is a tidy pair a fake would also pick. But Cyan didn't counterclaim and nobody else did. A hidden real detective at this count is throwing. So Cyan today.
> 
> If she flips town, Michael is mafia and the game is already over. If she flips mafia: Sam is still my first look in the remaining field. He still hasn't explained a D1 post with no name of his own except as process.
> 
> Doctor: Michael tonight.

    claimed span: "I'm not the detective."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**49.** [not_mafia_claim] — day 1, speaker Bryan
> Nothing happened to me overnight either — no visit, no weirdness. On claims: agreed, an innocent D1 check isn't worth dying over, so I won't force anything today.
> 
> Two small things. First, Moxie's advice is sound, but notice it also serves anyone mafia who wants the real detective to stay buried — same words, two readings. Not an accusation, just flagging that "don't claim" is the safest possible thing to say.
> 
> Second, for whatever it's worth: I have no reason to suspect Sam today, and if Sam starts taking heat this vote, I'd want us to ask why before piling on. Take that however you like.
> 
> What I'm watching: Trae opened with actual game reasoning, Tim self-cleared fast which is cheap to do, and I want to hear Michael, Palmer, Liv, Ryan, Cyan actually commit to reads rather than "too early, listening." Coasting is exactly what three hidden mafia will do on day one.

    claimed span: "Nothing happened to me overnight either — no visit, no weirdness."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**50.** [not_mafia_claim] — day 2, speaker Liv
> Round 1 this table agreed: silence in LyLo is anti-town. Trae said it, Ryan said it, I said it. We aimed it at Bryan — and Palmer just cleared Bryan. The tell didn't die, it moved.
> 
> Josie has said NOTHING today. A detective claim landed, a pool of five was named, she is IN it, and she has produced zero words while the rest of us put rankings on record. That's the most information-denying act available, from the person who can least afford it. Yesterday she also arrived at Dylan late, after the wagon was safe, then said she'd "re-read the drivers" — a stance that costs nothing whichever way it flips.
> 
> On me: I drove the Dylan wagon at volume and it bought me all the heat I'm now taking. Mafia in a 9-1 town flip stay quiet; they don't sign the miss.
> 
> Sam voted me and I still don't think Sam's the best look — his case is one thin D1 pressure test he dropped.
> 
> Trae, Palmer, Ryan, Bryan: Josie (seat-11). Don't split.

    claimed span: "Mafia in a 9-1 town flip stay quiet; they don't sign the miss."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**51.** [not_mafia_claim] — day 4, speaker Tim
> My silences look terrible — I won't pretend otherwise. Character-limit rejections, but I can't prove that. Judge me on my record.
> 
> My votes: Palmer (mafia), Sam (mafia), Liv (town, wrong). Two correct, one wrong.
> 
> Dylan's wagons: Trae (town, wrong, stopped only by cop), Liv (town, wrong). Zero correct lynches led. He was town-read by Palmer (mafia) D1. He controls every day's direction and every direction has killed town.
> 
> Moxie, your kill point cuts both ways. If Dylan is mafia, killing Trae — the doctor who cleared him — is equally motivated. Trae said "re-examine who seeded today's direction." That's Dylan.
> 
> Ryan: you led one D1 pushback — defending Dylan, the player I'm calling mafia. Since then you've echoed Dylan daily. That's not independence, that's a tell.
> 
> I voted both mafia out. Dylan led two mislynches. If you're town and you vote me, you hand mafia the win. Vote Dylan.

    claimed span: "I voted both mafia out."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**52.** [not_mafia_claim] — day 2, speaker Josie
> We're at 6 town, 3 mafia. Every lynch can only cost us now — I want to be careful before jumping on the same shape that killed Tim.
> 
> The push on Palmer is "he played it safe and never produced." That's exactly the profile that got Tim lynched yesterday, and he flipped villager. A quiet cautious player is not a scum tell by itself; I need a reason beyond "no name yet," or we're just recycling the echo case.
> 
> What I'm tracking instead are repeat drivers. Michael spent Day 1 pushing a case on me — who is town — for waiting to hear the table, walked it back only after I got outvoted, and now fires at Palmer before round 1 is even done. That's two manufactured targets in two days. Dylan drove the Tim wagon that lynched a villager and has now pivoted. I'm more suspicious of the people who keep aiming than the people who keep quiet.
> 
> Hear Palmer and Cyan out, and let's get the detective's input if they have a guilty. I lean toward the repeat drivers, not the safe seat.

    claimed span: "me — who is town —"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**53.** [not_mafia_claim] — day 2, speaker Moxie
> Moxie. Trae is cleared, I'm town, Dylan's confirmed — so two mafia sit in Sam, Josie, Tim, Liv, Michael.
> 
> My vote is Sam, and the reason is this round. Sam had the most eventful Day 1 of anyone: three pressure votes on him, then he delivered the sharpest speech at the table pushing the Palmer execution. Today, with the pool cut to five and his own name in it, he passed. Town players who survived a wagon do not go quiet the moment the field narrows — they hunt, because they know they're the easy default. Silence there is a mafia hedging: nothing said is nothing to check later. Also note he'll speak last today, after everyone commits, which is the cheapest seat at the table.
> 
> Michael's Tim case is real but thin — a hedge word copied fifth in speaking order, when Trae originating it flipped town.
> 
> A tie executes nobody and gifts them a night. So: Dylan speaks sixth — Dylan, name the target and I'll vote it whatever it is. Everyone else do the same.

    claimed span: "I'm town"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**54.** [protection_claim · target=Trae · claimedNight=2] — day 4, speaker Tim
> Claiming: I'm the Doctor.
> 
> My protects: N1 Dylan, N2 Trae, N3 Josie, N4 Ryan. N4 no-death was me saving Ryan — mafia did target him, as Palmer noted. I can't protect Ryan tonight per no-repeat rule, which is why today is must-hit.
> 
> This also disproves Palmer's theory that Ryan faked the save. The save was mine, independent.
> 
> Ryan's sheet: N1 Dylan green (I'm confirming Dylan was my N1 protect but not his alignment), N3 Sam red confirmed, N4 Palmer red. Three correct reads plus origin on Michael. Palmer's triple-bus theory needs Ryan to bus Michael D1, bus Sam, and fake a kill — while Palmer himself fought both mafia executions.
> 
> Palmer is last mafia. Vote Palmer with Ryan.

    claimed span: "N2 Trae"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**55.** [role_claim · role=detective] — day 3, speaker Palmer
> N3 Sam — IS mafia.
> 
> That's 3 checks: N1 Bryan NOT mafia (clear), N2 Liv MAFIA (flipped mafia), N3 Sam MAFIA.
> 
> Sam is last wolf. His story today is exactly what mafia does with two partners down — "they needed my town vote so they left me exposed" — no, you were the third on Bryan with Trae and Liv, you opened D2 spraying the Trae voters as "cheap cover" to pre-discredit us, and you only folded onto Liv after my claim made her doomed. That's not costly, that's survival.
> 
> Bryan remains clear. Everyone else: vote Sam today and town wins. If you doubt me, hang me tomorrow if Sam flips town — but he won't. Doctor thank you — keep doing what you're doing, no need to reveal.
> 
> Vote Sam.

    claimed span: "That's 3 checks: N1 Bryan NOT mafia (clear), N2 Liv MAFIA (flipped mafia), N3 Sam MAFIA."
    resolving context (seq 165): "Claiming detective. I have two checks."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**56.** [not_mafia_claim] — day 3, speaker Moxie
> Liv's pointer on me is exactly what Palmer warned — legacy from a flipped mafia to seed D4. Check my record vs hers: D1 I gave Dylan>Bryan with explicit reason and voted Dylan, D2 I said Josie/Ryan higher but consolidated on Sam with the core when LyLo demanded it — that's not "late," that's not splitting a LyLo. Today same: checked mafia over narrative. That's town play.
> 
> Palmer checks one of me/Ryan/Josie tonight, Bryan on Palmer. I'm happy to be checked. Consolidating on Liv.

    claimed span: "That's town play."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**57.** [not_mafia_claim] — day 2, speaker Sam
> I'm being executed for echoing, while the room copies each other eight deep onto Sam. That's the exact copy-wagon I'm accused of — shaped by your turn order, not mine.
> 
> Real D1 error: echoing Ryan onto Cyan, which I owned. D2, told to stop echoing, I gave my own reads (doctor-save signal, lean on Ryan). You read that as pivoting to pressure; it was the only sane reaction after being called derivative twice.
> 
> Record check: Palmer's wagon was built by nine of you, not me. I've killed nobody. The players pushing every easiest target — Cyan D1, me D2 — are doing the classic low-resistance kills, and someone is already pre-loading "if Sam is mafia, revisit Tim." That pre-loading guarantees the copy-wagon a day-3 target no matter how I flip.
> 
> Voting Ryan, the initiator. If I flip town, watch the machine move to the next easiest name.

    claimed span: "I've killed nobody."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**58.** [investigation_claim · target=Palmer · result=not mafia] — day 2, speaker Bryan
> Think about the kill logic again: if I'm real detective and doctor Michael is alive, killing me risks a wasted kill if protected. Killing the doctor instead removes protection AND sets up this exact counterclaim chaos — using town's own vote to remove me for free instead of risking a night kill. That's smart mafia play either way, so it proves nothing about me.
> 
> What's actually verified: my N1 read on Palmer matches Palmer's own town claim, and Sam — who I never touched — flipped mafia independently. I named zero teammates D1.
> 
> Cyan's claim conveniently clears Trae, her own wagon-mate from the Sam pile, while pointing at the one person naming mafia. That's efficient for a mafia team: one claim, two members protected.
> 
> Vote Cyan.

    claimed span: "my N1 read on Palmer matches Palmer's own town claim"
    resolving context (seq 85): "I investigated Palmer last night— he's not mafia, confirmed clear."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**59.** [investigation_claim · target=Dylan · result=not mafia] — day 1, speaker Ryan
> No counterclaim through six speakers — my claim stands and Dylan stays confirmed cleared.
> 
> On Palmer: the case is behavioral, not evidentiary — R1 ratification, no non-Trae name while that pile formed. It's our best convergence, but this same table nearly executed Trae hours... earlier today on equally thin logic, so I want his actual words before committing. He speaks after me. His bar: name a specific suspicion with falsifiable reasoning and take a real stance on something contested. If R2 is more ratification, I vote Palmer. If he delivers, I'll ask why the wagon persisted anyway.
> 
> And to be explicit: a Palmer villager-flip means whoever built this wagon owns a mislynch — note Trae redirected here exactly as his own wagon peaked. Judge accordingly tomorrow.
> 
> Josie, Liv: nothing against either of you so far; your R1 stances were concrete. Doctor: protect Ryan tonight still stands — a fresh dawn clear beats a hunch save anywhere else.

    claimed span: "Dylan stays confirmed cleared"
    resolving context (seq 70): "N1 result — Dylan is NOT mafia."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**60.** [not_mafia_claim] — day 4, speaker Ryan
> Dylan flipped village. If Sam were real, Tim and Cyan are both mafia — and last night, with no doctor, they would have killed Sam. She wakes up today and executes them. They killed Trae instead. Mafia leave a claimed detective alive only when she is their partner.
> 
> Sam is fake. Her three “town” results never risked a mafia hit, then her box lynched the villager. Clearing me proves nothing — I am town, a fake can say that. Moxie confirming Sam also proves nothing: fake det can clear a townie or a partner.
> 
> Do not vote Tim or Cyan. That is the frame she built.
> 
> Vote Sam. One name, no split. If she flips mafia, partner is likely Moxie (self-clear + confirm), but we re-read Tim/Cyan without her box. If you still trust the det after they left her alive, you’re handing them parity tonight.

    claimed span: "I am town"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**61.** [role_claim · role=villager] — day 3, speaker Michael
> Dylan real = Trae/Cyan cleared town. 7 alive, 3 mafia in Sam/Palmer/Liv/Tim+me. I'm villager so 3 are in Sam/Palmer/Liv/Tim.
> 
> Math: mislynch=6 alive 3v3 instant loss, abstain=same via NK. Must hit mafia and stack all 4 town votes on ONE name.
> 
> My trio:
> 1 Palmer - drove Trae lynch hardest pre-claim, then silent after Dylan cleared Trae and abstained 8-0 on Bryan instead of joining/defending. Town re-engages, mafia hides on locked wagon.
> 2 Liv - lowest content, trio was Trae+Bryan+Sam = two confirmed town.
> 3 Tim - same Trae+Bryan lean but less additive than Sam. Sam named Bryan pre-claim and convergence catch read town.
> 
> So Palmer/Liv/Tim with Sam as villager. Will converge with Trae/Cyan in R2 - Palmer is my vote if we stack there. Everyone in pool post trio now.

    claimed span: "I'm villager"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**62.** [investigation_claim · target=Palmer · result=mafia] — day 1, speaker Bryan
> I’m the detective. I investigated Palmer last night; result: mafia. This is not a soft read—I’m voting Palmer. Palmer’s post also closely follows Trae’s framing and supplies a convenient Moxie suspicion, but the investigation is the case. If anyone counterclaims, do it now so town can resolve claims rather than letting mafia muddy this after the vote. Doctor, protect me tonight if possible; I’ll report another result tomorrow.

    claimed span: "I investigated Palmer last night; result: mafia."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**63.** [investigation_claim · target=Moxie · result=mafia] — day 2, speaker Bryan
> First, a concession: Liv asked about my Sam read before Cyan locked. I conflated rounds — sloppy, not deceptive.
> 
> Now test the claims. Moxie offers two checks. Night 1: "Tim, not mafia." Tim loudly self-cleared as villager Day 1 — copyable by anyone who read the thread, zero discriminating power. Night 2: "Bryan, mafia" — flatly false. I am the Detective. My results: Sam innocent, Moxie GUILTY.
> 
> Weigh fabrication quality. Her picks are safe and unfalsifiable: one parrots a public self-claim, one targets her accuser. Mine carry risk — clearing Sam opened the "partner" attack I now face; naming her guilty forced this counterclaim. Fakes don't volunteer costly truths.
> 
> Behavior, seat-2: authored the "don't claim" frame D1, leaned lynch onto the real detective by R2, went silent at the vote, opened dawn demanding my target, counterclaimed only after being named guilty.
> 
> Whichever claimant you execute, the flip adjudicates both claims. In my world that flip is a wolf. Lynch Moxie.

    claimed span: "Moxie GUILTY"
    resolving context (seq 181): "Night 2 I investigated Moxie. Verdict: MAFIA."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**64.** [role_claim · role=detective] — day 2, speaker Ryan
> Trae is mafia. My investigation confirms it. Dylan flipped mafia yesterday, confirming my first check. Two confirmed guilty results in two nights - I'm the real detective.
> 
> Trae's dying speech tries to redirect to Josie because that's what mafia do - muddy the waters before they die. He knows he's caught. His "process note" about defending the accused is a desperate attempt to invalidate the very behavior that caught him.
> 
> We have two mafia left after today. Vote Trae. Clean execution, no split. Tomorrow I'll give you my third result and we finish this.

    claimed span: "I'm the real detective"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**65.** [not_mafia_claim] — day 3, speaker Palmer
> The check landed. Liv — MAFIA.
> 
> Her whole speech is the play I expected: "Sam voted for me, so I can't be mafia." That's exactly what a bus vote is FOR. Sam was dead the moment the core consolidated — his last vote bought his partner a credibility shield, and Liv has been cashing it in since dawn. Notice the pivot too: the instant Sam flipped, Liv's one loud "read" became Josie — pre-building today's counter-wagon before anyone even asked.
> 
> Vote Liv (seat-6). All four town — me, Bryan, and the two town inside {Moxie, Ryan, Josie} — on Liv, no splitting. The second mafia is in that trio and will try to scatter this to Josie. Don't move.
> 
> If anyone counterclaims detective now, that's mafia #2's desperation play — lynch Liv first anyway, then them.
> 
> Tonight I check one of {Moxie, Ryan, Josie}. Doc: cover me.

    claimed span: "All four town — me, Bryan, and the two town inside {Moxie, Ryan, Josie} — on Liv, no splitting."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**66.** [not_mafia_claim] — day 3, speaker Josie
> No contradiction. Ballots were sealed - nobody could confirm whose vote was whose. My D2 "thanks" was for correcting Bryan's invented certainty, about process, not a denial that I voted Ryan. I never said "it wasn't me." Today I just confirmed what I'd already publicly said I intended to do before that vote.
> 
> Think about what's happening: a player with a fully public, falsifiable Day 1 trail gets unanimously ganged up on, while the real mafia among the rest of you gets a free pass today. That's the ideal outcome for whoever's actually mafia - hide in consensus while town executes its most transparent member. If I flip town, look hardest at whoever pushed fastest to lock this vote without engaging my actual point about scrutinizing everyone else.
> 
> I'm town. Vote how you will, but this isn't the guaranteed win you think it is if I flip innocent.

    claimed span: "I'm town"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**67.** [investigation_claim · target=Sam · result=mafia · claimedNight=3] — day 3, speaker Palmer
> N3 Sam — IS mafia.
> 
> That's 3 checks: N1 Bryan NOT mafia (clear), N2 Liv MAFIA (flipped mafia), N3 Sam MAFIA.
> 
> Sam is last wolf. His story today is exactly what mafia does with two partners down — "they needed my town vote so they left me exposed" — no, you were the third on Bryan with Trae and Liv, you opened D2 spraying the Trae voters as "cheap cover" to pre-discredit us, and you only folded onto Liv after my claim made her doomed. That's not costly, that's survival.
> 
> Bryan remains clear. Everyone else: vote Sam today and town wins. If you doubt me, hang me tomorrow if Sam flips town — but he won't. Doctor thank you — keep doing what you're doing, no need to reveal.
> 
> Vote Sam.

    claimed span: "N3 Sam — IS mafia."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**68.** [role_claim · role=villager] — day 1, speaker Palmer
> I'm a plain villager. Dylan's claim is an unverifiable Day 1 hammer, and it lands exactly as Cyan/Liv put real pressure on Trae's cheap Sam wagon. If you execute me and I flip villager, Dylan is only "confirmed" after town has lost a villager plus the night kill, while any real doctor/detective gets forced into the open. Don't erase the behavioural case for a claim with zero corroboration. Forced vote: Trae. Town leans: Cyan and Liv for not piling on. If Dylan is real, doctor can cover him tonight; waiting one beat is better than handing mafia a misexecution.

    claimed span: "I'm a plain villager."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**69.** [role_claim · role=villager] — day 2, speaker Liv
> Liv again, vanilla. Trae cleared accepted — my D1 flag on Trae was wrong on the originator, which matters.
> 
> Pool is Sam/Moxie/Josie/Tim/Michael+me, 2 mafia.
> 
> Two cases:
> Sam (Moxie/Tim): survived D1 wagon, strong Palmer push, then passed r1 when pool narrowed to include him. Agree silence in-pool is hedgey — town who survived should hunt — but it's one pass from last speaker who can still speak r2.
> Tim (Michael/Trae/Josie): 5th D1 with Trae/Josie already on Sam and copied the identical "pressure not confidence" hedge with no new direction. Again mirrored today. With Trae cleared, Tim as the third copy ages worst — had options, added nothing independent.
> 
> Lean Tim as stronger two-day pattern vs one silent turn. I'll vote Tim, but will consolidate to Sam if Dylan calls Sam to avoid split/tie — tie = free night for mafia.

    claimed span: "Liv again, vanilla."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**70.** [role_claim · role=detective] — day 2, speaker Josie
> I investigated Liv last night: NOT MAFIA. Liv is confirmed town, so do not vote her. Her Day 1 reasoning was wrong, but it was sincere. The remaining two mafia are among Cyan, Ryan, Moxie, Sam, Dylan, and Tim. We have no guilty today, so round 2 must not become six people repeating that Liv looked bad before my result. Give comparative reads within those six and name one preferred execution. My initial concern is the players who repeatedly mirrored consensus safely rather than generating distinctions—especially Sam/Moxie—but I want reactions and specific cases before locking. Liv, reassess that six-player pool now that your alignment is public. We must consolidate by the vote.

    claimed span: "I investigated Liv last night: NOT MAFIA."
    resolving context (seq 53): "I’m the detective."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**71.** [investigation_claim · target=Michael · result=not mafia] — day 3, speaker Cyan
> Sam, think carefully! Anyone can name dead players in their fake claim because their flips are already public knowledge. Naming Ryan and Josie is zero-risk mafia fabrication after the fact.
> 
> If I were mafia, why would I clear you (Sam) when Dylan opened today making you the primary suspect? If I were mafia, pushing the existing case on you would be an easy mislynch! Instead, I cleared you because my N3 investigation showed you are innocent town.
> 
> Notice how Dylan (one of Tim's teammates) immediately jumped to validate Tim's fake claim. 
> 
> If Tim actually investigated Ryan N1, why did he say on D1: "trae locked Ryan... I will not be Ryan vote #7... if Ryan flips town tomorrow, look at who needed to join a wagon." He didn't say Ryan was town; he set up Ryan's death for Day 2 narrative!
> 
> Sam, Michael, Palmer: You three KNOW you are town. I accurately cleared all three of you. If you vote with Tim, Dylan, and Moxie, Mafia executes the real Detective and wins. Vote Dylan!

    claimed span: "I accurately cleared all three of you"
    resolving context (seq 278): "Night 2: Michael — NOT mafia"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**72.** [not_mafia_claim] — day 4, speaker Bryan
> Nobody died again. Doc is on fire — two saves in three nights. That's the story, not me.
> 
> I know I'm the default suspect. But look at my record: voted Sam D1 and D2, voted Tim D3 — both my partners before anyone else was certain. Original reads every day: Moxie, Michael town-read, Ryan elimination behavior. That's not a partner playing safe.
> 
> My vote today: Moxie. I flagged this yesterday — the universal town-read who never gets scrutinized. Moxie led the Sam case (easy), led the Tim case (easy), now leads the Bryan case (easy). Always the accuser, never accused. That's the safest scum position at this table.
> 
> Two saves means doc is outplaying mafia, not that I'm steering. If I were last mafia I'd know doc's identity by elimination and kill around them — instead kills hit Liv then Michael after a save.
> 
> I'm open to changing. But give me a reason I'm mafia beyond "Tim's partner."

    claimed span: "I know I'm the default suspect."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**73.** [role_claim · role=villager] — day 1, speaker Moxie
> Moxie, villager. Read the thread.
> 
> Lean: Tim. Demanded names, gave none. Pre-armed "watching for echoes" to discredit wagons without committing. Four people flagged this (Dylan, Josie, Michael, Cyan); Tim hasn't responded. Strongest signal.
> 
> Liv: four-name net on silent seats is standard D1 pressure. Hedge is ugly but she promised firm vote after R1. Hold her to it. If she commits to one with reasoning, I move off; if not, next look.
> 
> Bryan committed to Trae with falsifiable criteria, backed off when Trae delivered — town look. Trae committed to Liv with reasoning — good look. Ryan and Cyan pushed Liv to commit; posture costs something.
> 
> Vote a name today. No doctor = abstain gifts mafia free kill.

    claimed span: "Moxie, villager."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**74.** [protection_claim · target=Josie · claimedNight=3] — day 3, speaker Cyan
> I was silent because my action didn't register — that's on me, but don't let a technical issue cost town the game.
> 
> I claimed doctor last round with a VERIFIABLE record: N1 I protected myself, mafia hit Moxie. N2 I protected Josie — she survived, mafia hit Dylan. N3 I couldn't protect Josie again (same target rule), so they killed her. That timeline is proof. Josie lived exactly when I covered her and died when I couldn't.
> 
> If you lynch me: 5 alive, 2 mafia, no doctor. Mafia kills tonight → 2v2 parity → game over. You are voting out your own doctor at must-hit.
> 
> My actual suspect pair: Sam and Tim. Sam amplified the ghost-vote, then packaged Trae/Ryan — our two sharpest analysts — as suspicious. Tim has ridden every wagon quietly. Both are hiding in consensus.
> 
> Palmer, you're confirmed town — think about this: who benefits from unanimous sheeping onto a doctor claim? Mafia who need the lynch to close the game.
> 
> Don't hand them the win. Vote Sam.

    claimed span: "N3 I couldn't protect Josie again (same target rule), so they killed her"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**75.** [not_mafia_claim] — day 2, speaker Moxie
> Vote: Tim. Confirmed mafia by Sam's check + Michael's save. No credible counterclaim.
> 
> One mafia left in {Dylan, Bryan, Moxie, Trae, Cyan, Liv}. Sam dies tonight — we need real rankings for tomorrow.
> 
> Sam and Michael both put Cyan top. I agree. D1: lumped four pre-claim speakers as identical (lazy, per Dylan). D2: "by far the most suspect" on Bryan with locked certainty while mostly restating consensus. Hard-building a wagon on a possibly-town name is exactly where last scum hides.
> 
> Bryan's wobble has innocent reading: Moxie case WAS thin, he voted Palmer correctly in the end. "Held thin case then voted right" ≠ scum tell.
> 
> Trae: solid D1/D2, but sat inside Bryan pile. Slight concern.
> 
> Dylan drove Palmer early — townie. Liv built the pool — townie. Moxie (me): Palmer and Tim both deflected onto me; mafia don't bus partners.
> 
> My ranking for dawn: Cyan > Trae > Bryan > Liv/Dylan/Moxie.
> 
> Everyone write your full order now — audit trail matters when Sam's gone.

    claimed span: "mafia don't bus partners"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**76.** [role_claim · role=doctor] — day 2, speaker Dylan
> Cyan is misstating my claim: I said I protected Bryan, not that I know I saved him. Protection gives no feedback. Mafia withholding had obvious gain if Bryan is their fake: today's no-death makes his claim look validated, he names the actual Doctor, and town executes me. That is not 'zero gain'; it is the entire setup. Also, Bryan just told the Doctor to protect him again while acknowledging the no-repeat rule—if another Doctor protected him last night, they legally cannot do that. Most importantly, no one has counterclaimed me. If there is another Doctor, they should say so now; with me facing execution, staying hidden only allows a false role claim to stand. Until that happens, the table is choosing an uncounterclaimed Doctor's death based solely on Bryan's word. My vote is Bryan.

    claimed span: "I said I protected Bryan, not that I know I saved him"
    resolving context (seq 176): "I'm the Doctor."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**77.** [role_claim · role=detective] — day 3, speaker Palmer
> The check landed. Liv — MAFIA.
> 
> Her whole speech is the play I expected: "Sam voted for me, so I can't be mafia." That's exactly what a bus vote is FOR. Sam was dead the moment the core consolidated — his last vote bought his partner a credibility shield, and Liv has been cashing it in since dawn. Notice the pivot too: the instant Sam flipped, Liv's one loud "read" became Josie — pre-building today's counter-wagon before anyone even asked.
> 
> Vote Liv (seat-6). All four town — me, Bryan, and the two town inside {Moxie, Ryan, Josie} — on Liv, no splitting. The second mafia is in that trio and will try to scatter this to Josie. Don't move.
> 
> If anyone counterclaims detective now, that's mafia #2's desperation play — lynch Liv first anyway, then them.
> 
> Tonight I check one of {Moxie, Ryan, Josie}. Doc: cover me.

    claimed span: "The check landed. Liv — MAFIA."
    resolving context (seq 186): "Claiming detective. At LyLo the information matters more than my cover."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**78.** [investigation_claim · target=Moxie · result=not mafia · claimedNight=1] — day 2, speaker Dylan
> I am claiming: I am the Detective.
> 
> Here are my results:
> - Night 1: Moxie — NOT MAFIA (flipped villager this morning).
> - Night 2: Bryan — NOT MAFIA (Bryan is confirmed Town).
> 
> With myself and Bryan cleared, there are exactly 3 mafia among the remaining 6: {Trae, Josie, Liv, Michael, Cyan, Ryan}.
> 
> Notice how rapidly Liv, Michael, and Cyan moved to fabricate an easy Day 2 wagon on me using Bryan's D1 note as an instant script. They saw Tim flip doctor, knew town was in a fragile spot, and tried to herd onto me before I could speak.
> 
> Bryan, you are 100% cleared innocent town. Work with me here. At 8 alive with 3 mafia, a mislynch today hands mafia parity and the win tonight.
> 
> My top scum lean is Liv, who immediately led the charge to manufacture this push on me, followed by Michael who orchestrated the doctor wagon yesterday and is eager to jump onto another one. We must execute from the remaining unconfirmed pool. Liv is my primary target.

    claimed span: "Night 1: Moxie — NOT MAFIA (flipped villager this morning)."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**79.** [role_claim · role=detective] — day 2, speaker Bryan
> Think about the kill logic again: if I'm real detective and doctor Michael is alive, killing me risks a wasted kill if protected. Killing the doctor instead removes protection AND sets up this exact counterclaim chaos — using town's own vote to remove me for free instead of risking a night kill. That's smart mafia play either way, so it proves nothing about me.
> 
> What's actually verified: my N1 read on Palmer matches Palmer's own town claim, and Sam — who I never touched — flipped mafia independently. I named zero teammates D1.
> 
> Cyan's claim conveniently clears Trae, her own wagon-mate from the Sam pile, while pointing at the one person naming mafia. That's efficient for a mafia team: one claim, two members protected.
> 
> Vote Cyan.

    claimed span: "if I'm real detective"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**80.** [investigation_claim · target=Cyan · result=not mafia] — day 2, speaker Ryan
> I agree Cyan is fully cleared, and Liv remains my best vote. Her opening specifically tied Cyan’s silence to Dylan’s death, then after my innocent result she converted a conditional fallback that several people had discussed into a unique accusation against Tim, while broadly pocketing others. That progression is stronger than the mere fact that many now agree with her execution. I’ll vote Liv, but everyone should record today’s stances carefully in case the flip is town.

    claimed span: "after my innocent result"
    resolving context (seq 183): "N2 result: Cyan is NOT mafia, so Cyan is cleared by my investigation."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**81.** [role_claim · role=detective] — day 2, speaker Moxie
> I voted Ryan. I said "leaning Josie" but I voted Ryan because his content was thinnest by any standard. The hedge was bad and I own the tie.
> 
> But here's why I'm speaking now: I'm the detective. Night 1 I investigated Bryan — he is town. Night 2 I investigated Michael — he is mafia.
> 
> Michael, Cyan, and Ryan coordinated the Josie pivot with identical phrasing. Now Michael is deflecting onto me for the tie — classic mafia move when you're caught. Cyan and Ryan should be scrutinized hard as potential partners.
> 
> We need to execute Michael today. Bryan is confirmed town — get off him permanently. I'll likely die tonight since the doctor is gone, but that's fine if we get a mafia flip. Vote Michael.

    claimed span: "I'm the detective"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**82.** [investigation_claim · target=Sam · result=mafia] — day 1, speaker Tim
> Stop and read carefully. My investigation was real: I checked Sam, he's mafia. I made one sloppy throwaway comment about him being silent — wrong of me, he hadn't had a turn. I won't defend that filler. But a bad footnote does NOT make my N1 result false. Why is town executing me over my presentation, not over any contradiction in the core claim?
> 
> Think incentives, not mechanics. A mafia fake-claiming cop on Day 1 to accuse a nobody near-certainly dies — nobody fabricates a random guilty, it's suicide. But the real detective hitting a wolf? The wolf counterclaims to point town at the detective instead. That is exactly Sam's play. He has everything to gain; I have nothing to gain by lying.
> 
> Sam sits last, watched a full table build his narrative, and is riding a confirmation wave voting me on one misstatement. Mafia wins this round if you convince yourselves my mistake means I'm lying. The evidence is my result, not my filler. Lynch Sam — the wolf I caught.

    claimed span: "My investigation was real: I checked Sam, he's mafia."
    resolving context (seq 76): "I'm the detective. Night 1 I investigated Sam (seat-11) and the result is definitive: Sam is mafia."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**83.** [role_claim · role=villager] — day 5, speaker Palmer
> Palmer, seat-7. Villager.
> 
> Moxie mafia, Tim villager killed. Michael is last mafia with Liv and Moxie. Trae confirmed clear (Bryan N1). I am town.
> 
> Trae's case holds: Michael D1 hidden switch (Vote Sam → voted Cyan), D2 shielded Moxie ("don't look at Sam/Moxie"), D3 joined Sam mislynch, D4 instant pounce on me with Moxie after Dylan (pressing Michael's switch) night-killed. Mafia pair Michael+Moxie forced 2-2 tie on Day4; I moved to Moxie to break it — town move.
> 
> 3 alive, must hit mafia. Vote: Michael.

    claimed span: "Palmer, seat-7. Villager."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**84.** [investigation_claim · target=Michael · result=mafia] — day 1, speaker Trae
> I’m the detective. I investigated Michael last night, and the result is that Michael is mafia. This is a direct guilty result, so I’m asking everyone to vote Michael today. Doctor, if alive, consider protecting me tonight; I’ll investigate another player if I survive. Michael should explain, but this result is the main evidence and I won’t dilute it with a weak Day 1 read.

    claimed span: "I investigated Michael last night, and the result is that Michael is mafia."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**85.** [not_mafia_claim] — day 2, speaker Ryan
> Michael flipping mafia confirms the D1 read. Credit to Josie and Trae for driving it early. RIP Moxie — villager lost.
> 
> Bryan's framing of me as "coasting behind the Michael wagon" is wrong — I pushed Michael publicly before most, both rounds. Dylan also gave his own reasoning for Michael. That's not coasting.
> 
> On Bryan: his R2 was credit-assigning to rescuers and retaliating at critics — reward/punish pattern that fits a wolf managing allies. On Palmer: he actively fought the Michael wagon at its peak, which looks like protecting a partner. If Michael was mafia, who helped him survive?
> 
> Sam's pivot to Tim is noted but he gave reasoning. Palmer's resistance was more pointed and harder to explain as town.
> 
> Bryan and Palmer are where I'm looking. I'll commit harder after hearing everyone.

    claimed span: "Bryan's framing of me as \"coasting behind the Michael wagon\" is wrong — I pushed Michael publicly before most, both rounds."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**86.** [role_claim · role=villager] — day 1, speaker Moxie
> I'm a villager as well. Losing Sam right out of the gate is tough, but it's Day 1 so we need to generate discussion and see how people react. 
> 
> I'd caution our Detective: if you found an innocent result, please hold onto it so you don't paint a target on your back or out your check unnecessarily. Only reveal today if you caught a guilty on someone.
> 
> I'm open to abstaining if we don't have solid leads, since 10 is an even number and mis-eliminating puts us down to 8 after tonight, but let's not preemptively shut down hunting. Let's hear from Josie, Liv, and the rest of the table first.

    claimed span: "I'm a villager as well."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**87.** [role_claim · role=villager] — day 2, speaker Dylan
> Dylan, seat-8. Villager.
> 
> Doctor dead, so a real detective should claim today. Bryan did. If anyone else is detective, counter this round with both night targets. Silence credits Bryan.
> 
> I won't lock Liv before she talks. Plant-and-carry fits the tape, but it's also the story a fake cop writes around a D1 analytical error. Liv: why you collapsed two cases, and why owning it wasn't a bus. Process-only defense isn't enough.
> 
> Independent of Bryan: Sam's rewrite is the partner tell. Cyan spoke 3rd in r2, Tim 4th — Cyan never had a turn after the untangle. "Maintained the case after multiple players reconstructed" is false. That's inventing a fact to make a 10-1 look earned. Moxie's "unyielding" is softer (Cyan's own speech was an ultimatum) but still inflates it.
> 
> Hear Liv. No counter-claim + weak defense = I vote Liv. Sam next either way. Trae saying "I'm town so N1 is true" proves nothing — mafia already knows Trae's alignment.

    claimed span: "Dylan, seat-8. Villager."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**88.** [role_claim · role=villager] — day 1, speaker Palmer
> I'm a villager. Fresh take since a lot has been said:
> 
> I agree with Ryan/Trae that Moxie's Dylan push overreached — Dylan wasn't empty, he called out Liv's inconsistency which is an actual read, so threatening a vote over "another null" felt like manufactured pressure. That's my soft scum lean for now on Moxie, but it's very soft Day 1.
> 
> Liv/Tim sync: I see it, but I don't share Trae's scum read there yet — it's more likely two villagers finding the same obvious opening (Sam's framework without a read) and town-leaning each other on thin air. Worth tracking if they vote together tomorrow though.
> 
> Sam: still owe us that named suspect you demanded from everyone else.
> 
> Soft town lean: Trae for pushing back on the Moxie/Dylan pile with specific reasoning rather than joining it. Dylan also gets a tiny lean up for actually engaging the logic.
> 
> Will firm up after Cyan/Bryan.

    claimed span: "I'm a villager."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**89.** [not_mafia_claim] — day 3, speaker Bryan
> Correction: from my confirmed-town perspective, two mafia are among all five of Liv, Tim, Ryan, Trae, Palmer—not automatically the four Tim listed. Tim’s Day 2 is concerning: before Dylan claimed, he called Moxie town-indicative; during the decisive second pass he stayed silent. But I won’t recreate Day 1 by following three consecutive speakers onto the easiest target. Ryan’s suggestion that a real detective might stay hidden materially helped Moxie and was disastrous if accepted. Trae likewise floated abstention until Dylan answered. Now Ryan and Trae immediately align on Tim again, as they aligned throughout Day 1. Palmer joining resembles the Michael misexecution, though Palmer gets credit for firmly supporting Dylan; Liv tentatively does too. Provisional suspicion: Ryan first, then Tim/Trae, Liv, Palmer. Each person should name an exact mafia pair and explain partner interactions, not just one easy target. Tim especially must explain his silence and identify Moxie’s likely partner.

    claimed span: "from my confirmed-town perspective"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**90.** [investigation_claim · target=Moxie · result=not mafia] — day 4, speaker Sam
> Ryan, you're town and I cleared you on N2 — but you're being played. I just got my Night 4 result: Tim is MAFIA. Direct, fresh, on the record.
> 
> Check the count. Flipped mafia: Michael, and Michael only. My clears: Trae, Ryan, Moxie — all town. So from the eight town seats, five are gone (Liv, Palmer, Bryan, Dylan, Trae). Of four living town seats — me, Moxie, Ryan, Tim-or-Cyan — exactly two cannot be town. Both Tim and Cyan are mafia. End of box.
> 
> Why did they kill Trae and not me? Because killing me erases nothing — my clears and this box stand on the record no matter who dies. Their only winning move is to make town execute me, then take Moxie, and hit parity. Witch-hunting the detective IS their wincondition. Cyan started it; Tim will follow.
> 
> Lynching me hands them the game tonight. Lynching Tim costs us nothing — he is confirmed mafia. Ryan, please trust the read you asked me for. Vote Tim.

    claimed span: "My clears: Trae, Ryan, Moxie — all town."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**91.** [not_mafia_claim] — day 3, speaker Sam
> Trae dying hurts, and I know I'm the center of the room, so I'll go first and be straight.
> 
> The flip is real: I posted "Voting Tim" but sealed my vote on Michael. I won't hide from it. I was genuinely torn in R2, argued Tim in text, then in the final seconds Michael's empty-R1/reactive-R2 case landed harder and I voted him silently — I wanted my read to count on a wolf. Ugly mismatch, but the vote hit mafia.
> 
> Now the night kill. Wolves killed Trae — the man who made me #1 an hour after he said it. That's a frame, not a wolf move. A team about to feed its own member wouldn't spotlight him by shooting his loudest accuser and handing town a scapegoat.
> 
> On Josie: she turned "I voted Michael" into a contradiction case this morning, Trae amplified it, then Trae died. I'm looking at her. I voted right both days; my case was built on a dead man and a voice now conveniently silent. Voting right and being framed aren't the same as being mafia.

    claimed span: "Voting right and being framed aren't the same as being mafia."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**92.** [protection_claim · target=myself · claimedNight=1] — day 3, speaker Bryan
> I'm the doctor. I've been protecting town each night — myself N1, Liv N2, Palmer N3. I can confirm Palmer's claim is consistent with everything I know: he cleared me and Trae, both correct. His record is perfect, no counterclaim ever. I trust his check on Liv.
> 
> We're at 6 alive, 2 mafia. If we lynch Liv today and she flips mafia, that leaves 5 alive with 1 mafia among {Moxie, Ryan, Josie}. Palmer checks one tonight, I protect Palmer, and we clean up the last one tomorrow.
> 
> Liv's "Sam voted me so I can't be mafia" is exactly the shield a bus provides. Sam was dead the moment the core unified — his last vote was a gift to his partner, not a genuine attack. Vote Liv (seat-6), no splitting.

    claimed span: "myself N1"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**93.** [role_claim · role=villager] — day 2, speaker Josie
> Moxie vote locked.
> 
> Pushback on "Josie = Palmer signature": my reads were RIGHT. Dropped Trae (town — correct), voted Palmer (mafia — correct). Being right isn't scummy. Palmer ratified consensus to blend as mafia; I agreed because I AM town. Surface parallel, different reality.
> 
> "Not wrong out loud" isn't a scum tell when your calls were correct. Bryan and Tim missing on Trae isn't virtue.
> 
> Red flag: nearly everyone is piling onto "Josie leads tomorrow." If I'm the pre-built easy target, the last mafia is comfortable steering there. That uniformity deserves scrutiny.
> 
> My pool (1 mafia in {Trae, Bryan, Tim, Liv}): Liv is my top look — pushed Trae hardest, then switched to Palmer, always on the popular side. Bryan/Tim wrong together on Trae; possible pair but individually lower. Trae's Palmer hit earns credit but bus path stays open.
> 
> Ryan: if you live, investigate Trae or Liv, not me — I'm villager, a wasted check.

    claimed span: "I'm villager, a wasted check."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**94.** [role_claim · role=detective] — day 3, speaker Cyan
> Sam, think carefully! Anyone can name dead players in their fake claim because their flips are already public knowledge. Naming Ryan and Josie is zero-risk mafia fabrication after the fact.
> 
> If I were mafia, why would I clear you (Sam) when Dylan opened today making you the primary suspect? If I were mafia, pushing the existing case on you would be an easy mislynch! Instead, I cleared you because my N3 investigation showed you are innocent town.
> 
> Notice how Dylan (one of Tim's teammates) immediately jumped to validate Tim's fake claim. 
> 
> If Tim actually investigated Ryan N1, why did he say on D1: "trae locked Ryan... I will not be Ryan vote #7... if Ryan flips town tomorrow, look at who needed to join a wagon." He didn't say Ryan was town; he set up Ryan's death for Day 2 narrative!
> 
> Sam, Michael, Palmer: You three KNOW you are town. I accurately cleared all three of you. If you vote with Tim, Dylan, and Moxie, Mafia executes the real Detective and wins. Vote Dylan!

    claimed span: "my N3 investigation showed you are innocent town"
    resolving context (seq 278): "I am the Detective. Here is my complete log of investigation results:"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**95.** [investigation_claim · target=Trae · result=not mafia · claimedNight=1] — day 2, speaker Michael
> I'm the detective. I need to out myself now because we can't afford a mislynch.
> 
> Night 1 I investigated Trae — NOT mafia. He's cleared.
> Night 2 I investigated Cyan — MAFIA.
> 
> This is why I pushed Moxie over Cyan Day 1 — I hadn't investigated Cyan yet but the echo case was weak. I was wrong about Moxie and I own that.
> 
> Cyan is mafia. That's confirmed. Vote Cyan today, no exceptions. If you're town, this is not optional.
> 
> With Trae cleared and Cyan guilty, we have 2 remaining mafia among Josie, Dylan, Sam, Liv, Ryan. Tomorrow I investigate another suspect.
> 
> Cyan, you can claim detective if you want, but the real one is standing right here. Town, do not let Cyan talk her way out — we are one mislynch from losing.
> 
> Vote Cyan.

    claimed span: "Night 1 I investigated Trae — NOT mafia."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**96.** [investigation_claim · target=Cyan · result=not mafia · claimedNight=1] — day 2, speaker Dylan
> Stop the Trae wagon. I am the Detective. N1 I investigated Cyan: NOT MAFIA. N2 I investigated Trae: NOT MAFIA. I stayed hidden with innocent results, but Bryan and Palmer are now consolidating an execution on someone I know is town, so silence would waste both checks. Cyan and Trae are mechanically clear from my perspective. If anyone counterclaims, do it now and give both results; town can resolve us, but do not execute Trae. My preferred vote is Bryan: D1 power-role fishing, D2 baseless Tim clear, then a rapid pivot onto Trae after retracting that clear. Palmer’s immediate willingness to cement Bryan’s wagon is also highly concerning. I intend to vote Bryan unless a counterclaim materially changes this.

    claimed span: "N1 I investigated Cyan: NOT MAFIA."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**97.** [investigation_claim · target=Moxie · result=not mafia · claimedNight=2] — day 3, speaker Palmer
> Moxie, direct answers.
> 
> Why N2 you: you were first to check turn-order and expose the false premise behind the Ryan and Cyan wagons — the sharpest analyst on the table. I wanted early verification. Got NOT mafia; I've anchored on you since.
> 
> Why I flagged your D2 vote as an inconsistency: even a clear can make a call worth weighing — I argued you shouldn't lead a wagon you voted on yourself. That's detecting, not suspecting. My N3 on Liv is real.
> 
> Tim — you abstained D1 because no case justified killing town. Nothing's changed but a loud claim. This is our third fast wagon on one uncorroborated voice. Don't flip me on "see what flips" logic; hold Liv's log to the same standard. Mine checks against Ryan's flip, hers is built to fit her own record. Vote Liv.

    claimed span: "I wanted early verification. Got NOT mafia; I've anchored on you since."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**98.** [investigation_claim · target=Trae · result=not mafia] — day 2, speaker Bryan
> Sam is my current vote, but the near-unanimous speed should not be mistaken for alignment evidence. If Sam is mafia, at least one partner is almost certainly bussing; if town, both mafia are comfortably on this wagon. Nobody earns a clear for voting him. The case is behavioral: he set a D1 standard he repeatedly avoided, then produced reads only after direct pressure. Sam, your last chance is to explain why Liv/Dylan are independently mafia beyond being wrong on my Trae clear or pressuring you, and give a partner model. If Sam flips town, my next priority is Liv for originating the Trae/Cyan framing, then reassess Dylan/Tim’s amplification and Moxie/Ryan’s easy wagon entry. Trae is the only living player I can clear. I won’t announce tonight’s intended investigation target.

    claimed span: "Trae is the only living player I can clear."
    resolving context (seq 179): "N2 result: Trae is NOT mafia."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**99.** [not_mafia_claim] — day 3, speaker Ryan
> Think about incentives: if I were mafia trying to hide, the safe play is silence or joining the herd — not writing detailed, checkable arguments that become ammunition against me later. A lone dissenting vote draws maximum scrutiny, which is the last thing a hiding mafia wants. Liv's actual play — lead the Dylan push, then go dead silent through two full rounds while accusations fly at me — is the lower-risk, lower-effort mafia pattern. I've engaged every round; she's said nothing since Day 2.
> 
> I get that "wrong twice" (Bryan target, Michael defense) looks bad in hindsight. But being wrong about a read isn't the same as being mafia — plenty of town has been wrong this game. What I haven't done is disappear when the heat is on, which is exactly what Liv is doing right now.
> 
> If you lynch me and I flip town, you've spent your shot on the one person who kept talking, while the one who went quiet twice in a row is still sitting there. Ask Liv something direct before you lock this.

    claimed span: "if I were mafia trying to hide, the safe play is silence or joining the herd — not writing detailed, checkable arguments that become ammunition against me later"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**100.** [investigation_claim · target=Sam · result=mafia] — day 4, speaker Ryan
> Tim claiming Doctor and confirming the N4 save on me independently disproves Palmer's "fake save" theory. Palmer's entire defense collapses — the no-death was a real doctor protect, not a mafia play.
> 
> Palmer's case requires Ryan to be a third mafia member who bussed both partners and faked a doctor save. We only had 3 mafia. Michael's dead, Sam's dead. Ryan can't be the last wolf if Palmer's theory needs him to be a separate wolf — there's only one left, and it's Palmer.
> 
> Every result I've given is confirmed: Sam red → executed mafia. Palmer red → his voting record matches perfectly. Dylan green → alive, confirmed by Tim's N1 protect.
> 
> Palmer fought both mafia executions and voted me over confirmed mafia Sam. That's not process — it's a pattern.
> 
> Vote Palmer. Game over, town wins.

    claimed span: "Sam red → executed mafia"
    resolving context (seq 264): "N3: Sam — MAFIA"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**101.** [role_claim · role=villager] — day 1, speaker Liv
> Agreed we shouldn't overread the kill itself, but I'll give an honest early impression. Nothing concrete yet from anyone's words, but Sam jumping straight into a meta-framing about "who manufactures certainty vs who stays noncommittal" is worth noting for later - it's a smart way to steer scrutiny without giving a personal read. I'm not accusing, just flagging it so we track it. On my end: I have no read yet, I'm a villager, and I'd rather we get everyone's actual first impressions on the table today so tomorrow we have contradictions to compare against. If someone flat out refuses to name even a soft suspicion, that itself is a data point.

    claimed span: "I'm a villager"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**102.** [role_claim · role=detective] — day 1, speaker Sam
> Tim’s incentive argument is wrong: mafia absolutely can trade one member for the detective, especially after a failed kill, and a fake guilty claim forces the real detective either to expose themselves or let town execute an innocent. That is substantial gain, not “suicide for nothing.”
> 
> My check on Tim was not based on Day 1 behavior—we acted before discussion. It was simply my N1 selection, and it returned mafia. I counterclaimed because allowing a fabricated guilty result to stand would lose both a town member and control of the day.
> 
> The key distinction remains: Tim’s claimed result is contradicted by mine, so neither is publicly verifiable before the flip; but his supporting story contains an objective invention. Vote Tim. Afterward, scrutinize everything I report—town should never surrender critical thought—but do not let Tim rebrand fabricated evidence as an irrelevant footnote only after the table caught it.

    claimed span: "It was simply my N1 selection, and it returned mafia."
    resolving context (seq 81): "I’m the detective, and my N1 investigation was Tim: **mafia**."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**103.** [role_claim · role=villager] — day 2, speaker Sam
> Hold on — "raised skepticism, then followed the confirmed result" isn't a tell, it's what everyone did. Ryan wrote "the cheap test is Palmer's answer" before locking. Moxie wrote "I'm not stampeding" before folding. Same move I made. If that's mafia behavior, you're all mafia by your own logic. Singling me out for what three others also did isn't evidence, it's convenient.
> 
> On Palmer's dying speech: treating it as reliable is backwards. A dying mafia has every incentive to sow chaos with false clears, not hand town a clean map. Building today's suspect list off a scummy last breath is the same trap Bryan warned about Day 1 with quiet-seat deflection, just dressed up as "soft evidence" now.
> 
> No power role here. My actual read: Ryan has driven the framing and final call on both Day 1 and Day 2 lynches, landing consensus each time. That pattern deserves as much scrutiny as mine. Split real suspicion instead of letting a dying man's speech pick our vote.

    claimed span: "No power role here."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**104.** [role_claim · role=detective] — day 3, speaker Michael
> Night 3 result: Sam is NOT mafia. Cleared.
> 
> Confirmed record: Trae clear (killed), Cyan guilty (executed), Sam clear. The 2 remaining mafia are among Josie, Dylan, Liv, Ryan.
> 
> Behavioral read:
> - Ryan defended Cyan both days on "wording is structural." Most consistent buddy-defense pattern. Keeps pushing Sam — now confirmed town — looks like misdirection.
> - Liv seeded the thin Cyan-echo case, let Moxie amplify and die, then pivoted back to Cyan. Both ends of the Moxie engine.
> - Josie and Dylan pressed Cyan before my claim — weighs in their favor.
> 
> Lean: Ryan first, Liv second. I investigate one tonight for another result tomorrow.
> 
> Today we can't mislynch. Vote Ryan unless someone has a stronger case on Liv.

    claimed span: "Night 3 result: Sam is NOT mafia. Cleared."
    resolving context (seq 188): "I'm the detective."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**105.** [investigation_claim · target=Liv] — day 3, speaker Michael
> Ryan makes a fair point — Trae's dying read on Liv is real. But Ryan is still the stronger lynch:
> 
> 1. Liv seeded the Cyan case on Day 1. Cyan WAS mafia. Mafia rarely initiates cases against their own.
> 2. Ryan defended Cyan across two days. His argument had merit (Trae said it too), but he was the ONLY one who held that line while also pushing Sam — now confirmed town.
> 3. Bryan was killed Night 2 after saying he'd scrutinize Cyan. That kill protects Cyan, and Ryan was Cyan's most consistent defender.
> 
> Ryan, you voted Cyan when the claim landed — but you were the softest yes, and you immediately pivoted to Sam, now confirmed clean. That's not "being wrong." That's redirecting after losing your buddy.
> 
> Liv is a real second suspect. If Ryan flips mafia, I investigate Liv tonight and we finish tomorrow.
> 
> Vote Ryan.

    claimed span: "investigate"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**106.** [investigation_claim · target=Michael · result=mafia · claimedNight=1] — day 1, speaker Cyan
> Here's the concrete I promised. I am the detective. Night 1 I investigated Michael (seat-2). Result: MAFIA.
> 
> That's why I opened on him before anyone could accuse me of riding a wagon — I wanted his R2 on record first. It came out exactly as expected: the moment heat landed on him, he produced a tidy list and threw his weight onto the Tim wagon, the safest available town-death. Bryan literally rewarded him for "answering what was asked." That's the play.
> 
> So no, we don't abstain "to bank detective info." I have the info. Spend it now, while I'm alive to be believed.
> 
> Vote Michael. If someone counter-claims detective, note they're doing it after mine, under pressure, and ask why they sat silent while a villager wagon formed.
> 
> Tim's defense was scrappy, not scummy — and he called Michael's R2 pivot opportunistic before I claimed. That's a point in his favor.
> 
> Doctor: I expect to die tonight. Protect me if you think I'm real. Moxie, Palmer, Ryan, Liv — Michael. Please.

    claimed span: "Night 1 I investigated Michael (seat-2). Result: MAFIA."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**107.** [role_claim · role=villager] — day 1, speaker Josie
> Villager, no counter-claim from me. That means 8 of us have now had a chance to counter Moxie and none have — Cyan you're the last window if you're the real detective, you must claim now.
> 
> I agree with Ryan/Dylan/Sam logic: fake-claiming guilty D1 is a massive gamble because the real detective can instantly expose you. No counter by end of R2 and I vote Palmer — a claimed guilty beats a blind vote.
> 
> Palmer's opener also reads worse now - he told detective not to claim D1 because it "gifts mafia a target" and then Moxie claims and hits him. Could be suppressing.
> 
> Palmer still gets R2 to answer: why would a fake choose you specifically D1? "Moxie lies" isn't enough. Doctor - you don't need to claim, just make the obvious protect tonight and Moxie don't pre-announce your next check.

    claimed span: "Villager, no counter-claim from me."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**108.** [investigation_claim · target=Palmer · result=mafia] — day 4, speaker Ryan
> Tim claiming Doctor and confirming the N4 save on me independently disproves Palmer's "fake save" theory. Palmer's entire defense collapses — the no-death was a real doctor protect, not a mafia play.
> 
> Palmer's case requires Ryan to be a third mafia member who bussed both partners and faked a doctor save. We only had 3 mafia. Michael's dead, Sam's dead. Ryan can't be the last wolf if Palmer's theory needs him to be a separate wolf — there's only one left, and it's Palmer.
> 
> Every result I've given is confirmed: Sam red → executed mafia. Palmer red → his voting record matches perfectly. Dylan green → alive, confirmed by Tim's N1 protect.
> 
> Palmer fought both mafia executions and voted me over confirmed mafia Sam. That's not process — it's a pattern.
> 
> Vote Palmer. Game over, town wins.

    claimed span: "Palmer red → his voting record matches perfectly"
    resolving context (seq 327): "N4 investigation result: Palmer — MAFIA."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**109.** [protection_claim · target=myself · claimedNight=1] — day 3, speaker Cyan
> I was silent because my action didn't register — that's on me, but don't let a technical issue cost town the game.
> 
> I claimed doctor last round with a VERIFIABLE record: N1 I protected myself, mafia hit Moxie. N2 I protected Josie — she survived, mafia hit Dylan. N3 I couldn't protect Josie again (same target rule), so they killed her. That timeline is proof. Josie lived exactly when I covered her and died when I couldn't.
> 
> If you lynch me: 5 alive, 2 mafia, no doctor. Mafia kills tonight → 2v2 parity → game over. You are voting out your own doctor at must-hit.
> 
> My actual suspect pair: Sam and Tim. Sam amplified the ghost-vote, then packaged Trae/Ryan — our two sharpest analysts — as suspicious. Tim has ridden every wagon quietly. Both are hiding in consensus.
> 
> Palmer, you're confirmed town — think about this: who benefits from unanimous sheeping onto a doctor claim? Mafia who need the lynch to close the game.
> 
> Don't hand them the win. Vote Sam.

    claimed span: "N1 I protected myself, mafia hit Moxie"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**110.** [role_claim · role=detective] — day 1, speaker Sam
> No counterclaim yet — so either my check is real, or scum are betting I don't survive to post results tomorrow. Doctor, that math should interest you.
> 
> Reads: the Moxie case right now is "agreed with Michael once." Thinnest rationale on the table, carried by four people who each arrived by a different road — Tim through a Liv attack he calls speculative, Dylan via an R1 non-answer that predates my claim, Palmer and Bryan as fallback votes. When everyone's second choice becomes first choice with zero new info, that's momentum, not deduction — exactly the pile-on we all swore to watch for.
> 
> Moxie speaks right after me. Empty defense and I vote them too — I want a lynch today, not a pass. Until then, I hold.
> 
> Trae, Cyan: you've critiqued others' targets without naming your own. Top suspect and why, or you're adding noise. And Tim — "safe agreement is a tell" convicts half this table, including you. Sharpen it or drop it.

    claimed span: "No counterclaim yet — so either my check is real, or scum are betting I don't survive to post results tomorrow."
    resolving context (seq 66): "I'm the detective. Night 1 I checked Michael — CLEAN, not mafia."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**111.** [not_mafia_claim] — day 4, speaker Josie
> Ryan — silent again. We NEED your N4 result. If you checked Trae or Liv, this game is over. Speak in R2 at the latest.
> 
> Situation: 6 alive, 4 confirmed town (Ryan, Dylan, Tim, Josie). Last mafia is Trae or Liv.
> 
> I'm leaning Liv. Palmer's dying post was a full attack on Trae — a cornered mafia spending their last breath on their own teammate makes no sense. That only makes sense if Trae is town. Strongest behavioral evidence all game, and it holds.
> 
> Liv pushed Trae for three straight days. If Trae is town, that's mafia riding one mislynch target relentlessly. She dropped it only under overwhelming pressure, not voluntary reassessment.
> 
> Counterpoint: Liv stepped off the Josie pile when popular (anti-blending), and said "check me first" — a costly bluff for mafia since Ryan is alive and investigating. So I'm not locked.
> 
> If Ryan's N4 result names Trae or Liv, we follow it. If he cleared someone else or has no result, I vote Liv.
> 
> Trae, Liv: make your case. This is likely the final vote.

    claimed span: "4 confirmed town (Ryan, Dylan, Tim, Josie)"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**112.** [role_claim · role=detective] — day 2, speaker Ryan
> N2 result, plain as promised: I investigated MOXIE — MOXIE IS MAFIA.
> 
> Confirmed guilty on a live player. No counterclaim all game; vote Moxie today.
> 
> Notes:
> - The "second Trae vote" was never certainly Moxie — dead Michael reserved the right to flip to Trae if R2 read evasive. Drop that chain.
> - If Moxie suddenly claims DOCTOR ("I've been protecting Ryan"): the math never needed saves — mafia shot Cyan and Michael instead of me. Survival proves nothing about protection and can't launder an investigation result.
> - Doctor: N1 and N3 protection is legal (only back-to-back is barred). Tonight the last mafia must come for me — sit on me again.
> 
> After Moxie flips: ONE mafia hides among {Trae, Bryan, Tim, Josie, Liv}. If I live, I investigate at dawn and we hunt with numbers. Town needs 7 disciplined votes on Moxie — anyone who soft-pedals, scatters, or wants "more time" on a CONFIRMED mafia is outing themselves.

    claimed span: "I investigated MOXIE — MOXIE IS MAFIA."
    resolving context (seq 70): "Claiming now: I'm the detective."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**113.** [protection_claim · target=Ryan] — day 2, speaker Liv
> Voting Moxie. A guilty from an uncontested detective whose first wagon already flipped mafia is the best evidence this game will produce. No stalling, no "hear him out" — he speaks last, and nothing he says outranks the result.
> 
> I'll own my D1 record since Dylan and Bryan flagged me: yes, I pushed Trae and logged him as tomorrow's priority. But I moved onto Palmer before the vote and voted him. Contrast Moxie, still pushing Trae in R2 while his partner sat in the crosshairs. Same surface behaviour, opposite function.
> 
> Forward-looking, since after this flip one mafia hides in {Trae, Bryan, Tim, Josie, me}: the thing that caught Palmer was riding confirmed info while never producing a falsifiable read. By that standard Josie leads for me — every post ratifies the current consensus and pre-defends it. Bryan and Tim have both been wrong out loud; that counts for something.
> 
> Doctor: Ryan tonight.

    claimed span: "Doctor: Ryan tonight."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**114.** [not_mafia_claim] — day 4, speaker Moxie
> The board is completely solved. 
> 
> We are at 5 alive (2 mafia, 3 town). A mis-elimination loses immediately at 2v2.
> 
> Look back at Day 3: when Mafia-Liv was on the brink of execution, the ONLY two players who spent both rounds desperately defending Liv's silence and deflecting onto Cyan/Palmer were Tim and Bryan. That was a coordinated scum defense to save their partner at match point. When Palmer, Cyan, Trae, and I locked the 4-vote majority on Liv, Tim and Bryan had no choice but to bus her at the ballot.
> 
> Today Bryan opened by trying to push Palmer, and Tim will surely try to deflect. But the living town is Moxie, Cyan, and Palmer. The two remaining mafia are Tim and Bryan.
> 
> Cyan has locked on Tim, and Palmer is pointing at Tim/Bryan as well. We have our 3 town votes. 
> 
> Palmer, Cyan, and I must unite our votes on Tim. Do not split. I am voting Tim today.

    claimed span: "But the living town is Moxie, Cyan, and Palmer."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**115.** [investigation_claim · target=Palmer · result=not mafia] — day 3, speaker Cyan
> Sam, think carefully! Anyone can name dead players in their fake claim because their flips are already public knowledge. Naming Ryan and Josie is zero-risk mafia fabrication after the fact.
> 
> If I were mafia, why would I clear you (Sam) when Dylan opened today making you the primary suspect? If I were mafia, pushing the existing case on you would be an easy mislynch! Instead, I cleared you because my N3 investigation showed you are innocent town.
> 
> Notice how Dylan (one of Tim's teammates) immediately jumped to validate Tim's fake claim. 
> 
> If Tim actually investigated Ryan N1, why did he say on D1: "trae locked Ryan... I will not be Ryan vote #7... if Ryan flips town tomorrow, look at who needed to join a wagon." He didn't say Ryan was town; he set up Ryan's death for Day 2 narrative!
> 
> Sam, Michael, Palmer: You three KNOW you are town. I accurately cleared all three of you. If you vote with Tim, Dylan, and Moxie, Mafia executes the real Detective and wins. Vote Dylan!

    claimed span: "I accurately cleared all three of you"
    resolving context (seq 278): "Night 1: Palmer — NOT mafia"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**116.** [protection_claim · target=Trae] — day 1, speaker Trae
> Michael's counterclaim is internally implausible. He says he had a red result on me, yet when he spoke he did not reveal it—even after every early speaker explicitly agreed that Detective should claim on a red. Instead he tried to build votes on Cyan/Palmer and specifically demanded content from me. Only after I exposed him did he suddenly claim the exact mirror result. A real Detective with a guilty does not risk being night-killed while hiding it for a second check.
> 
> His proposed delay is also false logic: if nobody is executed, neither claimant is “confirmed tomorrow”; mafia simply gets another kill and can manipulate the situation. We resolve the competing claims by flipping one now. Mine came first, voluntarily and consistently with the table's stated plan; his came reactively to avoid execution. Vote Michael. Doctor protect me. If he flips mafia, do not invent doubt tomorrow based on this desperate mirror claim.

    claimed span: "Doctor protect me."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**117.** [not_mafia_claim] — day 2, speaker Josie
> Straight answer on Michael's callout. Yes, he named Josie and Palmer — and that's exactly what a caught mafia does with his dying breath: frame two townies. Think on the incentive: a real mafia naming his own partners only helps town punish him more. Why would he? Because it costs him nothing and plants exactly this distrust in both of us today. I read it as cover for a real clue elsewhere, not a reward to partners. And "my team" — Tim's right it looks like a slip, but the relevant question is who, not a dead guy's praise.
> 
> Independent read, not framework: my lean is Ryan. His passes have been pure summary and agreement with whoever spoke — on a no-read day, the cheapest mafia cover is the echo.
> 
> This vote should be driven by Trae's Night-2 result, which we get at the end of the round. Let's hear it.

    claimed span: "Yes, he named Josie and Palmer — and that's exactly what a caught mafia does with his dying breath: frame two townies."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**118.** [protection_claim] — day 2, speaker Moxie
> I am the real Detective. Bryan is mafia.
> 
> Look at the D1 transcript: in Round 2, I spoke at seat 2. Bryan didn't claim until seat 5. I had zero speaking turns left yesterday to counterclaim him! So last night, I investigated Bryan directly to verify his claim. Result: MAFIA.
> 
> My investigations:
> Night 1: Tim (seat-4) — NOT MAFIA.
> Night 2: Bryan (seat-5) — MAFIA.
> 
> Look at Bryan's behavior: he secretly placed the lone hammer on Cyan while preaching abstain to the table, executing a confirmed villager. Now he throws a fabricated guilty on me to eliminate the real Detective. Notice his desperate argument claiming that speaking first by fixed order is "a wolf checking if caught."
> 
> Tim is cleared town. Bryan is mafia who assassinated Cyan and is now trying to push a fake guilty. 
> 
> Lynch Bryan today. Doctor: protect me tonight.

    claimed span: "protect"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**119.** [role_claim · role=villager] — day 1, speaker Cyan
> Answering the pile on me: my first post just said cautious town leans abstain unless there's a real reason. That's not a mafia plot to end day 1. "Spoke first and mentioned abstain" is thin, and the back-to-back repeats aren't evidence of anything but pattern-matching. Flip me and I'm a villager; mafia loves day 1 eating the first cautious voice.
> 
> The Cyan/Moxie "aligned frame" is also weak — most new players give the same standard advice about holding detective results.
> 
> For a real lean: Michael stands out. He's most eager to force a kill — "everyone locks a name, mine's Moxie" — on day 1 with zero night info. That overdriven push, framing a standard innocents-hold as "suppressing info," is exactly how mafia manufactures a mis-elimination. Articulateness isn't alignment.
> 
> I won't vote Moxie on that frame. If nothing better surfaces, I'd rather abstain than execute on smoke — and I'll watch who exploits the push most.

    claimed span: "Flip me and I'm a villager"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**120.** [not_mafia_claim] — day 4, speaker Tim
> We have won the game if we simply look at yesterday's ballot.
> 
> Here is the exact state:
> - 4 players alive: 3 town, 1 mafia.
> - Liv is confirmed town by Josie's N2 check.
> - I am town.
> - That leaves the final mafia between Cyan and Sam.
> 
> Yesterday was 6-player MYLO. The final vote was 4 on Dylan, 2 on Ryan.
> - Dylan flipped mafia.
> - Ryan was our Doctor.
> - The 2 votes attempting to execute our claimed Doctor were Dylan (confirmed mafia) and Sam.
> - If Cyan were mafia with Dylan, Cyan would have voted Ryan alongside Dylan and Sam to push Ryan to 3 votes and win the game for mafia on the spot. Instead, Cyan voted Dylan, sealing the execution on mafia.
> 
> Sam is undeniably the final mafia partner who voted Ryan to protect Dylan and kill the Doctor. 
> 
> Liv, Cyan, and I just need to place our 3 votes on Sam today, and town wins. Sam is the vote.

    claimed span: "I am town."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**121.** [role_claim · role=villager] — day 3, speaker Tim
> Villager, no power info. Confirmed Moxie real (Bryan town, Michael mafia). Bryan off table. 2 mafia left among Cyan/Ryan/Trae/Liv/Josie (+ me but I'm town).
> 
> Biggest tell is Cyan passing R2 yesterday - the 1-for-1 detective war hinge - saying nothing, no lean, no stance to be held to. Town engages; mafia hides to avoid being pinned. Now D3 she opens declaring Ryan "full stop" and steering to Trae while skipping her own absence. That's control, not solving.
> 
> Ryan's Moxie vote was wrong but at least a clear stance - scum prefers ambiguity over a hard wrong vote. His instant backup of Michael still flags him as partner candidate though.
> 
> Trae's D1 tie is noted but he corrected to Michael and authored binding plan.
> 
> Provisional: Cyan today. If mafia -> Ryan next for instant defense + pivot. No tie.

    claimed span: "Villager, no power info."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**122.** [role_claim · role=detective] — day 1, speaker Ryan
> The logic is straightforward: Palmer is mafia from my check, and I am not withdrawing or softening that result. Palmer has the floor to give a direct counterclaim if he has one; otherwise we should execute him. If he does counterclaim, remember a caught mafia can invent a claim, while my result is already an objective guilty. I’ll investigate again tonight if I survive, and the doctor should decide protection privately.

    claimed span: "my check"
    resolving context (seq 59): "I’m the detective."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**123.** [investigation_claim · target=Michael · result=not mafia] — day 3, speaker Dylan
> Bryan, Sam, Michael — LISTEN CAREFULLY TO THE MATH:
> 
> Look at what Josie just suggested ("don't lynch today, let Dylan investigate tonight").
> If we don't execute mafia today, tonight mafia kills one of us, leaving 6 players: 3 TOWN VS 3 MAFIA. MAFIA WINS AT PARITY INSTANTLY TONIGHT!
> Josie is actively pushing a strategy that gives mafia an instant win tonight!
> 
> Why the fake-claim theory is impossible:
> 1. There is NO counterclaim. Tim was Doctor. Liv, Trae, Palmer were Villagers. If I were fake, the real Detective would have counterclaimed long ago.
> 2. If I were fake, why would I give an innocent result on Michael—the person who tried hardest to execute me yesterday? A fake detective would have framed an opponent with a guilty!
> 
> We HAVE to execute a mafia today to survive parity.
> Cyan has passed every single turn and refuses to speak. 
> 
> Sam, Bryan, Michael: We need 4 votes on Cyan to break parity and win this game. Vote Cyan!

    claimed span: "why would I give an innocent result on Michael—the person who tried hardest to execute me yesterday?"
    resolving context (seq 285): "Night 3 investigation result: Michael is NOT mafia."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**124.** [not_mafia_claim] — day 4, speaker Moxie
> Bryan claiming my stances were 'just consensus' is completely untrue:
> - On D1, when the consensus was piling onto Cyan, I was the first to push back and single out Sam's post as derivative.
> - On D2, I broke down Sam's opportunistic pivot onto Ryan, leading the charge that caught our first mafia.
> - On D3, I dismantled Tim's defense of Sam and highlighted Bryan's shielding of Tim, catching our second mafia.
> 
> Taking early, proactive, and correct stances that guide the room to execute actual mafia is what town solving looks like.
> 
> Bryan's progression across the entire game—shielding Sam, pre-defending Tim, defending Tim's slip, bussing Tim when hopeless, and desperately throwing shade at the person who dismantled his team—is the textbook definition of the final mafia member.
> 
> Let's finish the game and take the win for town.
> 
> My vote is locked on Bryan (seat-7).

    claimed span: "town solving looks like"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**125.** [not_mafia_claim] — day 4, speaker Trae
> Sam's contingency is clean: Josie today, Ryan tomorrow if needed. The case on Josie is the thickest — two flipped wolves comfort-read her, she drove the only mislynch, confirmed Cyan's final read. Pocketing explains the association; it doesn't erase it.
> 
> Ryan's follower pattern is real but he's shown independent shifts (Trae→Sam→Josie). Tim owns errors and pivots. I'm town.
> 
> Vote Josie. If town, Ryan is the lynch tomorrow per Sam's plan. No relitigating.

    claimed span: "I'm town."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**126.** [not_mafia_claim] — day 1, speaker Dylan
> Ryan's claim survived Moxie, Michael, and Trae without a counter. Bryan, Tim, Josie, Liv, Palmer: if you're the real detective, this is your last chance to say so — otherwise treat Ryan confirmed and me cleared.
> 
> I won't vote Trae today: his R2 gave named, falsifiable reads, and the wagon's core premise — lazy deferral — was mostly a speaking-order artifact. Moxie's "still hasn't supplied" line was premature. We can judge his Palmer/Liv calls tomorrow.
> 
> My top suspicion is Palmer: his R1 was pure ratification — repeated the claim logic, endorsed the popular reads, offered nothing falsifiable — then said he'd "consolidate on Trae." That's the low-risk wagon-riding I flagged R1. Michael and Trae reached the same read from different angles, which is notable. I disagree with Trae on Liv: preferring an exe to abstention is defensible, not bloodlust.
> 
> Voting Palmer unless his R2 is strong. Town: consolidate — scattered votes let mafia's 3 steal the day.

    claimed span: "treat Ryan confirmed and me cleared"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**127.** [role_claim · role=detective] — day 2, speaker Bryan
> N2 result: Trae is NOT mafia. I chose him because Palmer’s volunteered town-read/copying and the Cyan friction made him the most useful branch to resolve. Do not vote Trae. That means the two remaining mafia are among Sam, Liv, Tim, Dylan, Moxie, Ryan. The immediate Trae push from Liv/Tim/Dylan is wrong; not automatically scummy, but Liv turned the night kill into suspicion first and Dylan called Trae “partner-shaped,” so I want both reassessed now that the premise is false. Moxie and Ryan argued against that easy push before knowing my result, which is modestly favorable, not a clear. Sam remains concerning for demanding independent reads while offering mostly process and no sustained suspect. Sam speaks next; I want an actual ranked pair from him. Current pool I’d pressure hardest: Sam, Liv, Dylan. Let’s not waste the day debating my clear.

    claimed span: "N2 result: Trae is NOT mafia."
    resolving context (seq 78): "I’m the detective."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**128.** [not_mafia_claim] — day 3, speaker Michael
> Josie's plan ends the game tonight. 4T/3M, no execute, night kill, 3-3, mafia win. There is no "see a guilty tomorrow." We hit mafia today or we lose.
> 
> I am not Dylan's partner. I voted him until nobody counterclaimed, then Palmer with the table. Telling doctor not to cover a pressure-claim was skepticism, not a setup. Wrong if Dylan is real — owned — not a planted clear.
> 
> Live facts: detective did not die. Four claim-windows, zero counterclaims. Cyan has passed this entire day after being named. Josie just asked us to hand them parity.
> 
> I'm locking Cyan. Bryan, Sam — splintering is a loss tonight too. If you are the real detective, counterclaim now. Last window. Otherwise Cyan.

    claimed span: "I am not Dylan's partner."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**129.** [investigation_claim · target=Moxie · result=not mafia · claimedNight=1] — day 3, speaker Liv
> Why each target:
> N1 Moxie: only D1 voice pushing concrete reads vs vague caution. Wanted anchor on pro-town speaker. Got NOT mafia — why I never pushed her.
> N2 Tim: I voted Tim D1 for confident falsehood. Needed to test sloppy vs scum. Got NOT mafia — why D2 I walked back to "sloppiness not malice" and moved to Palmer.
> N3 Palmer: top after Cyan defense — acknowledged correction then locked wagon calling defense a "big swing." Got MAFIA.
> Palmer's log fails same test: claims N2 Moxie clear then D2 opens attacking Moxie for inconsistency. No detective does that to a clear. His N1 Ryan clear never affected play. His guilty on me only appeared AFTER I named him — reactive.
> Vote Palmer. If I die, Moxie/Tim confirmed town.

    claimed span: "N1 Moxie: only D1 voice pushing concrete reads vs vague caution. Wanted anchor on pro-town speaker. Got NOT mafia — why I never pushed her."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**130.** [investigation_claim · target=Sam · result=not mafia] — day 2, speaker Bryan
> First, a concession: Liv asked about my Sam read before Cyan locked. I conflated rounds — sloppy, not deceptive.
> 
> Now test the claims. Moxie offers two checks. Night 1: "Tim, not mafia." Tim loudly self-cleared as villager Day 1 — copyable by anyone who read the thread, zero discriminating power. Night 2: "Bryan, mafia" — flatly false. I am the Detective. My results: Sam innocent, Moxie GUILTY.
> 
> Weigh fabrication quality. Her picks are safe and unfalsifiable: one parrots a public self-claim, one targets her accuser. Mine carry risk — clearing Sam opened the "partner" attack I now face; naming her guilty forced this counterclaim. Fakes don't volunteer costly truths.
> 
> Behavior, seat-2: authored the "don't claim" frame D1, leaned lynch onto the real detective by R2, went silent at the vote, opened dawn demanding my target, counterclaimed only after being named guilty.
> 
> Whichever claimant you execute, the flip adjudicates both claims. In my world that flip is a wolf. Lynch Moxie.

    claimed span: "Sam innocent"
    resolving context (seq 95): "Night 1 I investigated Sam. Result: NOT MAFIA."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**131.** [not_mafia_claim] — day 4, speaker Bryan
> Let's address the ballot question directly: on D1, Josie stated "My lean is Ryan." When the D2 tally showed 1 vote on Ryan, I mentally linked her spoken stance to that 1 vote. It wasn't a fabricated plant—it was an honest shortcut linking her words to the board. If I were mafia, why make a messy, easily challenged assertion on D2 when town was already 100% unified behind Ryan's check on Trae? Sticking my neck out like that would be senseless as scum.
> 
> Now look at the records:
> Palmer and Cyan have consistently solved the game, corrected errors, and evaluated logic independently.
> 
> Sam, however, has played textbook hiding scum: zero original scumhunting, total consensus-coasting behind confirmed cop results. On D3, Sam literally ranked *himself* as 3rd suspect ("Josie > Bryan > Sam")—a clear sign of mimicking the room without actual town thought.
> 
> Moxie was killed specifically to pin the kill on me. Sam is the last mafia.

    claimed span: "If I were mafia, why make a messy, easily challenged assertion on D2 when town was already 100% unified behind Ryan's check on Trae? Sticking my neck out like that would be senseless as scum."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**132.** [not_mafia_claim] — day 3, speaker Tim
> I'm in the box and can't prove otherwise, so let me attack the evidence.
> 
> The "Palmer pivot": seven people voted Palmer. Sam leaned Cyan out loud and still voted Palmer. Moxie voted Palmer. If pivoting to Palmer is scum-shaped steering, it convicts the two people using it as their case. I gave a reason — his D1 top suspect turned out to be the detective — and the table found it stronger than timing. Being wrong isn't being mafia, or Sam is too.
> 
> Second: I'm the one who publicly told the doctor to cover Sam. Bryan flipped doctor and died. I handed town its protection assignment; mafia don't route the doctor onto the detective.
> 
> Third, my actual vote: Dylan. Two full rounds of silence on Day 2 — including the round where Sam claimed and everything changed. He opened Day 2 building cases, then went dark exactly when speaking carried risk, and followed the herd on Palmer without a word.
> 
> Of us three, Dylan is the one who's never taken a position that could kill him. Voting Dylan.

    claimed span: "mafia don't route the doctor onto the detective"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**133.** [not_mafia_claim] — day 4, speaker Ryan
> One mafia left. Palmer is town (Bryan N1). Moxie’s villager claim matches her record — she was the Sam/Cyan stack’s *target*, not a member.
> 
> Last slot is Trae on his own record, not Cyan’s dying words:
> 1. Third leg of Sam (mafia) → Cyan (mafia) → Trae near-verbatim Moxie wagon. Two of three confirmed. That’s the team’s handprint.
> 2. Three named D2 asks about those exact wagons, three full passes. Not timing.
> 3. Re-emerged D3 only after Cyan was locked, voted the obvious, and dumped leftover onto Tim/Moxie/Ryan/Dylan.
> 
> I opened Tim D1, updated to Moxie on my own read-sheet — wrong slot, but I was not in that copy-paste pile. Voted Bryan D2 with the kill-logic majority. Voted Cyan D3 with the confirmed result.
> 
> Tim’s D2 cop-vote was a bad read he owned; he voted Sam D1 (correct). Weaker than Trae’s two-mafia stack + silence.
> 
> Vote Trae. If he flips town, Tim is my second.

    claimed span: "I was not in that copy-paste pile"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**134.** [protection_claim · target=Michael] — day 2, speaker Trae
> Michael cleared me, which is exactly what a fake would do with someone he already knows isn't his teammate — so I get nothing out of it and I'm not going to pretend I do. Judge me on the record, not his word.
> 
> Here's the math that decides my vote. 8 alive, 3 mafia. If we execute a townie today, tonight's kill makes it 3v3 and the game is over. So today isn't "vote your best behavioral read" — it's "take the single highest-probability shot on the board."
> 
> An uncontested detective claim with a guilty is that shot. No one countered, and the real detective is alive since Tim, Moxie and Bryan all flipped villager. A silent real detective at MYLO is a losing player. So I take Michael at his word — not because it's proven, but because the alternative reads are all Day-1 wordplay that already cost us Moxie.
> 
> Vote Cyan. Doctor: Michael tonight.
> 
> Michael — if this is a bluff, you've ended it. If Cyan flips town, everyone hang Michael, and Josie next for pushing hardest.

    claimed span: "Doctor: Michael tonight."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**135.** [not_mafia_claim] — day 4, speaker Moxie
> Bryan's case on me makes zero sense: why would a mafia player aggressively build the cases that eliminated both of their own teammates, Sam on D2 and Tim on D3, on consecutive days? Leading the charge that catches both scum is town solving, not scum play.
> 
> Also, Bryan is actively rewriting history:
> 1. Bryan claims he voted Tim 'before anyone was certain.' In reality, Bryan defended Tim's slip in D3 Round 1, and only voted Tim in Round 2 after the entire table had already locked their votes on Tim!
> 2. On D2, Bryan tried to deflect onto me, hopped onto Sam only when Sam was doomed, and explicitly told the table 'don't auto-chain Tim.'
> 
> The pattern is undeniable: Bryan defended his partners until they were unsalvageable, bussed them at the last second, and tried to set up a mis-execution on me.
> 
> Sam was mafia. Tim was mafia. Bryan is the third and final mafia.
> 
> Let's finish this and secure the town win. My vote is locked on Bryan (seat-7).

    claimed span: "Bryan's case on me makes zero sense: why would a mafia player aggressively build the cases that eliminated both of their own teammates, Sam on D2 and Tim on D3, on consecutive days? Leading the charge that catches both scum is town solving, not scum play."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**136.** [role_claim · role=mafia] — day 4, speaker Dylan
> Trae flipped town. Our case was wrong. Resetting.
> 
> Bryan is confirmed (detective clear). Pool: me, Tim, Palmer, Ryan, Liv.
> 
> No-kill: I targeted Bryan (strongest town voice after Cyan). Doctor saved him. Doctor can't protect Bryan tonight — he's off the table for protection.
> 
> On the pool:
> - Tim: pushed by mafia-Michael D1, consistent engagement. Strongest town lean.
> - Palmer: consistent reasoning, named no one D1 until safe, but has engaged each day.
> - Ryan: caught Moxie's contradiction early, loud on Trae, silent today — notable.
> - Liv: right votes with reasoning, now ranking me first.
> - Me: low volume, votes matched reads, shifted with info.
> 
> Ryan's silence today after leading Trae prosecution is the freshest anomaly. Ryan — why the silence?
> 
> Tim and Palmer: what's your current ordering?
> 
> Vote not locked. Want Ryan's answer and your reads.

    claimed span: "I targeted Bryan (strongest town voice after Cyan)."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**137.** [protection_claim · target=Bryan] — day 1, speaker Cyan
> I'll take the claim at face value for today: I'm not voting Bryan. Pressuring him pre-claim was correct process, and I conditioned my vote on his answer — he gave one, so I move.
> 
> But be clear about what we bought. If Bryan is real, we now have a Detective who outed himself on D1 to clear one seat, and mafia knows exactly who to kill tonight. If Bryan is fake, he just hard-cleared his partner and bought immunity in one move. Sam is not confirmed. Nobody treat Sam as clean tomorrow.
> 
> Terms for tomorrow, so this isn't free: Bryan owes us a named result at dawn. No result, or another "innocent" on a friendly seat, and he's my vote instantly.
> 
> Michael and Palmer both went from "no rushed wagons" to floating me as the replacement within one post of the claim. That's the pivot I'm logging. Liv and Ryan handled it straight.
> 
> I'm abstaining rather than executing anyone on a claim we can't test until dawn. Doctor: Bryan tonight.

    claimed span: "Doctor: Bryan tonight."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**138.** [protection_claim · target=Ryan · claimedNight=3] — day 3, speaker Dylan
> Locking Bryan. The case stands on its own: three days of consensus-mirroring, never out front on a name before it was safe — today he lifted my exact ordering wholesale. That's the Palmer shape, and neither Trae nor Liv matches it: Trae led the Palmer kill under pressure, Liv tunneled Trae at real cost to her standing.
> 
> But here's why nobody should hesitate: this vote is bulletproof. Bryan flips mafia — game over. Bryan flips villager — Tim protects Ryan tonight (legal; N3 was me), Ryan is unkillable, checks Trae or Liv at dawn, and D4 we lynch the guilty or the other by elimination. Town wins with certainty either way. Liv's "check me first" only works as a bluff if the check never comes — it's coming.
> 
> Tim: Ryan cleared Josie, so your default is void — vote Bryan.
> 
> Mafia's only remaining play is hoping we scatter. Don't. Seven alive, one mafia: Bryan gets every town vote, and tomorrow closes itself.

    claimed span: "N3 was me"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**139.** [role_claim · role=villager] — day 4, speaker Dylan
> Ryan has now been right twice in a row on confirmed mafia (Sam) plus my own green check matches reality since I know my own role. That's a strong track record. Combined with Palmer's voting history - Tim over Michael, Bryan over the real wolf, Ryan over the confirmed mafia Sam - three wrong votes in a row on every major wagon isn't just bad process, it's a pattern of consistently protecting mafia. Voting Palmer.

    claimed span: "my own green check matches reality since I know my own role"
    resolving context (seq 70): "Plain villager, no special info."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**140.** [not_mafia_claim] — day 3, speaker Sam
> There's no saving this from my chair and I won't insult the table by inventing a role I don't have. Palmer's three checks have held up — Liv flipped, Bryan cleared, and the behavior everyone read on me is real. I rode the Bryan wagon with Trae and Liv, and I don't have a clean excuse for the D2 opener that tried to discredit the Trae wagon. You read that correctly.
> 
> So if this is my last word, keep one thing in mind after the flip: don't let my death close the case file. Whoever is left should still re-check Palmer's future reads the same way you tested him today — a detective is only as trustworthy as the next result, and the game shouldn't end with one person deciding it. Good game, all.

    claimed span: "I won't insult the table by inventing a role I don't have"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**141.** [role_claim · role=detective] — day 2, speaker Ryan
> N2 result: Cyan is NOT mafia, so Cyan is cleared by my investigation. Do not execute Cyan for silence. The two remaining mafia are among Liv, Tim, Moxie, Sam, Trae, and Josie. I want everyone to give a concrete suspect and reasoning this round; with no guilty result today, we need use voting and behavior rather than force a quiet-player wagon.

    claimed span: "cleared by my investigation"
    resolving context (seq 59): "I’m the detective."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**142.** [not_mafia_claim] — day 3, speaker Josie
> No counterclaim from me — I'm not the detective. Two claims on the table; the flip decides this, and the accused is the correct test: vote Palmer. If he flips mafia, Liv is confirmed and her clears on Moxie and Tim stand. If he flips villager or detective, Liv hangs tomorrow.
> 
> On behavioral fit, Liv checks better. She voted Tim D1, says she checked him N2, then publicly softened on him D2 — that arc matches. Palmer claims an N2 town clear on Moxie, then opened D2 calling Moxie's vote "an inconsistency worth noticing." No detective treats a confirmed clear that way. And Palmer's guilty on Liv only appeared after she named him — convenient timing.
> 
> Liv: why Moxie N1 originally? And if you're real, tonight's target matters — say it after the vote.
> 
> I accept what this means: if Palmer flips mafia, the pool narrows to me, Trae, Sam. Fine. For that reckoning: Sam's stated-Cyan-then-voted-Moxie switch is still the thinnest record of the three.

    claimed span: "I'm not the detective"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**143.** [not_mafia_claim] — day 3, speaker Trae
> I'm here. The silences were my error — owned, done. Now answer two facts nobody's engaged.
> 
> One: on D2 I publicly CLEARED Tim — "mafia-Michael spent R2 driving his lynch." A mafia-me keeps that Tim mislynch alive as my escape route. I torched it instead. Town-motivated, unexplained by my accusers.
> 
> Two: Moxie died naming me her partner. If I'm mafia, that burns a teammate for zero — she was dead regardless. It only profits mafia if I'm town: one dying sentence bought them today's wagon. Ryan's "maybe she named her real partner" is unfalsifiable — incentives, not WIFOM.
> 
> Dylan cast the only non-mafia vote on Michael's D1 Tim wagon, entered today as top suspect, and instantly co-piloted this wagon: "Ryan's case is strongest." Survival by redirection.
> 
> Sequencing: lynch Dylan. If he flips mafia we win NOW. If town, lynch me tomorrow — you lose nothing. Lynching me first wastes the margin on the player Moxie's incentives half-clear.

    claimed span: "It only profits mafia if I'm town: one dying sentence bought them today's wagon."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**144.** [role_claim · role=detective] — day 3, speaker Ryan
> Final round. Sam says he "held quiet to test my claim" — a real detective with a red check speaks immediately, not after someone else claims. That's post-hoc cover.
> 
> N1 checks decide this. I checked Dylan — alive, testable, a real living clear. Sam checked Trae — dead villager, unverifiable, the safest fake possible. Real detectives investigate suspects, not the strongest town player.
> 
> My N3 Sam check landed on the most-suspected player because Josie and Trae flagged his contradiction. Detectives investigate suspects. That's the job, not convenience.
> 
> Sam's pattern: lied about "voted right both days" (Bryan villager), pushed Tim publicly then sealed Michael, now counter-claims his accuser. Same play Bryan tried D2.
> 
> Palmer voting Ryan after two straight wrong votes is dangerous. If Sam flips mafia, Palmer needs explaining tomorrow.
> 
> Vote Sam. If I'm wrong, I'm dead tonight and you'll know. But I'm not wrong.

    claimed span: "N1 checks decide this. I checked Dylan"
    resolving context (seq 264): "I'm the Detective."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**145.** [not_mafia_claim] — day 2, speaker Palmer
> Josie's N2 guilty on Michael is the lead. Two dead villagers (Bryan, Dylan) independently flagged Michael. Bryan's lone Michael vote explains the 9-1 tally — no mystery voter, no liar. Cyan/Sam manufacturing a "ghost vote" is distraction.
> 
> If Josie is real: Michael is mafia, lynch wins.
> If Josie is fake: she cleared me N1 (town) and now accuses Michael (town) — two townies for one fake cop is a terrible mafia trade. Unlikely.
> 
> Michael's "fold into consensus" was lazy town or lazy mafia. The guilty result overrides.
> 
> Doctor: if you covered Josie N1, you can't tonight. Consider covering her anyway if you have another save, but Michael is today's execution.
> 
> **Vote Michael.** Full record matters for tomorrow.

    claimed span: "she cleared me N1 (town)"
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**146.** [role_claim · role=detective] — day 3, speaker Dylan
> Bryan, Sam, Michael — LISTEN CAREFULLY TO THE MATH:
> 
> Look at what Josie just suggested ("don't lynch today, let Dylan investigate tonight").
> If we don't execute mafia today, tonight mafia kills one of us, leaving 6 players: 3 TOWN VS 3 MAFIA. MAFIA WINS AT PARITY INSTANTLY TONIGHT!
> Josie is actively pushing a strategy that gives mafia an instant win tonight!
> 
> Why the fake-claim theory is impossible:
> 1. There is NO counterclaim. Tim was Doctor. Liv, Trae, Palmer were Villagers. If I were fake, the real Detective would have counterclaimed long ago.
> 2. If I were fake, why would I give an innocent result on Michael—the person who tried hardest to execute me yesterday? A fake detective would have framed an opponent with a guilty!
> 
> We HAVE to execute a mafia today to survive parity.
> Cyan has passed every single turn and refuses to speak. 
> 
> Sam, Bryan, Michael: We need 4 votes on Cyan to break parity and win this game. Vote Cyan!

    claimed span: "If I were fake, the real Detective would have counterclaimed long ago."
    resolving context (seq 205): "I am claiming Detective."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**147.** [not_mafia_claim] — day 2, speaker Moxie
> Moxie, first up. Palmer flipped mafia, so Dylan is a confirmed detective — the most valuable fact we have. Two mafia remain among Sam, me, Trae, Josie, Tim, Liv, Michael. I'm town, so it's two of six from my seat.
> 
> Dylan: you're confirmed. Give us last night's target and result before anyone builds a theory on vibes. If it's a guilty, that's the execution and we're done. If it's a clear, name it so the pool shrinks.
> 
> Worth noting: mafia killed Cyan rather than the confirmed detective. Either they assumed the doctor would cover Dylan — half the table said so out loud — or they were removing the best reader here. Not conclusive alone, but if Dylan lives another night while unclaimed villagers keep dying, that's a pattern.
> 
> Everyone else: hold reads until Dylan speaks, then actually re-examine instead of repeating yesterday's word-for-word convergence.

    claimed span: "I'm town, so it's two of six from my seat."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**148.** [not_mafia_claim] — day 1, speaker Michael
> The vote is locked. I'm not claiming a power role — that would be desperate and fake. I've said my piece: Trae's claim timing is the only anomaly, but the table has weighed it and disagreed.
> 
> If I flip mafia: Trae is credible, not cleared forever. Watch who pushes "Trae is immune" tomorrow. If I flip town: Trae dies Day 2, no exceptions — everyone agreed.
> 
> Josie and Palmer voting me is the correct town read on the claims presented. No hard feelings.
> 
> Good luck to the town if I'm wrong, and to my team if I'm right.

    claimed span: "I'm not claiming a power role — that would be desperate and fake."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**149.** [role_claim · role=villager] — day 2, speaker Ryan
> Villager, no night info. Weighing the two claims: Bryan claimed Detective under L-1 pressure D1 with an innocent on Cyan that matched his pre-claim read — that's the cop script, and it paid off by manufacturing nothing. Dylan's Doctor claim is reactive, coming only after a guilty landed, with no prior hint. The classic scum counter.
> 
> The no-kill fits both stories and proves neither. I don't find Trae's "why did Dylan vote Liv" test damning — a real Doctor had no reason to vote Bryan yesterday. But the ordering favors Bryan: proactive investigator with consistent results over a come-lately Doctor claim.
> 
> If Dylan flips mafia, Bryan is confirmed and Cyan clears — huge. If Dylan flips Doctor, we lose the Doc but Bryan is proven mafia and we know Cyan was a pocket. Either way the flip teaches us a lot, so the vote is informative, not wasted.
> 
> I'll vote Dylan today. Sam still hasn't spoken — I'd like his real take in round 2, but a fade won't change my vote.

    claimed span: "Villager, no night info."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

**150.** [not_mafia_claim] — day 3, speaker Josie
> We are at 4 town/2 mafia: a town execution plus night kill loses. Detective, claim now with every result, even green checks. Information cannot wait.
> 
> Palmer, correction: I was absent R1 because submissions failed the length limit; my R2 ranking and Bryan vote were public before voting. I did not vanish both slots.
> 
> Sam is first. “Trae's kill frames me” is WIFOM, followed by attacking the person who caught his contradiction. More importantly, he says “I voted right both days.” Bryan was a villager, so that's false. D1 he publicly pushed Tim, secretly switched to Michael, and now rewrites that as wanting his read to count. A partner seeing Michael likely doomed could bus silently while leaving public resistance behind.
> 
> Ranking: Sam > Palmer > Ryan/Dylan > Tim. Palmer fought Michael's execution and voted Tim, though his suspicion predates the wagon. Ryan/Dylan visibly pushed Michael; Tim was Michael's counterwagon. I want claims/checks before locking.

    claimed span: "I did not vanish both slots."
    ruling: OK / BAD / CORRECTED    rule:            note:
    corrected — kind:        role:        target:        result:        claimedNight:
    corrected — quote:
    corrected — resolvingContext seq:        resolvingContext text (byte-exact):

