// Publication gates (spec §7) — evaluates every gate it can from the
// artifacts on disk and refuses publication (exit 1) unless ALL pass.
// Three-valued on purpose: PASS (checked and holds), FAIL (checked and
// violated), PENDING (the artifact this gate needs does not exist yet).
// PENDING blocks publication exactly like FAIL — a gate that could not be
// evaluated has not been passed.
//
//   node scripts/check-gates.mjs [--manifest runs/analysis-v3/manifest.json]
//        [--publication runs/analysis-v3/publication.json]
//        [--agreement runs/analysis-v3/handcheck/agreement.json] ...
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { isDeepStrictEqual } from 'node:util'
import {
  checkExtractionMeta, checkRunId, sha256File, sha256Hex, verifyManifest,
} from './analysis-manifest.mjs'
import { derivePublishability } from './publication-omission.mjs'
import { aggregateClaimPropositions, CLAIM_PROPOSITION_VERSION } from './claim-propositions.mjs'
import {
  verifyCleanroomAttestation,
} from './build-cleanroom-v3.mjs'
import { EVALUATOR_VERSION, gameFacts, resolveEffectiveClaimTarget } from '../packages/seats/scripts/scoring-v3.mjs'

const { values } = parseArgs({
  options: {
    manifest: { type: 'string', default: 'runs/analysis-v3/manifest.json' },
    logs: { type: 'string' },
    spec: { type: 'string' },
    publication: { type: 'string', default: 'runs/analysis-v3/publication.json' },
    agreement: { type: 'string', default: 'runs/analysis-v3/handcheck/agreement.json' },
    extract: { type: 'string', default: 'runs/analysis-v3/extract' },
    ledger: { type: 'string', default: 'runs/analysis-v3/ledger' },
    'tripwire-report': { type: 'string' },
    cleanroom: { type: 'string', default: 'runs/analysis-v3/cleanroom.json' },
    outdir: { type: 'string', default: 'runs/analysis-v3' },
  },
})

const PUBLISHED_FAMILIES = ['role_claim', 'not_mafia_claim', 'investigation_claim', 'protection_claim']
const PUBLISHED_VERDICTS = ['true', 'false', 'ambiguous']

const readJson = (p) => (p && existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null)
const readJsonl = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
const listFiles = (dir, re) => (existsSync(dir) ? readdirSync(dir).filter((f) => re.test(f)).sort() : [])
const PASS = (detail) => ({ status: 'PASS', detail })
const FAIL = (detail) => ({ status: 'FAIL', detail })
const PENDING = (reason) => ({ status: 'PENDING', detail: reason })
// The manifest checks throw on failure (§5 hard-fail); gates convert the
// throw into a FAIL row so every gate still gets evaluated and printed.
const attempt = (fn) => {
  try {
    fn()
    return { ok: true, errors: [] }
  } catch (e) {
    return { ok: false, errors: e.errors ?? [e.message] }
  }
}

// 95% Wilson score interval, same formula agreement.mjs publishes with.
function wilson(k, n) {
  if (n === 0) return [null, null]
  const z = 1.96, p = k / n
  const den = 1 + (z * z) / n
  const mid = (p + (z * z) / (2 * n)) / den
  const half = (z / den) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [Math.max(0, mid - half), Math.min(1, mid + half)]
}

const manifest = readJson(values.manifest)
const publication = readJson(values.publication)

// ---- gate definitions ----------------------------------------------------

const gates = []
const gate = (id, name, fn) => gates.push({ id, name, fn })

// §7: all 40 roots verify; 100% message coverage of the frozen inputs; zero
// malformed records. verifyManifest re-walks every chain byte-for-byte.
gate('G1', 'integrity: roots verify, logs unchanged, spec pinned', () => {
  const r = attempt(() => verifyManifest(manifest, { logsDir: values.logs, specPath: values.spec }))
  return r.ok
    ? PASS(`${manifest.logs.count} logs, chains and roots verified, runId ${manifest.analysisRunId.slice(0, 12)}…`)
    : FAIL(r.errors[0] + (r.errors.length > 1 ? ` (+${r.errors.length - 1} more)` : ''))
})

// §3 engineering: complete message coverage or nonzero exit — every game
// extracted, every meta carrying the current content-addressed cacheKey.
gate('G2', 'extraction: 100% message coverage, fresh cache keys', () => {
  const files = listFiles(values.extract, /\.claims\.jsonl$/)
  if (files.length === 0) return PENDING(`no extraction outputs in ${values.extract}`)
  const seeds = new Set(Object.keys(manifest.logs.files))
  const errors = []
  const seen = new Set()
  for (const f of files) {
    const meta = readJsonl(join(values.extract, f)).find((l) => l._meta)
    if (!meta) { errors.push(`${f}: no meta line`); continue }
    seen.add(meta.seed)
    errors.push(...attempt(() => checkExtractionMeta(manifest, meta)).errors)
  }
  for (const s of seeds) if (!seen.has(s)) errors.push(`${s}: no extraction output`)
  return errors.length ? FAIL(errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} more)` : ''))
    : PASS(`${seen.size}/${seeds.size} games extracted, all metas current`)
})

// §6.1 / §7 as amended by PF-2 (docs/analysis/amendments/PF-2.md): every
// published positive carries an explicit blind reviewer confirmation;
// disputes, the audit sample, and recall-misses are human-ruled (human
// final); a ledger containing sensitivity-uncontested confirmations must
// publish the PF-2 validation block (audit-measured residual error bound).
// Inv/prot candidates: accepted ones are the ledger; rejected ones must
// each appear in the sealed review key (they were on the sheets).
gate('G3', 'reviewer confirmation of every published positive (PF-2: human-final on disputes + audit)', () => {
  // §3 ledger vocabulary is closed at exactly true|false|ambiguous — the
  // same set build-publication refuses to exceed. A machine-positive the
  // review did not uphold never enters the ledger; any other verdict is a
  // malformed record (§7: zero malformed records), a FAIL — never a
  // tolerated extra or a silent skip past the confirmation requirement.
  // Only verdict-stamped ledgers are audited here: the confirmed-INPUT
  // (mode confirmed-input) is the pre-scoring intermediate and carries no
  // verdicts by design — sweeping it would fail every record.
  const ledgerFiles = listFiles(values.ledger, /\.jsonl$/).filter((f) => {
    try { return JSON.parse(readFileSync(join(values.ledger, f), 'utf8').split('\n')[0]).mode === 'ledger' } catch { return false }
  })
  if (ledgerFiles.length === 0) return PENDING(`no verdict-stamped ledger (meta mode "ledger") in ${values.ledger}`)
  let confirmed = 0
  let uncontested = 0
  const errors = []
  const confirmedInputHashes = new Set()
  for (const f of ledgerFiles) {
    const rows = readJsonl(join(values.ledger, f))
    const ledgerMeta = rows.find((row) => row._meta)
    if (typeof ledgerMeta?.confirmedInputSha256 !== 'string') {
      errors.push(`${f}: ledger metadata lacks confirmedInputSha256`)
    } else confirmedInputHashes.add(ledgerMeta.confirmedInputSha256)
    for (const c of rows) {
      if (c._meta || !PUBLISHED_FAMILIES.includes(c.kind)) continue
      if (!PUBLISHED_VERDICTS.includes(c.verdict)) {
        errors.push(`${c.seed} seq ${c.seq} ${c.kind}: unknown verdict ${JSON.stringify(c.verdict ?? null)}`)
      } else if (c.human?.confirmed === true) {
        confirmed += 1
        if (c.human.via === 'sensitivity-uncontested') uncontested += 1
      } else errors.push(`${c.seed} seq ${c.seq} ${c.kind}: published verdict without reviewer confirmation`)
    }
  }
  // PF-2: sensitivity-uncontested confirmations are legitimate ONLY with
  // the published validation block (one-human audit confirmation + dispute
  // counts), bound to the exact confirmed-input every cohort ledger scored.
  if (uncontested > 0) {
    let pub = null
    try { pub = JSON.parse(readFileSync(values.publication, 'utf8')) } catch { pub = null }
    const pf2 = pub?.validation?.pf2 ?? pub?.sections?.pf2
    if (typeof pf2?.humanPacket?.audit?.confirmationRate !== 'number') {
      errors.push(`${uncontested} sensitivity-uncontested confirmations but the publication carries no PF-2 validation block`)
    }
    const pf2InputHash = pf2?.provenance?.inputs?.confirmedInputSha256
    if (confirmedInputHashes.size !== 1 || !confirmedInputHashes.has(pf2InputHash)) {
      errors.push('PF-2 validation is not bound to the confirmed-input hash shared by the scored ledgers')
    }
  }
  // §6.1 (PF-2 reading): accepted inv/prot candidates are the ledger;
  // REJECTED ones must each appear in the sealed review key — they were on
  // the confirm-all sheets by construction. Classifier-negatives are
  // covered by the §6.2 sample, not an exhaustive pass.
  const INV_PROT = ['investigation_claim', 'protection_claim']
  const isInvProt = (c) => [c.kind, c.candidate?.kind, c.machine?.kind].some((k) => INV_PROT.includes(k))
  const keyPath = join(values.outdir, 'handcheck', 'sealed-key.jsonl')
  const reviewed = new Set()
  try {
    for (const k of readJsonl(keyPath)) if (!k._meta) reviewed.add(`${k.seed}|${k.seq}|rejected:${k.machineDecision === 'rejected'}`)
  } catch { return PENDING(`no sealed review key at ${keyPath} to audit rejected inv/prot coverage`) }
  const rejectFiles = listFiles(values.extract, /\.rejects\.jsonl$/)
  if (rejectFiles.length === 0) return PENDING('ledger present but no rejects files to audit inv/prot review completeness')
  for (const f of rejectFiles) {
    for (const c of readJsonl(join(values.extract, f))) {
      if (c._meta || !isInvProt(c)) continue
      if (!reviewed.has(`${c.seed}|${c.seq}|rejected:true`)) {
        errors.push(`${c.seed ?? f} seq ${c.seq ?? '?'}: rejected inv/prot candidate absent from the review sheets`)
      }
    }
  }
  return errors.length ? FAIL(errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} more)` : ''))
    : PASS(`${confirmed} published positives reviewer-confirmed (${uncontested} uncontested under PF-2); rejected inv/prot all on the sheets`)
})

// §3.1: tripwire lexicon must show ≥95% quote-level coverage per published
// family against the archived v2 ledger, and the report must be the exact
// bytes the manifest pinned.
gate('G4', 'tripwire validation ≥95% per published family', () => {
  const path = values['tripwire-report'] ?? manifest.tripwire.validationReportPath
  const report = readJson(path)
  if (!report) return PENDING(`no tripwire validation report at ${path}`)
  if (!manifest.tripwire.validationReportSha256) return FAIL('report exists but its hash is not pinned in the manifest')
  if (sha256File(path) !== manifest.tripwire.validationReportSha256) {
    return FAIL('report bytes differ from the hash pinned in the manifest')
  }
  // tripwire.mjs pins the lexicon by content hash (sha256 of the JSON
  // value); the manifest pins the file bytes. Bind report -> pinned file by
  // recomputing the content hash from the pinned file.
  if (report.lexiconSha256) {
    const lexPath = manifest.tripwire.lexiconPath
    if (!lexPath || !existsSync(lexPath)) return FAIL('manifest pins no readable lexicon to check the report against')
    const contentHash = sha256Hex(JSON.stringify(JSON.parse(readFileSync(lexPath, 'utf8'))))
    if (report.lexiconSha256 !== contentHash) {
      return FAIL('report was validated against a different lexicon than the manifest pins')
    }
  }
  return checkTripwire(report, path)
})
// tripwire.mjs reports lexiconCoverage per family: the share of that
// family's archived v2 quotes the lexicon (any pattern) catches — the
// recall figure §3.1 gates on, since any hit queues the message for review.
function checkTripwire(report, path) {
  const families = report.families ?? report.perFamily ?? report.coverage
  if (!families) return FAIL(`${path}: no per-family coverage section`)
  const covOf = (entry) => (typeof entry === 'number' ? entry : entry?.lexiconCoverage ?? entry?.coverage)
  const errors = []
  for (const fam of PUBLISHED_FAMILIES) {
    const cov = covOf(families[fam])
    if (cov === undefined) errors.push(`${fam}: coverage missing`)
    else if (cov < 0.95) errors.push(`${fam}: coverage ${(cov * 100).toFixed(1)}% < 95%`)
  }
  return errors.length ? FAIL(errors.join('; '))
    : PASS(PUBLISHED_FAMILIES.map((f) => `${f} ${(100 * covOf(families[f])).toFixed(1)}%`).join(', '))
}

// §6.4 / §7: negative-sample miss rate with a Wilson interval, and
// lower-bound language wherever recall is unproven (§6.5 honesty fallback).
// §6.2 (PF-2 reading): the PUBLISHED-family miss rate is sweep 1's recall
// number; the full-codebook rate (shelved votes included) must be reported
// BESIDE it — publishing the conflated figure as "the" recall was itself a
// caught defect. Both sub-objects must recompute.
gate('G5', 'semantic omission evidence matches the declared validation scope', () => {
  if (!publication) return PENDING(`no publication at ${values.publication}`)
  if (publication.honesty?.mode === 'exploratory-v1') {
    if (publication.negativeSample !== undefined) {
      return FAIL('exploratory-v1 must not publish the model candidate scan as a negative-sample recall estimate')
    }
    const scope = publication.honesty.semanticResults
    if (publication.honesty.protocol !== 'PF-2 single-author adjudication (exploratory v1)' ||
        scope?.exploratory !== true || scope?.authorAdjudicated !== true ||
        scope?.potentiallyIncomplete !== true || scope?.generalRecallOrOmissionRateEstimated !== false ||
        scope?.section8ThreeArmValidation !== 'deferred beyond v1') {
      return FAIL('exploratory-v1 honesty scope is incomplete or contradictory')
    }
    if (publication.honesty.validation !== undefined) {
      return FAIL('exploratory-v1 embeds §8 validation even though the three-arm sitting is declared deferred')
    }
    if (publication.sections?.humanValidation !== undefined) {
      return FAIL('exploratory-v1 embeds the agreement artifact, leaking negative-sample miss-rate/Wilson fields despite declaring no recall or omission-rate estimate')
    }
    const scan = publication.targetedCandidateScan
    if (!scan || !Number.isInteger(scan.messagesScreened) || scan.messagesScreened <= 0 ||
        !Number.isInteger(scan.publishedFamilyCandidateMessages) || scan.publishedFamilyCandidateMessages < 0 ||
        !Number.isInteger(scan.fullCodebookCandidateMessages) || scan.fullCodebookCandidateMessages < scan.publishedFamilyCandidateMessages ||
        !/not a recall or omission-rate estimate/i.test(scan.interpretation ?? '')) {
      return FAIL('exploratory-v1 targetedCandidateScan is missing, malformed, or not explicitly disclaimed as a recall/omission-rate estimate')
    }
    if (!publication.sections?.pf2?.humanPacket?.audit ||
        typeof publication.sections.pf2.humanPacket.audit.confirmationRate !== 'number') {
      return FAIL('exploratory-v1 lacks the completed PF-2 human-packet audit evidence')
    }
    const agreement = readJson(values.agreement)
    const row = agreement?.negatives?.perRater?.find((r) => r.rater === scan.rater)
    if (!row || row.ratedItems !== scan.messagesScreened ||
        row.publishedFamilies?.itemsWithMiss !== scan.publishedFamilyCandidateMessages ||
        row.fullCodebook?.itemsWithMiss !== scan.fullCodebookCandidateMessages) {
      return FAIL('targetedCandidateScan counts do not match the bound agreement artifact')
    }
    const omitted = publication.sections?.falseStatementLedger?.omittedFamilies
    if (!Array.isArray(omitted) || omitted.length !== 0) {
      return FAIL('exploratory-v1 cannot claim §8 threshold-based family omissions without running §8')
    }
    return PASS(`${scan.publishedFamilyCandidateMessages} published-family candidate message(s) human-adjudicated as targeted cleanup; no recall/omission rate claimed`)
  }
  const ns = publication.negativeSample
  if (!ns) return FAIL('publication lacks a negativeSample section')
  if (typeof ns.n !== 'number') return FAIL('negativeSample.n missing')
  for (const [label, sub] of [['publishedFamilies', ns.publishedFamilies], ['fullCodebook', ns.fullCodebook]]) {
    if (!sub || typeof sub.itemsWithMiss !== 'number' || typeof sub.missRate !== 'number' || !Array.isArray(sub.wilson95)) {
      return FAIL(`negativeSample.${label} must publish {itemsWithMiss, missRate, wilson95}`)
    }
    if (Math.abs(sub.missRate - sub.itemsWithMiss / ns.n) > 1e-9) return FAIL(`${label}.missRate ≠ itemsWithMiss/n`)
    const [lo, hi] = wilson(sub.itemsWithMiss, ns.n)
    if (Math.abs(sub.wilson95[0] - lo) > 1e-6 || Math.abs(sub.wilson95[1] - hi) > 1e-6) {
      return FAIL(`${label}.wilson95 does not recompute`)
    }
  }
  if (ns.misses !== ns.publishedFamilies.itemsWithMiss) {
    return FAIL('legacy scalar fields must equal the published-family figure — the conflated rate must never lead')
  }
  // v3.2 §9 retires lower-bound language: "at least N" is one-directional and
  // survives only without false positives, and the row-level audit found 20.
  // A v3.2 publication carries the §8 protocol label BACKED BY EVIDENCE —
  // the review (finding 10) showed a bare label is satisfiable by a constant
  // the assembler always writes, so this gate audits the evidence, not the
  // label: the embedded validation summary must exist, its per-family
  // retained-precision lower bounds must recompute, and every family that
  // misses the floor must actually be omitted from the published totals.
  // (Archived v3.1 artifacts validate at the manifest-pinned code commit,
  // never against this gate.)
  // v3.2.2 (closure rerun finding 6): the §8 evidence-and-omission audit runs
  // on EVERY protocol-labeled publication — rater count is about recall
  // honesty, not the Tier L precision gate, so it never switches this off.
  if (typeof publication.honesty?.protocol === 'string') {
    const val = publication.honesty?.validation
    if (!val?.census?.byFamily || !val?.rater) {
      return FAIL('§8 protocol asserted but no validation evidence embedded (honesty.validation with census.byFamily and rater)')
    }
    const omitted = new Set((publication.sections?.falseStatementLedger?.omittedFamilies ?? []).map((o) => o.family))
    const expectedOmitted = new Set()
    const publishedByKind = publication.sections?.falseStatementLedger?.totals?.byKind ?? {}
    for (const [fam, v] of Object.entries(val.census.byFamily)) {
      if (typeof v?.n !== 'number' || typeof v?.upheld !== 'number') {
        return FAIL(`honesty.validation.census.byFamily.${fam} lacks {n, upheld}`)
      }
      // v3.2.2: publishability is DERIVED from the validated counts and the
      // ONE frozen floor definition (publication-omission.mjs) — a stored
      // tierLPublishable boolean is never trusted, and a contradictory flag is
      // itself a failure (closure review finding 3; rerun finding 7 killed the
      // hardcoded third copy of the thresholds).
      const derived = derivePublishability({ n: v.n, upheld: v.upheld })
      if (v.tierLPublishable !== undefined && v.tierLPublishable !== derived.publishable) {
        return FAIL(`${fam}: stored tierLPublishable=${v.tierLPublishable} contradicts the derivation (n=${v.n}, upheld=${v.upheld}, lo=${derived.lowerBound?.toFixed(4)})`)
      }
      if (v.n > 0 && !derived.publishable) {
        expectedOmitted.add(fam)
        if (!omitted.has(fam)) return FAIL(`${fam}: §8 gate unmet (derived) but the family is not in omittedFamilies — omit, never disclose-and-publish`)
        if (fam in publishedByKind) return FAIL(`${fam}: omitted at the §8 gate yet still present in totals.byKind`)
        for (const m of publication.stats?.models ?? []) {
          if (m.ledgerFamilies && fam in m.ledgerFamilies) {
            return FAIL(`${fam}: omitted at the §8 gate yet still present in stats.models[].ledgerFamilies — omission covers every surface`)
          }
        }
      }
    }
    for (const fam of omitted) {
      if (!expectedOmitted.has(fam)) {
        return FAIL(`${fam}: listed in omittedFamilies but its §8 census does not derive a required omission`)
      }
    }
    // v3.2.4: G5 consumes the WHOLE §8 evidence block, not only the census —
    // the true-sample and message-scan arms must be present, well-formed and
    // recomputable; the cross-check and the unaided first-pass metric must
    // SURVIVE into the publication with the model artifact hash-bound; the
    // census must enumerate its rows; and a family publishing false rows can
    // never ride a zero-count census (the n=0 bypass, closed).
    const ts = val.trueSample
    if (!ts || !Number.isInteger(ts.n) || ts.n <= 0 || !Number.isInteger(ts.confirmed) || ts.confirmed < 0 || ts.confirmed > ts.n) {
      return FAIL('§8 true-sample evidence missing or malformed (honesty.validation.trueSample needs {n>0, 0≤confirmed≤n})')
    }
    if (typeof ts.confirmationRate !== 'number' || Math.abs(ts.confirmationRate - ts.confirmed / ts.n) > 1e-9) {
      return FAIL('trueSample.confirmationRate does not recompute from confirmed/n')
    }
    const ms = val.messageScan
    if (!ms || !Number.isInteger(ms.n) || ms.n <= 0 || !Number.isInteger(ms.itemsWithMiss) || ms.itemsWithMiss < 0 || ms.itemsWithMiss > ms.n) {
      return FAIL('§8 message-scan evidence missing or malformed (honesty.validation.messageScan needs {n>0, 0≤itemsWithMiss≤n})')
    }
    if (ms.statistic !== 'message-level omission incidence') {
      return FAIL('messageScan.statistic must be labeled "message-level omission incidence" — never conflated with claim-level recall (v3.2.4)')
    }
    if (typeof ms.missRate !== 'number' || Math.abs(ms.missRate - ms.itemsWithMiss / ms.n) > 1e-9) {
      return FAIL('messageScan.missRate does not recompute from itemsWithMiss/n')
    }
    const [mLo, mHi] = wilson(ms.itemsWithMiss, ms.n)
    if (!Array.isArray(ms.wilson95) || Math.abs(ms.wilson95[0] - mLo) > 1e-6 || Math.abs(ms.wilson95[1] - mHi) > 1e-6) {
      return FAIL('messageScan.wilson95 does not recompute')
    }
    if (!val.crossCheck?.rater || !val.crossCheck?.method?.model || !Array.isArray(val.crossCheck?.resolutions)) {
      return FAIL('§8 cross-check evidence not embedded (honesty.validation.crossCheck with rater, method.model, resolutions)')
    }
    if (typeof val.modelRulingsSha256 !== 'string' || val.modelRulingsSha256 === '') {
      return FAIL('model cross-check artifact not hash-bound (honesty.validation.modelRulingsSha256)')
    }
    if (!val.unaidedFirstPass || typeof val.unaidedFirstPass.censusOverturnsByFamily !== 'object') {
      return FAIL('unaided first-pass metric not embedded (honesty.validation.unaidedFirstPass)')
    }
    const censusTotal = Object.values(val.census.byFamily).reduce((a, v) => a + (v?.n ?? 0), 0)
    if (!Array.isArray(val.census.claimKeys) || val.census.claimKeys.length !== censusTotal) {
      return FAIL(`census claimKeys must enumerate every census row (${val.census.claimKeys?.length ?? 'none'} keys vs ${censusTotal} in byFamily) — a countless census is not a census (v3.2.4)`)
    }
    for (const [fam, counts] of Object.entries(publishedByKind)) {
      const falseUpper = typeof counts?.false === 'number' ? counts.false : (counts?.false?.upper ?? 0)
      if (falseUpper > 0 && (val.census.byFamily[fam]?.n ?? 0) === 0 && !(val.closureIterations?.length > 0)) {
        return FAIL(`${fam}: publishes up to ${falseUpper} false proposition(s) on a zero-count census with no closure iterations — the n=0 bypass is closed (v3.2.4)`)
      }
    }
  } else if (publication.honesty?.secondHumanRater !== true) {
    return FAIL('recall unproven (single human) and no §8 protocol asserted')
  }
  const p = ns.publishedFamilies, f = ns.fullCodebook
  return PASS(`published-family miss ${p.itemsWithMiss}/${ns.n} = ${(p.missRate * 100).toFixed(1)}%; full-codebook ${f.itemsWithMiss}/${ns.n} = ${(f.missRate * 100).toFixed(1)}% (shelved votes, sweep-2 evidence)`)
})

// §7: inter-rater agreement (raw + κ) published for every sheet with ≥2
// raters. agreement.mjs emits {perRater, pairs}; multi-sheet runs may nest
// that shape under {sheets: {name: …}}.
gate('G6', 'inter-rater agreement (raw + κ) per multi-rater sheet', () => {
  const ag = readJson(values.agreement)
  if (!ag) return PENDING(`no agreement output at ${values.agreement}`)
  const sheets = ag.sheets ?? { default: ag }
  const errors = []
  let covered = 0
  for (const [name, sheet] of Object.entries(sheets)) {
    if ((sheet.perRater?.length ?? 0) < 2) continue
    covered += 1
    if (!sheet.pairs?.length) { errors.push(`${name}: ≥2 raters but no pairwise agreement`); continue }
    for (const p of sheet.pairs) {
      if (typeof p.rawAgreement !== 'number' || !('kappa' in p)) {
        errors.push(`${name}: pair ${p.raters?.join('/')} lacks raw agreement or κ`)
      }
    }
  }
  if (errors.length) return FAIL(errors.join('; '))
  if (covered === 0 && publication?.honesty?.secondHumanRater === true) {
    return FAIL('publication claims a second human rater but no sheet has ≥2 raters')
  }
  return PASS(covered ? `${covered} multi-rater sheet(s) publish raw + κ` : 'no multi-rater sheets (honesty fallback applies)')
})

// §7: no headline conclusion reverses across §1 cohorts or equal-vs-ballot
// weighting; a reversal may publish only WITH its range.
gate('G7', 'cohort / weighting sensitivity: reversals carry ranges', () => {
  if (!publication) return PENDING(`no publication at ${values.publication}`)
  const s = publication.sensitivity
  if (!s || !Array.isArray(s.reversals)) return FAIL('publication lacks sensitivity.reversals')
  const bare = s.reversals.filter((r) => !r.range)
  if (bare.length) return FAIL(`${bare.length} reversal(s) published without a range`)
  return PASS(s.reversals.length ? `${s.reversals.length} reversal(s), all with ranges` : 'no reversals across cohorts/weightings')
})

// §1/§7: reliability statistics come from scheduled-40 only.
gate('G8', 'reliability covers all 40 games (scheduled-40)', () => {
  if (!publication) return PENDING(`no publication at ${values.publication}`)
  const r = publication.reliability
  if (!r) return FAIL('publication lacks a reliability section')
  if (r.cohort !== 'scheduled-40' || r.games !== manifest.logs.count) {
    return FAIL(`reliability cohort ${r.cohort} over ${r.games} games; must be scheduled-40 over ${manifest.logs.count}`)
  }
  return PASS(`reliability over ${r.games} games`)
})

// §4/§7: no ranking or composite anywhere; no v1/v2 artifact shapes
// (v2 claims carried `support`; v2 metas carried `judgeModel`).
gate('G9', 'no rankings, composites, or v1/v2 shapes in publication', () => {
  if (!publication) return PENDING(`no publication at ${values.publication}`)
  const banned = /rank|composit|leaderboard/i
  const legacy = new Set(['support', 'judgeModel'])
  const hits = []
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return
    for (const [k, v] of Object.entries(node)) {
      if (banned.test(k) || legacy.has(k)) hits.push(`${path}${k}`)
      walk(v, `${path}${k}.`)
    }
  }
  walk(publication, '')
  return hits.length ? FAIL(`forbidden keys: ${hits.slice(0, 5).join(', ')}`) : PASS('no ranking/composite/legacy keys')
})

// §5: every derived artifact embeds the current analysisRunId. Archived
// instrument readings (extract/) predate the final id and are hash-pinned
// in the manifest instead, so only derived outputs are scanned.
gate('G10', 'every derived artifact embeds the analysisRunId', () => {
  const targets = []
  for (const sub of ['ledger', 'opportunity', 'stats', 'handcheck']) {
    const dir = join(values.outdir, sub)
    for (const f of listFiles(dir, /\.jsonl?$/)) targets.push(join(dir, f))
  }
  if (existsSync(values.publication)) targets.push(values.publication)
  const artifacts = targets.filter((p) => statSync(p).isFile())
  if (artifacts.length === 0) return PENDING(`no derived artifacts under ${values.outdir} yet`)
  // Immutable rating-phase evidence (sealed keys, rating files) and its
  // direct derivative (the agreement report, computed FROM those files) may
  // carry a SUPERSEDED runId when the manifest was later re-pinned with
  // fuller provenance: acceptable only for ids the manifest itself lists,
  // and only for those artifacts — everything else must carry the current id.
  const superseded = new Set(manifest.supersedes ?? [])
  const ratingPhase = (p) => p.includes(`${sep}handcheck${sep}`) || p.endsWith(`${sep}agreement.json`)
  const errors = []
  let inherited = 0
  for (const p of artifacts) {
    const head = p.endsWith('.jsonl') ? readJsonl(p)[0] : readJson(p)
    const r = attempt(() => checkRunId(manifest, head ?? {}, p))
    if (r.ok) continue
    const id = head?.analysisRunId
    if (ratingPhase(p) && id && superseded.has(id)) { inherited += 1; continue }
    errors.push(r.errors[0])
  }
  return errors.length ? FAIL(errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} more)` : ''))
    : PASS(`${artifacts.length} artifact(s) bound (${inherited} rating-phase readings under a manifest-listed superseded id)`)
})

// §5/§7: clean-room regeneration — deterministic reproduction of every
// derived artifact from logs + roots + manifest + archived readings + code.
// The regeneration run writes this attestation; the gate refuses stale ids.
gate('G11', 'clean-room regeneration succeeded for this runId', () => {
  const cr = readJson(values.cleanroom)
  if (!cr) return PENDING(`no clean-room report at ${values.cleanroom}`)
  const pf2ProvenancePath = join(values.outdir, 'handcheck', 'pf2-provenance.json')
  const r = attempt(() => verifyCleanroomAttestation({
    report: cr,
    manifest,
    manifestPath: values.manifest,
    runDir: values.outdir,
    provenance: pf2ProvenancePath,
  }))
  return r.ok
    ? PASS(`${cr.artifactCount} derived artifacts regenerated byte-identically under the current manifest and code commit`)
    : FAIL(r.errors[0])
})

// §7: the renderer consumes only publication.json. Not statically provable
// here, so the publication must carry the attestation explicitly.
// Attestation alone let a v1-shaped renderer pass — caught in review. The
// gate now inspects the renderer source: it must reference publication.json
// and must not read the retired v1 grades/judge inputs.
gate('G12', 'renderer consumes only publication.json (attested AND source-checked)', () => {
  if (!publication) return PENDING(`no publication at ${values.publication}`)
  if (publication.attestations?.rendererConsumesPublicationOnly !== true) {
    return PENDING('publication.attestations.rendererConsumesPublicationOnly not asserted')
  }
  const rendererPath = 'scripts/render-site.mjs'
  if (!existsSync(rendererPath)) return PENDING(`no renderer at ${rendererPath}`)
  const src = readFileSync(rendererPath, 'utf8')
  if (/grades\.json|--grades|judge\.json|--judge\b/.test(src)) {
    return FAIL(`${rendererPath} still reads v1 grades/judge inputs`)
  }
  if (!src.includes('publication.json')) return FAIL(`${rendererPath} does not reference publication.json`)
  return PASS('attested, and the renderer source reads publication.json only')
})

// v3.2.6: R20 defines a claim receipt (one public utterance), while paper
// prevalence uses an underlying-proposition count range. Recompute the exact
// links, uncertain action-link bounds, and receipts from hash-verified inputs.
gate('G13', 'claim unit: exact repeats collapse; uncertain action links publish as ranges', () => {
  if (!publication) return PENDING(`no publication at ${values.publication}`)
  if (publication.evaluatorVersion !== EVALUATOR_VERSION) {
    return FAIL(`publication evaluatorVersion ${JSON.stringify(publication.evaluatorVersion ?? null)} != current ${EVALUATOR_VERSION}`)
  }
  const ledger = publication.sections?.falseStatementLedger
  if (!ledger || !Array.isArray(ledger.claims)) return FAIL('publication lacks falseStatementLedger.claims receipt rows')
  if (!values.logs) return FAIL('claim-unit recomputation requires --logs')
  const omittedRows = ledger.omittedFamilies
  if (!Array.isArray(omittedRows)) return FAIL('falseStatementLedger.omittedFamilies must be an explicit array')
  const omitted = new Set()
  for (const row of omittedRows) {
    if (!row || !PUBLISHED_FAMILIES.includes(row.family)) {
      return FAIL(`falseStatementLedger.omittedFamilies contains invalid family ${JSON.stringify(row?.family ?? null)}`)
    }
    if (omitted.has(row.family)) return FAIL(`falseStatementLedger.omittedFamilies repeats ${row.family}`)
    omitted.add(row.family)
  }

  // The publication's copied receipt rows are not their own provenance.
  // Resolve the builder-recorded basename beneath --ledger, pin its exact
  // bytes, then derive the only receipt array the publication may contain.
  const source = ledger.sourceLedger
  if (!source || typeof source.filename !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256 ?? '')) {
    return FAIL('falseStatementLedger.sourceLedger must carry {filename, sha256}')
  }
  if (source.filename !== basename(source.filename)) {
    return FAIL('falseStatementLedger.sourceLedger.filename must be a basename under --ledger')
  }
  const ledgerRoot = resolve(values.ledger)
  const sourcePath = resolve(ledgerRoot, source.filename)
  if (dirname(sourcePath) !== ledgerRoot) {
    return FAIL('falseStatementLedger.sourceLedger resolves outside --ledger')
  }
  if (!existsSync(sourcePath)) return FAIL(`source ledger not found under --ledger: ${source.filename}`)
  if (sha256File(sourcePath) !== source.sha256) return FAIL('source ledger sha256 does not match the published pin')
  let sourceRows
  try {
    sourceRows = readJsonl(sourcePath)
  } catch (e) {
    return FAIL(`source ledger cannot be parsed: ${e.message}`)
  }
  const sourceMeta = sourceRows.find((row) => row._meta)
  if (sourceMeta?.evaluatorVersion !== EVALUATOR_VERSION) {
    return FAIL(`source ledger evaluatorVersion ${JSON.stringify(sourceMeta?.evaluatorVersion ?? null)} != current ${EVALUATOR_VERSION}`)
  }
  const sourceClaims = sourceRows.filter((row) => !row._meta)
  const unknownKind = sourceClaims.find((row) => !PUBLISHED_FAMILIES.includes(row.kind))
  if (unknownKind) return FAIL(`source ledger contains unsupported family ${JSON.stringify(unknownKind.kind ?? null)}`)
  const expectedReceipts = sourceClaims.filter((row) => !omitted.has(row.kind))
  if (JSON.stringify(ledger.claims) !== JSON.stringify(expectedReceipts)) {
    return FAIL('published receipt rows do not exactly equal the hash-pinned source ledger after explicit family omissions')
  }

  const unit = ledger.claimUnit
  if (unit?.primary !== 'truth-resolved underlying claim proposition count range' ||
      unit?.secondary !== 'public claim utterance receipt (R20)' ||
      unit?.mappingVersion !== CLAIM_PROPOSITION_VERSION) {
    return FAIL('falseStatementLedger.claimUnit is missing or does not name the frozen v3.2.6 units')
  }
  if (!Array.isArray(ledger.upperBoundPropositionCandidates)) return FAIL('falseStatementLedger.upperBoundPropositionCandidates missing')

  const facts = new Map()
  const factsFor = (seed) => {
    if (facts.has(seed)) return facts.get(seed)
    const path = join(values.logs, `${seed}.jsonl`)
    if (!existsSync(path)) throw new Error(`missing source log ${path}`)
    const want = manifest.logs?.files?.[seed]?.sha256
    if (!want) throw new Error(`manifest has no log hash for ${seed}`)
    const got = sha256File(path)
    if (got !== want) throw new Error(`${seed} log sha256 ${got} != manifest ${want}`)
    const parsed = readJsonl(path)
    const value = gameFacts(parsed)
    facts.set(seed, value)
    return value
  }

  const survivingFamilies = [...PUBLISHED_FAMILIES].sort().filter((family) => !omitted.has(family))
  const aggregateReceipts = (receipts, includeKinds = survivingFamilies) => aggregateClaimPropositions(receipts, {
    resolveTarget: (claim) => resolveEffectiveClaimTarget(claim, factsFor(claim.seed)),
    getMessage: (seed, seq) => {
      const value = factsFor(seed)
      const text = value.messageTexts.get(seq)
      const actor = value.messageActors.get(seq)
      return typeof text === 'string' ? { text, actor } : undefined
    },
    includeKinds,
  })
  // Omission is allowed only as an honest, recomputable disclosure. The
  // withheld counts and ranges are derived from the same hash-pinned source
  // ledger; editing those numbers after assembly must fail just like editing
  // a published headline.
  for (const row of omittedRows) {
    const familyReceipts = sourceClaims.filter((claim) => claim.kind === row.family)
    let familyMapping
    try { familyMapping = aggregateReceipts(familyReceipts, [row.family]) } catch (e) { return FAIL(e.message) }
    const expectedReceiptCounts = {
      true: familyReceipts.filter((claim) => claim.verdict === 'true').length,
      false: familyReceipts.filter((claim) => claim.verdict === 'false').length,
      ambiguous: familyReceipts.filter((claim) => claim.verdict === 'ambiguous').length,
    }
    if (JSON.stringify(row.omittedReceiptCounts) !== JSON.stringify(expectedReceiptCounts) ||
        JSON.stringify(row.omittedPropositionCountRanges) !== JSON.stringify(familyMapping.countRanges.byKind[row.family])) {
      return FAIL(`${row.family}: omitted receipt counts/proposition ranges do not recompute from the hash-pinned source ledger`)
    }
  }
  let computed
  try {
    computed = aggregateReceipts(ledger.claims)
  } catch (e) {
    return FAIL(e.message)
  }
  if (unit.mappingSha256 !== computed.mappingSha256) return FAIL('claimUnit.mappingSha256 does not recompute from published receipts')
  if (JSON.stringify(unit.linkageBasisCounts) !== JSON.stringify(computed.linkageBasisCounts)) {
    return FAIL('claimUnit.linkageBasisCounts does not recompute from published receipts')
  }
  if (JSON.stringify(ledger.upperBoundPropositionCandidates) !== JSON.stringify(computed.upperBoundRows)) {
    return FAIL('published upper-bound proposition candidates do not equal the recomputed mapping')
  }
  const statsMapping = publication.stats?.claimPropositions
  if (publication.stats?.evaluatorVersion !== EVALUATOR_VERSION ||
      JSON.stringify(statsMapping) !== JSON.stringify(computed) ||
      JSON.stringify(publication.stats?.ledgerResolvedPropositionCountRange) !== JSON.stringify(computed.countRanges.resolved) ||
      JSON.stringify(publication.stats?.ledgerAmbiguousPropositionCountRange) !== JSON.stringify(computed.countRanges.ambiguous) ||
      publication.stats?.ledgerClaimReceipts !== computed.receiptCount) {
    return FAIL('embedded stats do not carry the same proposition mapping and explicit unit totals')
  }

  // Recompute both per-model family tables from their primary sources. The
  // proposition table supplies ledgerFamilies; the verified source receipts
  // supply ledgerReceiptFamilies; game logs, never stored model fields,
  // attribute each seat to a model.
  const emptyFamily = () => ({ n: 0, true: 0, false: 0, ambiguous: 0, falseClass: {} })
  const addByModel = (map, row, label) => {
    const model = factsFor(row.seed).models[row.seat]
    if (!model) throw new Error(`${label} ${row.seed}#${row.firstSeq ?? row.seq}: seat ${row.seat} has no model attribution in the verified log`)
    if (!map.has(model)) map.set(model, new Map())
    const families = map.get(model)
    if (!families.has(row.kind)) families.set(row.kind, emptyFamily())
    const cell = families.get(row.kind)
    cell.n += 1
    cell[row.verdict] += 1
    if (row.verdict === 'false' && row.falseClass) {
      cell.falseClass[row.falseClass] = (cell.falseClass[row.falseClass] ?? 0) + 1
    }
  }
  const receiptByModel = new Map()
  const receiptsByModel = new Map()
  try {
    for (const row of expectedReceipts) {
      addByModel(receiptByModel, row, 'receipt')
      const model = factsFor(row.seed).models[row.seat]
      if (!receiptsByModel.has(model)) receiptsByModel.set(model, [])
      receiptsByModel.get(model).push(row)
    }
  } catch (e) {
    return FAIL(e.message)
  }
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    }
    return value
  }
  const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
  const statsModels = publication.stats?.models
  if (!Array.isArray(statsModels)) return FAIL('embedded stats.models is missing')
  const modelRows = new Map()
  for (const row of statsModels) {
    if (!row || typeof row.model !== 'string' || !row.model) return FAIL('embedded stats.models has a row without a model name')
    if (modelRows.has(row.model)) return FAIL(`embedded stats.models repeats model ${row.model}`)
    modelRows.set(row.model, row)
  }
  for (const model of receiptByModel.keys()) {
    if (!modelRows.has(model)) return FAIL(`embedded stats.models omits log-attributed model ${model}`)
  }
  const expectedReceiptTable = (map, model) => Object.fromEntries(survivingFamilies.map((family) => [
    family,
    map.get(model)?.get(family) ?? emptyFamily(),
  ]))
  const zeroRange = () => ({ lower: 0, upper: 0 })
  const emptyRangeFamily = () => ({
    propositions: zeroRange(), resolved: zeroRange(), true: zeroRange(), false: zeroRange(),
    ambiguous: zeroRange(), falseClasses: {},
  })
  for (const [model, row] of modelRows) {
    let modelMapping
    try { modelMapping = aggregateReceipts(receiptsByModel.get(model) ?? []) } catch (e) { return FAIL(e.message) }
    const expectedPropositions = Object.fromEntries(survivingFamilies.map((family) => [
      family, modelMapping.countRanges.byKind[family] ?? emptyRangeFamily(),
    ]))
    const expectedReceiptCells = expectedReceiptTable(receiptByModel, model)
    if (!same(row.ledgerFamilies, expectedPropositions)) {
      return FAIL(`stats.models[${model}].ledgerFamilies does not recompute from proposition mapping and log model attribution`)
    }
    if (!same(row.ledgerReceiptFamilies, expectedReceiptCells)) {
      return FAIL(`stats.models[${model}].ledgerReceiptFamilies does not recompute from source receipts and log model attribution`)
    }
  }
  if (!same(publication.sections?.ballotAccuracy, statsModels)) {
    return FAIL('sections.ballotAccuracy does not exactly equal the verified stats.models surface')
  }

  const resolvableReceipts = ledger.claims.filter((row) => row.verdict !== 'ambiguous')
  const falseReceipts = ledger.claims.filter((row) => row.verdict === 'false')
  const totals = ledger.totals ?? {}
  const expectedByKind = Object.fromEntries([...PUBLISHED_FAMILIES].sort().filter((kind) => !omitted.has(kind)).map((kind) => {
    const ranges = computed.countRanges.byKind[kind]
    return [kind, {
      true: ranges.true,
      false: ranges.false,
    }]
  }))
  const expectedResolvedRange = computed.countRanges.resolved
  const expectedAmbiguousByKind = Object.fromEntries([...PUBLISHED_FAMILIES].sort().filter((kind) => !omitted.has(kind)).map((kind) => [
    kind, computed.countRanges.byKind[kind].ambiguous,
  ]))
  if (!same(totals.propositionCountRange, expectedResolvedRange) ||
      totals.claimUtteranceReceipts !== resolvableReceipts.length ||
      !same(totals.falsePropositionCountRange, computed.countRanges.false) ||
      totals.falseClaimUtteranceReceipts !== falseReceipts.length ||
      !same(totals.byKind, expectedByKind) ||
      !same(totals.falseClassRanges, computed.countRanges.falseClasses) ||
      !same(ledger.ambiguousDisclosed?.propositionCountRange, computed.countRanges.ambiguous) ||
      !same(ledger.ambiguousDisclosed?.byKind, expectedAmbiguousByKind) ||
      ledger.ambiguousDisclosed?.utteranceReceipts !== ledger.claims.filter((row) => row.verdict === 'ambiguous').length) {
    return FAIL('headline proposition/receipt totals do not recompute from the mapping')
  }
  if (computed.countRanges.propositions.upper > computed.receiptCount ||
      computed.countRanges.propositions.lower > computed.countRanges.propositions.upper) {
    return FAIL('underlying-proposition range is incoherent with the receipt count')
  }
  return PASS(`${computed.countRanges.resolved.lower}–${computed.countRanges.resolved.upper} truth-resolved underlying proposition(s); ` +
    `${computed.countRanges.ambiguous.lower}–${computed.countRanges.ambiguous.upper} ambiguous disclosed separately; ` +
    `${computed.receiptCount} receipt(s); ${computed.exactlyLinkedReiterationReceipts} exact repeat receipt(s) collapsed, ` +
    `${computed.linkageUncertainReceiptCount} action receipt(s) linkage-uncertain`)
})

// The clean-room proof covers the three deterministic derivative files on
// disk. Bind the publication's selected views back to those exact bytes so a
// post-build edit cannot replace PF-2 counts, erase a sensitivity reversal,
// or substitute a different agreement artifact while G11 still passes.
gate('G14', 'publication views match the clean-room-attested derivative artifacts', () => {
  if (!publication) return PENDING(`no publication at ${values.publication}`)
  const statsDir = join(values.outdir, 'stats')
  const paths = {
    agreement: join(statsDir, 'agreement.json'),
    sensitivity: join(statsDir, 'sensitivity.json'),
    pf2: join(statsDir, 'pf2-validation.json'),
  }
  const missing = Object.entries(paths).filter(([, path]) => !existsSync(path))
  if (missing.length) return PENDING(`clean-room derivative missing: ${missing[0][1]}`)
  const agreementArtifact = readJson(paths.agreement)
  const sensitivityArtifact = readJson(paths.sensitivity)
  const pf2Artifact = readJson(paths.pf2)
  const bindings = publication.artifactBindings ?? {}
  for (const [name, path] of Object.entries(paths)) {
    const field = `${name}Sha256`
    if (bindings[field] !== sha256File(path)) return FAIL(`${field} does not bind the publication to ${path}`)
  }
  if (!isDeepStrictEqual(publication.sensitivity?.reversals, sensitivityArtifact?.reversals)) {
    return FAIL('publication sensitivity.reversals differs from the clean-room-attested sensitivity artifact')
  }
  if (!isDeepStrictEqual(publication.sections?.pf2, pf2Artifact)) {
    return FAIL('publication PF-2 block differs from the clean-room-attested PF-2 artifact')
  }
  if (publication.honesty?.mode === 'exploratory-v1') {
    if (publication.sections?.humanValidation !== undefined) {
      return FAIL('exploratory-v1 must not embed the agreement artifact or its negative-sample rates')
    }
  } else if (!isDeepStrictEqual(publication.sections?.humanValidation, agreementArtifact)) {
    return FAIL('publication humanValidation block differs from the clean-room-attested agreement artifact')
  }
  return PASS('PF-2, sensitivity, and agreement views are content-bound to the clean-room artifact set')
})

// ---- run -----------------------------------------------------------------

if (!manifest) {
  console.error(`no manifest at ${values.manifest} — build it first (analysis-manifest.mjs build)`)
  process.exit(1)
}

const results = gates.map((g) => ({ id: g.id, name: g.name, ...g.fn() }))
const width = Math.max(...results.map((r) => r.name.length))
console.log(`analysis-v3 publication gates · manifest ${values.manifest} · runId ${manifest.analysisRunId.slice(0, 12)}…\n`)
for (const r of results) {
  console.log(`${r.id.padEnd(4)} ${r.status.padEnd(8)} ${r.name.padEnd(width)}  ${r.detail}`)
}
const counts = { PASS: 0, FAIL: 0, PENDING: 0 }
for (const r of results) counts[r.status] += 1
console.log(`\n${counts.PASS} pass · ${counts.FAIL} fail · ${counts.PENDING} pending`)
if (counts.FAIL + counts.PENDING > 0) {
  console.log('publication is BLOCKED: every gate must PASS')
  process.exit(1)
}
console.log('all gates pass')
