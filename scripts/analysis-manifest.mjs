// Analysis v3 manifest — fail-closed provenance for everything derived from
// sweep 1 (spec §5). The manifest pins the frozen inputs (40 logs + roots),
// the cohort definitions (§1), the calibration draw (§3.3), the finder
// configuration, the tripwire hashes (§3.1), the bootstrap parameters (§4),
// and the registry of archived instrument readings — then derives ONE
// `analysisRunId` from the canonical JSON of all of it. Every derived
// artifact embeds that id; every consumer verifies it and hard-fails on
// mismatch. The manifest carries no timestamps: identical inputs must
// rebuild to an identical manifest, or clean-room regeneration (§5) is
// unprovable.
//
//   node scripts/analysis-manifest.mjs build   [--logs d] [--roots f] [--spec f] [--out f] ...
//   node scripts/analysis-manifest.mjs verify  --manifest f [--logs d] [--spec f]
//   node scripts/analysis-manifest.mjs register --manifest f --file path [--out f]
//   node scripts/analysis-manifest.mjs check-cohort --manifest f --cohort name --seeds a,b,...
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
// The exact functions that wrote the hash chains (packages/room) and drove
// every in-game draw (packages/engine) — reused, not reimplemented, so a
// verification failure can only mean the data changed, never a codec skew.
import { HASH_CHAIN_GENESIS, chainHash, stableStringify } from '../packages/room/src/log.ts'
import { drawInt } from '../packages/engine/src/rng.ts'

export { HASH_CHAIN_GENESIS, chainHash, stableStringify }

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// §1 cohort definitions, verbatim. scheduled-40 is the reliability universe
// (reliability after excluding games FOR reliability problems would be
// survivorship bias); headline-38 carries the behavioral headlines.
export const HEADLINE_38_EXCLUSIONS = ['sweep1-6', 'sweep1-15']
export const STRICT_31_EXCLUSIONS = [
  'sweep1-0', 'sweep1-6', 'sweep1-13', 'sweep1-15', 'sweep1-21',
  'sweep1-24', 'sweep1-25', 'sweep1-27', 'sweep1-38',
]

export const sha256Hex = (data) => createHash('sha256').update(data).digest('hex')
export const sha256File = (path) => sha256Hex(readFileSync(path))

// Seeds order by numeric suffix (sweep1-2 before sweep1-10), so every list
// in the manifest has one canonical order regardless of filesystem order.
const seedIndex = (s) => {
  const m = /-(\d+)$/.exec(s)
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY
}
export const seedSort = (seeds) =>
  [...seeds].sort((a, b) => seedIndex(a) - seedIndex(b) || (a < b ? -1 : a > b ? 1 : 0))

// ---- log integrity -------------------------------------------------------

/**
 * Full-chain verification of one log: seq gapless from 0, every envelope's
 * hash recomputes from the previous one, and the tail hash is the published
 * root. Returns { errors, root, messages } — messages counts `message_sent`
 * events, the §2 annotation universe (night chat is `mafia_message_sent`
 * and is out of scope by construction).
 */
export function verifyLogChain(raw, seed) {
  const errors = []
  let prev = HASH_CHAIN_GENESIS
  let messages = 0
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  for (const [i, line] of lines.entries()) {
    let env
    try {
      env = JSON.parse(line)
    } catch {
      errors.push(`${seed}: malformed JSON at line ${i}`)
      return { errors, root: null, messages }
    }
    if (env.seq !== i) errors.push(`${seed}: seq gap at line ${i} (seq ${env.seq})`)
    const { hash, ...bare } = env
    const computed = chainHash(prev, bare)
    if (computed !== hash) {
      errors.push(`${seed}: hash chain broken at seq ${env.seq}`)
      return { errors, root: null, messages }
    }
    prev = hash
    if (env.type === 'message_sent') messages += 1
  }
  if (lines.length === 0) errors.push(`${seed}: empty log`)
  return { errors, root: prev, messages }
}

// ---- cohorts (§1) --------------------------------------------------------

/** Content hash of one cohort: name + exclusion list + resolved game list.
 *  Changing either the wording (exclusions) or the membership changes it. */
export const cohortHash = ({ name, excluded, games }) =>
  sha256Hex(stableStringify({ name, excluded: [...excluded], games: seedSort(games) }))

export function buildCohorts(seeds) {
  const all = seedSort(seeds)
  const minus = (ex) => all.filter((s) => !ex.includes(s))
  const make = (name, excluded) => {
    const games = minus(excluded)
    return { excluded, games, sha256: cohortHash({ name, excluded, games }) }
  }
  return {
    'scheduled-40': make('scheduled-40', []),
    'headline-38': make('headline-38', HEADLINE_38_EXCLUSIONS),
    'strict-31': make('strict-31', STRICT_31_EXCLUSIONS),
    'all-40-behavioral': make('all-40-behavioral', []),
  }
}

// ---- calibration draw (§3.3) ---------------------------------------------

/**
 * Six games drawn by seeded random via the engine's own draw — a
 * without-replacement sample over the canonically ordered scheduled corpus,
 * so the draw is reproducible from the seed string alone.
 */
export function drawCalibrationGames(seedString, games, count) {
  if (count > games.length) throw new Error(`calibration draw of ${count} from ${games.length} games`)
  const pool = seedSort(games)
  const picked = []
  let counter = 0
  for (let i = 0; i < count; i++) {
    const d = drawInt(seedString, counter, pool.length)
    counter = d.counter
    picked.push(pool.splice(d.value, 1)[0])
  }
  return seedSort(picked)
}

// ---- analysisRunId -------------------------------------------------------

/** sha256 of the canonical JSON of the whole manifest minus the id itself.
 *  stableStringify sorts keys recursively, so field order can never matter. */
export function computeAnalysisRunId(manifest) {
  const { analysisRunId: _omit, ...body } = manifest
  return sha256Hex(stableStringify(body))
}

// ---- build ---------------------------------------------------------------

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  } catch (e) {
    throw new Error(`analysis-code commit unavailable (git rev-parse failed): ${e.message}`)
  }
}

const hashIfPresent = (path) => (path && existsSync(path) ? sha256File(path) : null)

/**
 * Builds the manifest from the frozen inputs, fail-closed: wrong corpus
 * size, missing roots, a root/log mismatch, or a broken chain refuses to
 * produce a manifest at all rather than producing a wrong one.
 */
export function buildManifest(opts = {}) {
  const {
    logsDir = 'runs/sweep-download/sweep1',
    rootsPath = 'runs/sweep-download/roots.txt',
    specPath = 'docs/analysis/analysis-v3-spec.md',
    expectedGames = 40,
    calibrationSeed = 'calibration-v3.1',
    calibrationCount = 6,
    bootstrapSeed = 'bootstrap-v3.1',
    bootstrapReplicates = 20000,
    humanRaters = [],
    finder = {},
    tripwireLexiconPath = 'runs/analysis-v3/tripwire-lexicon.json',
    tripwireReportPath = 'runs/analysis-v3/tripwire-validation.json',
    codeCommit = null,
    archivedReadings = [],
    supersedes = [],
  } = opts

  const roots = new Map(
    readFileSync(rootsPath, 'utf8').trim().split('\n').filter(Boolean)
      .map((l) => l.trim().split(/\s+/))
      .map(([seed, root]) => [seed, root]),
  )
  const seeds = seedSort(
    readdirSync(logsDir).filter((f) => /^sweep1-\d+\.jsonl$/.test(f)).map((f) => f.replace('.jsonl', '')),
  )
  if (seeds.length !== expectedGames) {
    throw new Error(`expected ${expectedGames} logs in ${logsDir}, found ${seeds.length}`)
  }
  const rootSeeds = seedSort([...roots.keys()])
  if (stableStringify(rootSeeds) !== stableStringify(seeds)) {
    throw new Error(`roots file seeds do not match the log directory (${rootsPath} vs ${logsDir})`)
  }

  const files = {}
  for (const seed of seeds) {
    const raw = readFileSync(join(logsDir, `${seed}.jsonl`))
    const { errors, root, messages } = verifyLogChain(raw.toString('utf8'), seed)
    if (errors.length) throw new Error(`refusing to build over a bad log: ${errors[0]}`)
    if (root !== roots.get(seed)) throw new Error(`${seed}: chain tail does not match the published root`)
    files[seed] = { sha256: sha256Hex(raw), root, messages }
  }

  const cohorts = buildCohorts(seeds)
  const manifest = {
    manifestVersion: 'analysis-v3.1',
    spec: { path: specPath, sha256: sha256File(specPath) },
    codeCommit: codeCommit ?? gitCommit(),
    logs: { dir: logsDir, count: seeds.length, files },
    cohorts,
    calibration: {
      seed: calibrationSeed,
      count: calibrationCount,
      games: drawCalibrationGames(calibrationSeed, cohorts['scheduled-40'].games, calibrationCount),
    },
    // Finder config participates in every cache key; null fields are honest
    // "not yet pinned" markers that the extraction stage must fill.
    finder: {
      model: 'claude-fable-5',
      promptsSha256: null,
      schemasSha256: null,
      parameters: null,
      codeVersion: null,
      ...finder,
    },
    tripwire: {
      lexiconPath: tripwireLexiconPath,
      lexiconSha256: hashIfPresent(tripwireLexiconPath),
      validationReportPath: tripwireReportPath,
      validationReportSha256: hashIfPresent(tripwireReportPath),
    },
    bootstrap: { seed: bootstrapSeed, replicates: bootstrapReplicates },
    // §6 designated human raters, by name. build-publication keys the
    // honesty fallback (single-human lower bounds) and the negative-sample
    // rater designation off this list; sensitivity raters are never listed.
    humanRaters: [...humanRaters],
    // {path, sha256, kind} per archived instrument reading (LLM outputs are
    // not re-runnable-identical; they are archived and hash-pinned instead).
    archivedReadings: [...archivedReadings].sort((a, b) => (a.path < b.path ? -1 : 1)),
    // Prior analysisRunIds this manifest supersedes: immutable rating-phase
    // readings may carry one of these (gate G10 accepts them ONLY there).
    supersedes: [...supersedes],
  }
  manifest.analysisRunId = computeAnalysisRunId(manifest)
  return manifest
}

// ---- checks --------------------------------------------------------------
// Every check THROWS on failure (§5: consumers hard-fail on mismatch) and
// returns { ok: true, errors: [] } on success, so a caller can neither
// ignore a failure nor need to inspect a result to be safe. The thrown
// ProvenanceError carries the complete error list on `.errors`.

export class ProvenanceError extends Error {
  constructor(errors) {
    super(errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} more)` : ''))
    this.name = 'ProvenanceError'
    this.errors = errors
  }
}
const passOrThrow = (errors) => {
  if (errors.length) throw new ProvenanceError(errors)
  return { ok: true, errors: [] }
}

/** Parse a manifest file and refuse one whose analysisRunId does not match
 *  its own body — a tampered manifest fails at load, everywhere. */
export function loadManifest(path) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  if (!manifest.analysisRunId || computeAnalysisRunId(manifest) !== manifest.analysisRunId) {
    throw new ProvenanceError([`${path}: analysisRunId does not match the manifest body`])
  }
  return manifest
}

/**
 * Re-derives everything re-derivable: the runId over the manifest body, the
 * spec hash, cohort membership and hashes from the exclusion lists, the
 * calibration draw from its recorded seed (§3.3), every pinned tripwire and
 * archived-reading byte hash, and for every log its byte hash, its full
 * chain, its root, and its message count. One changed byte anywhere fails
 * the run (§1).
 */
export function verifyManifest(manifest, opts = {}) {
  const errors = []
  const logsDir = opts.logsDir ?? manifest.logs.dir
  const specPath = opts.specPath ?? manifest.spec.path

  if (computeAnalysisRunId(manifest) !== manifest.analysisRunId) {
    errors.push('analysisRunId does not match the manifest body')
  }
  if (!existsSync(specPath)) errors.push(`spec missing: ${specPath}`)
  else if (sha256File(specPath) !== manifest.spec.sha256) errors.push('spec sha256 mismatch (spec changed after freeze)')

  // Cohorts re-derive from the §1 definitions — a manifest carrying any
  // other exclusion wording, membership, or hash is not a v3.1 manifest.
  const seeds = seedSort(Object.keys(manifest.logs.files))
  const expected = buildCohorts(seeds)
  for (const [name, want] of Object.entries(expected)) {
    const cohort = manifest.cohorts[name]
    if (!cohort) { errors.push(`cohort ${name}: missing`); continue }
    if (stableStringify(cohort.excluded) !== stableStringify(want.excluded)) {
      errors.push(`cohort ${name}: exclusions differ from the §1 definition`)
    }
    if (stableStringify(cohort.games) !== stableStringify(want.games)) {
      errors.push(`cohort ${name}: game list inconsistent with its exclusions`)
    }
    if (cohort.sha256 !== want.sha256) errors.push(`cohort ${name}: stored hash does not match its definition`)
  }
  for (const name of Object.keys(manifest.cohorts)) {
    if (!expected[name]) errors.push(`cohort ${name}: not a §1 cohort`)
  }

  // §3.3: the calibration list must re-derive from its recorded seed via
  // the engine's own draw — a hand-picked game list is not a seeded draw.
  const cal = manifest.calibration
  if (!cal?.seed || typeof cal.count !== 'number' || !Array.isArray(cal.games)) {
    errors.push('calibration section missing seed, count, or games')
  } else {
    try {
      const want = drawCalibrationGames(cal.seed, expected['scheduled-40'].games, cal.count)
      if (stableStringify(cal.games) !== stableStringify(want)) {
        errors.push('calibration games do not re-derive from the recorded seed (§3.3 seeded draw)')
      }
    } catch (e) {
      errors.push(`calibration draw cannot re-derive: ${e.message}`)
    }
  }

  // Tripwire pins are byte pins: once the manifest records a hash, the file
  // must exist and hash identically for as long as the manifest is in force.
  for (const [pathKey, shaKey] of [['lexiconPath', 'lexiconSha256'], ['validationReportPath', 'validationReportSha256']]) {
    const pinned = manifest.tripwire?.[shaKey]
    if (!pinned) continue
    const p = manifest.tripwire[pathKey]
    if (!p || !existsSync(p)) errors.push(`tripwire ${pathKey} is pinned but the file is missing`)
    else if (sha256File(p) !== pinned) errors.push(`tripwire ${pathKey}: bytes differ from the pinned hash`)
  }

  // Archived instrument readings are byte pins exactly like the tripwire
  // pins (§5: LLM outputs are not re-runnable-identical, so their archived
  // bytes ARE the instrument reading): every registered file must exist and
  // hash identically for as long as the manifest is in force.
  for (const r of manifest.archivedReadings ?? []) {
    if (!r?.path || !existsSync(r.path)) errors.push(`archived reading ${r?.path}: file missing`)
    else if (sha256File(r.path) !== r.sha256) errors.push(`archived reading ${r.path}: bytes differ from the pinned hash`)
  }

  const onDisk = existsSync(logsDir)
    ? seedSort(readdirSync(logsDir).filter((f) => /^sweep1-\d+\.jsonl$/.test(f)).map((f) => f.replace('.jsonl', '')))
    : []
  if (stableStringify(onDisk) !== stableStringify(seeds)) {
    errors.push(`log directory does not hold exactly the manifest's ${seeds.length} games`)
  }
  for (const seed of seeds) {
    const path = join(logsDir, `${seed}.jsonl`)
    if (!existsSync(path)) { errors.push(`${seed}: log missing`); continue }
    const raw = readFileSync(path)
    const rec = manifest.logs.files[seed]
    if (sha256Hex(raw) !== rec.sha256) { errors.push(`${seed}: log bytes changed (sha256 mismatch)`); continue }
    const { errors: chainErrors, root, messages } = verifyLogChain(raw.toString('utf8'), seed)
    errors.push(...chainErrors)
    if (root !== rec.root) errors.push(`${seed}: chain tail does not match the recorded root`)
    if (messages !== rec.messages) errors.push(`${seed}: message count mismatch`)
  }
  return passOrThrow(errors)
}

/** Cohort binding (§5 required failing test): an artifact scored on one
 *  cohort's seed set must never be consumed as another cohort's. */
export function checkCohortBinding(manifest, cohortName, seedSet) {
  const cohort = manifest.cohorts[cohortName]
  if (!cohort) throw new ProvenanceError([`unknown cohort ${cohortName}`])
  const errors = []
  const given = new Set(seedSet)
  const missing = cohort.games.filter((s) => !given.has(s))
  const extra = [...given].filter((s) => !cohort.games.includes(s))
  if (missing.length) errors.push(`${cohortName}: artifact lacks ${missing.length} cohort game(s): ${missing.join(', ')}`)
  if (extra.length) errors.push(`${cohortName}: artifact carries ${extra.length} out-of-cohort game(s): ${extra.join(', ')}`)
  passOrThrow(errors)
  return { ok: true, errors: [], missing, extra }
}

/** Every derived artifact embeds the current analysisRunId; a consumer that
 *  meets anything else must hard-fail (§5). Accepts the artifact's meta
 *  object or the bare id string; `label` names the artifact in errors. */
export function checkRunId(manifest, artifactMeta, label = 'artifact') {
  const id = typeof artifactMeta === 'string' ? artifactMeta : artifactMeta?.analysisRunId
  if (!id) throw new ProvenanceError([`${label} does not embed an analysisRunId`])
  if (id !== manifest.analysisRunId) {
    throw new ProvenanceError([`${label} analysisRunId ${id.slice(0, 12)}… does not match the manifest's ${manifest.analysisRunId.slice(0, 12)}…`])
  }
  return { ok: true, errors: [] }
}

/**
 * Extraction meta check (§3 engineering: complete coverage or nonzero exit;
 * §5 required failing test: missing or stale extraction fails). The stamped
 * cacheKey is content-addressed by extract-v3 over the log bytes ‖ spec sha
 * ‖ its own prompt/schema/config internals ‖ its code version — internals
 * the manifest does not pin, so the key cannot be re-minted here. Staleness
 * is instead detected from the components the meta stamps AND the manifest
 * independently pins (the spec sha at freeze, the finder model, the log's
 * public-message count); the reading's bytes themselves are pinned by the
 * archivedReadings registry. Coverage fields are REQUIRED: an omitted count
 * is a failure, never assumed-complete coverage.
 */
export function checkExtractionMeta(manifest, meta) {
  const errors = []
  if (!meta || !meta.seed) throw new ProvenanceError(['extraction meta missing a seed'])
  const file = manifest.logs.files[meta.seed]
  if (!file) throw new ProvenanceError([`extraction meta for unknown seed ${meta.seed}`])
  if (typeof meta.cacheKey !== 'string' || !/^[0-9a-f]{64}$/.test(meta.cacheKey)) {
    errors.push(`${meta.seed}: missing or malformed cacheKey`)
  }
  if (meta.specSha256 !== manifest.spec.sha256) {
    errors.push(`${meta.seed}: stale extraction (ran under spec ${String(meta.specSha256).slice(0, 12)}…, frozen spec is ${manifest.spec.sha256.slice(0, 12)}…)`)
  }
  if (meta.finderModel !== manifest.finder.model) {
    errors.push(`${meta.seed}: finder model ${meta.finderModel} is not the manifest's ${manifest.finder.model}`)
  }
  if (typeof meta.messages !== 'number') {
    errors.push(`${meta.seed}: meta lacks a message count — coverage unproven`)
  } else if (meta.messages !== file.messages) {
    errors.push(`${meta.seed}: extraction saw ${meta.messages} messages, the log holds ${file.messages}`)
  }
  if (typeof meta.unprocessedMessages !== 'number') {
    errors.push(`${meta.seed}: meta lacks unprocessedMessages — coverage unproven`)
  } else if (meta.unprocessedMessages !== 0) {
    errors.push(`${meta.seed}: ${meta.unprocessedMessages} unprocessed message(s) — coverage must be complete`)
  }
  return passOrThrow(errors)
}

// ---- archived instrument readings ----------------------------------------

const READING_KINDS = [
  [/\.claims\.jsonl$/, 'extraction'],
  [/\.class(?:ified|ification)?\.jsonl$/, 'classification'],
  [/\.rejects\.jsonl$/, 'rejects'],
  [/\.raw\.jsonl$/, 'raw_responses'],
  [/handcheck|\.sheet\./, 'sheet'],
]
const readingKind = (path) => (READING_KINDS.find(([re]) => re.test(path)) ?? [null, 'instrument_reading'])[1]

/**
 * Hash-pins one LLM output (or sheet) into the manifest registry and
 * recomputes the analysisRunId — a reading that isn't registered simply is
 * not part of the run. Returns the registry entry. Re-registering a path
 * replaces its entry (a changed reading is a changed run).
 */
export function registerReading(manifest, filePath) {
  const entry = { path: filePath, sha256: sha256File(filePath), kind: readingKind(filePath) }
  manifest.archivedReadings = [
    ...manifest.archivedReadings.filter((r) => r.path !== filePath),
    entry,
  ].sort((a, b) => (a.path < b.path ? -1 : 1))
  manifest.analysisRunId = computeAnalysisRunId(manifest)
  return entry
}

// ---- CLI -----------------------------------------------------------------

// §3 engineering: atomic writes — never leave a half-written manifest.
export function writeFileAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      logs: { type: 'string', default: 'runs/sweep-download/sweep1' },
      roots: { type: 'string', default: 'runs/sweep-download/roots.txt' },
      spec: { type: 'string', default: 'docs/analysis/analysis-v3-spec.md' },
      manifest: { type: 'string', default: 'runs/analysis-v3/manifest.json' },
      out: { type: 'string' },
      'calibration-seed': { type: 'string', default: 'calibration-v3.1' },
      'bootstrap-seed': { type: 'string', default: 'bootstrap-v3.1' },
      'bootstrap-replicates': { type: 'string', default: '20000' },
      'tripwire-lexicon': { type: 'string', default: 'runs/analysis-v3/tripwire-lexicon.json' },
      'tripwire-report': { type: 'string', default: 'runs/analysis-v3/tripwire-validation.json' },
      'finder-model': { type: 'string', default: 'claude-fable-5' },
      /** Pin the full finder descriptor from a completed extraction dir:
       *  model + code version from a claims meta, prompt/schema hashes from
       *  the extractor module itself. */
      'finder-from-extract': { type: 'string' },
      /** Comma-separated dirs whose files register as archived instrument
       *  readings (LLM outputs, sealed keys, rating files). */
      register: { type: 'string' },
      /** Comma-separated prior analysisRunIds this manifest supersedes —
       *  immutable rating-phase readings may carry these (gate G10). */
      supersedes: { type: 'string' },
      'human-raters': { type: 'string', default: '' },
      file: { type: 'string' },
      cohort: { type: 'string' },
      seeds: { type: 'string' },
    },
  })
  const cmd = positionals[0]
  const report = (check) => {
    try {
      check()
      console.log('OK')
    } catch (e) {
      for (const msg of e.errors ?? [e.message]) console.error(`FAIL ${msg}`)
      process.exit(1)
    }
  }

  if (cmd === 'build') {
    let finder = { model: values['finder-model'] }
    if (values['finder-from-extract']) {
      const dir = values['finder-from-extract']
      const claimFile = readdirSync(dir).filter((f) => f.endsWith('.claims.jsonl')).sort()[0]
      if (!claimFile) { console.error(`--finder-from-extract ${dir}: no claims files`); process.exit(1) }
      const meta = JSON.parse(readFileSync(join(dir, claimFile), 'utf8').split('\n')[0])
      const mod = await import(pathToFileURL(resolve('packages/seats/scripts/extract-v3.mjs')).href)
      finder = {
        model: meta.finderModel,
        promptsSha256: mod.PROMPTS_SHA256,
        schemasSha256: mod.SCHEMAS_SHA256,
        parameters: { secondModel: meta.secondModel ?? null, maxMessages: meta.maxMessages ?? null, tripwireLexiconSha256: meta.tripwireLexiconSha256 ?? null },
        codeVersion: meta.extractorVersion,
      }
    }
    const archivedReadings = []
    for (const dir of (values.register ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
      for (const f of readdirSync(dir).sort()) {
        const p = join(dir, f)
        if (!statSync(p).isFile() || !/\.(jsonl?|json)$/.test(f)) continue
        archivedReadings.push({ path: p, sha256: sha256File(p), kind: f.replace(/^[^.]*\./, '') })
      }
    }
    const manifest = buildManifest({
      logsDir: values.logs,
      rootsPath: values.roots,
      specPath: values.spec,
      calibrationSeed: values['calibration-seed'],
      bootstrapSeed: values['bootstrap-seed'],
      bootstrapReplicates: Number(values['bootstrap-replicates']),
      tripwireLexiconPath: values['tripwire-lexicon'],
      tripwireReportPath: values['tripwire-report'],
      humanRaters: values['human-raters'].split(',').map((s) => s.trim()).filter(Boolean),
      supersedes: (values.supersedes ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      finder,
      archivedReadings,
    })
    const out = values.out ?? values.manifest
    writeFileAtomic(out, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(`wrote ${out}`)
    console.log(`games ${manifest.logs.count} · calibration [${manifest.calibration.games.join(', ')}]`)
    console.log(`analysisRunId ${manifest.analysisRunId}`)
  } else if (cmd === 'verify') {
    report(() => verifyManifest(loadManifest(values.manifest), { logsDir: values.logs, specPath: values.spec }))
  } else if (cmd === 'register') {
    if (!values.file) { console.error('register needs --file'); process.exit(1) }
    const manifest = loadManifest(values.manifest)
    const entry = registerReading(manifest, values.file)
    writeFileAtomic(values.out ?? values.manifest, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(`registered ${entry.kind} ${entry.path} ${entry.sha256.slice(0, 12)}…`)
    console.log(`analysisRunId ${manifest.analysisRunId}`)
  } else if (cmd === 'check-cohort') {
    if (!values.cohort || !values.seeds) { console.error('check-cohort needs --cohort and --seeds'); process.exit(1) }
    report(() => checkCohortBinding(loadManifest(values.manifest), values.cohort, values.seeds.split(',').map((s) => s.trim()).filter(Boolean)))
  } else {
    console.error('usage: analysis-manifest.mjs <build|verify|register|check-cohort> [options]')
    process.exit(1)
  }
}
