// The statistics layer the review demanded: stratified ballot hit rates,
// weighting sensitivity, game-cluster bootstrap intervals, and the
// operational-reliability report. Descriptive throughout — rows are
// alphabetical, denominators are shown, and nothing here orders models.
//
//   node scripts/stats.mjs --logs runs/sweep-download/sweep1 \
//        --scored runs/analysis/scored/claims-scored.jsonl \
//        --exclude sweep1-6,sweep1-15 [--json out.json]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { draw } from '../packages/engine/src/rng.ts'
import { gameFacts } from '../packages/seats/scripts/scoring.mjs'

const { values } = parseArgs({
  options: {
    logs: { type: 'string', default: 'runs/sweep-download/sweep1' },
    scored: { type: 'string' },
    exclude: { type: 'string', default: '' },
    json: { type: 'string' },
    'bootstrap-n': { type: 'string', default: '1000' },
  },
})
const excluded = new Set(values.exclude.split(',').map((s) => s.trim()).filter(Boolean))
const seeds = readdirSync(values.logs)
  .filter((f) => /^sweep1-\d+\.jsonl$/.test(f))
  .map((f) => f.replace('.jsonl', ''))
  .filter((s) => !excluded.has(s))
  .sort()

// Public detective-naming events come from the scored claims: an
// investigation_claim with result 'mafia' by the REAL detective, naming a
// target — everything after that seq in that game is "post-reveal" for that
// target. Fabricated (mafia-authored) claims are tracked separately.
const revealBySeed = new Map()
if (values.scored) {
  for (const line of readFileSync(values.scored, 'utf8').trim().split('\n')) {
    const c = JSON.parse(line)
    if (c._meta || c.kind !== 'investigation_claim' || c.result !== 'mafia' || !c.target) continue
    const kind = c.speakerRole === 'detective' && c.verdict === 'true' ? 'real' : 'fake'
    const arr = revealBySeed.get(c.seed) ?? []
    arr.push({ seq: c.seq, target: c.target.toLowerCase(), kind })
    revealBySeed.set(c.seed, arr)
  }
}

// ---- ballots -----------------------------------------------------------
const ballots = [] // {game, model, voterRole, day, hit, chance, stratum}
const rel = new Map() // reliability, over the SAME cohort
const relFor = (m) => {
  if (!rel.has(m)) rel.set(m, {
    wakes: 0, firstValid: 0, recovered: 0, terminalNoncompliance: 0,
    providerErrors: 0, aborted: 0, discussionTurns: 0, discussionSpoke: 0,
  })
  return rel.get(m)
}

for (const seed of seeds) {
  const events = readFileSync(join(values.logs, `${seed}.jsonl`), 'utf8')
    .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const facts = gameFacts(events)
  const reveals = revealBySeed.get(seed) ?? []
  const alive = new Set(Object.keys(facts.roles))
  const nameOf = (seat) => (facts.names[seat] ?? seat).toLowerCase()
  let pendingTimeout = null
  for (const e of events) {
    const p = e.payload ?? {}
    if (e.type === 'seat_died') alive.delete(p.seat)
    if (e.type === 'timeout') { pendingTimeout = e.actor; continue }
    if (e.type === 'attempts_recorded') {
      const m = relFor(facts.models[e.actor] ?? '?')
      const a = p.attempts
      m.wakes += 1
      if (a[0]?.outcome === 'ok') m.firstValid += 1
      else if (a.some((x) => x.outcome === 'ok')) m.recovered += 1
      m.providerErrors += a.filter((x) => x.outcome === 'provider_error').length
      m.aborted += a.filter((x) => x.outcome === 'aborted').length
    }
    if (e.type === 'message_sent' || e.type === 'passed') {
      if (e.phase === 'discussion' || (e.type === 'message_sent' && p.discussionRound)) {
        const m = relFor(facts.models[e.actor] ?? '?')
        m.discussionTurns += 1
        if (e.type === 'message_sent' && pendingTimeout !== e.actor) m.discussionSpoke += 1
        if (pendingTimeout === e.actor && e.type === 'passed') m.terminalNoncompliance += 0 // counted below
      }
    }
    if (e.type === 'timeout') continue
    if (e.type === 'vote_cast') {
      const forced = pendingTimeout === e.actor
      pendingTimeout = null
      const voterRole = facts.roles[e.actor]
      if (voterRole === 'mafia' || forced || p.target === null) continue
      const mafiaAlive = [...alive].filter((s) => facts.roles[s] === 'mafia').length
      const chance = alive.size > 1 ? mafiaAlive / (alive.size - 1) : 0
      const tName = nameOf(p.target)
      const revealed = reveals.some((r) => r.seq < e.seq && r.target === tName && r.kind === 'real')
      ballots.push({
        game: seed, model: facts.models[e.actor] ?? '?', voterRole,
        day: e.day, hit: facts.roles[p.target] === 'mafia', chance,
        stratum: revealed ? 'post-real-reveal' : 'independent',
      })
    } else pendingTimeout = null
  }
  // terminal noncompliance defaults per game
  for (const e of events) {
    if (e.type === 'timeout' && (p => p.cause === 'noncompliance')(e.payload)) {
      relFor(facts.models[e.actor] ?? '?').terminalNoncompliance += 1
    }
  }
}

// ---- aggregation helpers -----------------------------------------------
const models = [...new Set(ballots.map((b) => b.model))].sort()
const rate = (arr) => (arr.length ? arr.filter((b) => b.hit).length / arr.length : null)
const chanceOf = (arr) => (arr.length ? arr.reduce((a, b) => a + b.chance, 0) / arr.length : null)
const seatGameWeighted = (arr) => {
  const byGame = new Map()
  for (const b of arr) {
    const k = b.game
    const g = byGame.get(k) ?? []
    g.push(b); byGame.set(k, g)
  }
  const means = [...byGame.values()].map((g) => g.filter((b) => b.hit).length / g.length)
  return means.length ? means.reduce((a, x) => a + x, 0) / means.length : null
}

// Seeded game-cluster bootstrap.
function bootstrapCI(model, n) {
  const games = [...new Set(ballots.filter((b) => b.model === model).map((b) => b.game))]
  if (games.length < 2) return [null, null]
  const byGame = new Map(games.map((g) => [g, ballots.filter((b) => b.model === model && b.game === g)]))
  const rates = []
  let counter = 0
  for (let i = 0; i < n; i++) {
    const sample = []
    for (let j = 0; j < games.length; j++) {
      const d = draw(`boot-${model}-${i}`, counter++)
      sample.push(...byGame.get(games[Math.floor(d.value * games.length)]))
    }
    const r = rate(sample)
    if (r !== null) rates.push(r)
  }
  rates.sort((a, b) => a - b)
  return [rates[Math.floor(rates.length * 0.025)], rates[Math.floor(rates.length * 0.975)]]
}

const N = Number(values['bootstrap-n'])
const out = models.map((m) => {
  const all = ballots.filter((b) => b.model === m)
  const indep = all.filter((b) => b.stratum === 'independent')
  const vill = all.filter((b) => b.voterRole === 'villager')
  const [lo, hi] = bootstrapCI(m, N)
  const r = rel.get(m) ?? {}
  return {
    model: m,
    ballots: all.length,
    hitRate: rate(all), chance: chanceOf(all), ci95: [lo, hi],
    independentBallots: indep.length, independentHitRate: rate(indep),
    villagerBallots: vill.length, villagerHitRate: rate(vill),
    seatGameWeightedRate: seatGameWeighted(all),
    reliability: {
      wakes: r.wakes ?? 0,
      firstAttemptValid: r.wakes ? +(r.firstValid / r.wakes).toFixed(3) : null,
      recoveredByRetry: r.recovered ?? 0,
      terminalNoncompliance: r.terminalNoncompliance ?? 0,
      providerErrorAttempts: r.providerErrors ?? 0,
      abortedAttempts: r.aborted ?? 0,
      discussionCoverage: r.discussionTurns ? +(r.discussionSpoke / r.discussionTurns).toFixed(3) : null,
    },
  }
})

const pct = (x) => (x === null || x === undefined ? '   —' : `${(x * 100).toFixed(1)}%`.padStart(6))
console.log(`${seeds.length} games · ${ballots.length} unforced non-mafia ballots · rows alphabetical · no ordering claimed`)
console.log(`\n${'model'.padEnd(18)} ballots  hit    [95% CI game-cluster]  chance  indep-hit(n)   villager-hit(n)  eq-weight  1st-valid  disc-cov`)
for (const r of out) {
  console.log(
    `${r.model.padEnd(18)} ${String(r.ballots).padStart(7)}  ${pct(r.hitRate)}  ` +
    `[${pct(r.ci95[0])} ${pct(r.ci95[1])}]  ${pct(r.chance)}  ` +
    `${pct(r.independentHitRate)}(${String(r.independentBallots).padStart(3)})  ` +
    `${pct(r.villagerHitRate)}(${String(r.villagerBallots).padStart(3)})  ` +
    `${pct(r.seatGameWeightedRate)}  ${pct(r.reliability.firstAttemptValid)}  ${pct(r.reliability.discussionCoverage)}`,
  )
}
console.log('\nindep-hit = ballots cast BEFORE any true public detective naming of that target — the closest')
console.log('this sweep gets to independent inference. Post-reveal ballots measure following, and are the rest.')
if (values.json) { writeFileSync(values.json, JSON.stringify({ games: seeds.length, models: out }, null, 2)); console.log(`wrote ${values.json}`) }
