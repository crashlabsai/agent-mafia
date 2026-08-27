// Opportunity table — analysis v3.1 §4. One row per decision opportunity:
// every day-vote each living seat was prompted for (abstains and
// timeout-forced defaults included) and every night action each living
// power-role seat owed (mafia night_kill, doctor night_protect, detective
// night_investigate). Deterministic, pure over the frozen logs; no LLM.
//
//   node scripts/opportunity-table.mjs [logs...] [--logs dir] \
//        [--manifest runs/analysis-v3/manifest.json] \
//        [--out runs/analysis-v3/opportunity/table.jsonl]
//
// Every derivation rule below is pinned against real sweep1 log excerpts in
// packages/seats/test/opportunity-table.test.ts. Conventions verified over
// all 40 logs before being coded (cited per rule):
//
// - Turn blocks: attempts_recorded(seat) -> optional reasoning_recorded ->
//   one outcome event by the same actor (vote_cast / night_action_submitted
//   / timeout). Enumeration does not depend on attempts_recorded, though:
//   the engine awaits every living seat in `vote` and every living power
//   role in `night_actions` (engine reducer.ts advance()/nightActors()), and
//   all 40 logs contain exactly one outcome event per awaited seat per
//   phase. This module re-asserts that completeness and hard-fails on any
//   gap (spec §5 fail-closed).
// - Timeout -> forced attribution: the engine applies the default action
//   the moment it logs the timeout, so the forced default event is ALWAYS
//   at timeout.seq + 1 with the same actor (verified: all 12 vote/night
//   timeouts across the 40 logs). This replaces v2's cross-event
//   pendingTimeout carry (scoring.mjs:40-45), which could mis-attribute a
//   forced default across unrelated interleaved events.
// - Forced defaults by phase (engine legal.ts defaultActionFor): vote ->
//   vote_cast with target null; night_actions -> night_action_submitted
//   with action "no_action". A timeout-forced default is a valid action by
//   the ENGINE but not by the seat: rows carry forced=true, valid=false,
//   submitted=null, and stats-v3 computes coverage over seat-valid rows.
// - Night numbering: night_action_submitted / investigation_result /
//   night_resolved carry e.day === N for the night that dawns into day N's
//   discussion and vote (fixtured from sweep1-0 seq 33-50: night_actions
//   day=1 -> dawn day=1 -> discussion day=1). A row's `day` is that value.
// - Abstain: an explicit vote_cast target null (not timeout-adjacent) or a
//   voluntary night "no_action" is the SEAT's own legal abstention:
//   submitted='abstain', valid=true.
// - Kill resolution (engine reducer.ts resolveDawn): plurality of mafia
//   submissions, seeded tiebreak; the doctor's protect intercepts iff it
//   equals the resolved choice, in which case night_resolved reports
//   {killed:null, protected:true} and the intended victim is exactly the
//   protect target. Applied effects are read from night_resolved, never
//   re-derived from submissions.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const POWER_ROLES = new Set(['mafia', 'doctor', 'detective'])
const NIGHT_KIND_BY_ROLE = {
  mafia: 'night_kill',
  doctor: 'night_protect',
  detective: 'night_investigate',
}

/**
 * Build all opportunity rows for one game.
 * `events` is the parsed jsonl in seq order; `root` is the verified chain
 * root (= the final event's hash, matching runs/sweep-download/roots.txt).
 */
export function opportunityRows(events, { root = null, analysisRunId = 'UNBOUND' } = {}) {
  const roles = {}
  const models = {}
  let seed = null
  let seatOrder = []
  let config = {}
  const alive = new Set()
  // Doctor legality state: engine legal.ts excludes lastProtected when
  // doctorMayRepeatTarget=false; the engine refreshes lastProtected at every
  // dawn to that night's protect target ?? null (reducer.ts resolveDawn), so
  // a no-protect night clears the restriction.
  let lastProtected = null
  // Facts for groundTruth: per-seat mafia-ballot history (seat cast a ballot
  // on a true mafia seat, by seq) and per-detective checked-target history.
  const mafiaBallotSeqs = new Map() // seat -> first seq of a ballot on a mafia seat
  const checked = new Map() // detective -> Set<target> investigated on a PRIOR night
  const rows = []
  let nightBuffer = [] // rows of the in-flight night, finalized at night_resolved
  let nightChecksToCommit = [] // [detective, target] committed after the night resolves
  let voteBuffer = null // { day, seen:Set } for the in-flight vote phase

  const isForcedDefault = (e, prev, phase) =>
    prev != null &&
    prev.type === 'timeout' &&
    prev.actor === e.actor &&
    prev.seq === e.seq - 1 &&
    prev.payload.phase === phase

  const legalVoteTargets = () => [...alive] // engine legal.ts:74 — self-votes are legal; abstain via null
  const legalNightTargets = (seat) => {
    const role = roles[seat]
    if (role === 'mafia') {
      // engine legal.ts:49 — kill targets exclude every living mafia (self included)
      return [...alive].filter((s) => roles[s] !== 'mafia')
    }
    if (role === 'doctor') {
      let t = [...alive]
      if (!config.doctorMaySelfProtect) t = t.filter((s) => s !== seat)
      if (!config.doctorMayRepeatTarget && lastProtected) t = t.filter((s) => s !== lastProtected)
      return t
    }
    return [...alive].filter((s) => s !== seat) // detective: living non-self
  }

  const assertVoteComplete = () => {
    if (!voteBuffer) return
    for (const s of alive) {
      if (!voteBuffer.seen.has(s)) {
        throw new Error(`${seed}: living ${s} has no ballot on day ${voteBuffer.day} — log incomplete`)
      }
    }
    voteBuffer = null
  }

  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    const p = e.payload ?? {}
    const prev = events[i - 1]

    switch (e.type) {
      case 'game_created':
        seed = p.matchSeed ?? seed
        config = p.config ?? {}
        seatOrder = (p.config?.seats ?? p.seats ?? []).map((s) => s.id)
        break
      case 'role_assigned':
        roles[p.seat] = p.role
        alive.add(p.seat)
        break
      case 'seat_bound':
        models[p.seat] = p.modelKey
        break
      case 'seat_died':
        alive.delete(p.seat)
        break

      case 'phase_changed':
        if (p.from === 'vote') assertVoteComplete()
        if (p.to === 'vote') voteBuffer = { day: p.day, seen: new Set() }
        break

      case 'vote_cast': {
        const seat = p.seat
        voteBuffer?.seen.add(seat)
        const forced = isForcedDefault(e, prev, 'vote')
        const legalTargets = legalVoteTargets()
        const submitted = forced ? null : p.target === null ? 'abstain' : p.target
        if (!forced && p.target !== null && !legalTargets.includes(p.target)) {
          throw new Error(`${seed}: seq ${e.seq} ballot on non-living ${p.target} — log/derivation mismatch`)
        }
        const voterIsMafia = roles[seat] === 'mafia'
        const livingMafia = [...alive].filter((s) => roles[s] === 'mafia').length
        rows.push({
          seed,
          root,
          seq: e.seq,
          seat,
          model: models[seat] ?? null,
          role: roles[seat],
          day: e.day,
          phase: 'vote',
          kind: 'day_vote',
          legalTargets,
          submitted,
          valid: !forced,
          forced,
          groundTruth: forced || p.target === null
            ? null
            : { targetRole: roles[p.target], targetIsMafia: roles[p.target] === 'mafia' },
          // §4: exact per-ballot chance for TOWN ballots only — living legal
          // mafia targets ÷ legal non-self targets. Null for mafia voters.
          chance: voterIsMafia ? null : livingMafia / (alive.size - 1),
          analysisRunId,
        })
        if (p.target !== null && roles[p.target] === 'mafia' && !mafiaBallotSeqs.has(seat)) {
          mafiaBallotSeqs.set(seat, e.seq)
        }
        break
      }

      case 'night_action_submitted': {
        const seat = p.seat
        const forced = isForcedDefault(e, prev, 'night_actions')
        const kind = NIGHT_KIND_BY_ROLE[roles[seat]]
        if (!kind) throw new Error(`${seed}: seq ${e.seq} night action by non-power ${seat}`)
        const legalTargets = legalNightTargets(seat)
        if (!forced && p.target !== null && !legalTargets.includes(p.target)) {
          throw new Error(`${seed}: seq ${e.seq} illegal night target ${p.target} — log/derivation mismatch`)
        }
        const submitted = forced ? null : p.action === 'no_action' ? 'abstain' : p.target
        nightBuffer.push({
          seed,
          root,
          seq: e.seq, // §4: protections and investigations carry the acting event's seq
          seat,
          model: models[seat] ?? null,
          role: roles[seat],
          day: e.day,
          phase: 'night_actions',
          kind,
          legalTargets,
          submitted,
          valid: !forced,
          forced,
          groundTruth: null, // filled at night_resolved from applied effects
          chance: null,
          analysisRunId,
        })
        if (kind === 'night_investigate' && !forced && p.target !== null) {
          nightChecksToCommit.push([seat, p.target])
        }
        break
      }

      case 'night_resolved': {
        for (const s of alive) {
          if (POWER_ROLES.has(roles[s]) && !nightBuffer.some((r) => r.seat === s)) {
            throw new Error(`${seed}: living ${roles[s]} ${s} has no night submission on day ${e.day} — log incomplete`)
          }
        }
        const protectRow = nightBuffer.find((r) => r.kind === 'night_protect')
        const protectTarget =
          protectRow && typeof protectRow.submitted === 'string' && protectRow.submitted !== 'abstain'
            ? protectRow.submitted
            : null
        // Applied effect, preferred over intents: killed is the plurality
        // victim unless intercepted, in which case the intended victim is
        // the protect target (saved <=> protectTarget === plurality choice).
        const victim = p.killed ?? (p.protected ? protectTarget : null)
        for (const r of nightBuffer) {
          const t = typeof r.submitted === 'string' && r.submitted !== 'abstain' ? r.submitted : null
          if (t === null) continue // forced or abstained: no target, no target facts
          if (r.kind === 'night_kill') {
            r.groundTruth = {
              targetRole: roles[t],
              targetWasPowerRole: roles[t] === 'doctor' || roles[t] === 'detective',
              // victim-had-voted-mafia (§4): the TARGET cast a ballot on a
              // true mafia seat strictly before this kill submission.
              targetHadVotedMafia: (mafiaBallotSeqs.get(t) ?? Infinity) < r.seq,
              nightVictim: victim,
              intercepted: p.protected === true && victim === t,
            }
          } else if (r.kind === 'night_protect') {
            r.groundTruth = {
              targetRole: roles[t],
              selfProtect: t === r.seat,
              interceptedKill: p.protected === true, // factual: protect equalled the resolved kill choice
            }
          } else {
            r.groundTruth = {
              targetRole: roles[t],
              result: roles[t] === 'mafia' ? 'mafia' : 'not mafia',
              previouslyCheckedByThisDetective: checked.get(r.seat)?.has(t) ?? false,
            }
          }
        }
        rows.push(...nightBuffer)
        nightBuffer = []
        for (const [det, t] of nightChecksToCommit) {
          if (!checked.has(det)) checked.set(det, new Set())
          checked.get(det).add(t)
        }
        nightChecksToCommit = []
        lastProtected = protectTarget // engine refreshes this every dawn, null included
        break
      }
    }
  }
  assertVoteComplete()
  if (nightBuffer.length > 0) {
    throw new Error(`${seed}: ${nightBuffer.length} night submissions never resolved — log incomplete`)
  }

  // Stable order: by seq, which is already the log order.
  const order = new Map(seatOrder.map((s, i) => [s, i]))
  for (const r of rows) r.legalTargets.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
  return rows
}

function readEvents(path) {
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      logs: { type: 'string' },
      manifest: { type: 'string' },
      out: { type: 'string', default: 'runs/analysis-v3/opportunity/table.jsonl' },
    },
  })

  const given = [...positionals]
  if (values.logs) {
    for (const f of readdirSync(values.logs).sort()) {
      if (f.endsWith('.jsonl') && !f.startsWith('manifest')) given.push(join(values.logs, f))
    }
  }
  if (given.length === 0) {
    console.error('usage: node scripts/opportunity-table.mjs [logs...] [--logs dir] [--manifest m.json] [--out table.jsonl]')
    process.exit(1)
  }

  // One input per log: the same file named twice (positionally and via
  // --logs) is a single input, and two DIFFERENT files sharing a seed
  // basename would silently double that game's rows — hard failure.
  const bySeed = new Map() // seed basename -> resolved path
  const paths = []
  for (const p of given) {
    const abs = resolve(p)
    const seed = basename(abs, '.jsonl')
    const prior = bySeed.get(seed)
    if (prior === abs) continue
    if (prior !== undefined) {
      console.error(`seed ${seed} supplied by two different files: ${prior} and ${abs}`)
      process.exit(1)
    }
    bySeed.set(seed, abs)
    paths.push(abs)
  }

  // The manifest binds rows to an analysisRunId (§5). Without one, rows are
  // stamped UNBOUND so smoke runs work; stats-v3 refuses UNBOUND tables.
  let analysisRunId = 'UNBOUND'
  if (values.manifest) {
    const m = JSON.parse(readFileSync(values.manifest, 'utf8'))
    if (!m.analysisRunId) {
      console.error(`${values.manifest}: no analysisRunId`)
      process.exit(1)
    }
    analysisRunId = m.analysisRunId
  }

  const allRows = []
  const perSeed = []
  for (const path of paths) {
    const events = readEvents(path)
    // The verified chain root is the final event's hash (matches
    // runs/sweep-download/roots.txt for every sweep1 log).
    const root = events[events.length - 1]?.hash ?? null
    const rows = opportunityRows(events, { root, analysisRunId })
    const seed = rows[0]?.seed ?? basename(path, '.jsonl')
    perSeed.push({ seed, rows: rows.length })
    allRows.push(...rows)
  }

  // §5 clean-room: the artifact must be byte-reproducible, so the meta line
  // carries no timestamp — provenance lives in the manifest's analysisRunId.
  const meta = {
    _meta: true,
    generator: 'opportunity-table',
    spec: 'analysis-v3.1 §4',
    analysisRunId,
    games: perSeed.length,
    rows: allRows.length,
    perSeed,
  }
  mkdirSync(dirname(values.out), { recursive: true })
  const lines = [meta, ...allRows].map((r) => JSON.stringify(r)).join('\n') + '\n'
  writeFileSync(values.out, lines)
  console.log(`${values.out}: ${allRows.length} rows across ${perSeed.length} games (analysisRunId ${analysisRunId})`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
