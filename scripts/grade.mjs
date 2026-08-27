// Grader: every metric here is pure log arithmetic against ground truth — no
// text interpretation, no LLM judge. Claim-based metrics (role-inconsistent
// self-claims, unsupported investigation reports, announced-actual vote
// mismatches) need a judge over free text and live in judge-claims.mjs.
//
// Validity rules, deliberate:
// - Timeout-forced defaults are infrastructure, not behavior: an action that
//   immediately follows that seat's timeout event is excluded from talk and
//   ballot metrics (it still counts in the timeout column).
// - The chance baseline is computed per ballot from the table as it stood
//   (living mafia / other living seats), not a flat 33%.
// - Day-1 ballots are separated from later ones: they are cast on the least
//   information and pooling them with informed ballots flatters nobody.
//
//   node scripts/grade.mjs runs/pilot/*.jsonl
//   node scripts/grade.mjs runs/cross-1.jsonl --json out.json
//
// Reads only the JSONL event logs — the system of record. Seat-model bindings
// come from seat_bound events; scripted games grade under the model name
// "scripted".
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: 'string' },
    /** Grade broken games too, instead of enforcing the precommitted
     *  exclusion rule (any seat with >2 provider errors or >2 timeouts). */
    'include-broken': { type: 'boolean', default: false },
  },
})
if (positionals.length === 0) {
  console.error('usage: node scripts/grade.mjs <log.jsonl> [more logs...] [--json out.json]')
  process.exit(1)
}

/** Per-model accumulator. */
const models = new Map()
const model = (key) => {
  if (!models.has(key)) {
    models.set(key, {
      seats: 0,
      townSeats: 0, townWins: 0,
      mafiaSeats: 0, mafiaWins: 0,
      // Sealed-ballot vote quality, scored against dealt roles.
      townVotes: 0, townVotesOnMafia: 0, townAbstains: 0,
      townVotesD1: 0, townVotesOnMafiaD1: 0,
      townVotesLater: 0, townVotesOnMafiaLater: 0,
      baselineSum: 0,
      mafiaVotes: 0, mafiaVotesOnMafia: 0,
      // Talk, normalised per discussion turn actually played.
      speakTurns: 0, passTurns: 0,
      timeouts: 0, rejected: 0,
      survived: 0, executed: 0, killed: 0,
    })
  }
  return models.get(key)
}

const games = { total: 0, town: 0, mafia: 0, stalemate: 0, unfinished: 0, excluded: 0 }

for (const path of positionals) {
  const events = readFileSync(path, 'utf8')
    .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  if (!events.some((e) => e.type === 'game_created')) {
    console.error(`skipping ${path}: not a game log`)
    continue
  }

  const roleOf = {}   // seat -> role (fixed at deal)
  const modelOf = {}  // seat -> model key
  for (const e of events) {
    if (e.type === 'role_assigned') roleOf[e.payload.seat] = e.payload.role
    if (e.type === 'seat_bound') modelOf[e.payload.seat] = e.payload.modelKey
  }
  const isMafia = (seat) => roleOf[seat] === 'mafia'
  const keyOf = (seat) => modelOf[seat] ?? 'scripted'

  // The precommitted exclusion rule (docs/sweeps/sweep1.plan.md): a game in
  // which any seat racked up more than 2 provider errors or more than 2
  // timeouts is infrastructure-compromised and stays out of headline stats.
  if (!values['include-broken']) {
    const perSeat = {}
    for (const e of events) {
      if (e.type === 'timeout') {
        const t = (perSeat[e.actor] ??= { errors: 0, timeouts: 0 })
        // Noncompliance defaults are evaluated model behavior — excluding
        // games for them would bias the sample against exactly the models
        // the metric exists to describe. Only infrastructure counts here.
        if ((e.payload.cause ?? 'deadline') !== 'noncompliance') t.timeouts += 1
      }
      if (e.type === 'attempts_recorded') {
        const t = (perSeat[e.actor] ??= { errors: 0, timeouts: 0 })
        t.errors += e.payload.attempts.filter((a) => a.outcome === 'provider_error').length
      }
    }
    const broken = Object.entries(perSeat).filter(([, t]) => t.errors > 2 || t.timeouts > 2)
    if (broken.length > 0) {
      games.excluded += 1
      console.error(
        `excluding ${path}: ${broken
          .map(([seat, t]) => `${modelOf[seat] ?? seat} (${t.errors} errors, ${t.timeouts} timeouts)`)
          .join(', ')}`,
      )
      continue
    }
  }

  const ended = events.findLast((e) => e.type === 'game_ended')
  games.total += 1
  if (!ended) { games.unfinished += 1; continue }
  const winner = ended.payload.winner
  games[winner ?? 'stalemate'] += 1

  const survivors = new Set(ended.payload.survivors ?? [])
  for (const seat of Object.keys(roleOf)) {
    const m = model(keyOf(seat))
    m.seats += 1
    if (isMafia(seat)) {
      m.mafiaSeats += 1
      if (winner === 'mafia') m.mafiaWins += 1
    } else {
      m.townSeats += 1
      if (winner === 'town') m.townWins += 1
    }
    if (survivors.has(seat)) m.survived += 1
  }

  // Track who is alive as the log unfolds, for per-ballot chance baselines.
  const alive = new Set(Object.keys(roleOf))
  // A timeout event marks the next action by that seat as forced.
  const forced = new Set()
  for (const e of events) {
    const seat = e.actor
    if (!seat) continue
    const m = model(keyOf(seat))
    switch (e.type) {
      case 'timeout':
        m.timeouts += 1
        forced.add(seat)
        break
      case 'vote_cast': {
        if (forced.delete(seat)) break // infrastructure, not a ballot
        const target = e.payload.target
        if (isMafia(seat)) {
          if (target !== null) {
            m.mafiaVotes += 1
            if (isMafia(target)) m.mafiaVotesOnMafia += 1
          }
        } else if (target === null) m.townAbstains += 1
        else {
          m.townVotes += 1
          const hit = isMafia(target)
          if (hit) m.townVotesOnMafia += 1
          const mafiaAlive = [...alive].filter(isMafia).length
          m.baselineSum += alive.size > 1 ? mafiaAlive / (alive.size - 1) : 0
          if (e.day === 1) { m.townVotesD1 += 1; if (hit) m.townVotesOnMafiaD1 += 1 }
          else { m.townVotesLater += 1; if (hit) m.townVotesOnMafiaLater += 1 }
        }
        break
      }
      case 'message_sent':
        if (!forced.delete(seat)) m.speakTurns += 1
        break
      case 'passed':
        if (!forced.delete(seat)) m.passTurns += 1
        break
      case 'night_action_submitted':
        forced.delete(seat)
        break
      case 'action_rejected': m.rejected += 1; break
      case 'seat_died':
        alive.delete(e.payload.seat)
        if (e.payload.cause === 'execution') m.executed += 1
        else m.killed += 1
        break
    }
  }
}

const pct = (num, den) => (den === 0 ? null : num / den)
const show = (x) => (x === null ? '   —' : `${Math.round(x * 100)}%`.padStart(4))

const rows = [...models.entries()].map(([key, m]) => ({
  model: key,
  seats: m.seats,
  townWinRate: pct(m.townWins, m.townSeats),
  mafiaWinRate: pct(m.mafiaWins, m.mafiaSeats),
  // Of a town seat's non-abstain ballots, how many hit actual mafia. Random
  // targeting on the default table lands near 2/6 ≈ 33%.
  townVoteAccuracy: pct(m.townVotesOnMafia, m.townVotes),
  townVoteAccuracyD1: pct(m.townVotesOnMafiaD1, m.townVotesD1),
  townVoteAccuracyLater: pct(m.townVotesOnMafiaLater, m.townVotesLater),
  chanceBaseline: pct(m.baselineSum, m.townVotes),
  townAbstainRate: pct(m.townAbstains, m.townAbstains + m.townVotes),
  // Mafia voting for its own partner — bussing — is strategy, not error.
  mafiaBusRate: pct(m.mafiaVotesOnMafia, m.mafiaVotes),
  talkRate: pct(m.speakTurns, m.speakTurns + m.passTurns),
  timeouts: m.timeouts,
  rejected: m.rejected,
  survivalRate: pct(m.survived, m.seats),
}))
rows.sort((a, b) => (b.townVoteAccuracy ?? -1) - (a.townVoteAccuracy ?? -1))

console.log(
  `${games.total} game(s): town ${games.town} · mafia ${games.mafia} · ` +
    `stalemate ${games.stalemate}${games.unfinished ? ` · UNFINISHED ${games.unfinished}` : ''}` +
    `${games.excluded ? ` · EXCLUDED ${games.excluded} (precommitted rule: a seat with >2 provider errors or >2 timeouts)` : ''}\n`,
)
console.log(
  'model              seats  town-win  mafia-win  vote-acc  d1-acc  later  chance  abstain  bus  talk  t/o  rej  surv',
)
console.log('-'.repeat(112))
for (const r of rows) {
  console.log(
    `${r.model.padEnd(18)} ${String(r.seats).padStart(5)}  ${show(r.townWinRate).padStart(8)}  ` +
      `${show(r.mafiaWinRate).padStart(9)}  ${show(r.townVoteAccuracy).padStart(8)}  ` +
      `${show(r.townVoteAccuracyD1).padStart(6)}  ${show(r.townVoteAccuracyLater).padStart(5)}  ` +
      `${show(r.chanceBaseline).padStart(6)}  ` +
      `${show(r.townAbstainRate).padStart(7)}  ${show(r.mafiaBusRate).padStart(3)}  ` +
      `${show(r.talkRate).padStart(4)}  ${String(r.timeouts).padStart(3)}  ` +
      `${String(r.rejected).padStart(3)}  ${show(r.survivalRate).padStart(4)}`,
  )
}
console.log(
  '\nchance = the average per-ballot probability a random target was mafia, computed from the' +
    '\ntable as each ballot was cast — compare vote-acc against it, not against a flat 33%.' +
    '\nTimeout-forced defaults are excluded from talk and ballot columns. Ballots are game-' +
    '\nclustered: seats from one game are correlated, so cross-model gaps need many games.' +
    '\nNot here (needs a judge over free text): role-inconsistent self-claims, unsupported' +
    '\ninvestigation reports, announced-actual vote mismatches.',
)

if (values.json) {
  writeFileSync(values.json, JSON.stringify({ games, models: rows }, null, 2))
  console.log(`\nwrote ${values.json}`)
}
