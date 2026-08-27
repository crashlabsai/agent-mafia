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
import { dirname, join, sep } from 'node:path'
import { parseArgs } from 'node:util'
import {
  checkExtractionMeta, checkRunId, sha256File, sha256Hex, verifyManifest,
} from './analysis-manifest.mjs'

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
  for (const f of ledgerFiles) {
    for (const c of readJsonl(join(values.ledger, f))) {
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
  // the published validation block (audit agreement + dispute counts).
  if (uncontested > 0) {
    let pub = null
    try { pub = JSON.parse(readFileSync(values.publication, 'utf8')) } catch { pub = null }
    const pf2 = pub?.validation?.pf2 ?? pub?.sections?.pf2
    if (!pf2?.humanPacket?.audit?.agreementRate) {
      errors.push(`${uncontested} sensitivity-uncontested confirmations but the publication carries no PF-2 validation block`)
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
gate('G5', 'negative-sample recall: published-family AND full-codebook, both recomputable', () => {
  if (!publication) return PENDING(`no publication at ${values.publication}`)
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
  if (publication.honesty?.secondHumanRater !== true && publication.honesty?.lowerBoundLanguage !== true) {
    return FAIL('recall unproven (single human) but lowerBoundLanguage is not asserted')
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
  if (cr.ok !== true) return FAIL('clean-room report present but ok !== true')
  const r = attempt(() => checkRunId(manifest, cr, values.cleanroom))
  return r.ok ? PASS('clean-room regeneration reproduced all derived artifacts') : FAIL(r.errors[0])
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
