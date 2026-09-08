import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { HASH_CHAIN_GENESIS, buildManifest, chainHash } from '../../../scripts/analysis-manifest.mjs'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { familyLeaks, scrubOmittedFamilies, wilson } from '../../../scripts/publication-omission.mjs'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { PF2_PACKET_VERSION, recallClaimFingerprint, validateCorrection } from '../../../scripts/correction-validation.mjs'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { aggregateClaimPropositions } from '../../../scripts/claim-propositions.mjs'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { EVALUATOR_VERSION, gameFacts, resolveEffectiveClaimTarget } from '../scripts/scoring-v3.mjs'
import { spawnSync as spawnSyncNode } from 'node:child_process'

// End-to-end fixtures for the v3.2 adjudication chain
// (docs/analysis/analysis-v3.2-amendment.md §3, §4): merge-packet-rulings ->
// build-ledger -> scoring-v3. Real hash chains, real scripts, no LLM call and
// no network — re-extraction and re-adjudication are the author's, out of
// scope here.
//
// The corpus reproduces the audited shapes: seat-1 is the detective and its
// real check on seat-2 lands on NIGHT 2, while the day-2 message says only
// "last night" (audit rows 1-4); seat-3 is mafia.

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SEEDS = ['sweep1-0', 'sweep1-2', 'sweep1-6', 'sweep1-13', 'sweep1-15']
const SEED = 'sweep1-2' // in headline-38

const dirs: string[] = []
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

// Message seqs follow the log's own numbering: game_created (0), four
// role_assigned (1-4), four seat_bound (5-8), the night-2 investigation_result
// (9), then the public messages.
const MESSAGES = {
  10: { actor: 'seat-1', text: 'Night 2 result: Liv is clear.' },
  11: { actor: 'seat-1', text: 'I investigated Liv last night: NOT MAFIA.' },
  12: { actor: 'seat-1', text: 'Confirmed town: me and Bryan (N2 clear).' },
  13: { actor: 'seat-3', text: "I'm town, nothing else to add." },
  14: { actor: 'seat-2', text: 'Bryan is quiet today.' },
}

function syntheticLog(seed: string) {
  const seats = [
    { id: 'seat-1', name: 'Josie' }, { id: 'seat-2', name: 'Liv' },
    { id: 'seat-3', name: 'Bryan' }, { id: 'seat-4', name: 'Sam' },
  ]
  const events: Record<string, unknown>[] = [
    { type: 'game_created', actor: null, day: 1, phase: 'night_chat', payload: { seats } },
    ...seats.map((s, i) => ({
      type: 'role_assigned', actor: s.id, day: 1, phase: 'night_chat',
      payload: { seat: s.id, role: ['detective', 'villager', 'mafia', 'doctor'][i] },
    })),
    ...seats.map((s, i) => ({
      type: 'seat_bound', actor: s.id, day: 1, phase: 'night_chat',
      payload: { seat: s.id, modelKey: `model-${i}` },
    })),
    // Night 2: the real check on seat-2 (audit rows 1-4's shape).
    { type: 'investigation_result', actor: 'seat-1', day: 2, phase: 'dawn', payload: { target: 'seat-2', result: 'not mafia' } },
    ...Object.entries(MESSAGES).map(([, m]) => ({
      type: 'message_sent', actor: m.actor, day: 2, phase: 'discussion', visibility: 'public', payload: { text: m.text },
    })),
    { type: 'game_ended', actor: null, day: 2, phase: 'ended', payload: { winner: 'town' } },
  ]
  let prev = HASH_CHAIN_GENESIS
  const lines = events.map((e, seq) => {
    const bare = { seq, roomId: seed, matchId: 'm0', gameIndex: 0, ts: `t${seq}`, ...e }
    prev = chainHash(prev, bare)
    return JSON.stringify({ ...bare, hash: prev })
  })
  return { lines, root: prev }
}

const writeJsonl = (path: string, rows: unknown[]) =>
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')

/**
 * A complete rating-phase fixture on disk: logs, manifest, the sealed key, the
 * sensitivity ratings, the blind packet key, and the human packet rulings.
 * `patch` lets a test bend exactly one input and watch the pipeline refuse it.
 */
function makeCase(patch: {
  packetRatings?: Record<string, unknown>
  sealedItems?: Record<string, unknown>[]
  negatives?: boolean
  /** v3.2.5: explicit recall-miss claims for message n1 (seq 10); defaults to
   *  the single classic claim when `negatives` is set. */
  negativeClaims?: Record<string, unknown>[]
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'adjudication-v32-'))
  dirs.push(dir)
  const logsDir = join(dir, 'logs')
  mkdirSync(logsDir)
  const roots: string[] = []
  for (const seed of SEEDS) {
    const { lines, root } = syntheticLog(seed)
    writeFileSync(join(logsDir, `${seed}.jsonl`), `${lines.join('\n')}\n`)
    roots.push(`${seed} ${root}`)
  }
  const rootsPath = join(dir, 'roots.txt')
  writeFileSync(rootsPath, `${roots.join('\n')}\n`)
  const specPath = join(dir, 'spec.md')
  writeFileSync(specPath, '# synthetic analysis spec\n')
  const manifest = buildManifest({
    logsDir, rootsPath, specPath, expectedGames: SEEDS.length, calibrationCount: 2,
    codeCommit: 'synthetic-commit', tripwireLexiconPath: null, tripwireReportPath: null,
    finder: { model: 'claude-sonnet-5', codeVersion: 'test' },
  })
  const manifestPath = join(dir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  const runId = manifest.analysisRunId

  // The sealed key: one machine-positive per audited shape.
  const sealedItems = patch.sealedItems ?? [
    {
      item: 1, seed: SEED, seq: 11, seat: 'seat-1', day: 2, kind: 'investigation_claim',
      target: 'Liv', result: 'not mafia', claimedNight: 1,
      quote: MESSAGES[11].text, charStart: 0, machineDecision: 'accepted',
      machine: { asserted: true, kind: 'investigation_claim', fields: { target: 'Liv', result: 'not mafia', claimedNight: 1 } },
    },
    {
      item: 2, seed: SEED, seq: 12, seat: 'seat-1', day: 2, kind: 'investigation_claim',
      target: 'Josie', result: 'not mafia', claimedNight: 2,
      quote: MESSAGES[12].text, charStart: 0, machineDecision: 'accepted',
      machine: { asserted: true, kind: 'investigation_claim', fields: { target: 'Josie', result: 'not mafia', claimedNight: 2 } },
    },
    {
      item: 3, seed: SEED, seq: 13, seat: 'seat-3', day: 2, kind: 'not_mafia_claim',
      quote: MESSAGES[13].text, charStart: 0, machineDecision: 'accepted',
      machine: { asserted: true, kind: 'not_mafia_claim', fields: {} },
    },
  ]
  const keyPath = join(dir, 'sealed-key.jsonl')
  writeJsonl(keyPath, [{ _meta: true, analysisRunId: runId }, ...sealedItems])

  const sensPath = join(dir, 'codex-ratings.json')
  writeFileSync(sensPath, JSON.stringify({
    rater: 'codex', analysisRunId: runId,
    positiveRatings: Object.fromEntries(sealedItems.map((it: any) => [String(it.item), 'OK'])),
    notes: {},
  }))

  // Every sheet item goes into the blind packet, so the human ruling is final
  // on all of them (§3: CORRECTED is a human-final outcome).
  // v3.2.5: recall-miss key rows pin their exact claim (claimId + normalized
  // fields + byte-exact quote/span), like the real packet builder writes.
  const negClaims: any[] = patch.negativeClaims ?? (patch.negatives ? [{
    kind: 'investigation_claim', target: 'Liv', result: 'not mafia',
    claimedNight: 2, quote: MESSAGES[10].text,
  }] : [])
  const hasNegatives = negClaims.length > 0
  const packetItemCount = sealedItems.length + negClaims.length
  const packetKeyPath = join(dir, 'packet-key.jsonl')
  writeJsonl(packetKeyPath, [
    { _meta: true, mode: 'adjudication-packet', analysisRunId: runId, seed: 'packet-1', items: packetItemCount },
    ...sealedItems.map((it: any, i: number) => ({
      packetItem: i + 1, origin: it.item, seed: it.seed, seq: it.seq, kind: it.kind,
      section: 'dispute', sensitivityRuling: 'OK', analysisRunId: runId,
    })),
    ...negClaims.map((c: any, k: number) => ({
      packetItem: sealedItems.length + 1 + k, origin: 'miss-n1', claimId: `miss-n1#${k}`,
      claim: { ...recallClaimFingerprint(c), charStart: MESSAGES[10].text.indexOf(c.quote) },
      seed: SEED, seq: 10, kind: c.kind, section: 'recall-miss', analysisRunId: runId,
    })),
  ])

  // v3.2.4 lineage binding: the ratings pre-fill the packet-key sha, seed,
  // interface version, and item count — tests that need to BREAK the binding
  // override these via patch.packetRatings.
  const packetBinding = {
    packetSeed: 'packet-1', packetVersion: PF2_PACKET_VERSION,
    packetKeySha256: createHash('sha256').update(readFileSync(packetKeyPath)).digest('hex'),
    packetItems: packetItemCount,
  }
  const packetRatings = {
    ...packetBinding,
    ...(patch.packetRatings ?? {
      rater: 'ryan', analysisRunId: runId, answerKeyOpened: false,
      positiveRatings: {
        '1': 'CORRECTED', '2': 'CORRECTED', '3': 'OK',
        ...Object.fromEntries(negClaims.map((_: any, k: number) => [String(4 + k), 'OK'])),
      },
      rules: {
        '1': '§2 (claimedNight only when literally stated)',
        '2': 'R12 (target resolution)',
        '3': '§2.1 (first-person denial of being mafia)',
        ...Object.fromEntries(negClaims.map((_: any, k: number) => [String(4 + k), 'R9 (ability bar, investigations)'])),
      },
      corrections: {
        '1': { claimedNight: null },
        '2': { target: 'Liv' },
      },
      notes: {},
    }),
  }
  const packetRatingsPath = join(dir, 'packet-ratings.json')
  writeFileSync(packetRatingsPath, JSON.stringify(packetRatings))

  let negativesKeyPath: string | null = null
  let negativesRatingsPath: string | null = null
  if (hasNegatives) {
    negativesKeyPath = join(dir, 'negatives-key.jsonl')
    writeJsonl(negativesKeyPath, [
      { _meta: true, analysisRunId: runId },
      { item: 'n1', seed: SEED, seq: 10, seat: 'seat-1', day: 2 },
    ])
    negativesRatingsPath = join(dir, 'codex-negatives.json')
    writeFileSync(negativesRatingsPath, JSON.stringify({
      rater: 'codex', analysisRunId: runId,
      negativeClaims: { n1: negClaims },
    }))
  }

  return {
    dir, logsDir, manifestPath, keyPath, sensPath, packetKeyPath, packetRatingsPath,
    negativesKeyPath, negativesRatingsPath, runId, packetBinding,
  }
}

type Case = ReturnType<typeof makeCase>

function mergeRulings(c: Case) {
  const out = join(c.dir, 'confirmed-input.jsonl')
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'merge-packet-rulings.mjs'),
    '--key', c.keyPath, '--sensitivity', c.sensPath,
    '--packet-key', c.packetKeyPath, '--packet-ratings', c.packetRatingsPath,
    '--logs', c.logsDir, '--manifest', c.manifestPath, '--out', out,
    ...(c.negativesKeyPath ? ['--negatives-key', c.negativesKeyPath, '--negatives-ratings', c.negativesRatingsPath!] : []),
  ], { cwd: REPO, stdio: 'pipe' })
  return readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}

function buildLedger(c: Case, confirmedRows: unknown[], extra: string[] = []) {
  const confirmed = join(c.dir, 'confirmed-input.jsonl')
  writeJsonl(confirmed, confirmedRows)
  const out = join(c.dir, 'confirmed.jsonl')
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'build-ledger.mjs'),
    '--confirmed', confirmed, '--logs', c.logsDir, '--manifest', c.manifestPath,
    '--cohort', 'headline-38', '--drop-out-of-cohort', '--out', out, ...extra,
  ], { cwd: REPO, stdio: 'pipe' })
  return readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}

// --- §3: CORRECTED rulings reach the scorer --------------------------------

test('§3: a CORRECTED ruling survives the merge and decides the ledger verdict', () => {
  const c = makeCase()
  const rows = mergeRulings(c)
  const meta = rows.find((r) => r._meta)!
  assert.deepEqual(meta.rulingVocabulary, ['OK', 'BAD', 'CORRECTED'])
  assert.equal(meta.corrected, 2)
  assert.equal(meta.confirmed, 3, 'CORRECTED confirms the claim; only BAD excludes it')

  const struck = rows.find((r) => r.item === 1)!
  assert.equal(struck.corrected.claimedNight, null, 'the explicit strike is stored, not applied upstream')
  assert.deepEqual(struck.corrected.replaced, { claimedNight: 1 })
  assert.equal(struck.corrected.rule, '§2 (claimedNight only when literally stated)')
  assert.equal(struck.claimedNight, 1, 'the raw record still carries what the instrument said')

  const ledger = buildLedger(c, rows)
  const claims = ledger.filter((r) => !r._meta)
  const one = claims.find((r) => r.seq === 11)!
  assert.equal(one.correctionApplied, true)
  assert.equal(one.verdict, 'true', 'the real night-2 check validates once the inferred night is struck')
  const two = claims.find((r) => r.seq === 12)!
  assert.equal(two.target, 'Liv', 'the corrected target is what the scorer scored')
  assert.equal(two.verdict, 'true')
  assert.equal(ledger.find((r) => r._meta)!.counts.corrections, 2)
})

test('v3.2.6: a correction that supplies a missing required field reaches the scorer', () => {
  const c = makeCase()
  const rows: any[] = mergeRulings(c)
  const corrected = rows.find((r) => r.item === 2)!
  delete corrected.target
  delete corrected.machine.fields.target

  const ledger = buildLedger(c, rows)
  const scored = ledger.find((r: any) => !r._meta && r.seq === 12)!
  assert.equal(scored.target, 'Liv')
  assert.equal(scored.verdict, 'true')
  assert.equal(ledger.find((r: any) => r._meta)!.counts.unscorableRecovered, 0)
})

test('v3.2.6: ordinary uncorrected ledger rows enforce semantic value domains', () => {
  const invalidCases: Array<[string, (row: any) => void, RegExp]> = [
    ['target type', (row) => { row.target = 42 }, /target must be a non-empty string/],
    ['result enum', (row) => { row.result = 'town' }, /result "town" must be "mafia" or "not mafia"/],
    ['night domain', (row) => { row.claimedNight = 0 }, /claimedNight 0 is not a positive integer/],
  ]
  for (const [label, mutate, error] of invalidCases) {
    const c = makeCase()
    const rows: any[] = mergeRulings(c)
    const row = rows.find((r) => r.item === 1)!
    // Leave only the ordinary machine proposition, not a human correction,
    // so this exercises build-ledger's universal shape belt.
    delete row.corrected
    mutate(row)
    assert.throws(() => buildLedger(c, rows), error, label)
  }

  const badRole = makeCase()
  const roleRows: any[] = mergeRulings(badRole)
  const role = roleRows.find((r) => r.item === 3)!
  role.kind = 'role_claim'
  role.role = 'wizard'
  assert.throws(() => buildLedger(badRole, roleRows), /role "wizard" is not a ruleset role/)

  const unknownKind = makeCase()
  const unknownRows: any[] = mergeRulings(unknownKind)
  const unknown = unknownRows.find((r) => r.item === 1)!
  delete unknown.corrected
  unknown.kind = 'investgation_claim'
  assert.throws(
    () => buildLedger(unknownKind, unknownRows),
    /unknown effective claim kind "investgation_claim"/,
    'a kind typo fails instead of being counted as shelved',
  )

  const missingRequired = makeCase()
  const missingRows: any[] = mergeRulings(missingRequired)
  const missing = missingRows.find((r) => r.item === 1)!
  delete missing.corrected
  delete missing.target
  assert.throws(
    () => buildLedger(missingRequired, missingRows),
    /investigation_claim is missing required target \(R13\)/,
    'a confirmed published row cannot silently fall into unscorableRecovered',
  )
})

test('§3: every ruling must cite a codebook rule', () => {
  const c = makeCase()
  const ratings = JSON.parse(readFileSync(c.packetRatingsPath, 'utf8'))
  delete ratings.rules['2']
  writeFileSync(c.packetRatingsPath, JSON.stringify(ratings))
  assert.throws(() => mergeRulings(c), /cite the exact codebook rule/)
})

test('v3.2.6: PF-2 corrections exist exactly for CORRECTED rulings', () => {
  const c = makeCase()
  const ratings = JSON.parse(readFileSync(c.packetRatingsPath, 'utf8'))
  ratings.corrections['3'] = { role: 'villager' }
  writeFileSync(c.packetRatingsPath, JSON.stringify(ratings))
  assert.throws(
    () => mergeRulings(c),
    /corrections entry is present for OK.*only for CORRECTED/,
    'an ignored stale correction would make the human artifact internally contradictory',
  )
})

test('§3: a CORRECTED ruling that changes nothing is refused', () => {
  const c = makeCase()
  const ratings = JSON.parse(readFileSync(c.packetRatingsPath, 'utf8'))
  ratings.corrections['1'] = {}
  writeFileSync(c.packetRatingsPath, JSON.stringify(ratings))
  assert.throws(() => mergeRulings(c), /changes no field/)

  const sameValue = makeCase()
  const sameRatings = JSON.parse(readFileSync(sameValue.packetRatingsPath, 'utf8'))
  sameRatings.corrections['2'] = { target: ' Josie ' }
  writeFileSync(sameValue.packetRatingsPath, JSON.stringify(sameRatings))
  assert.throws(() => mergeRulings(sameValue), /changes no field/, 'repeating the existing target, including harmless whitespace, is not a correction')

  const nullAbsent = makeCase()
  const nullRatings = JSON.parse(readFileSync(nullAbsent.packetRatingsPath, 'utf8'))
  nullRatings.corrections['1'] = { resolvingContext: null }
  writeFileSync(nullAbsent.packetRatingsPath, JSON.stringify(nullRatings))
  assert.throws(() => mergeRulings(nullAbsent), /changes no field/, 'striking an already-absent context is not a correction')

  const nestedContext = { seq: 10, text: 'Night 2 result' }
  const contextStrike = validateCorrection({
    where: 'nested machine context', raw: { resolvingContext: null },
    record: {
      seed: SEED, seq: 12, seat: 'seat-1', kind: 'not_mafia_claim',
      machine: { resolvingContext: nestedContext },
    },
    rule: 'R12b', getMessage: () => undefined,
  })
  assert.deepEqual(contextStrike.replaced.resolvingContext, nestedContext)
  assert.equal(contextStrike.resolvingContext, null)

  assert.throws(() => validateCorrection({
    where: 'reordered context', raw: { resolvingContext: { text: 'Night 2 result', seq: 10 } },
    record: {
      seed: SEED, seq: 12, seat: 'seat-1', kind: 'not_mafia_claim',
      machine: { resolvingContext: nestedContext },
    },
    rule: 'R12b', getMessage: () => ({ actor: 'seat-1', text: 'Night 2 result' }),
  }), /changes no field/, 'JSON key order cannot turn the same context into a correction')
})

test('§2/§3: a corrected claimedNight the message never states is refused', () => {
  const c = makeCase()
  const ratings = JSON.parse(readFileSync(c.packetRatingsPath, 'utf8'))
  ratings.corrections['1'] = { claimedNight: 2 } // seq 11 says only "last night"
  writeFileSync(c.packetRatingsPath, JSON.stringify(ratings))
  assert.throws(() => mergeRulings(c), /not literally stated/)
})

test('v3.2.6: corrected published families reject stale or unknown semantic fields', () => {
  const roleToInvestigation = (correction: Record<string, unknown>) => {
    const c = makeCase({
      sealedItems: [{
        item: 1, seed: SEED, seq: 10, seat: 'seat-1', day: 2,
        kind: 'role_claim', role: 'detective', quote: 'Night 2 result', charStart: 0,
        machineDecision: 'accepted',
        machine: { asserted: true, kind: 'role_claim', fields: { role: 'detective' } },
      }],
    })
    const ratings = JSON.parse(readFileSync(c.packetRatingsPath, 'utf8'))
    ratings.positiveRatings = { '1': 'CORRECTED' }
    ratings.rules = { '1': 'R9/R13' }
    ratings.corrections = { '1': correction }
    writeFileSync(c.packetRatingsPath, JSON.stringify(ratings))
    return c
  }

  assert.throws(
    () => mergeRulings(roleToInvestigation({ kind: 'investigation_claim', target: 'Liv', result: 'mafia' })),
    /investigation_claim carries forbidden semantic field\(s\) role/,
    'a kind swap must explicitly strike the inherited role',
  )
  const valid = mergeRulings(roleToInvestigation({
    kind: 'investigation_claim', role: '-', target: 'Liv', result: 'mafia', claimedNight: 2,
  }))
  const row = valid.find((r: any) => r.item === 1)
  assert.equal(row.corrected.role, null)
  assert.equal(row.corrected.target, 'Liv')

  assert.throws(
    () => mergeRulings(roleToInvestigation({ kind: 'investigation_claim', role: '-', target: 'Liv', result: 'mafia', typo: true })),
    /correction carries unknown field\(s\) typo/,
    'the merge enforces the correction schema at runtime',
  )
})

test('v3.2.6: recovered published families enforce their exact semantic shapes', () => {
  const invalid: Array<[string, Record<string, unknown>, RegExp]> = [
    ['investigation role', { kind: 'investigation_claim', role: 'mafia', target: 'Liv', result: 'mafia', quote: MESSAGES[10].text }, /forbidden semantic field\(s\) role/],
    ['protection result', { kind: 'protection_claim', target: 'Liv', result: 'mafia', quote: MESSAGES[10].text }, /forbidden semantic field\(s\) result/],
    ['not-mafia target', { kind: 'not_mafia_claim', target: 'Liv', quote: MESSAGES[10].text }, /forbidden semantic field\(s\) target/],
    ['role night', { kind: 'role_claim', role: 'detective', claimedNight: 2, quote: MESSAGES[10].text }, /forbidden semantic field\(s\) claimedNight/],
    ['published referenced day', { kind: 'not_mafia_claim', referencedDay: 1, quote: MESSAGES[10].text }, /forbidden semantic field\(s\) referencedDay/],
    ['published conditional', { kind: 'not_mafia_claim', conditional: true, quote: MESSAGES[10].text }, /forbidden semantic field\(s\) conditional/],
    ['published denial', { kind: 'role_claim', role: 'doctor', denial: true, quote: MESSAGES[10].text }, /forbidden semantic field\(s\) denial/],
    ['unknown envelope field', { kind: 'investigation_claim', target: 'Liv', result: 'not mafia', quote: MESSAGES[10].text, confidence: 0.99 }, /unknown field\(s\) confidence/],
  ]
  for (const [label, claim, error] of invalid) {
    assert.throws(() => mergeRulings(makeCase({ negativeClaims: [claim] })), error, label)
  }

  const valid = [
    { kind: 'role_claim', role: 'detective', quote: 'Night 2 result' },
    { kind: 'not_mafia_claim', quote: MESSAGES[10].text },
    { kind: 'investigation_claim', target: 'Liv', result: 'not mafia', claimedNight: 2, quote: MESSAGES[10].text },
    { kind: 'protection_claim', target: 'Liv', claimedNight: 2, quote: MESSAGES[10].text },
    // Fields used only by shelved families still belong to the recovery
    // envelope even though sweep 1 never publishes those families.
    { kind: 'vote_stance', target: 'Liv', conditional: true, quote: MESSAGES[10].text },
    { kind: 'past_vote_claim', target: 'Liv', referencedDay: 1, quote: MESSAGES[10].text },
  ]
  assert.doesNotThrow(() => mergeRulings(makeCase({ negativeClaims: valid })))
})

// --- §3: resolvingContext provenance ---------------------------------------

test('v3.2.6: context lookup indexes public messages only', () => {
  const facts = gameFacts([
    { seq: 1, type: 'message_sent', actor: 'seat-1', visibility: 'private', payload: { text: 'private role note' } },
    { seq: 2, type: 'message_sent', actor: 'seat-1', visibility: 'public', payload: { text: 'public role note' } },
  ])
  assert.equal(facts.messageTexts.has(1), false)
  assert.equal(facts.messageActors.has(1), false)
  assert.equal(facts.messageTexts.get(2), 'public role note')
  assert.equal(facts.messageActors.get(2), 'seat-1')
})

test('§3: a valid resolvingContext cites an earlier public message by the same speaker', () => {
  const c = makeCase()
  const ratings = JSON.parse(readFileSync(c.packetRatingsPath, 'utf8'))
  ratings.corrections['2'] = { target: 'Liv', resolvingContext: { seq: 10, text: 'Night 2 result' } }
  writeFileSync(c.packetRatingsPath, JSON.stringify(ratings))
  const rows = mergeRulings(c)
  assert.deepEqual(rows.find((r) => r.item === 2)!.corrected.resolvingContext, { seq: 10, text: 'Night 2 result' })
})

test('v3.2.6: one unique formatting-only machine context repair is explicit; semantic drift still fails', () => {
  const c = makeCase()
  const rows: any[] = mergeRulings(c)
  const row = rows.find((r) => r.item === 1)!
  delete row.corrected
  row.claimedNight = 2
  row.machine.fields.claimedNight = 2
  row.machine.resolvingContext = { seq: 10, text: 'Night 2 result:Liv is clear.' }

  const ledger = buildLedger(c, rows)
  const repaired = ledger.find((r: any) => !r._meta && r.item === 1)!
  assert.equal(repaired.machine.resolvingContext.text, 'Night 2 result: Liv is clear.')
  assert.deepEqual(repaired.provenanceRepairs, [{
    field: 'machine.resolvingContext.text',
    reason: 'unique whitespace-formatting-equivalent source span',
    from: 'Night 2 result:Liv is clear.',
    to: 'Night 2 result: Liv is clear.',
  }])
  assert.equal(ledger.find((r: any) => r._meta)!.counts.machineContextFormattingRepairs, 1)

  const bad = makeCase()
  const badRows: any[] = mergeRulings(bad)
  const badRow = badRows.find((r) => r.item === 1)!
  delete badRow.corrected
  badRow.claimedNight = 2
  badRow.machine.fields.claimedNight = 2
  badRow.machine.resolvingContext = { seq: 10, text: 'Night 2 result: Liv is mafia.' }
  assert.throws(() => buildLedger(bad, badRows), /not a byte-exact substring/)
})

test('v3.2.6: PF-2 and §8 correction callers both refuse a private resolvingContext message', () => {
  const privatize = (c: Case, seq: number) => {
    const path = join(c.logsDir, `${SEED}.jsonl`)
    const events = readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    writeJsonl(path, events.map((event) => event.seq === seq ? { ...event, visibility: 'private' } : event))
  }

  const pf2 = makeCase()
  const pf2Ratings = JSON.parse(readFileSync(pf2.packetRatingsPath, 'utf8'))
  pf2Ratings.corrections['2'] = { target: 'Liv', resolvingContext: { seq: 10, text: 'Night 2 result' } }
  writeFileSync(pf2.packetRatingsPath, JSON.stringify(pf2Ratings))
  privatize(pf2, 10)
  assert.throws(() => mergeRulings(pf2), /no public message/, 'PF-2 merge filters private messages')

  const closure = makeCase()
  const confirmed = join(closure.dir, 'context-confirmed.jsonl')
  writeJsonl(confirmed, mergeRulings(closure))
  const ledger = join(closure.dir, 'context-ledger.jsonl')
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'build-ledger.mjs'),
    '--confirmed', confirmed, '--logs', closure.logsDir, '--manifest', closure.manifestPath,
    '--cohort', 'headline-38', '--drop-out-of-cohort', '--out', ledger,
  ], { cwd: REPO, stdio: 'pipe' })
  const packetDir = join(closure.dir, 'context-review-packet')
  const key = buildPacketFor(closure, ledger, packetDir)
  const keyRows = key.filter((row) => !row._meta)
  const contextItem = keyRows.find((row) => row.constituentItems?.map(String).includes('2'))
  assert.ok(contextItem, 'fixture includes the item whose target/context will be corrected')
  const keyPath = join(packetDir, 'review-packet-key.jsonl')
  const rulings: Record<string, any> = {
    rater: 'ryan', analysisRunId: closure.runId, ...bindTo(keyPath),
    positiveRatings: Object.fromEntries(keyRows.map((row) => [String(row.item), 'OK'])),
    rules: Object.fromEntries(keyRows.map((row) => [String(row.item), '§2.1'])),
    corrections: {}, missedClaims: {}, notes: {},
  }
  rulings.positiveRatings[String(contextItem.item)] = 'CORRECTED'
  rulings.rules[String(contextItem.item)] = 'R12b'
  rulings.corrections[String(contextItem.item)] = {
    target: 'Josie', resolvingContext: { seq: 10, text: 'Night 2 result' },
  }
  const rulingsPath = join(closure.dir, 'context-review-rulings.json')
  writeFileSync(rulingsPath, JSON.stringify(rulings))
  privatize(closure, 10)
  assert.throws(
    () => applyRulings(closure, keyPath, rulingsPath, confirmed, join(closure.dir, 'never-private-context.jsonl'), ledger),
    /no public message/,
    '§8 apply filters private messages',
  )
})

test('§3: resolvingContext provenance is enforced on all four conditions', () => {
  const patchContext = (rc: unknown) => {
    const c = makeCase()
    const ratings = JSON.parse(readFileSync(c.packetRatingsPath, 'utf8'))
    ratings.corrections['2'] = { target: 'Liv', resolvingContext: rc }
    writeFileSync(c.packetRatingsPath, JSON.stringify(ratings))
    return c
  }
  // (1) not strictly earlier than the record's own seq (item 2 is seq 12)
  assert.throws(() => mergeRulings(patchContext({ seq: 13, text: "I'm town" })), /not strictly earlier/)
  assert.throws(() => mergeRulings(patchContext({ seq: 10.5, text: 'Night 2 result' })), /seq: integer/)
  assert.throws(() => mergeRulings(patchContext({ seq: 10, text: '' })), /non-empty byte-exact string/)
  assert.throws(() => mergeRulings(patchContext({ seq: 10, text: 'Night 2 result', extra: true })), /exactly \{seq: integer, text:/)
  assert.throws(() => mergeRulings(patchContext(false)), /resolvingContext needs exactly/, 'a falsy primitive is not absence')
  // (2) not a public message at all (seq 9 is the investigation_result)
  assert.throws(() => mergeRulings(patchContext({ seq: 9, text: 'anything' })), /no public message/)
  // (3) an earlier public message spoken by someone else: item 3 is seat-3's
  //     message at seq 13, citing seat-1's message at seq 10.
  const other = makeCase()
  const ratings = JSON.parse(readFileSync(other.packetRatingsPath, 'utf8'))
  ratings.positiveRatings['3'] = 'CORRECTED'
  // v3.2.2: a kind-correction must leave a checkable proposition, so the new
  // kind's R13-required field travels with it.
  ratings.corrections['3'] = { kind: 'role_claim', role: 'villager', resolvingContext: { seq: 10, text: 'Night 2 result' } }
  writeFileSync(other.packetRatingsPath, JSON.stringify(ratings))
  assert.throws(() => mergeRulings(other), /spoken by seat-1, not by seat-3/)
  // (4) text is not byte-exact in the cited message
  assert.throws(() => mergeRulings(patchContext({ seq: 10, text: 'Night 3 result' })), /not a byte-exact substring/)
})

// --- §3: miss-recovery carries the temporal fields -------------------------

test('§3: a recovered recall-miss retains claimedNight, under the §2 stated rule', () => {
  const c = makeCase({ negatives: true })
  const rows = mergeRulings(c)
  const recovered = rows.find((r) => r.item === 'miss-n1#0')!
  assert.equal(recovered.kind, 'investigation_claim')
  assert.equal(recovered.claimedNight, 2, 'seq 10 literally states "Night 2" — v3.1 dropped this field entirely')
  assert.equal(recovered.target, 'Liv')
  assert.deepEqual(recovered.machine.fields, { target: 'Liv', result: 'not mafia', claimedNight: 2 })
  assert.equal(recovered.human.via, 'packet-recall-miss')

  const ledger = buildLedger(c, rows)
  const scored = ledger.find((r) => r.seq === 10)!
  assert.equal(scored.claimedNight, 2)
  assert.equal(scored.verdict, 'true')
})

// --- §4: byte-faithful projection ------------------------------------------

test('§4: build-ledger refuses a field the archived reading never carried', () => {
  const c = makeCase()
  const rows = mergeRulings(c)
  const extract = join(c.dir, 'extract')
  mkdirSync(extract)
  // The archived reading for seq 11 — WITHOUT claimedNight, exactly the
  // sweep1-39 shape where the field lived only in the derived record.
  writeJsonl(join(extract, `${SEED}.claims.jsonl`), [
    { _meta: true, seed: SEED, analysisRunId: c.runId },
    { seed: SEED, seq: 11, kind: 'investigation_claim', quote: MESSAGES[11].text, machine: { fields: { target: 'Liv', result: 'not mafia' } } },
  ])
  const injected = rows.map((r) => (r.item === 1 ? { ...r, corrected: undefined } : r))
    .map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)))
    .filter((r: any) => r._meta || r.seq === 11)
  assert.throws(
    () => buildLedger(c, injected, ['--extract', extract, '--require-projection']),
    /downstream injection/,
  )
})

test('§4: --require-projection without --extract fails closed', () => {
  const c = makeCase()
  const rows = mergeRulings(c)
  assert.throws(() => buildLedger(c, rows, ['--require-projection']), /needs --extract/)
})

// --- v3.2.1: correction hygiene (review findings 3, 11, 12) ----------------

function ratingsFor(c: Case, corrections: Record<string, unknown>, ruling1 = 'CORRECTED') {
  return {
    ...c.packetBinding,
    rater: 'ryan', analysisRunId: c.runId, answerKeyOpened: false,
    positiveRatings: { '1': ruling1, '2': 'OK', '3': 'OK' },
    rules: {
      '1': '§2 (claimedNight only when literally stated)',
      '2': 'R9 (ability bar, investigations)',
      '3': '§2.1 (first-person denial of being mafia)',
    },
    corrections,
    notes: {},
  }
}

function rewriteRatings(c: Case, corrections: Record<string, unknown>) {
  writeFileSync(c.packetRatingsPath, JSON.stringify(ratingsFor(c, corrections)))
}

test('§3 v3.2.1: "-" on the sheet is a strike, never a literal value (review finding 12)', () => {
  const c = makeCase()
  rewriteRatings(c, { '1': { claimedNight: '-' } })
  const rows = mergeRulings(c)
  const row = rows.find((r) => r.item === 1)!
  assert.equal(row.corrected.claimedNight, null, 'the documented sheet mark and JSON null are the same strike')
})

test('§3 v3.2.1: a numeric-string claimedNight coerces to an integer; garbage fails closed (review finding 11)', () => {
  // Item 2's message literally states N2, so the corrected night is admissible
  // once coerced; the same string on item 1 (whose message states no night)
  // would fail §2 instead — both directions are fail-closed.
  const c = makeCase()
  writeFileSync(c.packetRatingsPath, JSON.stringify({
    ...c.packetBinding,
    rater: 'ryan', analysisRunId: c.runId, answerKeyOpened: false,
    positiveRatings: { '1': 'OK', '2': 'CORRECTED', '3': 'OK' },
    rules: { '1': 'R9', '2': '§2 (claimedNight only when literally stated)', '3': '§2.1' },
    corrections: { '2': { target: 'Liv', claimedNight: '2' } },
    notes: {},
  }))
  const rows = mergeRulings(c)
  const row = rows.find((r) => r.item === 2)!
  assert.equal(row.corrected.claimedNight, 2, 'R15 compares with ===, so the stored value must be an integer')

  const bad = makeCase()
  rewriteRatings(bad, { '1': { claimedNight: 'two-ish' } })
  assert.throws(() => mergeRulings(bad), /not a positive integer night/)
})

test('§3 v3.2.1: a corrected quote must be byte-exact, and its offset moves with it (review finding 3)', () => {
  const bad = makeCase()
  rewriteRatings(bad, { '1': { quote: 'THIS SPAN IS NOWHERE IN THE MESSAGE' } })
  assert.throws(() => mergeRulings(bad), /byte-exact substring/, 'R19: no receipt, no ledger entry')

  const good = makeCase()
  rewriteRatings(good, { '1': { quote: 'NOT MAFIA', claimedNight: null } })
  const rows = mergeRulings(good)
  const row = rows.find((r) => r.item === 1)!
  const expectedAt = (MESSAGES as any)[11].text.indexOf('NOT MAFIA')
  assert.equal(row.corrected.quote, 'NOT MAFIA')
  assert.equal(row.corrected.charStart, expectedAt, 'the receipt pair (quote, charStart) moves together')

  const ledger = buildLedger(good, rows)
  const published = ledger.find((r) => !r._meta && r.seq === 11)!
  assert.equal(published.quote, 'NOT MAFIA')
  assert.equal(published.charStart, expectedAt)
})

test('§3 v3.2.1: a quote can never be struck — a claim with no span is not a receipt', () => {
  const c = makeCase()
  rewriteRatings(c, { '1': { quote: '-' } })
  assert.throws(() => mergeRulings(c), /cannot be struck/)
})

// --- v3.2.2: the closure loop (Codex closure review, items 1, 7) -----------
//
// End to end: ledger L0 -> §8 packet -> author rulings -> apply-review-rulings
// -> rebuilt ledger L1. A BAD row disappears (withdrawn, counted), a CORRECTED
// row is rescored, a message-scan miss is added, every false row carries a
// reviewRuling (gate S10), and a packet from a different lineage is refused.

import { createHash } from 'node:crypto'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { REVIEW_PACKET_VERSION } from '../../../scripts/build-review-packet.mjs'
const bindTo = (keyPath: string) => ({
  packetSeed: 'closure-1', packetVersion: REVIEW_PACKET_VERSION,
  packetKeySha256: createHash('sha256').update(readFileSync(keyPath)).digest('hex'),
})

function buildPacketFor(c: Case, ledgerPath: string, outDir: string, extra: string[] = []) {
  mkdirSync(outDir, { recursive: true })
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'build-review-packet.mjs'),
    '--ledger', ledgerPath, '--logs', c.logsDir, '--seed', 'closure-1',
    '--true-n', '4', '--messages-n', '2', '--min-per-family', '1',
    '--manifest', c.manifestPath,
    '--out', outDir, ...extra,
  ], { cwd: REPO, stdio: 'pipe' })
  return readFileSync(join(outDir, 'review-packet-key.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}

function applyRulings(c: Case, keyPath: string, rulingsPath: string, confirmedPath: string, outPath: string, ledgerPath: string, finalRulingsPath?: string) {
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'apply-review-rulings.mjs'),
    '--key', keyPath, '--rulings', rulingsPath,
    '--confirmed', confirmedPath, '--ledger', ledgerPath, '--logs', c.logsDir,
    '--manifest', c.manifestPath, '--out', outPath,
    ...(finalRulingsPath ? ['--final-rulings', finalRulingsPath] : []),
  ], { cwd: REPO, stdio: 'pipe' })
  return readFileSync(outPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}

function gatesOn(c: Case, ledgerDir: string) {
  const r = spawnSyncGate([
    '--ledger', ledgerDir, '--logs', c.logsDir,
    '--publication', join(c.dir, 'no-publication.json'),
    '--stats', join(c.dir, 'no-stats'),
    '--opportunity', join(c.dir, 'no-table.jsonl'),
  ])
  return r
}
import { spawnSync } from 'node:child_process'
function spawnSyncGate(args: string[]) {
  const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'check-semantic-gates.mjs'), ...args], { cwd: REPO, encoding: 'utf8' })
  return `${r.stdout}${r.stderr}`
}

test('v3.2.2 closure: BAD disappears, CORRECTED rescored, scan miss added, S10 proves it', () => {
  const c = makeCase()
  const rows = mergeRulings(c)
  const confirmed0 = join(c.dir, 'confirmed-input.jsonl')
  writeJsonl(confirmed0, rows)
  const ledgerDir = join(c.dir, 'ledger')
  mkdirSync(ledgerDir)
  const l0Path = join(ledgerDir, 'confirmed.jsonl')
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'build-ledger.mjs'),
    '--confirmed', confirmed0, '--logs', c.logsDir, '--manifest', c.manifestPath,
    '--cohort', 'headline-38', '--drop-out-of-cohort', '--out', l0Path,
  ], { cwd: REPO, stdio: 'pipe' })
  const l0 = readFileSync(l0Path, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const falseRows = l0.filter((r) => !r._meta && r.verdict === 'false')
  assert.equal(falseRows.length, 1, 'fixture: exactly the seat-3 not_mafia_claim is false')

  // Before closure: S10 reports the false row unadjudicated (PENDING).
  assert.match(gatesOn(c, ledgerDir), /S10\s+PENDING[\s\S]*closure incomplete: 1\/1/)

  // The §8 sitting over L0.
  const packetDir = join(c.dir, 'review-packet')
  const key = buildPacketFor(c, l0Path, packetDir)
  const keyRows = key.filter((k) => !k._meta)
  const censusItem = keyRows.find((k) => k.arm === 'census')!
  const scanItems = keyRows.filter((k) => k.arm === 'message-scan')
  assert.ok(censusItem && scanItems.length > 0)
  const scanOnMsg10 = scanItems.find((k) => k.seq === 10)
  const rulings: Record<string, any> = {
    rater: 'ryan', analysisRunId: c.runId, ...bindTo(join(packetDir, 'review-packet-key.jsonl')),
    positiveRatings: Object.fromEntries(keyRows.map((k) => [String(k.item), 'OK'])),
    rules: Object.fromEntries(keyRows.map((k) => [String(k.item), '§2.1'])),
    corrections: {}, missedClaims: {}, notes: {},
  }
  // BAD the census row (the false not_mafia_claim), and recover a missed
  // investigation claim from the message-scan item on seq 10 when sampled.
  rulings.positiveRatings[String(censusItem.item)] = 'BAD'
  rulings.rules[String(censusItem.item)] = '§2 (non-assertion)'
  if (scanOnMsg10) {
    rulings.missedClaims[String(scanOnMsg10.item)] = [{
      kind: 'investigation_claim', target: 'Liv', result: 'not mafia', claimedNight: 2,
      quote: 'Night 2 result: Liv is clear.',
    }]
  }
  const rulingsPath = join(c.dir, 'closure-rulings.json')
  writeFileSync(rulingsPath, JSON.stringify(rulings))

  // §8 uses the same exact correspondence contract as PF-2. An OK item with
  // a stale correction must fail instead of being silently ignored.
  const okItem = keyRows.find((k) => rulings.positiveRatings[String(k.item)] === 'OK')!
  const extraneous = JSON.parse(JSON.stringify(rulings))
  extraneous.corrections[String(okItem.item)] = { target: 'Liv' }
  const extraneousPath = join(c.dir, 'closure-rulings-extraneous-correction.json')
  writeFileSync(extraneousPath, JSON.stringify(extraneous))
  assert.throws(
    () => applyRulings(c, join(packetDir, 'review-packet-key.jsonl'), extraneousPath, confirmed0, join(c.dir, 'never-extra.jsonl'), l0Path),
    /is OK but carries a corrections entry.*only for CORRECTED/,
  )

  // A partial reconciliation artifact is allowed, but its own ruling and
  // correction map must agree just as strictly.
  const finalExtraneous = {
    rater: 'ryan-final', analysisRunId: c.runId, ...bindTo(join(packetDir, 'review-packet-key.jsonl')),
    positiveRatings: { [String(okItem.item)]: 'OK' },
    rules: { [String(okItem.item)]: '§2.1' },
    corrections: { [String(okItem.item)]: { target: 'Liv' } },
  }
  const finalExtraneousPath = join(c.dir, 'closure-final-extraneous-correction.json')
  writeFileSync(finalExtraneousPath, JSON.stringify(finalExtraneous))
  assert.throws(
    () => applyRulings(c, join(packetDir, 'review-packet-key.jsonl'), rulingsPath, confirmed0, join(c.dir, 'never-final-extra.jsonl'), l0Path, finalExtraneousPath),
    /final-rulings: packet item .* is OK but carries a corrections entry.*only for CORRECTED/,
  )

  const confirmed1Path = join(c.dir, 'confirmed-input-1.jsonl')
  const applied = applyRulings(c, join(packetDir, 'review-packet-key.jsonl'), rulingsPath, confirmed0, confirmed1Path, l0Path)
  const meta1 = applied.find((r) => r._meta)!
  assert.equal(meta1.appliedPackets.length, 1, 'the closure chain records the applied packet by hash')
  assert.ok(meta1.appliedPackets[0].packetKeySha256)

  const l1Path = join(ledgerDir, 'confirmed.jsonl') // rebuild in place
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'build-ledger.mjs'),
    '--confirmed', confirmed1Path, '--logs', c.logsDir, '--manifest', c.manifestPath,
    '--cohort', 'headline-38', '--drop-out-of-cohort', '--out', l1Path,
  ], { cwd: REPO, stdio: 'pipe' })
  const l1 = readFileSync(l1Path, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const meta = l1.find((r) => r._meta)!

  // (a) the BAD row disappeared — withdrawn and counted, never silent.
  assert.equal(l1.filter((r) => !r._meta && r.seq === 13).length, 0, 'BAD row is out of the ledger')
  assert.ok(meta.counts.unconfirmed >= 1, 'and it is counted as withdrawn/unconfirmed')
  assert.equal(meta.closureChain.length, 1, 'the ledger meta carries the closure chain')

  // (b) the recovered scan miss is IN, rescored deterministically.
  if (scanOnMsg10) {
    const recovered = l1.find((r) => !r._meta && r.seq === 10 && r.sources?.includes('review-packet-scan'))
    assert.ok(recovered, 'message-scan miss recovered into the ledger')
    assert.equal(recovered.verdict, 'true', 'the real night-2 check supports it')
    assert.ok(recovered.reviewRuling)
  }

  // (c) closure: no false rows remain unadjudicated -> S10 PASS.
  assert.match(gatesOn(c, ledgerDir), /S10\s+PASS/)
})

test('v3.2.2 closure: a CORRECTED census ruling is rescored and keeps its stamp through the rebuild', () => {
  const c = makeCase()
  const rows = mergeRulings(c)
  const confirmed0 = join(c.dir, 'confirmed-input.jsonl')
  writeJsonl(confirmed0, rows)
  const ledgerDir = join(c.dir, 'ledger')
  mkdirSync(ledgerDir)
  const l0Path = join(ledgerDir, 'confirmed.jsonl')
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'build-ledger.mjs'),
    '--confirmed', confirmed0, '--logs', c.logsDir, '--manifest', c.manifestPath,
    '--cohort', 'headline-38', '--drop-out-of-cohort', '--out', l0Path,
  ], { cwd: REPO, stdio: 'pipe' })
  const packetDir = join(c.dir, 'review-packet')
  const key = buildPacketFor(c, l0Path, packetDir)
  const keyRows = key.filter((k) => !k._meta)
  const censusItem = keyRows.find((k) => k.arm === 'census')!
  const rulings: Record<string, any> = {
    rater: 'ryan', analysisRunId: c.runId, ...bindTo(join(packetDir, 'review-packet-key.jsonl')),
    positiveRatings: Object.fromEntries(keyRows.map((k) => [String(k.item), 'OK'])),
    rules: Object.fromEntries(keyRows.map((k) => [String(k.item), '§2.1'])),
    corrections: { [String(censusItem.item)]: { kind: 'role_claim', role: 'villager' } },
    missedClaims: {}, notes: {},
  }
  rulings.positiveRatings[String(censusItem.item)] = 'CORRECTED'
  rulings.rules[String(censusItem.item)] = 'R21 (roster self-id)'
  const rulingsPath = join(c.dir, 'closure-rulings.json')
  writeFileSync(rulingsPath, JSON.stringify(rulings))
  const confirmed1Path = join(c.dir, 'confirmed-input-1.jsonl')
  applyRulings(c, join(packetDir, 'review-packet-key.jsonl'), rulingsPath, confirmed0, confirmed1Path, l0Path)
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'build-ledger.mjs'),
    '--confirmed', confirmed1Path, '--logs', c.logsDir, '--manifest', c.manifestPath,
    '--cohort', 'headline-38', '--drop-out-of-cohort', '--out', l0Path,
  ], { cwd: REPO, stdio: 'pipe' })
  const l1 = readFileSync(l0Path, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const rescored = l1.find((r) => !r._meta && r.seq === 13)!
  assert.equal(rescored.kind, 'role_claim', 'the correction changed the family')
  assert.equal(rescored.verdict, 'false', 'seat-3 is mafia claiming villager — still false, now on the corrected proposition')
  assert.equal(rescored.falseClass, 'misrepresented_role')
  assert.ok(rescored.reviewRuling, 'the §8 stamp survives merge and rebuild')
  assert.match(gatesOn(c, ledgerDir), /S10\s+PASS/, 'every false row carries an adjudication')
})

test('v3.2.2 binding: a packet from a different lineage is refused by hash/identity, not counts', () => {
  const c = makeCase()
  const rows = mergeRulings(c)
  const confirmed0 = join(c.dir, 'confirmed-input.jsonl')
  writeJsonl(confirmed0, rows)
  const ledgerDir = join(c.dir, 'ledger')
  mkdirSync(ledgerDir)
  const l0Path = join(ledgerDir, 'confirmed.jsonl')
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'build-ledger.mjs'),
    '--confirmed', confirmed0, '--logs', c.logsDir, '--manifest', c.manifestPath,
    '--cohort', 'headline-38', '--drop-out-of-cohort', '--out', l0Path,
  ], { cwd: REPO, stdio: 'pipe' })
  const packetDir = join(c.dir, 'review-packet')
  buildPacketFor(c, l0Path, packetDir)
  const keyPath = join(packetDir, 'review-packet-key.jsonl')

  // Same COUNTS, different identity: rewrite one census row's seq. The apply
  // must refuse on exact identity — a same-count substitution never passes.
  const tampered = readFileSync(keyPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  for (const k of tampered) if (!k._meta && k.arm === 'census') { k.seq = 999; k.claimKey = `${k.seed}|999|${k.kind}|0`; k.constituentItems = ['ghost-item'] }
  const tamperedPath = join(c.dir, 'tampered-key.jsonl')
  writeJsonl(tamperedPath, tampered)
  const rulings = {
    rater: 'ryan', analysisRunId: c.runId, ...bindTo(tamperedPath),
    positiveRatings: Object.fromEntries(tampered.filter((k) => !k._meta).map((k) => [String(k.item), 'OK'])),
    rules: Object.fromEntries(tampered.filter((k) => !k._meta).map((k) => [String(k.item), '§2.1'])),
    corrections: {}, missedClaims: {}, notes: {},
  }
  const rulingsPath = join(c.dir, 'closure-rulings.json')
  writeFileSync(rulingsPath, JSON.stringify(rulings))
  assert.throws(
    () => applyRulings(c, tamperedPath, rulingsPath, confirmed0, join(c.dir, 'never.jsonl'), l0Path),
    /constituent record|not in this confirmed-input/,
  )
})

test('v3.2.2 rerun-fix: a BAD ruling on an R17-merged proposition withdraws EVERY constituent', () => {
  // Rerun finding 1: charStart-based matching hit one constituent and the
  // false row was rebuilt from the survivor. Constituent-item matching must
  // withdraw them all.
  const c = makeCase({
    sealedItems: [
      {
        item: 3, seed: SEED, seq: 13, seat: 'seat-3', day: 2, kind: 'not_mafia_claim',
        quote: MESSAGES[13].text, charStart: 0, machineDecision: 'accepted',
        machine: { asserted: true, kind: 'not_mafia_claim', fields: {} },
      },
      {
        // A second record of the SAME proposition (R17 merges them).
        item: 4, seed: SEED, seq: 13, seat: 'seat-3', day: 2, kind: 'not_mafia_claim',
        quote: "I'm town", charStart: 0, machineDecision: 'accepted',
        machine: { asserted: true, kind: 'not_mafia_claim', fields: {} },
      },
    ],
    packetRatings: {
      rater: 'ryan', analysisRunId: '', answerKeyOpened: false,
      positiveRatings: { '1': 'OK', '2': 'OK' },
      rules: { '1': '§2.1', '2': '§2.1' },
      corrections: {}, notes: {},
    },
  })
  // patch analysisRunId into ratings now that makeCase computed it
  const ratings = JSON.parse(readFileSync(c.packetRatingsPath, 'utf8'))
  ratings.analysisRunId = c.runId
  writeFileSync(c.packetRatingsPath, JSON.stringify(ratings))
  const rows = mergeRulings(c)
  const confirmed0 = join(c.dir, 'confirmed-input.jsonl')
  writeJsonl(confirmed0, rows)
  const ledgerDir = join(c.dir, 'ledger')
  mkdirSync(ledgerDir)
  const l0Path = join(ledgerDir, 'confirmed.jsonl')
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'build-ledger.mjs'),
    '--confirmed', confirmed0, '--logs', c.logsDir, '--manifest', c.manifestPath,
    '--cohort', 'headline-38', '--drop-out-of-cohort', '--out', l0Path,
  ], { cwd: REPO, stdio: 'pipe' })
  const l0 = readFileSync(l0Path, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const merged = l0.filter((r) => !r._meta && r.seq === 13)
  assert.equal(merged.length, 1, 'R17 merged the two records into one false row')
  assert.deepEqual([...merged[0].mergedItems].sort(), [3, 4], 'and the row names both constituents')

  const packetDir = join(c.dir, 'review-packet')
  const key = buildPacketFor(c, l0Path, packetDir)
  const censusItem = key.filter((k) => !k._meta).find((k) => k.arm === 'census')!
  assert.deepEqual([...censusItem.constituentItems].sort(), [3, 4])
  const keyRows = key.filter((k) => !k._meta)
  const rulings2 = {
    rater: 'ryan', analysisRunId: c.runId, ...bindTo(join(packetDir, 'review-packet-key.jsonl')),
    positiveRatings: Object.fromEntries(keyRows.map((k) => [String(k.item), 'OK'])),
    rules: Object.fromEntries(keyRows.map((k) => [String(k.item), '§2.1'])),
    corrections: {}, missedClaims: {}, notes: {},
  }
  rulings2.positiveRatings[String(censusItem.item)] = 'BAD'
  rulings2.rules[String(censusItem.item)] = '§2 (non-assertion)'
  const rulingsPath = join(c.dir, 'closure-rulings.json')
  writeFileSync(rulingsPath, JSON.stringify(rulings2))
  const confirmed1Path = join(c.dir, 'confirmed-input-1.jsonl')
  const applied = applyRulings(c, join(packetDir, 'review-packet-key.jsonl'), rulingsPath, confirmed0, confirmed1Path, l0Path)
  const withdrawn = applied.filter((r) => !r._meta && r.seq === 13 && r.human?.confirmed === false)
  assert.equal(withdrawn.length, 2, 'BOTH constituents withdrawn — the false row cannot be rebuilt from a survivor')
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'build-ledger.mjs'),
    '--confirmed', confirmed1Path, '--logs', c.logsDir, '--manifest', c.manifestPath,
    '--cohort', 'headline-38', '--drop-out-of-cohort', '--out', l0Path,
  ], { cwd: REPO, stdio: 'pipe' })
  const l1 = readFileSync(l0Path, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(l1.filter((r) => !r._meta && r.seq === 13).length, 0)
  assert.match(gatesOn(c, ledgerDir), /S10\s+PASS/)
})

test('v3.2.2 rerun-fix: a row that BECOMES false on rebuild is never closed by a true-sample stamp (S10 loops)', () => {
  // Rerun finding 3: every applied row was pre-stamped, so a correction that
  // flipped a true row to false satisfied S10 on arrival. verdictAtRuling
  // closes only rows adjudicated AS false.
  const c = makeCase()
  const rows = mergeRulings(c)
  const confirmed0 = join(c.dir, 'confirmed-input.jsonl')
  writeJsonl(confirmed0, rows)
  const ledgerDir = join(c.dir, 'ledger')
  mkdirSync(ledgerDir)
  const l0Path = join(ledgerDir, 'confirmed.jsonl')
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'build-ledger.mjs'),
    '--confirmed', confirmed0, '--logs', c.logsDir, '--manifest', c.manifestPath,
    '--cohort', 'headline-38', '--drop-out-of-cohort', '--out', l0Path,
  ], { cwd: REPO, stdio: 'pipe' })
  const packetDir = join(c.dir, 'review-packet')
  const key = buildPacketFor(c, l0Path, packetDir)
  const keyRows = key.filter((k) => !k._meta)
  // Item 2's TRUE row (seq 12, target Liv after the earlier correction) gets a
  // CORRECTED ruling that retargets it to a seat with no matching check —
  // flipping it false on rebuild.
  const trueItem = keyRows.find((k) => k.arm === 'true-sample' && k.seq === 12)
  const censusItem = keyRows.find((k) => k.arm === 'census')!
  assert.ok(trueItem, 'fixture: the seq-12 true row is in the sample')
  const rulings2 = {
    rater: 'ryan', analysisRunId: c.runId, ...bindTo(join(packetDir, 'review-packet-key.jsonl')),
    positiveRatings: Object.fromEntries(keyRows.map((k) => [String(k.item), 'OK'])),
    rules: Object.fromEntries(keyRows.map((k) => [String(k.item), '§2.1'])),
    corrections: { [String(trueItem!.item)]: { target: 'Sam' } },
    missedClaims: {}, notes: {},
  }
  rulings2.positiveRatings[String(trueItem!.item)] = 'CORRECTED'
  rulings2.rules[String(trueItem!.item)] = 'R12 (target resolution)'
  rulings2.positiveRatings[String(censusItem.item)] = 'BAD'
  rulings2.rules[String(censusItem.item)] = '§2 (non-assertion)'
  const rulingsPath = join(c.dir, 'closure-rulings.json')
  writeFileSync(rulingsPath, JSON.stringify(rulings2))
  const confirmed1Path = join(c.dir, 'confirmed-input-1.jsonl')
  applyRulings(c, join(packetDir, 'review-packet-key.jsonl'), rulingsPath, confirmed0, confirmed1Path, l0Path)
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'build-ledger.mjs'),
    '--confirmed', confirmed1Path, '--logs', c.logsDir, '--manifest', c.manifestPath,
    '--cohort', 'headline-38', '--drop-out-of-cohort', '--out', l0Path,
  ], { cwd: REPO, stdio: 'pipe' })
  const l1 = readFileSync(l0Path, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const flipped = l1.find((r) => !r._meta && r.seq === 12)!
  assert.equal(flipped.verdict, 'false', 'the correction flipped the row to false')
  assert.equal(flipped.reviewRuling.verdictAtRuling, 'true', 'but its stamp was made about a TRUE row')
  const out = gatesOn(c, ledgerDir)
  assert.match(out, /S10\s+PENDING/, 'so the closure loop stays open')
  assert.match(out, /closure incomplete: 1\/1/)

  // --- Second iteration (v3.2.3 items 6 and 7) ---
  // The next packet's census contains ONLY the unruled false row, and a
  // second CORRECTED ruling COMPOSES over the effective prior proposition.
  const packet2Dir = join(c.dir, 'review-packet-2')
  const key2 = buildPacketFor(c, l0Path, packet2Dir, [])
  const census2 = key2.filter((k) => !k._meta && k.arm === 'census')
  assert.equal(census2.length, 1, 'later closure packets take only rows lacking a valid false-row adjudication')
  assert.equal(census2[0].seq, 12)
  const key2Path = join(packet2Dir, 'review-packet-key.jsonl')
  const key2Rows = key2.filter((k) => !k._meta)
  const rulings3: Record<string, any> = {
    rater: 'ryan', analysisRunId: c.runId, ...bindTo(key2Path),
    positiveRatings: Object.fromEntries(key2Rows.map((k) => [String(k.item), 'OK'])),
    rules: Object.fromEntries(key2Rows.map((k) => [String(k.item), '§2.1'])),
    corrections: { [String(census2[0].item)]: { claimedNight: '-' } },
    missedClaims: {}, notes: {},
  }
  rulings3.positiveRatings[String(census2[0].item)] = 'CORRECTED'
  rulings3.rules[String(census2[0].item)] = '§2 (claimedNight only when literally stated)'
  const rulings3Path = join(c.dir, 'closure-rulings-2.json')
  writeFileSync(rulings3Path, JSON.stringify(rulings3))
  const confirmed2Path = join(c.dir, 'confirmed-input-2.jsonl')
  applyRulings(c, key2Path, rulings3Path, confirmed1Path, confirmed2Path, l0Path)
  const applied2 = readFileSync(confirmed2Path, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const composed = applied2.find((r) => !r._meta && r.seq === 12)!
  assert.equal(composed.corrected.target, 'Sam', 'the FIRST correction survives composition')
  assert.equal(composed.corrected.claimedNight, null, 'and the second correction adds its strike')
  // THREE corrections touched this record in its lifetime (the original PF-2
  // adjudication, then two closure sittings) — both priors are preserved.
  assert.deepEqual(composed.corrected.priorRules, ['R12 (target resolution)', 'R12 (target resolution)'], 'every prior rule preserved in the audit trail')
  assert.equal(applied2.find((r) => r._meta)!.appliedPackets.length, 2, 'the closure chain grew by one entry')
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'build-ledger.mjs'),
    '--confirmed', confirmed2Path, '--logs', c.logsDir, '--manifest', c.manifestPath,
    '--cohort', 'headline-38', '--drop-out-of-cohort', '--out', l0Path,
  ], { cwd: REPO, stdio: 'pipe' })
  const l2 = readFileSync(l0Path, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const closed = l2.find((r) => !r._meta && r.seq === 12)!
  assert.equal(closed.reviewRuling.verdictAtRuling, 'false', 'the second sitting adjudicated it AS a false row')
  assert.match(gatesOn(c, ledgerDir), /S10\s+PASS/, 'closure reached')
})

test('v3.2.3 e2e: build-publication assembles, scrubs every surface, and the REAL G5 audits it', () => {
  // The whole chain, no stubs on the assembler or G5: adjudication ->
  // provisional ledger (with projection) -> §8 packet -> rulings + model
  // cross-check -> apply -> final ledger -> validation summary ->
  // build-publication (real semantic gates, strict) -> real check-gates G5.
  const c = makeCase()
  const rows = mergeRulings(c)
  const confirmed0 = join(c.dir, 'confirmed-input.jsonl')
  writeJsonl(confirmed0, rows)
  // Synthetic archived readings so the §4 projection can RUN (S7).
  const extractDir = join(c.dir, 'extract')
  mkdirSync(extractDir)
  writeJsonl(join(extractDir, `${SEED}.claims.jsonl`), [
    { _meta: true, seed: SEED },
    ...rows.filter((r: any) => !r._meta && r.machine).map((r: any) => ({
      seed: r.seed, seq: r.seq, kind: r.kind, seat: r.seat,
      role: r.role, target: r.target, result: r.result, claimedNight: r.claimedNight,
      quote: r.quote, machine: r.machine,
    })),
  ])
  const ledgerDir = join(c.dir, 'ledger')
  mkdirSync(ledgerDir)
  const l0Path = join(ledgerDir, 'confirmed.jsonl')
  const buildLedgerAt = (confirmedPath: string) => execFileSync(process.execPath, [
    join(REPO, 'scripts', 'build-ledger.mjs'),
    '--confirmed', confirmedPath, '--logs', c.logsDir, '--manifest', c.manifestPath,
    '--cohort', 'headline-38', '--drop-out-of-cohort',
    '--extract', extractDir, '--require-projection', '--out', l0Path,
  ], { cwd: REPO, stdio: 'pipe' })
  buildLedgerAt(confirmed0)

  // v3.2.4: the provisional ledger must survive the rebuild — the unblind
  // step and build-publication both verify against its exact bytes. It lives
  // OUTSIDE ledgerDir so gate S10 audits only the rebuilt ledger.
  const provisionalPath = join(c.dir, 'confirmed-provisional.jsonl')
  writeFileSync(provisionalPath, readFileSync(l0Path))

  const packetDir = join(c.dir, 'review-packet')
  const key = buildPacketFor(c, provisionalPath, packetDir)
  const keyRows = key.filter((k) => !k._meta)
  const keyPath = join(packetDir, 'review-packet-key.jsonl')
  const censusItem = keyRows.find((k) => k.arm === 'census')!
  const rulings: Record<string, any> = {
    rater: 'ryan', analysisRunId: c.runId, ...bindTo(keyPath),
    positiveRatings: Object.fromEntries(keyRows.map((k) => [String(k.item), 'OK'])),
    rules: Object.fromEntries(keyRows.map((k) => [String(k.item), '§2.1'])),
    corrections: {}, missedClaims: {}, notes: {},
  }
  rulings.positiveRatings[String(censusItem.item)] = 'BAD'
  rulings.rules[String(censusItem.item)] = '§2 (non-assertion)'
  // Complete scan coverage in BOTH files: an empty array is an explicit
  // "no missed claims here".
  for (const k of keyRows.filter((k) => k.arm === 'message-scan')) rulings.missedClaims[String(k.item)] = []
  const rulingsPath = join(c.dir, 'rulings.json')
  writeFileSync(rulingsPath, JSON.stringify(rulings))
  // Complete, method-identified model cross-check that fully agrees.
  const model = {
    ...rulings, rater: 'model-x',
    method: { model: 'model-x-2026', promptSha256: 'ab'.repeat(32), settings: { temperature: 0 } },
  }
  const modelPath = join(c.dir, 'model-rulings.json')
  writeFileSync(modelPath, JSON.stringify(model))

  const confirmed1 = join(c.dir, 'confirmed-input-1.jsonl')
  applyRulings(c, keyPath, rulingsPath, confirmed0, confirmed1, provisionalPath)
  buildLedgerAt(confirmed1)

  // The §8 validation summary (final-based), with the cross-check. v3.2.4:
  // the unblind verifies and consumes the provisional ledger.
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'build-review-packet.mjs'), '--unblind',
    '--key', keyPath, '--rulings', rulingsPath, '--model-rulings', modelPath,
    '--ledger', provisionalPath,
    '--out', packetDir,
  ], { cwd: REPO, stdio: 'pipe' })
  const validationPath = join(packetDir, 'review-packet-merged.json')

  // Assembler inputs.
  const runStamp = (r: Record<string, unknown>) => ({ ...r, analysisRunId: c.runId })
  const oppPath = join(c.dir, 'table.jsonl')
  writeJsonl(oppPath, [
    { _meta: true, analysisRunId: c.runId, generator: 'opportunity-table' },
    runStamp({ seed: SEED, seq: 40, kind: 'day_vote', role: 'villager', chanceUniformOverLegalTargets: 0.25, chanceUniformOverLivingNonSelf: 1 / 3 }),
  ])
  const ledgerClaimsForStats = readFileSync(l0Path, 'utf8').trim().split('\n')
    .map((line) => JSON.parse(line)).filter((row) => !row._meta)
  const propositionFacts = gameFacts(readFileSync(join(c.logsDir, `${SEED}.jsonl`), 'utf8').trim().split('\n').map((line) => JSON.parse(line)))
  const claimPropositions = aggregateClaimPropositions(ledgerClaimsForStats, {
    resolveTarget: (claim: any) => resolveEffectiveClaimTarget(claim, propositionFacts),
  })
  const familyCells = (source: any[]) => Object.fromEntries(
    ['investigation_claim', 'not_mafia_claim', 'protection_claim', 'role_claim'].map((kind) => {
      const familyRows = source.filter((row) => row.kind === kind)
      const falseClass = familyRows.filter((row) => row.verdict === 'false' && row.falseClass)
        .reduce((acc, row) => ({ ...acc, [row.falseClass]: (acc[row.falseClass] ?? 0) + 1 }), {} as Record<string, number>)
      return [kind, {
        n: familyRows.length,
        true: familyRows.filter((row) => row.verdict === 'true').length,
        false: familyRows.filter((row) => row.verdict === 'false').length,
        ambiguous: familyRows.filter((row) => row.verdict === 'ambiguous').length,
        falseClass,
      }]
    }),
  )
  const statsPath = join(c.dir, 'stats.json')
  writeFileSync(statsPath, JSON.stringify(runStamp({
    evaluatorVersion: EVALUATOR_VERSION,
    definitions: {
      reportStratum: 'before any public verified investigation result',
      reportStratumResultTypes: ['mafia', 'not mafia'],
      vacuity: { checked: 3, violations: 0 },
      semanticUnits: {
        primary: 'truth-resolved underlying claim proposition count range',
        secondary: 'public claim utterance receipt',
        mappingVersion: claimPropositions.version,
      },
    },
    claimPropositions,
    ledgerResolvedPropositionCountRange: claimPropositions.countRanges.resolved,
    ledgerAmbiguousPropositionCountRange: claimPropositions.countRanges.ambiguous,
    ledgerClaimReceipts: claimPropositions.receiptCount,
    models: [runStamp({
      model: 'model-0',
      strata: { beforeAnyPublicVerifiedInvestigationResult: { hits: 1 } },
      ledgerFamilies: claimPropositions.countRanges.byKind,
      ledgerReceiptFamilies: familyCells(ledgerClaimsForStats),
    })],
    nightAggregate: { detectiveFirstTimeTargets: { count: 1, n: 1 } },
    reliability: { cohort: 'scheduled-40', perModel: [] },
  })))
  const [wl, wh] = wilson(1, 100)
  const agreementPath = join(c.dir, 'agreement.json')
  writeFileSync(agreementPath, JSON.stringify(runStamp({
    negatives: { perRater: [{ rater: 'ryan', ratedItems: 100, itemsWithMiss: 1, missRate: 0.01, wilson95: [wl, wh], publishedFamilies: { itemsWithMiss: 1, missRate: 0.01, wilson95: [wl, wh] }, fullCodebook: { itemsWithMiss: 2, missRate: 0.02, wilson95: wilson(2, 100) } }] },
  })))
  const sensitivityPath = join(c.dir, 'sensitivity.json')
  writeFileSync(sensitivityPath, JSON.stringify(runStamp({ reversals: [] })))
  const pf2Path = join(c.dir, 'pf2.json')
  const confirmedInputSha256 = createHash('sha256').update(readFileSync(confirmed1)).digest('hex')
  writeFileSync(pf2Path, JSON.stringify(runStamp({
    provenance: { inputs: { confirmedInputSha256 } },
    humanPacket: { audit: { confirmationRate: 0.98, confirmedAsWritten: 49, n: 50 } },
  })))
  const stubGates = join(c.dir, 'stub-gates.mjs')
  const forwardedGateArgsPath = join(c.dir, 'forwarded-gate-args.json')
  writeFileSync(stubGates,
    `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(forwardedGateArgsPath)}, JSON.stringify(process.argv.slice(2)))\n`)
  const tripwireReportPath = join(c.dir, 'tripwire-report.json')
  const pubPath = join(c.dir, 'publication.json')

  const r = spawnSyncNode(process.execPath, [
    join(REPO, 'scripts', 'build-publication.mjs'),
    '--manifest', c.manifestPath, '--opportunity', oppPath, '--stats', statsPath,
    '--ledger', l0Path, '--agreement', agreementPath, '--sensitivity', sensitivityPath,
    '--validation', validationPath, '--provisional-ledger', provisionalPath,
    '--pf2', pf2Path, '--amendment', join(REPO, 'docs', 'analysis', 'analysis-v3.2-amendment.md'),
    '--extract', extractDir, '--logs', c.logsDir,
    '--tripwire-report', tripwireReportPath,
    '--gates', stubGates, '--out', pubPath,
  ], { cwd: REPO, encoding: 'utf8' })
  assert.equal(r.status, 0, `build-publication + strict semantic gates: ${r.stdout}${r.stderr}`)
  const forwardedGateArgs = JSON.parse(readFileSync(forwardedGateArgsPath, 'utf8'))
  const forwardedValue = (flag: string) => forwardedGateArgs[forwardedGateArgs.indexOf(flag) + 1]
  assert.equal(forwardedValue('--outdir'), resolve(c.dir), 'publication gates audit this manifest run directory, not a stale default')
  assert.equal(forwardedValue('--cleanroom'), resolve(c.dir, 'cleanroom.json'), 'publication gates receive this run clean-room attestation')
  assert.equal(forwardedValue('--tripwire-report'), resolve(tripwireReportPath), 'publication gates receive this manifest run tripwire report')
  const publication = JSON.parse(readFileSync(pubPath, 'utf8'))
  assert.equal(publication.artifactBindings.agreementSha256,
    createHash('sha256').update(readFileSync(agreementPath)).digest('hex'))
  assert.equal(publication.artifactBindings.sensitivitySha256,
    createHash('sha256').update(readFileSync(sensitivityPath)).digest('hex'))
  assert.equal(publication.artifactBindings.pf2Sha256,
    createHash('sha256').update(readFileSync(pf2Path)).digest('hex'))

  const stalePf2Path = join(c.dir, 'pf2-stale-confirmed-input.json')
  const stalePf2 = JSON.parse(readFileSync(pf2Path, 'utf8'))
  stalePf2.provenance.inputs.confirmedInputSha256 = 'f'.repeat(64)
  writeFileSync(stalePf2Path, JSON.stringify(stalePf2))
  const stalePf2Build = spawnSyncNode(process.execPath, [
    join(REPO, 'scripts', 'build-publication.mjs'),
    '--manifest', c.manifestPath, '--opportunity', oppPath, '--stats', statsPath,
    '--ledger', l0Path, '--agreement', agreementPath, '--sensitivity', sensitivityPath,
    '--validation', validationPath, '--provisional-ledger', provisionalPath,
    '--pf2', stalePf2Path, '--amendment', join(REPO, 'docs', 'analysis', 'analysis-v3.2-amendment.md'),
    '--extract', extractDir, '--logs', c.logsDir,
    '--gates', stubGates, '--out', join(c.dir, 'publication-stale-pf2.json'),
  ], { cwd: REPO, encoding: 'utf8' })
  assert.equal(stalePf2Build.status, 1)
  assert.match(`${stalePf2Build.stdout}${stalePf2Build.stderr}`, /confirmed-input hash does not match the ledger/)

  // Item 8: the ASSEMBLED publication object — the omitted family (not_mafia,
  // census n=1 < floor) appears on NO surface, ballotAccuracy included.
  const omitted = publication.sections.falseStatementLedger.omittedFamilies.map((o: any) => o.family)
  assert.deepEqual(omitted, ['not_mafia_claim'])
  const leaks = familyLeaks(publication, 'not_mafia_claim').filter((p: string) =>
    !p.includes('omittedFamilies') && !p.includes('honesty.validation') && !p.includes('closureChain'))
  assert.deepEqual(leaks, [], `omitted family leaked at: ${leaks.join(', ')}`)
  assert.equal('not_mafia_claim' in (publication.sections.ballotAccuracy[0]?.ledgerFamilies ?? {}), false, 'ballotAccuracy is hoisted from the scrubbed object')

  // Item 1: the REAL G5 over the assembled publication.
  const boundStatsDir = join(c.dir, 'stats')
  mkdirSync(boundStatsDir, { recursive: true })
  for (const [source, name] of ([
    [agreementPath, 'agreement.json'],
    [sensitivityPath, 'sensitivity.json'],
    [pf2Path, 'pf2-validation.json'],
  ] as Array<[string, string]>)) writeFileSync(join(boundStatsDir, name), readFileSync(source))
  const gates = spawnSyncNode(process.execPath, [
    join(REPO, 'scripts', 'check-gates.mjs'),
    '--publication', pubPath, '--manifest', c.manifestPath,
    '--agreement', agreementPath, '--ledger', ledgerDir, '--extract', extractDir,
    '--logs', c.logsDir, '--outdir', c.dir,
  ], { cwd: REPO, encoding: 'utf8' })
  const out = `${gates.stdout}${gates.stderr}`
  assert.match(out, /G5\s+PASS/, out)
  assert.match(out, /G13\s+PASS/, out)
  assert.match(out, /G14\s+PASS/, out)

  const tamperedPf2View = JSON.parse(readFileSync(pubPath, 'utf8'))
  tamperedPf2View.sections.pf2.humanPacket.audit.confirmationRate = 0.5
  const tamperedPf2ViewPath = join(c.dir, 'tampered-pf2-view.json')
  writeFileSync(tamperedPf2ViewPath, JSON.stringify(tamperedPf2View, null, 2))
  const boundGate = spawnSyncNode(process.execPath, [
    join(REPO, 'scripts', 'check-gates.mjs'),
    '--publication', tamperedPf2ViewPath, '--manifest', c.manifestPath,
    '--agreement', agreementPath, '--ledger', ledgerDir, '--extract', extractDir,
    '--logs', c.logsDir, '--outdir', c.dir,
  ], { cwd: REPO, encoding: 'utf8' })
  assert.match(`${boundGate.stdout}${boundGate.stderr}`, /G14\s+FAIL[\s\S]*PF-2 block differs/)

  const tamperedSensitivityView = JSON.parse(readFileSync(pubPath, 'utf8'))
  tamperedSensitivityView.sensitivity.reversals = [{ comparison: 'invented', range: [0, 1] }]
  const tamperedSensitivityViewPath = join(c.dir, 'tampered-sensitivity-view.json')
  writeFileSync(tamperedSensitivityViewPath, JSON.stringify(tamperedSensitivityView, null, 2))
  const sensitivityGate = spawnSyncNode(process.execPath, [
    join(REPO, 'scripts', 'check-gates.mjs'),
    '--publication', tamperedSensitivityViewPath, '--manifest', c.manifestPath,
    '--agreement', agreementPath, '--ledger', ledgerDir, '--extract', extractDir,
    '--logs', c.logsDir, '--outdir', c.dir,
  ], { cwd: REPO, encoding: 'utf8' })
  assert.match(`${sensitivityGate.stdout}${sensitivityGate.stderr}`, /G14\s+FAIL[\s\S]*sensitivity\.reversals differs/)

  // And the negative arm: a publication whose omitted family sneaks back into
  // totals.byKind must FAIL the real G5.
  const tampered = JSON.parse(readFileSync(pubPath, 'utf8'))
  tampered.sections.falseStatementLedger.totals.byKind.not_mafia_claim = { true: 0, false: 1, ambiguous: 0 }
  const tamperedPath2 = join(c.dir, 'tampered-publication.json')
  writeFileSync(tamperedPath2, JSON.stringify(tampered, null, 2))
  const gates2 = spawnSyncNode(process.execPath, [
    join(REPO, 'scripts', 'check-gates.mjs'),
    '--publication', tamperedPath2, '--manifest', c.manifestPath,
    '--agreement', agreementPath, '--ledger', ledgerDir, '--extract', extractDir,
    '--logs', c.logsDir,
  ], { cwd: REPO, encoding: 'utf8' })
  assert.match(`${gates2.stdout}${gates2.stderr}`, /G5\s+FAIL[\s\S]*omitted at the §8 gate yet still present in totals\.byKind/)

  // A post-build edit cannot inflate or alter the proposition mapping: G13
  // independently recomputes it from the published receipts and source logs.
  const tamperedUnits = JSON.parse(readFileSync(pubPath, 'utf8'))
  tamperedUnits.sections.falseStatementLedger.upperBoundPropositionCandidates[0].mentionCount += 1
  const tamperedUnitsPath = join(c.dir, 'tampered-claim-units.json')
  writeFileSync(tamperedUnitsPath, JSON.stringify(tamperedUnits, null, 2))
  const unitGates = spawnSyncNode(process.execPath, [
    join(REPO, 'scripts', 'check-gates.mjs'),
    '--publication', tamperedUnitsPath, '--manifest', c.manifestPath,
    '--agreement', agreementPath, '--ledger', ledgerDir, '--extract', extractDir,
    '--logs', c.logsDir,
  ], { cwd: REPO, encoding: 'utf8' })
  assert.match(`${unitGates.stdout}${unitGates.stderr}`, /G13\s+FAIL[\s\S]*upper-bound proposition candidates do not equal/)

  // --- v3.2.4 regression: crossCheck and unaidedFirstPass SURVIVE publication,
  // with the model artifact hash-bound.
  const val = publication.honesty.validation
  assert.equal(val.crossCheck.method.model, 'model-x-2026', 'the cross-check rides the publication')
  assert.ok(Array.isArray(val.crossCheck.resolutions), 'disagreement resolutions ride the publication')
  assert.ok(val.unaidedFirstPass, 'the unaided-author metric rides the publication')
  assert.equal(val.modelRulingsSha256,
    createHash('sha256').update(readFileSync(modelPath)).digest('hex'),
    'the model cross-check artifact is hash-bound to the exact file')
  assert.equal(val.messageScan.statistic, 'message-level omission incidence')

  // --- v3.2.4 regression: zero or malformed §8 evidence FAILS the real G5.
  const runG5 = (pub: any) => {
    const p = join(c.dir, `g5-${Math.random().toString(36).slice(2)}.json`)
    writeFileSync(p, JSON.stringify(pub, null, 2))
    const g = spawnSyncNode(process.execPath, [
      join(REPO, 'scripts', 'check-gates.mjs'),
      '--publication', p, '--manifest', c.manifestPath,
      '--agreement', agreementPath, '--ledger', ledgerDir, '--extract', extractDir,
      '--logs', c.logsDir,
    ], { cwd: REPO, encoding: 'utf8' })
    return `${g.stdout}${g.stderr}`
  }
  const zeroScan = JSON.parse(readFileSync(pubPath, 'utf8'))
  zeroScan.honesty.validation.messageScan = { ...zeroScan.honesty.validation.messageScan, n: 0, itemsWithMiss: 0, missRate: 0 }
  assert.match(runG5(zeroScan), /G5\s+FAIL[\s\S]*message-scan evidence missing or malformed/)
  const noCross = JSON.parse(readFileSync(pubPath, 'utf8'))
  delete noCross.honesty.validation.crossCheck
  assert.match(runG5(noCross), /G5\s+FAIL[\s\S]*cross-check evidence not embedded/)
  const mislabeled = JSON.parse(readFileSync(pubPath, 'utf8'))
  mislabeled.honesty.validation.messageScan.statistic = 'recall'
  assert.match(runG5(mislabeled), /G5\s+FAIL[\s\S]*message-level omission incidence/)
  const countless = JSON.parse(readFileSync(pubPath, 'utf8'))
  countless.honesty.validation.census.claimKeys = []
  assert.match(runG5(countless), /G5\s+FAIL[\s\S]*countless census/)
  const noUnaided = JSON.parse(readFileSync(pubPath, 'utf8'))
  delete noUnaided.honesty.validation.unaidedFirstPass
  assert.match(runG5(noUnaided), /G5\s+FAIL[\s\S]*unaided first-pass/)
  const extraOmission = JSON.parse(readFileSync(pubPath, 'utf8'))
  extraOmission.sections.falseStatementLedger.omittedFamilies.push({ family: 'role_claim' })
  assert.match(runG5(extraOmission), /G5\s+FAIL[\s\S]*does not derive a required omission/)

  // Paper-v1 stop decision: the completed PF-2 sitting may publish under an
  // explicit exploratory scope without pretending the deferred §8 protocol
  // ran. This invokes the real strict semantic gates and deliberately omits
  // --validation/--provisional-ledger.
  const exploratoryPath = join(c.dir, 'publication-exploratory.json')
  const exploratoryBuild = spawnSyncNode(process.execPath, [
    join(REPO, 'scripts', 'build-publication.mjs'),
    '--manifest', c.manifestPath, '--opportunity', oppPath, '--stats', statsPath,
    '--ledger', l0Path, '--agreement', agreementPath, '--sensitivity', sensitivityPath,
    '--exploratory-v1', '--pf2', pf2Path,
    '--amendment', join(REPO, 'docs', 'analysis', 'analysis-v3.2-amendment.md'),
    '--extract', extractDir, '--logs', c.logsDir,
    '--gates', stubGates, '--out', exploratoryPath,
  ], { cwd: REPO, encoding: 'utf8' })
  assert.equal(exploratoryBuild.status, 0, `${exploratoryBuild.stdout}${exploratoryBuild.stderr}`)
  assert.match(`${exploratoryBuild.stdout}${exploratoryBuild.stderr}`, /S5\s+PASS/)
  assert.match(`${exploratoryBuild.stdout}${exploratoryBuild.stderr}`, /S10\s+PASS/)
  const exploratoryPublication = JSON.parse(readFileSync(exploratoryPath, 'utf8'))
  assert.equal(exploratoryPublication.honesty.mode, 'exploratory-v1')
  assert.equal(exploratoryPublication.honesty.validation, undefined)
  assert.equal(exploratoryPublication.sections.humanValidation, undefined,
    'exploratory v1 cannot leak the diagnostic negative-sample rates through the agreement payload')
  assert.equal(exploratoryPublication.negativeSample, undefined)
  assert.equal(exploratoryPublication.targetedCandidateScan.messagesScreened, 100)
  assert.equal(exploratoryPublication.targetedCandidateScan.publishedFamilyCandidateMessages, 1)
  assert.deepEqual(exploratoryPublication.sections.falseStatementLedger.omittedFamilies, [])

  // --- v3.2.4 regression: an empty (or missing) later census cannot publish.
  // Extend the ledger's closure chain by one fake iteration and re-run the
  // assembler: no summary supplied → refused; an empty-census summary → refused.
  const ledgerLines = readFileSync(l0Path, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const lMeta = ledgerLines.find((r: any) => r._meta)
  const fakeEntry = {
    packetKeySha256: 'f'.repeat(64), rulingsSha256: 'e'.repeat(64),
    provisionalLedgerSha256: 'd'.repeat(64), confirmedInputSha256: 'c'.repeat(64), packetSeed: 'closure-2',
  }
  const extendedPath = join(ledgerDir, 'confirmed.jsonl')
  const restore = readFileSync(l0Path)
  writeJsonl(extendedPath, [{ ...lMeta, closureChain: [...lMeta.closureChain, fakeEntry] }, ...ledgerLines.filter((r: any) => !r._meta)])
  const rerunPub = (extra: string[]) => spawnSyncNode(process.execPath, [
    join(REPO, 'scripts', 'build-publication.mjs'),
    '--manifest', c.manifestPath, '--opportunity', oppPath, '--stats', statsPath,
    '--ledger', extendedPath, '--agreement', agreementPath, '--sensitivity', sensitivityPath,
    '--validation', validationPath, '--provisional-ledger', provisionalPath,
    '--pf2', pf2Path, '--amendment', join(REPO, 'docs', 'analysis', 'analysis-v3.2-amendment.md'),
    '--extract', extractDir, '--logs', c.logsDir,
    '--gates', stubGates, '--out', join(c.dir, 'pub-closure.json'), ...extra,
  ], { cwd: REPO, encoding: 'utf8' })
  const missing = rerunPub([])
  assert.equal(missing.status, 1)
  assert.match(`${missing.stdout}${missing.stderr}`, /every iteration after the first publishes its evidence/)
  const emptySummaryPath = join(c.dir, 'closure-empty.json')
  writeFileSync(emptySummaryPath, JSON.stringify({
    packetKeySha256: fakeEntry.packetKeySha256, rulingsSha256: fakeEntry.rulingsSha256,
    items: 0, census: { n: 0, claimKeys: [] },
  }))
  const empty = rerunPub(['--closure-validations', emptySummaryPath])
  assert.equal(empty.status, 1)
  assert.match(`${empty.stdout}${empty.stderr}`, /empty census would never have been sat/)
  writeFileSync(extendedPath, restore)

  // --- v3.2.4 regression: a later packet must never SUBSTITUTE for the
  // initial census — a validation summary matching a non-initial chain entry
  // is refused by position.
  const swapped = readFileSync(l0Path, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const sMeta = swapped.find((r: any) => r._meta)
  writeJsonl(extendedPath, [{ ...sMeta, closureChain: [fakeEntry, ...sMeta.closureChain] }, ...swapped.filter((r: any) => !r._meta)])
  const substituted = rerunPub(['--closure-validations', emptySummaryPath])
  assert.equal(substituted.status, 1)
  assert.match(`${substituted.stdout}${substituted.stderr}`, /not the INITIAL packet/)
  writeFileSync(extendedPath, restore)
})

test('v3.2.3 surgical: an exact duplicate recovery is skipped, a distinct same-kind claim is retained', () => {
  const c = makeCase()
  const rows = mergeRulings(c)
  const confirmed0 = join(c.dir, 'confirmed-input.jsonl')
  writeJsonl(confirmed0, rows)
  const ledgerDir = join(c.dir, 'ledger')
  mkdirSync(ledgerDir)
  const l0Path = join(ledgerDir, 'confirmed.jsonl')
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'build-ledger.mjs'),
    '--confirmed', confirmed0, '--logs', c.logsDir, '--manifest', c.manifestPath,
    '--cohort', 'headline-38', '--drop-out-of-cohort', '--out', l0Path,
  ], { cwd: REPO, stdio: 'pipe' })
  // A hand-built key with one message-scan item on seq 12 — a message that
  // ALREADY hosts a confirmed record (raw target Josie). One rater-listed
  // claim duplicates it exactly; the other is a genuinely different
  // same-kind claim in the same message.
  const keyPath = join(c.dir, 'scan-key.jsonl')
  writeJsonl(keyPath, [
    {
      _meta: true, mode: 'review-packet', version: REVIEW_PACKET_VERSION, seed: 'scan-1',
      analysisRunId: c.runId,
      ledgerSha256: createHash('sha256').update(readFileSync(l0Path)).digest('hex'),
    },
    { item: 1, arm: 'message-scan', seed: SEED, seq: 12, day: 2, kind: null, verdict: null },
  ])
  const fullMsg = MESSAGES[12].text
  const rulings2 = {
    rater: 'ryan', analysisRunId: c.runId, packetSeed: 'scan-1', packetVersion: REVIEW_PACKET_VERSION,
    packetKeySha256: createHash('sha256').update(readFileSync(keyPath)).digest('hex'),
    positiveRatings: { '1': 'OK' }, rules: { '1': 'R9' },
    corrections: {}, notes: {},
    missedClaims: { '1': [
      // Exact duplicate of the existing record: same kind, fields, and span.
      { kind: 'investigation_claim', target: 'Josie', result: 'not mafia', claimedNight: 2, quote: fullMsg },
      // Distinct same-kind claim in the SAME message (different target+span).
      { kind: 'investigation_claim', target: 'Bryan', result: 'not mafia', claimedNight: 2, quote: 'me and Bryan (N2 clear)' },
    ] },
  }
  const rulingsPath = join(c.dir, 'scan-rulings.json')
  writeFileSync(rulingsPath, JSON.stringify(rulings2))
  const outPath = join(c.dir, 'confirmed-scan.jsonl')
  applyRulings(c, keyPath, rulingsPath, confirmed0, outPath, l0Path)
  const applied = readFileSync(outPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const recovered = applied.filter((r) => !r._meta && r.sources?.includes('review-packet-scan'))
  assert.equal(recovered.length, 1, 'the exact duplicate is skipped; the distinct claim is retained')
  assert.equal(recovered[0].target, 'Bryan', 'and it is the DISTINCT one — seed+seq+kind was too broad (v3.2.3)')
  const meta = applied.find((r) => r._meta)!
  assert.equal(meta.reviewApplied['scan-1'].duplicateRecovered, 1, 'the skip is counted, never silent')
})

test('v3.2.3 surgical: lineage fails CLOSED — missing hashes are rejected like mismatches', () => {
  const c = makeCase()
  const rows = mergeRulings(c)
  const confirmed0 = join(c.dir, 'confirmed-input.jsonl')
  writeJsonl(confirmed0, rows)
  const ledgerDir = join(c.dir, 'ledger')
  mkdirSync(ledgerDir)
  const l0Path = join(ledgerDir, 'confirmed.jsonl')
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'build-ledger.mjs'),
    '--confirmed', confirmed0, '--logs', c.logsDir, '--manifest', c.manifestPath,
    '--cohort', 'headline-38', '--drop-out-of-cohort', '--out', l0Path,
  ], { cwd: REPO, stdio: 'pipe' })
  const packetDir = join(c.dir, 'review-packet')
  const key = buildPacketFor(c, l0Path, packetDir)
  const keyPath = join(packetDir, 'review-packet-key.jsonl')
  const keyRows = key.filter((k) => !k._meta)
  const mkRulings = (bindPath: string) => {
    const r = {
      rater: 'ryan', analysisRunId: c.runId, ...bindTo(bindPath),
      positiveRatings: Object.fromEntries(keyRows.map((k) => [String(k.item), 'OK'])),
      rules: Object.fromEntries(keyRows.map((k) => [String(k.item), '§2.1'])),
      corrections: {}, missedClaims: {}, notes: {},
    }
    const p = join(c.dir, `rulings-${Math.abs(bindPath.length)}.json`)
    writeFileSync(p, JSON.stringify(r))
    return p
  }

  // (a) A packet key with NO ledgerSha256: refused outright.
  const unpinned = key.map((k) => (k._meta ? { ...k, ledgerSha256: undefined } : k))
  const unpinnedPath = join(c.dir, 'unpinned-key.jsonl')
  writeJsonl(unpinnedPath, unpinned)
  assert.throws(
    () => applyRulings(c, unpinnedPath, mkRulings(unpinnedPath), confirmed0, join(c.dir, 'never1.jsonl'), l0Path),
    /carries no ledgerSha256/,
  )

  // (b) A provisional ledger with NO confirmedInputSha256: refused outright.
  const stripped = readFileSync(l0Path, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    .map((r) => (r._meta ? { ...r, confirmedInputSha256: undefined } : r))
  const strippedPath = join(c.dir, 'stripped-ledger.jsonl')
  writeJsonl(strippedPath, stripped)
  const packet2Dir = join(c.dir, 'review-packet-2')
  buildPacketFor(c, strippedPath, packet2Dir)
  const key2Path = join(packet2Dir, 'review-packet-key.jsonl')
  assert.throws(
    () => applyRulings(c, key2Path, mkRulings(key2Path), confirmed0, join(c.dir, 'never2.jsonl'), strippedPath),
    /records no confirmedInputSha256/,
  )

  // (c) A SIBLING confirmed input (same shape, different bytes): sha mismatch.
  const sibling = [...rows.map((r) => ({ ...r }))]
  const siblingPath = join(c.dir, 'sibling-confirmed.jsonl')
  writeJsonl(siblingPath, [...sibling, { item: 'extra', seed: SEED, seq: 14, seat: 'seat-2', day: 2, kind: 'not_mafia_claim', quote: 'Bryan is quiet today.', analysisRunId: c.runId, human: { rater: 'ryan', confirmed: false } }])
  assert.throws(
    () => applyRulings(c, keyPath, mkRulings(keyPath), siblingPath, join(c.dir, 'never3.jsonl'), l0Path),
    /not the file the provisional ledger was built from/,
  )
})

// --- v3.2.4 regressions -----------------------------------------------------

test('v3.2.4: PF-2 packet substitution, reordering, partial or padded ratings are refused', () => {
  // Substituted key: same row count, different bytes — sha mismatch, refused
  // before a single ruling is read.
  const c = makeCase()
  const keyLines = readFileSync(c.packetKeyPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  writeJsonl(c.packetKeyPath, keyLines.map((r: any) => (r.packetItem === 2 ? { ...r, seq: r.seq + 1 } : r)))
  assert.throws(() => mergeRulings(c), /packetKeySha256 does not match the packet key on disk/)

  // Reordered rows: refused on position even when the ratings re-pin the
  // reordered file's hash.
  const c2 = makeCase()
  const lines2 = readFileSync(c2.packetKeyPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  writeJsonl(c2.packetKeyPath, [lines2.find((r: any) => r._meta), ...lines2.filter((r: any) => !r._meta).reverse()])
  const ratings2 = JSON.parse(readFileSync(c2.packetRatingsPath, 'utf8'))
  ratings2.packetKeySha256 = createHash('sha256').update(readFileSync(c2.packetKeyPath)).digest('hex')
  writeFileSync(c2.packetRatingsPath, JSON.stringify(ratings2))
  assert.throws(() => mergeRulings(c2), /reordered or incomplete/)

  // Partial sitting: an unruled packet item refuses the merge.
  const c3 = makeCase()
  const ratings3 = JSON.parse(readFileSync(c3.packetRatingsPath, 'utf8'))
  delete ratings3.positiveRatings['2']
  writeFileSync(c3.packetRatingsPath, JSON.stringify(ratings3))
  assert.throws(() => mergeRulings(c3), /unruled .* a partial sitting cannot merge/)

  // Padded ratings: a ruling for an item not in this packet names the file
  // as wrong or edited.
  const c4 = makeCase()
  const ratings4 = JSON.parse(readFileSync(c4.packetRatingsPath, 'utf8'))
  ratings4.positiveRatings['99'] = 'OK'
  writeFileSync(c4.packetRatingsPath, JSON.stringify(ratings4))
  assert.throws(() => mergeRulings(c4), /unknown item/)

  // Missing binding metadata is rejected like a mismatch.
  const c5 = makeCase()
  const ratings5 = JSON.parse(readFileSync(c5.packetRatingsPath, 'utf8'))
  delete ratings5.packetVersion
  writeFileSync(c5.packetRatingsPath, JSON.stringify(ratings5))
  assert.throws(() => mergeRulings(c5), /missing packetVersion/)
})

test('v3.2.4: a scan frame from the wrong or unstated cohort is refused', () => {
  const c = makeCase()
  const rows = mergeRulings(c)
  const confirmed0 = join(c.dir, 'confirmed-input.jsonl')
  writeJsonl(confirmed0, rows)
  const l0 = join(c.dir, 'L0.jsonl')
  execFileSync(process.execPath, [
    join(REPO, 'scripts', 'build-ledger.mjs'),
    '--confirmed', confirmed0, '--logs', c.logsDir, '--manifest', c.manifestPath,
    '--cohort', 'headline-38', '--drop-out-of-cohort', '--out', l0,
  ], { cwd: REPO, stdio: 'pipe' })
  const lines = readFileSync(l0, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const meta = lines.find((r: any) => r._meta)
  const body = lines.filter((r: any) => !r._meta)

  // A cohort game the manifest never inventoried: refused.
  const foreign = join(c.dir, 'L0-foreign.jsonl')
  writeJsonl(foreign, [{ ...meta, seeds: [...meta.seeds, 'sweep1-999'] }, ...body])
  assert.throws(() => buildPacketFor(c, foreign, join(c.dir, 'rp-foreign')), /not in the manifest/)

  // No cohort/seeds at all: an uncohorted scan frame is refused.
  const bare = join(c.dir, 'L0-bare.jsonl')
  const { cohort: _c, seeds: _s, ...bareMeta } = meta
  writeJsonl(bare, [bareMeta, ...body])
  assert.throws(() => buildPacketFor(c, bare, join(c.dir, 'rp-bare')), /no cohort\/seeds/)
})

test('v3.2.6: omitting a family removes proposition and receipt surfaces', () => {
  const stats = {
    models: [{
      model: 'm',
      strata: { beforeAnyPublicVerifiedInvestigationResult: { hits: 1 } },
      ledgerFamilies: { investigation_claim: { n: 1 }, role_claim: { n: 2 } },
      ledgerReceiptFamilies: { investigation_claim: { n: 2 }, role_claim: { n: 3 } },
    }],
    ledgerConfirmedClaims: 3,
    ledgerResolvedPropositionCountRange: { lower: 2, upper: 3 },
    ledgerAmbiguousPropositionCountRange: { lower: 0, upper: 1 },
    ledgerClaimReceipts: 5,
    claimPropositions: { rows: [{ kind: 'investigation_claim' }, { kind: 'role_claim' }] },
  }
  const out = scrubOmittedFamilies(stats, ['investigation_claim'])
  assert.equal(out.models[0].strata, undefined, 'strata are conditioned on investigation reports — they go with the family')
  assert.ok(out.models[0].strataOmitted)
  assert.equal(out.ledgerConfirmedClaims, undefined, 'the contaminated aggregate is withheld')
  assert.equal('investigation_claim' in out.models[0].ledgerFamilies, false)
  assert.equal('investigation_claim' in out.models[0].ledgerReceiptFamilies, false)
  assert.ok('role_claim' in out.models[0].ledgerFamilies, 'unrelated families keep their counts')
  assert.ok('role_claim' in out.models[0].ledgerReceiptFamilies, 'unrelated receipt families keep their counts')
  assert.equal(out.ledgerResolvedPropositionCountRange, undefined)
  assert.equal(out.ledgerAmbiguousPropositionCountRange, undefined)
  assert.equal(out.ledgerClaimReceipts, undefined)
  assert.equal(out.claimPropositions, undefined)
  // ANY omission withholds ledgerConfirmedClaims — it counts every family's rows.
  const out2 = scrubOmittedFamilies({ ledgerConfirmedClaims: 5, models: [] }, ['role_claim'])
  assert.equal(out2.ledgerConfirmedClaims, undefined)
  // No omission: everything untouched.
  const out3 = scrubOmittedFamilies(stats, [])
  assert.equal(out3.ledgerConfirmedClaims, 3)
})

// --- v3.2.5 regressions -----------------------------------------------------

test('v3.2.5: each recall-miss item binds to ONE exact claim — no fan-out, no overwrite, substitution refused', () => {
  // TWO published-family claims on ONE message: two packet items, two
  // independent rulings. Under v3.2.4 the second ruling overwrote the first
  // (map keyed by message id) and the surviving ruling fanned out to every
  // claim on the message.
  const twoClaims = [
    { kind: 'investigation_claim', target: 'Liv', result: 'not mafia', claimedNight: 2, quote: MESSAGES[10].text },
    { kind: 'role_claim', role: 'detective', quote: 'Night 2 result' },
  ]
  const c = makeCase({ negativeClaims: twoClaims })
  const ratings = JSON.parse(readFileSync(c.packetRatingsPath, 'utf8'))
  ratings.positiveRatings['5'] = 'BAD'
  writeFileSync(c.packetRatingsPath, JSON.stringify(ratings))
  const rows = mergeRulings(c)
  const recovered = rows.filter((r: any) => typeof r.item === 'string' && r.item.startsWith('miss-n1'))
  assert.equal(recovered.length, 1, 'the OK claim recovers; the BAD claim does not — one ruling per claim')
  assert.equal(recovered[0].item, 'miss-n1#0')
  assert.equal(recovered[0].kind, 'investigation_claim')
  assert.equal(rows.find((r: any) => r._meta).missesAdded, 1)

  // Substituted claim content: refused by the sealed fingerprint.
  const c2 = makeCase({ negatives: true })
  const neg2 = JSON.parse(readFileSync(c2.negativesRatingsPath!, 'utf8'))
  neg2.negativeClaims.n1[0].target = 'Sam'
  writeFileSync(c2.negativesRatingsPath!, JSON.stringify(neg2))
  assert.throws(() => mergeRulings(c2), /changed or substituted/)

  // Removed claim: refused, named as substitution.
  const c3 = makeCase({ negatives: true })
  const neg3 = JSON.parse(readFileSync(c3.negativesRatingsPath!, 'utf8'))
  neg3.negativeClaims.n1 = []
  writeFileSync(c3.negativesRatingsPath!, JSON.stringify(neg3))
  assert.throws(() => mergeRulings(c3), /changed or substituted/)

  // A key row without the claim pin is a pre-v3.2.5 packet: refused.
  const c4 = makeCase({ negatives: true })
  const key4 = readFileSync(c4.packetKeyPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  writeJsonl(c4.packetKeyPath, key4.map((r: any) => {
    if (r.section !== 'recall-miss') return r
    const { claimId: _c, claim: _p, ...rest } = r
    return rest
  }))
  const ratings4 = JSON.parse(readFileSync(c4.packetRatingsPath, 'utf8'))
  ratings4.packetKeySha256 = createHash('sha256').update(readFileSync(c4.packetKeyPath)).digest('hex')
  writeFileSync(c4.packetRatingsPath, JSON.stringify(ratings4))
  assert.throws(() => mergeRulings(c4), /no claimId\/claim pin/)

  // A ruled miss with the negatives files withheld is a silent drop: refused.
  const c5 = makeCase({ negatives: true })
  assert.throws(() => {
    execFileSync(process.execPath, [
      join(REPO, 'scripts', 'merge-packet-rulings.mjs'),
      '--key', c5.keyPath, '--sensitivity', c5.sensPath,
      '--packet-key', c5.packetKeyPath, '--packet-ratings', c5.packetRatingsPath,
      '--logs', c5.logsDir, '--manifest', c5.manifestPath, '--out', join(c5.dir, 'out.jsonl'),
    ], { cwd: REPO, stdio: 'pipe' })
  }, /never be dropped silently/)
})

test("v3.2.5: CORRECTED on a recall-miss applies and preserves the human's corrected proposition", () => {
  const c = makeCase({ negatives: true })
  const ratings = JSON.parse(readFileSync(c.packetRatingsPath, 'utf8'))
  ratings.positiveRatings['4'] = 'CORRECTED'
  ratings.corrections['4'] = { claimedNight: '-' }
  writeFileSync(c.packetRatingsPath, JSON.stringify(ratings))
  const rows = mergeRulings(c)
  const rec = rows.find((r: any) => r.item === 'miss-n1#0')!
  assert.ok(rec.corrected, "the human's correction lands on the record — v3.2.4 silently discarded it")
  assert.equal(rec.corrected.claimedNight, null, 'the strike is preserved as the corrected proposition')
  assert.equal(rec.corrected.rule, 'R9 (ability bar, investigations)')
  assert.equal(rec.claimedNight, 2, 'the base recovered fields stay — the scorer applies the correction')
  assert.equal(rec.human.ruling, 'CORRECTED')
  assert.equal(rows.find((r: any) => r._meta).corrected, 3, 'two sheet corrections + one miss correction, all counted')

  // And the scorer actually consumes it: the ledger row carries the block.
  const ledger = buildLedger(c, rows)
  const scored = ledger.find((r: any) => !r._meta && r.seq === 10)!
  assert.equal(scored.corrected.claimedNight, null, 'the corrected block reaches the ledger for the scorer')

  // Fail-closed: CORRECTED on a miss with no corrections entry is refused.
  const c2 = makeCase({ negatives: true })
  const ratings2 = JSON.parse(readFileSync(c2.packetRatingsPath, 'utf8'))
  ratings2.positiveRatings['4'] = 'CORRECTED'
  writeFileSync(c2.packetRatingsPath, JSON.stringify(ratings2))
  assert.throws(() => mergeRulings(c2), /no corrections entry/)
})

test('v3.2.5: a BAD-ruled recall-miss claim is still pin-verified — mutation, removal, and reordering refused', () => {
  // The pin check runs BEFORE the ruling branch: under the earlier ordering a
  // BAD ruling skipped first, so tampering with a BAD-ruled claim passed
  // silently. Claim #1 (packet item 5) is ruled BAD in all three arms.
  const twoClaims = [
    { kind: 'investigation_claim', target: 'Liv', result: 'not mafia', claimedNight: 2, quote: MESSAGES[10].text },
    { kind: 'role_claim', role: 'detective', quote: 'Night 2 result' },
  ]
  const withBad = () => {
    const c = makeCase({ negativeClaims: twoClaims })
    const ratings = JSON.parse(readFileSync(c.packetRatingsPath, 'utf8'))
    ratings.positiveRatings['5'] = 'BAD'
    writeFileSync(c.packetRatingsPath, JSON.stringify(ratings))
    return c
  }
  // Mutated: the BAD-ruled claim's role changes.
  const c1 = withBad()
  const n1 = JSON.parse(readFileSync(c1.negativesRatingsPath!, 'utf8'))
  n1.negativeClaims.n1[1].role = 'mafia'
  writeFileSync(c1.negativesRatingsPath!, JSON.stringify(n1))
  assert.throws(() => mergeRulings(c1), /changed or substituted/)
  // Removed: the BAD-ruled claim disappears from the ratings file.
  const c2 = withBad()
  const n2 = JSON.parse(readFileSync(c2.negativesRatingsPath!, 'utf8'))
  n2.negativeClaims.n1 = n2.negativeClaims.n1.slice(0, 1)
  writeFileSync(c2.negativesRatingsPath!, JSON.stringify(n2))
  assert.throws(() => mergeRulings(c2), /changed or substituted/)
  // Reordered: the two claims swap places.
  const c3 = withBad()
  const n3 = JSON.parse(readFileSync(c3.negativesRatingsPath!, 'utf8'))
  n3.negativeClaims.n1.reverse()
  writeFileSync(c3.negativesRatingsPath!, JSON.stringify(n3))
  assert.throws(() => mergeRulings(c3), /changed or substituted/)
})
