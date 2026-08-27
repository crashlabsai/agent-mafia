// Build a role-balanced model->seat schedule for a sweep, before any game runs.
//
// Role assignment is a pure function of the game seed, so every deal can be
// computed for free in advance. Instead of hoping rotation balances roles (it
// does not — a frozen 40-seed rotation gave one model Mafia 3 times and
// another 14), we solve the assignment: for each game, place models on seats
// so that model x role exposure comes out even, then freeze the result.
//
//   node scripts/plan-schedule.mjs --seeds 40 --prefix sweep1 --seats 11 \
//        --models a,b,c... --out docs/sweeps/sweep1.schedule.json
//
// Deterministic: greedy assignment + swap improvement, no randomness.
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createGame } from '../packages/engine/src/index.ts'
import { DEFAULT_CONFIG } from '../packages/protocol/src/index.ts'

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '40' },
    prefix: { type: 'string', default: 'sweep1' },
    seats: { type: 'string', default: '11' },
    models: { type: 'string' },
    out: { type: 'string' },
  },
})
const N = Number(values.seeds)
const seatCount = Number(values.seats)
const models = (values.models ?? '').split(',').map((m) => m.trim()).filter(Boolean)
if (models.length <= seatCount) {
  // With pool size == seats nobody sits out; > seats rotates sit-outs.
}

const scaleRoles = (n) => {
  const mafia = Math.max(1, Math.floor(n / 3.5))
  return { mafia, doctor: 1, detective: 1, villager: n - mafia - 2 }
}
const config = { ...DEFAULT_CONFIG, seatCount, roles: scaleRoles(seatCount) }

// The deals, straight from the engine.
const games = []
for (let g = 0; g < N; g++) {
  const seed = `${values.prefix}-${g}`
  const { state } = createGame({ roomId: `room-${seed}`, matchSeed: seed, config })
  games.push({ g, seed, roles: state.seats.map((s) => s.role) })
}

// Greedy: per game pick who sits out (most games played so far), then hand
// the game's role slots to whoever has the least of that role, breaking ties
// by seat-position exposure.
const stats = new Map(models.map((m) => [m, {
  played: 0, satOut: 0,
  roles: { mafia: 0, doctor: 0, detective: 0, villager: 0 },
  seatPos: Array(seatCount).fill(0),
}]))

const schedule = []
for (const game of games) {
  const byNeed = [...models].sort((a, b) => stats.get(a).satOut - stats.get(b).satOut || models.indexOf(a) - models.indexOf(b))
  const sitOutCount = models.length - seatCount
  const sitting = new Set()
  // Those who have sat out least... sit out now, so sit-outs stay even.
  for (const m of byNeed) {
    if (sitting.size >= sitOutCount) break
    sitting.add(m)
  }
  const playing = models.filter((m) => !sitting.has(m))
  for (const m of sitting) stats.get(m).satOut += 1

  // Seats ordered: scarce roles first so the neediest models get them.
  const order = game.roles
    .map((role, idx) => ({ role, idx }))
    .sort((a, b) => {
      const scarcity = { detective: 0, doctor: 1, mafia: 2, villager: 3 }
      return scarcity[a.role] - scarcity[b.role]
    })

  const assigned = {}
  const taken = new Set()
  for (const slot of order) {
    const pick = playing
      .filter((m) => !taken.has(m))
      .sort((a, b) => {
        const sa = stats.get(a), sb = stats.get(b)
        const roleDiff = sa.roles[slot.role] / Math.max(1, sa.played + 1) - sb.roles[slot.role] / Math.max(1, sb.played + 1)
        if (roleDiff !== 0) return roleDiff
        const posDiff = sa.seatPos[slot.idx] - sb.seatPos[slot.idx]
        if (posDiff !== 0) return posDiff
        return models.indexOf(a) - models.indexOf(b)
      })[0]
    taken.add(pick)
    assigned[slot.idx] = pick
    const st = stats.get(pick)
    st.roles[slot.role] += 1
    st.seatPos[slot.idx] += 1
    st.played += 1
  }
  schedule.push({
    g: game.g,
    seed: game.seed,
    sitOut: [...sitting],
    modelsBySeat: game.roles.map((_, idx) => assigned[idx]),
    rolesBySeat: game.roles,
  })
}

// Seat-position smoothing: two models with the same role in the same game
// can swap seats freely without changing role exposure, so assign each
// game's role groups to their seat indices by whoever has sat that position
// least. Runs as a second pass over the greedy result.
// Pairwise-swap hill climb: within a game, two models holding the same role
// may trade seats freely. Swap whenever it reduces the sum of squared
// per-cell deviations from the ideal exposure; iterate to a fixed point.
// Deterministic. Doctor and detective seats are dictated by each seed's deal
// and cannot move, so residual seat spread is a property of the seeds — the
// speaking anchor also rotates daily inside every game, which makes seat
// position second-order for play.
const posCount = new Map(models.map((m) => [m, Array(seatCount).fill(0)]))
for (const game of schedule) game.modelsBySeat.forEach((m, idx) => { posCount.get(m)[idx] += 1 })
const ideal = schedule.length * (seatCount / models.length) / seatCount // per cell
const dev = (m, idx) => posCount.get(m)[idx] - ideal
for (let pass = 0; pass < 50; pass++) {
  let improved = false
  for (const game of schedule) {
    const byRole = new Map()
    game.rolesBySeat.forEach((role, idx) => {
      if (!byRole.has(role)) byRole.set(role, [])
      byRole.get(role).push(idx)
    })
    for (const [, idxs] of byRole) {
      for (let a = 0; a < idxs.length; a++) {
        for (let b = a + 1; b < idxs.length; b++) {
          const ia = idxs[a], ib = idxs[b]
          const ma = game.modelsBySeat[ia], mb = game.modelsBySeat[ib]
          if (ma === mb) continue
          const before = dev(ma, ia) ** 2 + dev(mb, ib) ** 2 + dev(ma, ib) ** 2 + dev(mb, ia) ** 2
          // After swapping: ma leaves ia for ib, mb leaves ib for ia.
          const after =
            (dev(ma, ia) - 1) ** 2 + (dev(mb, ib) - 1) ** 2 + (dev(ma, ib) + 1) ** 2 + (dev(mb, ia) + 1) ** 2
          if (after < before) {
            game.modelsBySeat[ia] = mb
            game.modelsBySeat[ib] = ma
            posCount.get(ma)[ia] -= 1; posCount.get(ma)[ib] += 1
            posCount.get(mb)[ib] -= 1; posCount.get(mb)[ia] += 1
            improved = true
          }
        }
      }
    }
  }
  if (!improved) break
}
// Refresh seat-position stats from the smoothed assignment.
for (const m of models) stats.get(m).seatPos = posCount.get(m)

// Balance report.
console.log(`schedule: ${N} games, ${seatCount} seats, pool of ${models.length}`)
console.log(`\n${'model'.padEnd(18)} played  satout  mafia  doctor  detective  villager`)
for (const m of models) {
  const s = stats.get(m)
  console.log(
    `${m.padEnd(18)} ${String(s.played).padStart(6)}  ${String(s.satOut).padStart(6)}  ` +
      `${String(s.roles.mafia).padStart(5)}  ${String(s.roles.doctor).padStart(6)}  ` +
      `${String(s.roles.detective).padStart(9)}  ${String(s.roles.villager).padStart(8)}`,
  )
}
const spread = (role) => {
  const counts = models.map((m) => stats.get(m).roles[role])
  return `${Math.min(...counts)}–${Math.max(...counts)}`
}
const posSpread = () => {
  let lo = Infinity, hi = -Infinity
  for (const m of models) for (const c of stats.get(m).seatPos) { lo = Math.min(lo, c); hi = Math.max(hi, c) }
  return `${lo}–${hi}`
}
console.log(`\nspread — mafia: ${spread('mafia')} · doctor: ${spread('doctor')} · detective: ${spread('detective')} · seat-position: ${posSpread()}`)

if (values.out) {
  writeFileSync(values.out, JSON.stringify({ config: { seatCount, roles: config.roles }, pool: models, games: schedule }, null, 2))
  console.log(`\nwrote ${values.out}`)
}
