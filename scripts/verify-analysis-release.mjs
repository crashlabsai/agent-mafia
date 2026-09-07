// Verify the curated v3.2 analysis release without access to the private run.

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { assertPublicText, RELEASE_PAYLOAD_PATHS } from './build-analysis-release.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_BUNDLE = join(REPO_ROOT, 'docs', 'sweeps', 'results', 'analysis-v32')
// These two files cannot hash themselves. Every other bundle file, including
// README.md and DATA-NOTICE.md, must be inventoried in RELEASE-MANIFEST.json.
const SELF_REFERENTIAL_RELEASE_FILES = new Set(['RELEASE-MANIFEST.json', 'SHA256SUMS'])
const REQUIRED_DOCUMENTATION = Object.freeze(['README.md', 'DATA-NOTICE.md'])
const MIN_PF2_SOURCE_COVERAGE = 160
const CLEANROOM_ARTIFACTS = Object.freeze([
  'ledger/confirmed-input.jsonl',
  'opportunity/table.jsonl',
  'ledger/confirmed-headline-38.jsonl',
  'ledger/confirmed-strict-31.jsonl',
  'ledger/confirmed-all-40-behavioral.jsonl',
  'stats/stats-headline-38.json',
  'stats/stats-strict-31.json',
  'stats/stats-all-40-behavioral.json',
  'stats/agreement.json',
  'stats/pf2-validation.json',
  'stats/sensitivity.json',
])
const OMITTED_PROVENANCE_GROUPS = Object.freeze([
  {
    pattern: 'extract/*.raw.jsonl',
    matches: (path) => /^runs\/analysis-v3\.2\/extract\/sweep1-\d+\.raw\.jsonl$/.test(path),
  },
  {
    pattern: 'handcheck/codex-pass/events-*.jsonl',
    matches: (path) => /^runs\/analysis-v3\.2\/handcheck\/codex-pass\/events-(?:sheet-\d+|negatives)\.jsonl$/.test(path),
  },
  {
    pattern: 'handcheck/codex-pass/*.raw.json',
    matches: (path) => /^runs\/analysis-v3\.2\/handcheck\/codex-pass\/(?:ratings-sheet-\d+|negatives)\.raw\.json$/.test(path),
  },
  {
    pattern: 'handcheck/codex-pass/err-*.log and sha256s.txt',
    matches: (path) => /^runs\/analysis-v3\.2\/handcheck\/codex-pass\/(?:err-(?:sheet-\d+|negatives)\.log|sha256s\.txt)$/.test(path),
  },
])
const FORBIDDEN_NAMES = [
  /(^|\/)HANDOFF\.md$/,
  /(^|\/)packet-pre-v3/,
  /DRAFT/,
  /review\.html$/,
  /start-review\.command$/,
  /local-manifest/,
  /\.log$/,
  /(^|\/)events-[^/]+\.jsonl$/,
  /(^|\/)(?:ratings-sheet-[^/]+|negatives)\.raw\.json$/,
  /(^|\/)extract\/[^/]+\.raw\.jsonl$/,
]
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const isSha256 = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const isGitCommit = (value) => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label}: ${error.message}`)
  }
}

function walk(root, path = root) {
  const files = []
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`symlink is not allowed: ${relative(root, full)}`)
    if (entry.isDirectory()) files.push(...walk(root, full))
    else if (entry.isFile()) files.push(relative(root, full).split(sep).join('/'))
  }
  return files.sort()
}

function aggregateHash(files) {
  const digest = createHash('sha256')
  for (const file of files) digest.update(`${file.path}\x00${file.bytes}\x00${file.sha256}\n`)
  return digest.digest('hex')
}

function cleanroomArtifactSetHash(artifacts) {
  const digest = createHash('sha256')
  for (const artifact of artifacts) digest.update(`${artifact.path}\x00${artifact.bytes}\x00${artifact.sha256}\n`)
  return digest.digest('hex')
}

function provenanceAggregateHash(files) {
  const digest = createHash('sha256')
  for (const file of files) digest.update(`${file.path}\x00${file.sha256}\n`)
  return digest.digest('hex')
}

function assertSafeRelativePath(path, label) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
    throw new Error(`${label}: unsafe path ${String(path)}`)
  }
}

function assertSameCounts(actual, expected, label) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) throw new Error(`${label}: counts missing or malformed`)
  const actualKeys = Object.keys(actual).sort()
  const expectedKeys = Object.keys(expected).sort()
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error(`${label}: count families do not re-derive`)
  }
  for (const key of expectedKeys) if (actual[key] !== expected[key]) throw new Error(`${label}: count for ${key} does not re-derive`)
}

function releaseEntryBySource(bySource, sourcePath, label) {
  const entry = bySource.get(sourcePath)
  if (!entry) throw new Error(`${label}: release crosswalk is missing ${sourcePath}`)
  return entry
}

function requireFile(bundle, path) {
  const full = join(bundle, path)
  if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`required file missing: ${path}`)
  return full
}

function main() {
  const { positionals } = parseArgs({ allowPositionals: true })
  if (positionals.length > 1) throw new Error('usage: node scripts/verify-analysis-release.mjs [bundle-directory]')
  const bundle = resolve(positionals[0] ?? DEFAULT_BUNDLE)
  if (!existsSync(bundle) || !lstatSync(bundle).isDirectory()) throw new Error(`bundle directory missing: ${bundle}`)

  const manifest = readJson(requireFile(bundle, 'RELEASE-MANIFEST.json'), 'release manifest')
  if (manifest.schemaVersion !== 'analysis-v32-release-v1') throw new Error('unknown release manifest schema')
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('release manifest has no files')
  if (!isSha256(manifest.analysisRunId) || !isSha256(manifest.pf2RunId) || !isGitCommit(manifest.codeCommit)) {
    throw new Error('release manifest identity is missing or malformed')
  }
  if (!isSha256(manifest.sourceProvenanceSha256) || !isSha256(manifest.aggregateSha256)) {
    throw new Error('release manifest hash binding is missing or malformed')
  }

  const recorded = new Set()
  const recordedSources = new Set()
  let pathNormalizations = 0
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('release manifest contains an invalid entry')
    assertSafeRelativePath(entry.path, 'release manifest')
    if (recorded.has(entry.path)) throw new Error(`duplicate release path: ${entry.path}`)
    recorded.add(entry.path)
    for (const pattern of FORBIDDEN_NAMES) if (pattern.test(entry.path)) throw new Error(`private artifact included: ${entry.path}`)
    if (typeof entry.kind !== 'string' || !entry.kind) throw new Error(`release manifest kind missing: ${entry.path}`)
    if (!Number.isInteger(entry.bytes) || entry.bytes < 0 || !isSha256(entry.sha256)) {
      throw new Error(`release manifest size or hash malformed: ${entry.path}`)
    }
    if (entry.sourcePath !== undefined) {
      assertSafeRelativePath(entry.sourcePath, `source path for ${entry.path}`)
      if (recordedSources.has(entry.sourcePath)) throw new Error(`duplicate release source path: ${entry.sourcePath}`)
      recordedSources.add(entry.sourcePath)
      if (!Number.isInteger(entry.sourceBytes) || entry.sourceBytes < 0 || !isSha256(entry.sourceSha256)) {
        throw new Error(`release source size or hash malformed: ${entry.path}`)
      }
      if (!Number.isInteger(entry.pathNormalizations) || entry.pathNormalizations < 0) {
        throw new Error(`path-normalization count malformed: ${entry.path}`)
      }
      for (const pattern of FORBIDDEN_NAMES) if (pattern.test(entry.sourcePath)) throw new Error(`private source artifact included: ${entry.sourcePath}`)
      if (entry.generated === true) throw new Error(`source-backed release entry marked generated: ${entry.path}`)
    } else if (entry.generated !== true) {
      throw new Error(`release entry has neither source provenance nor generated marker: ${entry.path}`)
    }
    const full = requireFile(bundle, entry.path)
    const bytes = readFileSync(full)
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error(`checksum mismatch: ${entry.path}`)
    assertPublicText(bytes.toString('utf8'), entry.path)
    pathNormalizations += Number(entry.pathNormalizations ?? 0)
  }

  for (const path of REQUIRED_DOCUMENTATION) {
    if (!recorded.has(path)) throw new Error(`${path} must be hash-bound in the release manifest`)
  }
  const requiredPayloads = new Set(RELEASE_PAYLOAD_PATHS)
  const missingPayloads = RELEASE_PAYLOAD_PATHS.filter((path) => !recorded.has(path))
  const unexpectedPayloads = [...recorded].filter((path) => !requiredPayloads.has(path))
  if (missingPayloads.length || unexpectedPayloads.length) {
    throw new Error(`release manifest differs from canonical inventory (missing: ${missingPayloads.join(', ') || 'none'}; unexpected: ${unexpectedPayloads.join(', ') || 'none'})`)
  }

  if (aggregateHash(manifest.files) !== manifest.aggregateSha256) throw new Error('aggregate release hash does not re-derive')

  const actualFiles = walk(bundle)
  const expectedFiles = new Set([...recorded, ...SELF_REFERENTIAL_RELEASE_FILES])
  const extras = actualFiles.filter((path) => !expectedFiles.has(path))
  const missing = [...expectedFiles].filter((path) => !actualFiles.includes(path))
  if (extras.length || missing.length) {
    throw new Error(`bundle file set differs (extra: ${extras.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'})`)
  }

  // The self-referential inventory files cannot contain their own hashes, but
  // they are still subject to the same public-content scan as inventoried data.
  for (const path of SELF_REFERENTIAL_RELEASE_FILES) {
    assertPublicText(readFileSync(requireFile(bundle, path), 'utf8'), path)
  }

  const expectedSums = manifest.files.map((file) => `${file.sha256}  ${file.path}`).join('\n') + '\n'
  if (readFileSync(requireFile(bundle, 'SHA256SUMS'), 'utf8') !== expectedSums) throw new Error('SHA256SUMS differs from release manifest')

  const sourceManifestPath = requireFile(bundle, 'manifest.json')
  const sourceManifestBytes = readFileSync(sourceManifestPath)
  const sourceManifest = readJson(sourceManifestPath, 'source analysis manifest')
  if (!isSha256(sourceManifest.analysisRunId) || !isGitCommit(sourceManifest.codeCommit) ||
      sourceManifest.analysisRunId !== manifest.analysisRunId || sourceManifest.codeCommit !== manifest.codeCommit) {
    throw new Error('source analysis manifest disagrees with release identity')
  }

  const sourceProvenancePath = requireFile(bundle, 'handcheck/pf2-provenance.json')
  const sourceProvenanceBytes = readFileSync(sourceProvenancePath)
  const sourceProvenance = readJson(sourceProvenancePath, 'source PF-2 provenance')
  if (sourceProvenance.manifestVersion !== `pf2-provenance-${sourceProvenance.packetVersion}` ||
      sourceProvenance.packetVersion !== 'pf2-v3.2.5' ||
      !isSha256(sourceProvenance.analysisRunId) || !isGitCommit(sourceProvenance.codeCommit) ||
      sourceProvenance.analysisRunId !== manifest.pf2RunId ||
      sourceProvenance.codeCommit !== manifest.codeCommit ||
      sha256(sourceProvenanceBytes) !== manifest.sourceProvenanceSha256) {
    throw new Error('source PF-2 provenance disagrees with release identity')
  }
  if (!Array.isArray(sourceProvenance.disclosures) || !sourceProvenance.disclosures.some((text) =>
    typeof text === 'string' && /item-level blind/i.test(text) && /not prior-free/i.test(text))) {
    throw new Error('source PF-2 provenance lacks the item-level-blind / not-prior-free disclosure')
  }
  if (!Array.isArray(sourceProvenance.files) || sourceProvenance.files.length === 0 || !isSha256(sourceProvenance.aggregateSha256)) {
    throw new Error('source PF-2 provenance inventory is missing or malformed')
  }

  const pins = new Map()
  const provenanceCounts = {}
  for (const entry of sourceProvenance.files) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('source PF-2 provenance contains an invalid entry')
    assertSafeRelativePath(entry.path, 'source PF-2 provenance')
    if (pins.has(entry.path)) throw new Error(`duplicate PF-2 provenance path: ${entry.path}`)
    if (typeof entry.kind !== 'string' || !entry.kind || !Number.isInteger(entry.bytes) || entry.bytes < 0 || !isSha256(entry.sha256)) {
      throw new Error(`source PF-2 provenance entry malformed: ${entry.path}`)
    }
    pins.set(entry.path, entry)
    provenanceCounts[entry.kind] = (provenanceCounts[entry.kind] ?? 0) + 1
  }
  assertSameCounts(sourceProvenance.counts, provenanceCounts, 'source PF-2 provenance')
  if (provenanceAggregateHash(sourceProvenance.files) !== sourceProvenance.aggregateSha256) {
    throw new Error('source PF-2 provenance aggregateSha256 does not re-derive')
  }

  let coveredPins = 0
  const coveredPinPaths = new Set()
  for (const entry of manifest.files) {
    const pin = pins.get(entry.sourcePath)
    if (!pin) continue
    if (pin.sha256 !== entry.sourceSha256 || pin.bytes !== entry.sourceBytes) {
      throw new Error(`source crosswalk disagrees with PF-2 provenance: ${entry.path}`)
    }
    coveredPinPaths.add(entry.sourcePath)
    coveredPins += 1
  }
  if (coveredPins !== manifest.sourceProvenanceCoverage?.included || pins.size !== manifest.sourceProvenanceCoverage?.total) {
    throw new Error('PF-2 provenance coverage counts do not re-derive')
  }
  if (coveredPins < MIN_PF2_SOURCE_COVERAGE) {
    throw new Error(`PF-2 provenance coverage fell below ${MIN_PF2_SOURCE_COVERAGE}: ${coveredPins}`)
  }

  if (!Array.isArray(manifest.omissions)) throw new Error('release omission disclosure is missing')
  const omissionRecords = new Map()
  for (const omission of manifest.omissions) {
    if (!omission || typeof omission.pattern !== 'string' || !omission.pattern ||
        typeof omission.reason !== 'string' || !omission.reason) {
      throw new Error('release omission disclosure contains a malformed entry')
    }
    if (omissionRecords.has(omission.pattern)) throw new Error(`duplicate omission disclosure: ${omission.pattern}`)
    omissionRecords.set(omission.pattern, omission)
  }
  const unexportedPins = sourceProvenance.files.filter((entry) => !coveredPinPaths.has(entry.path))
  const classifiedOmissions = new Set()
  for (const group of OMITTED_PROVENANCE_GROUPS) {
    const record = omissionRecords.get(group.pattern)
    if (!record) throw new Error(`required omission disclosure missing: ${group.pattern}`)
    const matching = unexportedPins.filter((entry) => group.matches(entry.path))
    if (!Number.isInteger(record.count) || record.count !== matching.length) {
      throw new Error(`omission count does not re-derive for ${group.pattern}: recorded ${String(record.count)}, actual ${matching.length}`)
    }
    for (const entry of matching) {
      if (classifiedOmissions.has(entry.path)) throw new Error(`omitted provenance path classified twice: ${entry.path}`)
      classifiedOmissions.add(entry.path)
    }
  }
  const undisclosedOmissions = unexportedPins.filter((entry) => !classifiedOmissions.has(entry.path))
  if (undisclosedOmissions.length > 0) {
    throw new Error(`PF-2 provenance files omitted without a counted disclosure: ${undisclosedOmissions.map((entry) => entry.path).join(', ')}`)
  }

  const cleanroom = readJson(requireFile(bundle, 'cleanroom.json'), 'clean-room attestation')
  const bySource = new Map(manifest.files.map((entry) => [entry.sourcePath, entry]))
  if (cleanroom.schemaVersion !== 'cleanroom-v3.2' || cleanroom.generator !== 'scripts/build-cleanroom-v3.mjs' || cleanroom.ok !== true) {
    throw new Error('clean-room attestation has an unknown schema/generator or ok !== true')
  }
  if (cleanroom.analysisRunId !== manifest.analysisRunId || cleanroom.codeCommit !== manifest.codeCommit ||
      cleanroom.manifestSha256 !== sha256(sourceManifestBytes) ||
      cleanroom.pf2ProvenanceSha256 !== sha256(sourceProvenanceBytes)) {
    throw new Error('clean-room attestation identity or source binding disagrees with the release')
  }
  if (cleanroom.logs?.count !== sourceManifest.logs?.count ||
      cleanroom.bootstrap?.seed !== sourceManifest.bootstrap?.seed ||
      cleanroom.bootstrap?.replicates !== sourceManifest.bootstrap?.replicates) {
    throw new Error('clean-room log/bootstrap parameters disagree with the source analysis manifest')
  }
  if (!Array.isArray(cleanroom.reproduced) || cleanroom.artifactCount !== CLEANROOM_ARTIFACTS.length ||
      cleanroom.reproduced.length !== CLEANROOM_ARTIFACTS.length) {
    throw new Error(`clean-room attestation must enumerate exactly ${CLEANROOM_ARTIFACTS.length} artifacts`)
  }
  for (let index = 0; index < CLEANROOM_ARTIFACTS.length; index += 1) {
    const expectedPath = CLEANROOM_ARTIFACTS[index]
    const artifact = cleanroom.reproduced[index]
    if (!artifact || artifact.path !== expectedPath || !Number.isInteger(artifact.bytes) || artifact.bytes < 0 || !isSha256(artifact.sha256)) {
      throw new Error(`clean-room artifact set/order or metadata differs at position ${index + 1}`)
    }
    const entry = releaseEntryBySource(bySource, `runs/analysis-v3.2/${artifact.path}`, 'clean-room attestation')
    if (entry.sourceSha256 !== artifact.sha256 || entry.sourceBytes !== artifact.bytes) {
      throw new Error(`clean-room source hash has no matching release crosswalk: ${artifact.path}`)
    }
  }
  if (!isSha256(cleanroom.artifactSetSha256) || cleanroom.artifactSetSha256 !== cleanroomArtifactSetHash(cleanroom.reproduced)) {
    throw new Error('clean-room artifactSetSha256 does not re-derive')
  }

  const pf2Validation = readJson(requireFile(bundle, 'stats/pf2-validation.json'), 'PF-2 validation summary')
  if (pf2Validation.schemaVersion !== 'pf2-validation-v3.2.6' ||
      pf2Validation.analysisRunId !== manifest.analysisRunId ||
      pf2Validation.ratedUnderRunId !== manifest.pf2RunId ||
      pf2Validation.provenance?.codeCommit !== manifest.codeCommit ||
      pf2Validation.provenance?.pf2AggregateSha256 !== sourceProvenance.aggregateSha256) {
    throw new Error('PF-2 validation summary disagrees with the release/PF-2 identity')
  }
  if (pf2Validation.scope?.itemLevelBlind !== true || pf2Validation.scope?.priorFree !== false ||
      pf2Validation.scope?.generalRecallOrOmissionRateEstimated !== false) {
    throw new Error('PF-2 validation summary has unexpected scope disclosures')
  }
  const pf2Inputs = pf2Validation.provenance?.inputs
  if (!pf2Inputs || typeof pf2Inputs !== 'object' || Array.isArray(pf2Inputs)) {
    throw new Error('PF-2 validation input bindings are missing')
  }
  const expectedPf2Inputs = new Map([
    ['analysisManifestSha256', 'runs/analysis-v3.2/manifest.json'],
    ['pf2ProvenanceSha256', 'runs/analysis-v3.2/handcheck/pf2-provenance.json'],
    ['sealedKeySha256', 'runs/analysis-v3.2/handcheck/sealed-key.jsonl'],
    ['sensitivityRatingsSha256', 'runs/analysis-v3.2/handcheck/codex-ratings.json'],
    ['packetKeySha256', 'runs/analysis-v3.2/handcheck/packet/packet-key.jsonl'],
    ['packetRatingsSha256', 'runs/analysis-v3.2/handcheck/packet/ryan-packet-ratings-blind-clarified.json'],
    ['negativesKeySha256', 'runs/analysis-v3.2/handcheck/negatives-sealed-key.jsonl'],
    ['negativesRatingsSha256', 'runs/analysis-v3.2/handcheck/codex-negatives.json'],
    ['confirmedInputSha256', 'runs/analysis-v3.2/ledger/confirmed-input.jsonl'],
  ])
  if (Object.keys(pf2Inputs).length !== expectedPf2Inputs.size) {
    throw new Error('PF-2 validation input binding set is incomplete or contains unexpected fields')
  }
  for (const [field, sourcePath] of expectedPf2Inputs) {
    const entry = releaseEntryBySource(bySource, sourcePath, 'PF-2 validation summary')
    if (!isSha256(pf2Inputs[field]) || pf2Inputs[field] !== entry.sourceSha256) {
      throw new Error(`PF-2 validation input binding mismatch: ${field}`)
    }
  }

  const expectedTripwire = new Map([
    ['tripwire/lexicon.json', sourceManifest.tripwire?.lexiconSha256],
    ['tripwire/validation.json', sourceManifest.tripwire?.validationReportSha256],
  ])
  for (const [path, hash] of expectedTripwire) {
    if (!hash || sha256(readFileSync(requireFile(bundle, path))) !== hash) throw new Error(`tripwire pin mismatch: ${path}`)
  }

  const conduct = readJson(requireFile(bundle, 'handcheck/codex-pass/conduct-summary.json'), 'conduct summary')
  if (conduct.schemaVersion !== 'analysis-v32-codex-conduct-v1' || !Array.isArray(conduct.sessions)) {
    throw new Error('conduct summary schema or session inventory is malformed')
  }
  const expectedSessions = new Set(['negatives', ...Array.from({ length: 8 }, (_, index) => `sheet-${String(index + 1).padStart(2, '0')}`)])
  let conductCommands = 0
  let conductReads = 0
  for (const session of conduct.sessions) {
    if (!session || !expectedSessions.delete(session.session)) throw new Error(`conduct summary has an unknown or duplicate session: ${String(session?.session)}`)
    if (!isSha256(session.sourceSha256) || !Number.isInteger(session.commandExecutions) || !Number.isInteger(session.fileReads) ||
        session.commandExecutions !== 0 || session.fileReads !== 0) {
      throw new Error(`conduct summary session does not establish tool-free behavior: ${session.session}`)
    }
    const sourcePath = `runs/analysis-v3.2/handcheck/codex-pass/events-${session.session}.jsonl`
    const pin = pins.get(sourcePath)
    if (!pin || pin.sha256 !== session.sourceSha256) throw new Error(`conduct summary source hash is not PF-2-pinned: ${session.session}`)
    conductCommands += session.commandExecutions
    conductReads += session.fileReads
  }
  if (expectedSessions.size > 0 || conduct.totals?.sessions !== conduct.sessions.length ||
      conduct.totals?.commandExecutions !== conductCommands || conduct.totals?.fileReads !== conductReads ||
      conduct.totals.sessions !== 9 || conductCommands !== 0 || conductReads !== 0) {
    throw new Error('conduct summary does not establish nine tool-free sessions')
  }

  const claims = actualFiles.filter((path) => /^extract\/sweep1-\d+\.claims\.jsonl$/.test(path))
  const negatives = actualFiles.filter((path) => /^extract\/sweep1-\d+\.negatives\.jsonl$/.test(path))
  const rejects = actualFiles.filter((path) => /^extract\/sweep1-\d+\.rejects\.jsonl$/.test(path))
  if (claims.length !== 40 || negatives.length !== 40 || rejects.length !== 40) {
    throw new Error(`extraction set incomplete: ${claims.length} claims, ${negatives.length} negatives, ${rejects.length} rejects`)
  }

  console.log(`analysis release PASS: ${manifest.files.length} files, ${manifest.aggregateSha256}`)
  console.log(`identity: run ${manifest.analysisRunId.slice(0, 12)}..., commit ${manifest.codeCommit.slice(0, 12)}...`)
  console.log(`sanitization: ${pathNormalizations} machine-local game paths normalized; no secret signatures found`)
  console.log(`PF-2 source crosswalk: ${coveredPins}/${pins.size} provenance entries included`)
}

try {
  main()
} catch (error) {
  console.error(`verify-analysis-release: ${error.message ?? error}`)
  process.exitCode = 1
}
