// Build the measured PF-2 validation summary from the CURRENT v3.2 inputs.
//
// This is deliberately a derivation, not a hand-maintained results file. It
// verifies the current analysis manifest, the frozen PF-2 provenance manifest,
// both sealed keys, both model-rating artifacts, the human packet/key binding,
// every packet section, and the merged confirmed-input lineage before writing
// a count. The six negative-sample candidates remain TARGETED CLEANUP under the
// exploratory-v1 decision: this script never turns them into a recall rate.
//
//   node scripts/build-pf2-validation.mjs \
//     --manifest runs/analysis-v3.2/manifest.json \
//     --provenance runs/analysis-v3.2/handcheck/pf2-provenance.json \
//     --key runs/analysis-v3.2/handcheck/sealed-key.jsonl \
//     --sensitivity runs/analysis-v3.2/handcheck/codex-ratings.json \
//     --packet-key runs/analysis-v3.2/handcheck/packet/packet-key.jsonl \
//     --packet-ratings runs/analysis-v3.2/handcheck/packet/ryan-packet-ratings-blind-clarified.json \
//     --negatives-key runs/analysis-v3.2/handcheck/negatives-sealed-key.jsonl \
//     --negatives-ratings runs/analysis-v3.2/handcheck/codex-negatives.json \
//     --confirmed-input runs/analysis-v3.2/ledger/confirmed-input.jsonl \
//     --out runs/analysis-v3.2/stats/pf2-validation.json
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { parseArgs } from 'node:util'
import { loadManifest } from './analysis-manifest.mjs'
import {
  KNOWN_KINDS,
  PF2_PACKET_VERSION,
  recallClaimFingerprint,
  validateRecoveredClaim,
} from './correction-validation.mjs'
import { wilson } from './publication-omission.mjs'

const RULINGS = Object.freeze(['OK', 'BAD', 'CORRECTED'])
const PACKET_SECTIONS = Object.freeze(['dispute', 'audit', 'recall-miss'])
const PUBLISHED_FAMILIES = Object.freeze([...KNOWN_KINDS].sort())

const invariant = (condition, message) => {
  if (!condition) throw new Error(message)
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sha256File = (path) => sha256(readFileSync(path))

function readJson(path, label) {
  let value
  try { value = JSON.parse(readFileSync(path, 'utf8')) }
  catch (error) { throw new Error(`${label} ${path}: invalid JSON (${error.message})`) }
  invariant(value && typeof value === 'object' && !Array.isArray(value), `${label} ${path}: expected one JSON object`)
  return value
}

function readJsonl(path, label) {
  const raw = readFileSync(path, 'utf8')
  const rows = raw.split('\n').filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line) }
    catch (error) { throw new Error(`${label} ${path}:${index + 1}: invalid JSON (${error.message})`) }
  })
  invariant(rows.length > 0, `${label} ${path}: empty JSONL artifact`)
  invariant(rows[0]?._meta === true, `${label} ${path}: first row must be the _meta row`)
  invariant(rows.slice(1).every((row) => row?._meta !== true), `${label} ${path}: multiple _meta rows`)
  return { raw, meta: rows[0], rows: rows.slice(1) }
}

const exactKeys = (actual, expected, where) => {
  const got = Object.keys(actual ?? {}).sort()
  const want = [...expected].map(String).sort()
  invariant(isDeepStrictEqual(got, want), `${where}: keys are not exactly the sealed item ids (missing, extra, or substituted entry)`)
}

const rulingCounts = (rulings) => ({
  ok: rulings.filter((r) => r === 'OK').length,
  bad: rulings.filter((r) => r === 'BAD').length,
  corrected: rulings.filter((r) => r === 'CORRECTED').length,
})

const finalRulingCounts = (rows) => rulingCounts(rows.map((row) => row.humanRuling))

const normalizeCorrectionValue = (field, value) => {
  if (value === '-' || value === '' || value === null) return null
  if (field === 'claimedNight' && typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim())
  if (field === 'target' && typeof value === 'string') return value.trim()
  return value
}

function assertStoredCorrection(row, raw, rule, note, source, where) {
  invariant(row.corrected && typeof row.corrected === 'object' && !Array.isArray(row.corrected), `${where}: CORRECTED ruling has no stored corrected block`)
  invariant(row.corrected.rule === rule, `${where}: stored correction rule does not match the human packet`)
  invariant(row.corrected.replaced && typeof row.corrected.replaced === 'object', `${where}: corrected block does not preserve replaced values`)
  const expectedKeys = new Set(['rule', 'replaced', ...Object.keys(raw)])
  if (note) expectedKeys.add('note')
  if (typeof raw.quote === 'string' && raw.quote !== '' && raw.quote !== '-') expectedKeys.add('charStart')
  invariant(
    isDeepStrictEqual(Object.keys(row.corrected).sort(), [...expectedKeys].sort()),
    `${where}: stored corrected block has missing or extra fields`,
  )
  invariant(note ? row.corrected.note === note : row.corrected.note === undefined, `${where}: stored correction note does not match the human packet`)
  invariant(
    isDeepStrictEqual(Object.keys(row.corrected.replaced).sort(), Object.keys(raw).sort()),
    `${where}: stored correction replaced-map does not match the corrected fields`,
  )
  for (const [field, value] of Object.entries(raw)) {
    invariant(
      isDeepStrictEqual(row.corrected[field], normalizeCorrectionValue(field, value)),
      `${where}: stored corrected.${field} does not match the finalized packet correction`,
    )
    const prior = field === 'resolvingContext'
      ? source.resolvingContext ?? source.machine?.resolvingContext ?? null
      : source[field] ?? null
    invariant(isDeepStrictEqual(row.corrected.replaced[field], prior), `${where}: corrected.replaced.${field} does not match the source record`)
  }
  if (expectedKeys.has('charStart')) invariant(Number.isInteger(row.corrected.charStart) && row.corrected.charStart >= 0, `${where}: corrected quote has no valid charStart`)
}

function verifyProvenanceManifest(provenance, path) {
  invariant(typeof provenance.manifestVersion === 'string' && provenance.manifestVersion.startsWith('pf2-provenance-'), `${path}: not a PF-2 provenance manifest`)
  invariant(typeof provenance.analysisRunId === 'string' && /^[0-9a-f]{64}$/.test(provenance.analysisRunId), `${path}: missing or malformed analysisRunId`)
  invariant(typeof provenance.codeCommit === 'string' && /^[0-9a-f]{40}$/.test(provenance.codeCommit), `${path}: missing or malformed codeCommit`)
  invariant(
    Array.isArray(provenance.disclosures) && provenance.disclosures.some((text) => /item-level blind/i.test(text) && /not prior-free/i.test(text)),
    `${path}: missing the item-level-blind / not-prior-free disclosure`,
  )
  invariant(Array.isArray(provenance.files) && provenance.files.length > 0, `${path}: files inventory missing or empty`)
  const paths = new Set()
  const counts = {}
  const aggregate = createHash('sha256')
  for (const entry of provenance.files) {
    invariant(entry && typeof entry.path === 'string' && entry.path, `${path}: inventory entry has no path`)
    invariant(!paths.has(entry.path), `${path}: duplicate inventory path ${entry.path}`)
    paths.add(entry.path)
    invariant(typeof entry.kind === 'string' && entry.kind, `${path}: ${entry.path} has no kind`)
    invariant(Number.isInteger(entry.bytes) && entry.bytes >= 0, `${path}: ${entry.path} has invalid byte count`)
    invariant(typeof entry.sha256 === 'string' && /^[0-9a-f]{64}$/.test(entry.sha256), `${path}: ${entry.path} has invalid sha256`)
    const diskPath = isAbsolute(entry.path) ? entry.path : resolve(entry.path)
    invariant(existsSync(diskPath), `${path}: inventoried artifact is missing: ${entry.path}`)
    invariant(statSync(diskPath).size === entry.bytes, `${path}: inventoried byte count changed: ${entry.path}`)
    invariant(sha256File(diskPath) === entry.sha256, `${path}: inventoried bytes differ from the pinned hash: ${entry.path}`)
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1
    aggregate.update(`${entry.path}\x00${entry.sha256}\n`)
  }
  invariant(isDeepStrictEqual(provenance.counts, counts), `${path}: stored kind counts do not re-derive from the file inventory`)
  invariant(aggregate.digest('hex') === provenance.aggregateSha256, `${path}: aggregateSha256 does not re-derive from the file inventory`)
}

function requirePin(entries, artifactPath, expectedKind, label) {
  const digest = sha256File(artifactPath)
  const size = statSync(artifactPath).size
  const matches = (entries ?? []).filter((entry) =>
    basename(entry.path ?? '') === basename(artifactPath) &&
    entry.sha256 === digest &&
    (entry.bytes === undefined || entry.bytes === size) &&
    (expectedKind === null || entry.kind === expectedKind),
  )
  invariant(matches.length === 1, `${label}: artifact is not pinned exactly once with its current bytes`)
  return digest
}

function verifyRatingsContract(ratings, itemIds, where, { requireRuleFor = () => true } = {}) {
  invariant(ratings.answerKeyOpened === false, `${where}: answerKeyOpened must be false`)
  invariant(typeof ratings.rater === 'string' && ratings.rater.trim(), `${where}: rater missing`)
  invariant(typeof ratings.blindSource === 'string' && ratings.blindSource.trim(), `${where}: blindSource missing`)
  exactKeys(ratings.positiveRatings, itemIds, `${where}.positiveRatings`)
  const wanted = new Set(itemIds.map(String))
  for (const id of itemIds.map(String)) {
    const ruling = ratings.positiveRatings[id]
    invariant(RULINGS.includes(ruling), `${where}: item ${id} has invalid ruling ${JSON.stringify(ruling)}`)
    if (requireRuleFor(ruling)) {
      invariant(typeof ratings.rules?.[id] === 'string' && ratings.rules[id].trim(), `${where}: item ${id} has no codebook rule`)
    }
    const hasCorrection = Object.prototype.hasOwnProperty.call(ratings.corrections ?? {}, id)
    invariant(hasCorrection === (ruling === 'CORRECTED'), `${where}: item ${id} correction presence does not match its ruling`)
  }
  for (const [name, map] of [['rules', ratings.rules], ['corrections', ratings.corrections], ['notes', ratings.notes]]) {
    const stray = Object.keys(map ?? {}).filter((id) => !wanted.has(id))
    invariant(stray.length === 0, `${where}.${name}: unknown item ${stray[0]}`)
  }
}

const seededHash = (packetSeed, value) => createHash('sha256')
  .update(packetSeed)
  .update('\x00')
  .update(value)
  .digest('hex')

const packetShuffleHash = (packetSeed, row) => seededHash(packetSeed, `${row.seed}|${row.seq}|${row.kind}|${row.quote ?? ''}`)

function verifyHumanMetadata(actual, expected, where) {
  for (const field of ['rater', 'confirmed', 'ruling', 'via']) {
    invariant(isDeepStrictEqual(actual?.[field], expected[field]), `${where}: human.${field} does not match the finalized ruling path`)
  }
  if (expected.rule !== undefined) invariant(actual.rule === expected.rule, `${where}: human.rule does not match the finalized packet`)
  invariant((actual.note ?? '') === (expected.note ?? ''), `${where}: human.note does not match its source ratings artifact`)
}

/**
 * Validate all PF-2 inputs and return one deterministic, paper-consumable
 * summary. Paths, timestamps, and mutable booleans never enter the result.
 */
export function buildPf2Validation(options) {
  const required = ['manifest', 'provenance', 'key', 'sensitivity', 'packetKey', 'packetRatings', 'confirmedInput']
  for (const name of required) invariant(options?.[name], `build-pf2-validation: missing ${name}`)

  const manifest = loadManifest(options.manifest)
  const provenance = readJson(options.provenance, 'PF-2 provenance')
  verifyProvenanceManifest(provenance, options.provenance)
  invariant(manifest.codeCommit === provenance.codeCommit, 'analysis manifest and PF-2 provenance pin different code commits')
  invariant(
    manifest.analysisRunId === provenance.analysisRunId || (manifest.supersedes ?? []).includes(provenance.analysisRunId),
    'current analysis manifest neither matches nor supersedes the PF-2 provenance run',
  )

  // The current manifest pins the provenance manifest itself and every
  // immutable input. The provenance inventory independently pins the rating-
  // phase artifacts. Both must agree with the bytes supplied on this run.
  const currentPins = manifest.archivedReadings ?? []
  const provenancePins = provenance.files
  const inputSpecs = [
    ['key', 'sealed-key', 'sealedKeySha256'],
    ['sensitivity', 'sensitivity-ratings', 'sensitivityRatingsSha256'],
    ['packetKey', 'packet', 'packetKeySha256'],
    ['packetRatings', 'human-adjudication', 'packetRatingsSha256'],
  ]
  if (options.negativesKey || options.negativesRatings) {
    invariant(options.negativesKey && options.negativesRatings, 'negative key and ratings must be supplied together')
    inputSpecs.push(['negativesKey', 'sealed-key', 'negativesKeySha256'])
    inputSpecs.push(['negativesRatings', 'sensitivity-ratings', 'negativesRatingsSha256'])
  }
  const inputHashes = {
    analysisManifestSha256: sha256File(options.manifest),
    pf2ProvenanceSha256: requirePin(currentPins, options.provenance, 'json', 'PF-2 provenance manifest'),
  }
  for (const [option, kind, outputName] of inputSpecs) {
    const fromProvenance = requirePin(provenancePins, options[option], kind, `${option} PF-2 provenance`)
    const fromCurrent = requirePin(currentPins, options[option], null, `${option} current analysis manifest`)
    invariant(fromCurrent === fromProvenance, `${option}: current and PF-2 provenance hashes disagree`)
    inputHashes[outputName] = fromCurrent
  }
  inputHashes.confirmedInputSha256 = sha256File(options.confirmedInput)

  const sealed = readJsonl(options.key, 'sealed key')
  invariant(sealed.meta.mode === 'positives', 'sealed key: mode must be positives')
  invariant(sealed.meta.analysisRunId === provenance.analysisRunId, 'sealed key: analysisRunId does not match PF-2 provenance')
  invariant(sealed.meta.items === sealed.rows.length, 'sealed key: meta item count does not match its rows')
  const sealedById = new Map()
  for (let index = 0; index < sealed.rows.length; index += 1) {
    const row = sealed.rows[index]
    invariant(row.item === index + 1, `sealed key: row ${index + 1} has a substituted or reordered item id`)
    invariant(row.analysisRunId === sealed.meta.analysisRunId, `sealed key: item ${row.item} has a different analysisRunId`)
    invariant(PUBLISHED_FAMILIES.includes(row.kind), `sealed key: item ${row.item} has unknown family ${JSON.stringify(row.kind)}`)
    invariant(row.machineDecision === 'accepted' || row.machineDecision === 'rejected', `sealed key: item ${row.item} has invalid machineDecision`)
    sealedById.set(String(row.item), row)
  }
  const machineAccepted = sealed.rows.filter((row) => row.machineDecision === 'accepted')
  const machineRejected = sealed.rows.filter((row) => row.machineDecision === 'rejected')
  invariant(sealed.meta.machinePositives === machineAccepted.length, 'sealed key: machinePositives does not re-derive')
  invariant(sealed.meta.rejectedPowerCandidates === machineRejected.length, 'sealed key: rejectedPowerCandidates does not re-derive')

  const sensitivity = readJson(options.sensitivity, 'sensitivity ratings')
  invariant(sensitivity.analysisRunId === sealed.meta.analysisRunId, 'sensitivity ratings: analysisRunId does not match sealed key')
  verifyRatingsContract(sensitivity, sealed.rows.map((row) => row.item), 'sensitivity ratings', {
    requireRuleFor: (ruling) => ruling !== 'OK',
  })

  const packet = readJsonl(options.packetKey, 'packet key')
  invariant(packet.meta.mode === 'adjudication-packet', 'packet key: mode must be adjudication-packet')
  invariant(packet.meta.analysisRunId === sealed.meta.analysisRunId, 'packet key: analysisRunId does not match sealed key')
  invariant(packet.meta.sensitivityRater === sensitivity.rater, 'packet key: sensitivityRater does not match the supplied ratings')
  invariant(typeof packet.meta.seed === 'string' && packet.meta.seed, 'packet key: seed missing')
  invariant(packet.meta.items === packet.rows.length, 'packet key: meta item count does not match its rows')
  const packetByOrigin = new Map()
  const sectionRows = Object.fromEntries(PACKET_SECTIONS.map((section) => [section, []]))
  for (let index = 0; index < packet.rows.length; index += 1) {
    const row = packet.rows[index]
    invariant(row.packetItem === index + 1, `packet key: row ${index + 1} has a substituted or reordered packetItem`)
    invariant(row.analysisRunId === packet.meta.analysisRunId, `packet key: item ${row.packetItem} has a different analysisRunId`)
    invariant(PACKET_SECTIONS.includes(row.section), `packet key: item ${row.packetItem} has unknown section ${JSON.stringify(row.section)}`)
    sectionRows[row.section].push(row)
    if (row.section !== 'recall-miss') {
      invariant(!packetByOrigin.has(String(row.origin)), `packet key: source item ${row.origin} appears twice`)
      packetByOrigin.set(String(row.origin), row)
    }
  }
  for (const section of PACKET_SECTIONS) {
    const metaField = section === 'recall-miss' ? 'misses' : section === 'dispute' ? 'disputes' : 'audit'
    invariant(packet.meta[metaField] === sectionRows[section].length, `packet key: ${metaField} count does not re-derive`)
  }
  invariant(
    packet.meta.items === packet.meta.disputes + packet.meta.audit + packet.meta.misses,
    'packet key: section counts do not sum to items',
  )

  // Every non-OK sensitivity ruling is a dispute, exactly once; no OK may be
  // smuggled into that section. The audit is the deterministic seed-selected
  // prefix of accepted-as-written machine positives.
  const expectedDisputes = sealed.rows.filter((row) => sensitivity.positiveRatings[String(row.item)] !== 'OK')
  invariant(sectionRows.dispute.length === expectedDisputes.length, 'packet key: dispute section is not the full sensitivity non-OK census')
  for (const source of expectedDisputes) {
    const row = packetByOrigin.get(String(source.item))
    invariant(row?.section === 'dispute', `packet key: sensitivity dispute ${source.item} is missing`)
    invariant(row.sensitivityRuling === sensitivity.positiveRatings[String(source.item)], `packet key: dispute ${source.item} carries the wrong sensitivity ruling`)
    invariant(row.seed === source.seed && row.seq === source.seq && row.kind === source.kind, `packet key: dispute ${source.item} identity does not match the sealed key`)
  }
  const auditPool = machineAccepted
    .filter((row) => sensitivity.positiveRatings[String(row.item)] === 'OK')
    .sort((a, b) => packetShuffleHash(packet.meta.seed, a).localeCompare(packetShuffleHash(packet.meta.seed, b)))
  const expectedAuditIds = auditPool.slice(0, packet.meta.audit).map((row) => String(row.item)).sort()
  const actualAuditIds = sectionRows.audit.map((row) => String(row.origin)).sort()
  invariant(isDeepStrictEqual(actualAuditIds, expectedAuditIds), 'packet key: audit section does not re-derive from its seed and declared size')
  for (const row of sectionRows.audit) {
    const source = sealedById.get(String(row.origin))
    invariant(row.sensitivityRuling === 'OK' && source?.machineDecision === 'accepted', `packet key: audit item ${row.packetItem} is not an accepted-as-written machine positive`)
    invariant(row.seed === source.seed && row.seq === source.seq && row.kind === source.kind, `packet key: audit item ${row.packetItem} identity does not match the sealed key`)
  }

  const human = readJson(options.packetRatings, 'packet ratings')
  invariant(human.analysisRunId === packet.meta.analysisRunId, 'packet ratings: analysisRunId does not match packet key')
  invariant(human.packetSeed === packet.meta.seed, 'packet ratings: packetSeed does not match packet key')
  invariant(human.packetVersion === PF2_PACKET_VERSION && human.packetVersion === provenance.packetVersion, 'packet ratings: packetVersion is stale or disagrees with PF-2 provenance')
  invariant(human.packetItems === packet.rows.length, 'packet ratings: packetItems does not match packet key')
  invariant(human.packetKeySha256 === inputHashes.packetKeySha256, 'packet ratings: packetKeySha256 does not match the supplied key')
  invariant(isDeepStrictEqual(human.rulingVocabulary, RULINGS), 'packet ratings: rulingVocabulary does not match the PF-2 contract')
  invariant((manifest.humanRaters ?? []).includes(human.rater), 'packet ratings: rater is not designated as human in the current manifest')
  verifyRatingsContract(human, packet.rows.map((row) => row.packetItem), 'packet ratings')

  // Negative sample and recall-miss pins. Optional only when the packet has
  // no recall-miss rows; a populated recall section without both artifacts is
  // an unverifiable claim substitution and fails closed.
  let negativeKey = null
  let negativeRatings = null
  let expectedRecall = []
  let negativeSummary = {
    rater: null,
    messagesRated: 0,
    messagesWithAnyListedClaim: 0,
    listedClaims: 0,
    publishedFamilyCandidateMessages: 0,
    publishedFamilyCandidates: 0,
    interpretation: 'Targeted candidate cleanup only; not a recall or omission-rate estimate.',
  }
  if (sectionRows['recall-miss'].length > 0) {
    invariant(options.negativesKey && options.negativesRatings, 'packet has recall-miss rows but negative key/ratings were not supplied')
  }
  if (options.negativesKey) {
    negativeKey = readJsonl(options.negativesKey, 'negative sealed key')
    invariant(negativeKey.meta.mode === 'negatives', 'negative sealed key: mode must be negatives')
    invariant(negativeKey.meta.analysisRunId === sealed.meta.analysisRunId, 'negative sealed key: analysisRunId does not match positive sealed key')
    invariant(negativeKey.meta.items === negativeKey.rows.length, 'negative sealed key: meta item count does not match its rows')
    const negativeById = new Map()
    for (const row of negativeKey.rows) {
      invariant(typeof row.item === 'string' && row.item, 'negative sealed key: item id missing')
      invariant(!negativeById.has(row.item), `negative sealed key: duplicate item ${row.item}`)
      invariant(row.analysisRunId === negativeKey.meta.analysisRunId, `negative sealed key: item ${row.item} has a different analysisRunId`)
      invariant(typeof row.text === 'string', `negative sealed key: item ${row.item} has no source text`)
      negativeById.set(row.item, row)
    }
    negativeRatings = readJson(options.negativesRatings, 'negative ratings')
    invariant(negativeRatings.analysisRunId === negativeKey.meta.analysisRunId, 'negative ratings: analysisRunId does not match negative sealed key')
    invariant(negativeRatings.answerKeyOpened === false, 'negative ratings: answerKeyOpened must be false')
    invariant(negativeRatings.rater === sensitivity.rater, 'positive and negative sensitivity ratings name different raters')
    invariant(typeof negativeRatings.blindSource === 'string' && negativeRatings.blindSource.trim(), 'negative ratings: blindSource missing')
    exactKeys(negativeRatings.negativeClaims, negativeKey.rows.map((row) => row.item), 'negative ratings.negativeClaims')

    expectedRecall = []
    let listedClaims = 0
    let messagesWithAny = 0
    let publishedMessages = 0
    for (const source of negativeKey.rows) {
      const claims = negativeRatings.negativeClaims[source.item]
      invariant(Array.isArray(claims), `negative ratings: ${source.item} must map to an array`)
      if (claims.length) messagesWithAny += 1
      let hasPublished = false
      claims.forEach((claim, index) => {
        listedClaims += 1
        try { validateRecoveredClaim({ where: `negative ratings ${source.item} claim ${index}`, claim, text: source.text }) }
        catch (error) { throw new Error(error.message) }
        invariant(typeof claim.quote === 'string' && claim.quote.length > 0, `negative ratings: ${source.item} claim ${index} has no byte-exact quote`)
        const charStart = source.text.indexOf(claim.quote)
        invariant(charStart >= 0, `negative ratings: ${source.item} claim ${index} quote is not in the sealed message`)
        if (KNOWN_KINDS.has(claim.kind)) {
          hasPublished = true
          expectedRecall.push({
            origin: `miss-${source.item}`,
            claimId: `miss-${source.item}#${index}`,
            seed: source.seed,
            seq: source.seq,
            kind: claim.kind,
            claim: { ...recallClaimFingerprint(claim), charStart },
            source,
            listed: claim,
          })
        }
      })
      if (hasPublished) publishedMessages += 1
    }
    invariant(sectionRows['recall-miss'].length === expectedRecall.length, 'packet key: recall-miss section is not the full published-family candidate list')
    const actualByClaimId = new Map()
    for (const row of sectionRows['recall-miss']) {
      invariant(typeof row.claimId === 'string' && !actualByClaimId.has(row.claimId), `packet key: duplicate or missing recall claimId ${JSON.stringify(row.claimId)}`)
      actualByClaimId.set(row.claimId, row)
    }
    for (const expected of expectedRecall) {
      const row = actualByClaimId.get(expected.claimId)
      invariant(row, `packet key: published-family candidate ${expected.claimId} is missing`)
      invariant(row.origin === expected.origin && row.seed === expected.seed && row.seq === expected.seq && row.kind === expected.kind, `packet key: ${expected.claimId} identity does not match the negative sample`)
      invariant(row.sensitivityRuling === 'CLAIMED', `packet key: ${expected.claimId} must carry sensitivityRuling CLAIMED`)
      invariant(isDeepStrictEqual(row.claim, expected.claim), `packet key: ${expected.claimId} fingerprint or span was substituted`)
      expected.packetRow = row
    }
    negativeSummary = {
      rater: negativeRatings.rater,
      messagesRated: negativeKey.rows.length,
      messagesWithAnyListedClaim: messagesWithAny,
      listedClaims,
      publishedFamilyCandidateMessages: publishedMessages,
      publishedFamilyCandidates: expectedRecall.length,
      interpretation: 'Targeted candidate cleanup only; not a recall or omission-rate estimate.',
    }
  }

  // The packet builder applies a second seeded shuffle across all three arms.
  // Re-derive the exact row order, including stable order for multiple claims
  // on one negative message; a re-keyed or manually reordered packet must not
  // be described as the frozen shuffled sitting.
  const expectedPacketOrder = [
    ...expectedDisputes.map((row) => ({ section: 'dispute', origin: row.item, claimId: null, seed: row.seed, seq: row.seq, kind: row.kind })),
    ...auditPool.slice(0, packet.meta.audit).map((row) => ({ section: 'audit', origin: row.item, claimId: null, seed: row.seed, seq: row.seq, kind: row.kind })),
    ...expectedRecall.map((row) => ({ section: 'recall-miss', origin: row.origin, claimId: row.claimId, seed: row.seed, seq: row.seq, kind: row.kind })),
  ].sort((a, b) => seededHash(packet.meta.seed, `${a.seed}|${a.seq}|${a.kind}|${a.origin}`)
    .localeCompare(seededHash(packet.meta.seed, `${b.seed}|${b.seq}|${b.kind}|${b.origin}`)))
  const orderIdentity = (row) => `${row.section}|${row.origin}|${row.claimId ?? ''}`
  invariant(
    isDeepStrictEqual(packet.rows.map(orderIdentity), expectedPacketOrder.map(orderIdentity)),
    'packet key: full shuffled order does not re-derive from its seed and three source arms',
  )

  // Human packet comparisons are pure counts over the sealed section labels;
  // no inferred semantic category is introduced here.
  const compared = packet.rows.map((row) => ({
    ...row,
    humanRuling: human.positiveRatings[String(row.packetItem)],
  }))
  const disputes = compared.filter((row) => row.section === 'dispute')
  const audit = compared.filter((row) => row.section === 'audit')
  const recall = compared.filter((row) => row.section === 'recall-miss')
  const matrixFor = (rows, sensitivityValues) => Object.fromEntries(sensitivityValues.map((sensitivityRuling) => [
    sensitivityRuling,
    Object.fromEntries(RULINGS.map((humanRuling) => [
      humanRuling.toLowerCase(),
      rows.filter((row) => row.sensitivityRuling === sensitivityRuling && row.humanRuling === humanRuling).length,
    ])),
  ]))
  const auditConfirmedAsWritten = audit.filter((row) => row.humanRuling === 'OK').length

  // The confirmed-input is not an opaque count source. Reconstruct the
  // expected ruling path for every sealed source row and every retained miss,
  // then require exactly those row identities and the independently derived
  // meta counts.
  const confirmed = readJsonl(options.confirmedInput, 'confirmed input')
  invariant(confirmed.meta.mode === 'confirmed-input', 'confirmed input: mode must be confirmed-input')
  invariant(confirmed.meta.analysisRunId === manifest.analysisRunId, 'confirmed input: analysisRunId does not match current manifest')
  if (manifest.analysisRunId === sealed.meta.analysisRunId) {
    invariant(confirmed.meta.ratedUnderRunId === undefined, 'confirmed input: ratedUnderRunId must be absent when no supersession occurred')
  } else {
    invariant(confirmed.meta.ratedUnderRunId === sealed.meta.analysisRunId, 'confirmed input: ratedUnderRunId does not identify the frozen rating run')
  }
  invariant(confirmed.meta.rater === human.rater && confirmed.meta.sensitivityRater === sensitivity.rater, 'confirmed input: rater identities do not match the supplied ratings')
  invariant(confirmed.meta.design === 'PF-2 targeted human pass, v3.2 §3 OK/BAD/CORRECTED', 'confirmed input: design label does not match PF-2')
  invariant(isDeepStrictEqual(confirmed.meta.rulingVocabulary, RULINGS), 'confirmed input: rulingVocabulary does not match PF-2')
  invariant(confirmed.meta.items === confirmed.rows.length, 'confirmed input: meta items does not match row count')
  const confirmedByItem = new Map()
  for (const row of confirmed.rows) {
    const id = String(row.item)
    invariant(!confirmedByItem.has(id), `confirmed input: duplicate item ${id}`)
    invariant(row.analysisRunId === manifest.analysisRunId, `confirmed input: item ${id} has stale analysisRunId`)
    confirmedByItem.set(id, row)
  }

  let expectedConfirmed = 0
  let expectedExcluded = 0
  let expectedCorrected = 0
  let sensitivityUncontested = 0
  for (const source of sealed.rows) {
    const id = String(source.item)
    const row = confirmedByItem.get(id)
    invariant(row, `confirmed input: sealed source item ${id} is missing`)
    const sourceProjection = Object.fromEntries(Object.entries(source).filter(([field]) => field !== 'analysisRunId'))
    const rowProjection = Object.fromEntries(Object.entries(row).filter(([field]) => !['analysisRunId', 'human', 'corrected'].includes(field)))
    invariant(isDeepStrictEqual(rowProjection, sourceProjection), `confirmed input: sealed source fields changed for item ${id}`)
    const packetRow = packetByOrigin.get(id)
    const humanRuling = packetRow ? human.positiveRatings[String(packetRow.packetItem)] : sensitivity.positiveRatings[id]
    const isConfirmed = humanRuling === 'OK' || humanRuling === 'CORRECTED'
    if (isConfirmed) expectedConfirmed += 1
    else expectedExcluded += 1
    const expectedHuman = packetRow ? {
      rater: human.rater,
      confirmed: isConfirmed,
      ruling: humanRuling,
      via: `packet-${packetRow.section}`,
      rule: human.rules[String(packetRow.packetItem)],
      note: human.notes?.[String(packetRow.packetItem)] ?? '',
    } : {
      rater: sensitivity.rater,
      confirmed: isConfirmed,
      ruling: humanRuling,
      via: 'sensitivity-uncontested',
      note: sensitivity.notes?.[id] ?? '',
    }
    verifyHumanMetadata(row.human, expectedHuman, `confirmed input item ${id}`)
    if (!packetRow) sensitivityUncontested += 1
    if (humanRuling === 'CORRECTED') {
      expectedCorrected += 1
      invariant(packetRow, `confirmed input item ${id}: uncontested sensitivity CORRECTED is not final`)
      assertStoredCorrection(row, human.corrections[String(packetRow.packetItem)], expectedHuman.rule, expectedHuman.note, source, `confirmed input item ${id}`)
    } else {
      invariant(row.corrected === undefined, `confirmed input item ${id}: non-CORRECTED ruling carries a corrected block`)
    }
  }

  const expectedRecoveredIds = new Set()
  if (negativeKey) {
    const negativeById = new Map(negativeKey.rows.map((row) => [row.item, row]))
    for (const packetRow of sectionRows['recall-miss']) {
      const packetItem = String(packetRow.packetItem)
      const ruling = human.positiveRatings[packetItem]
      if (ruling === 'BAD') continue
      const match = /^miss-(.+)#(\d+)$/.exec(packetRow.claimId)
      invariant(match, `packet key: malformed recall claimId ${packetRow.claimId}`)
      const source = negativeById.get(match[1])
      const listed = negativeRatings.negativeClaims[match[1]][Number(match[2])]
      const row = confirmedByItem.get(packetRow.claimId)
      invariant(row, `confirmed input: confirmed recall candidate ${packetRow.claimId} is missing`)
      expectedRecoveredIds.add(packetRow.claimId)
      const validated = validateRecoveredClaim({ where: packetRow.claimId, claim: listed, text: source.text })
      invariant(validated.publishable, `confirmed input: ${packetRow.claimId} is not a published-family claim`)
      invariant(row.machineDecision === 'missed-recovered', `confirmed input: ${packetRow.claimId} is not marked missed-recovered`)
      invariant(row.seed === source.seed && row.seq === source.seq && row.kind === listed.kind, `confirmed input: recovered identity changed for ${packetRow.claimId}`)
      invariant(row.quote === listed.quote && row.charStart === packetRow.claim.charStart, `confirmed input: recovered receipt changed for ${packetRow.claimId}`)
      for (const [field, value] of Object.entries(validated.fields)) {
        invariant(isDeepStrictEqual(row[field], value), `confirmed input: recovered ${packetRow.claimId}.${field} changed`)
      }
      const expectedRecoveredBase = {
        item: packetRow.claimId,
        seed: source.seed,
        game: source.game ?? null,
        seq: source.seq,
        seat: source.seat ?? source.actor,
        day: source.day,
        kind: listed.kind,
        ...validated.fields,
        quote: listed.quote,
        charStart: packetRow.claim.charStart,
        machineDecision: 'missed-recovered',
        analysisRunId: manifest.analysisRunId,
        sources: ['negative-sample'],
        machine: { asserted: true, kind: listed.kind, fields: { ...validated.fields } },
      }
      const recoveredProjection = Object.fromEntries(Object.entries(row).filter(([field]) => !['human', 'corrected'].includes(field)))
      invariant(isDeepStrictEqual(recoveredProjection, expectedRecoveredBase), `confirmed input: recovered record body changed for ${packetRow.claimId}`)
      const expectedHuman = {
        rater: human.rater,
        confirmed: true,
        ruling,
        via: 'packet-recall-miss',
        rule: human.rules[packetItem],
        note: human.notes?.[packetItem] ?? '',
      }
      verifyHumanMetadata(row.human, expectedHuman, `confirmed input ${packetRow.claimId}`)
      expectedConfirmed += 1
      if (ruling === 'CORRECTED') {
        expectedCorrected += 1
        assertStoredCorrection(row, human.corrections[packetItem], expectedHuman.rule, expectedHuman.note, expectedRecoveredBase, `confirmed input ${packetRow.claimId}`)
      } else invariant(row.corrected === undefined, `confirmed input ${packetRow.claimId}: non-CORRECTED ruling carries a corrected block`)
    }
  }
  const allowedIds = new Set([...sealedById.keys(), ...expectedRecoveredIds])
  invariant(confirmedByItem.size === allowedIds.size, 'confirmed input: unexpected, missing, or duplicate records relative to sealed sources and confirmed misses')
  for (const id of confirmedByItem.keys()) invariant(allowedIds.has(id), `confirmed input: unexpected item ${id}`)

  const expectedMeta = {
    total: sealed.rows.length,
    humanRuled: packet.rows.length - sectionRows['recall-miss'].length,
    sensitivityOnly: sensitivityUncontested,
    confirmed: expectedConfirmed,
    corrected: expectedCorrected,
    excluded: expectedExcluded,
    missesAdded: expectedRecoveredIds.size,
  }
  for (const [field, value] of Object.entries(expectedMeta)) {
    invariant(confirmed.meta[field] === value, `confirmed input: meta.${field}=${JSON.stringify(confirmed.meta[field])} does not re-derive as ${value}`)
  }

  const acceptedByFamily = Object.fromEntries(PUBLISHED_FAMILIES.map((family) => {
    const rows = machineAccepted.filter((row) => row.kind === family)
    const counts = rulingCounts(rows.map((row) => sensitivity.positiveRatings[String(row.item)]))
    return [family, { rated: rows.length, ...counts, okRate: rows.length ? counts.ok / rows.length : null }]
  }))
  const sensitivityCounts = rulingCounts(sealed.rows.map((row) => sensitivity.positiveRatings[String(row.item)]))
  const rejectedCounts = rulingCounts(machineRejected.map((row) => sensitivity.positiveRatings[String(row.item)]))
  const disputeFinal = finalRulingCounts(disputes)
  const recallFinal = finalRulingCounts(recall)

  return {
    schemaVersion: 'pf2-validation-v3.2.6',
    analysisRunId: manifest.analysisRunId,
    ratedUnderRunId: sealed.meta.analysisRunId,
    design: 'PF-2 targeted human pass (exploratory v1)',
    scope: {
      itemLevelBlind: true,
      priorFree: false,
      semanticResults: 'exploratory, author-adjudicated, and potentially incomplete',
      generalRecallOrOmissionRateEstimated: false,
    },
    provenance: {
      codeCommit: provenance.codeCommit,
      codeCommitScope: 'rating/extraction pipeline pinned by the analysis and PF-2 manifests',
      generatorSourceSha256: sha256File(fileURLToPath(import.meta.url)),
      pf2AggregateSha256: provenance.aggregateSha256,
      inputs: inputHashes,
    },
    sensitivityRater: sensitivity.rater,
    humanRater: human.rater,
    sensitivityPass: {
      itemsRated: sealed.rows.length,
      machineAcceptedCandidates: machineAccepted.length,
      rejectedPowerCandidates: machineRejected.length,
      rulings: sensitivityCounts,
      machineAcceptedByFamily: acceptedByFamily,
      rejectedCandidateRulings: rejectedCounts,
      metricLabel: 'sensitivity-rater ruling counts and OK-rate; not precision or recall',
    },
    humanPacket: {
      items: packet.rows.length,
      blind: true,
      shuffled: true,
      disputes: {
        n: disputes.length,
        sensitivityRulings: rulingCounts(disputes.map((row) => row.sensitivityRuling)),
        finalRulings: disputeFinal,
        exactAgreement: disputes.filter((row) => row.sensitivityRuling === row.humanRuling).length,
        changed: disputes.filter((row) => row.sensitivityRuling !== row.humanRuling).length,
        finalConfirmed: disputeFinal.ok + disputeFinal.corrected,
        finalExcluded: disputeFinal.bad,
        rulingMatrix: matrixFor(disputes, ['BAD', 'CORRECTED']),
      },
      audit: {
        n: audit.length,
        confirmedAsWritten: auditConfirmedAsWritten,
        changed: audit.length - auditConfirmedAsWritten,
        finalRulings: finalRulingCounts(audit),
        confirmationRate: audit.length ? auditConfirmedAsWritten / audit.length : null,
        wilson95: wilson(auditConfirmedAsWritten, audit.length),
        targetPopulation: 'sensitivity-rater OK rulings on machine-accepted candidates',
        targetPopulationSize: machineAccepted.filter((row) => sensitivity.positiveRatings[String(row.item)] === 'OK').length,
        sensitivityUncontestedRemainder: sensitivityUncontested,
        metricLabel: 'human confirmation rate on the seeded audited-accept sample; not two-human agreement',
      },
      recallMiss: {
        n: recall.length,
        confirmed: recallFinal.ok + recallFinal.corrected,
        excluded: recallFinal.bad,
        corrected: recallFinal.corrected,
        finalRulings: recallFinal,
        interpretation: 'Targeted candidate cleanup only; not a recall or omission-rate estimate.',
      },
    },
    targetedCandidateScan: negativeSummary,
    finalLedgerInput: {
      records: confirmed.rows.length,
      sourceCandidates: sealed.rows.length,
      confirmed: expectedConfirmed,
      excluded: expectedExcluded,
      corrected: expectedCorrected,
      humanFinal: packet.rows.length,
      humanRuledSourceCandidates: expectedMeta.humanRuled,
      sensitivityUncontested,
      recoveredMisses: expectedRecoveredIds.size,
    },
  }
}

export function writePf2Validation(options) {
  const summary = buildPf2Validation(options)
  const out = resolve(options.out)
  mkdirSync(dirname(out), { recursive: true })
  const tmp = `${out}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(summary, null, 2)}\n`)
  renameSync(tmp, out)
  return summary
}

async function main() {
  const { values } = parseArgs({
    options: {
      manifest: { type: 'string' },
      provenance: { type: 'string' },
      key: { type: 'string' },
      sensitivity: { type: 'string' },
      'packet-key': { type: 'string' },
      'packet-ratings': { type: 'string' },
      'negatives-key': { type: 'string' },
      'negatives-ratings': { type: 'string' },
      'confirmed-input': { type: 'string' },
      out: { type: 'string', default: 'runs/analysis-v3.2/stats/pf2-validation.json' },
    },
  })
  const required = ['manifest', 'provenance', 'key', 'sensitivity', 'packet-key', 'packet-ratings', 'confirmed-input']
  for (const flag of required) invariant(values[flag], `--${flag} is required`)
  const summary = writePf2Validation({
    manifest: values.manifest,
    provenance: values.provenance,
    key: values.key,
    sensitivity: values.sensitivity,
    packetKey: values['packet-key'],
    packetRatings: values['packet-ratings'],
    negativesKey: values['negatives-key'],
    negativesRatings: values['negatives-ratings'],
    confirmedInput: values['confirmed-input'],
    out: values.out,
  })
  console.log(`wrote ${resolve(values.out)}: ${summary.sensitivityPass.itemsRated} sensitivity items, ` +
    `${summary.humanPacket.items} human packet items, ${summary.finalLedgerInput.records} confirmed-input records`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error.message ?? error)
    process.exitCode = 1
  })
}
