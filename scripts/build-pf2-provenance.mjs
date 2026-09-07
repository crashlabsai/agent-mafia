// PF-2 provenance manifest (v3.2.6): one content-addressed inventory of every
// artifact the adjudication sitting depends on — the archived extraction
// readings, both sealed keys, every rater-facing sheet and template, the
// complete sensitivity-pass record (prompts, schemas, event logs, raw
// fragments), the combined sensitivity ratings, and the packet triplet the
// human rates from. Anything that later disagrees with this manifest is a
// substitution, not a mystery.
//
// The manifest also carries the sitting's blinding DISCLOSURES: v3.2.4
// records that the human rater saw aggregate family-level sensitivity
// results before rating, so the sitting is described as item-level blind,
// never as prior-free. A protocol that hides its own priors is exactly the
// kind of quiet overclaim the external reviews exist to catch.
//
// Deterministic: no timestamps — identity is the code commit plus the
// content hashes. Atomic write. Never opens item-level key CONTENT beyond
// the _meta line of the sealed key (for the analysisRunId).
//
//   node scripts/build-pf2-provenance.mjs \
//        --handcheck runs/analysis-v3.2/handcheck \
//        --extract runs/analysis-v3.2/extract \
//        [--out runs/analysis-v3.2/handcheck/pf2-provenance.json]
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { PF2_PACKET_VERSION } from './correction-validation.mjs'

const { values } = parseArgs({
  options: {
    handcheck: { type: 'string' },
    extract: { type: 'string' },
    out: { type: 'string' },
  },
})
const fail = (m) => { console.error(m); process.exit(1) }
if (!values.handcheck || !values.extract) {
  fail('usage: build-pf2-provenance.mjs --handcheck dir --extract dir [--out file]')
}
const HC = resolve(values.handcheck)
const EX = resolve(values.extract)
const OUT = resolve(values.out ?? join(HC, 'pf2-provenance.json'))

const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const entry = (p, kind) => ({ path: p, kind, bytes: statSync(p).size, sha256: sha256File(p) })

const files = []
const addDir = (dir, kind, filter = () => true) => {
  if (!existsSync(dir)) fail(`${dir}: missing — the manifest inventories what EXISTS; nothing may be skipped silently`)
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f)
    if (statSync(p).isFile() && filter(f)) files.push(entry(p, kind))
  }
}
const addFile = (p, kind, { optional = false } = {}) => {
  if (!existsSync(p)) {
    if (optional) return
    fail(`${p}: required artifact missing`)
  }
  files.push(entry(p, kind))
}

// 1. Archived instrument readings the sealed keys were built from.
addDir(EX, 'extraction', (f) => /\.jsonl$/.test(f))
// 2. Sealed keys (hashed as opaque bytes; their content stays sealed).
addFile(join(HC, 'sealed-key.jsonl'), 'sealed-key')
addFile(join(HC, 'negatives-sealed-key.jsonl'), 'sealed-key')
// 3. Rater-facing sheets and templates.
addDir(HC, 'rater-facing', (f) => /^(sheet-\d+\.md|negatives-sheet-\d+\.md|ratings-template\.json|negatives-template\.json)$/.test(f))
// 4. The complete sensitivity-pass record.
addDir(join(HC, 'codex-pass'), 'sensitivity-pass')
// 5. Combined sensitivity ratings and the method record.
addFile(join(HC, 'codex-ratings.json'), 'sensitivity-ratings')
addFile(join(HC, 'codex-negatives.json'), 'sensitivity-ratings')
addFile(join(HC, 'codex-review-summary.md'), 'sensitivity-method', { optional: true })
// 6. The packet the human rates from.
addFile(join(HC, 'packet', 'packet-key.jsonl'), 'packet')
addFile(join(HC, 'packet', 'packet-sheet.md'), 'packet')
addFile(join(HC, 'packet', 'packet-template.json'), 'packet')
addFile(join(HC, 'packet', 'packet-ratings.schema.json'), 'packet')
addFile(join(HC, 'packet', 'packet-ratings.example.json'), 'packet')
// 7. Once the human sitting is finalized, preserve all three semantic layers:
// the untouched first pass, the explicit approved clarification overlay, and
// the deterministic final ratings. All-or-none avoids a provenance manifest
// that accidentally blesses only the post-clarification output.
const humanFinalization = [
  'ryan-packet-ratings-first-pass.json',
  'ryan-ratings-clarification-overlay.json',
  'ryan-packet-ratings-blind-clarified.json',
  'ryan-ratings-approval-record.md',
  'ryan-methodology-addendum-v326.md',
]
const finalizationPaths = humanFinalization.map((name) => join(HC, 'packet', name))
const presentFinalization = finalizationPaths.filter((path) => existsSync(path))
if (presentFinalization.length > 0 && presentFinalization.length !== finalizationPaths.length) {
  fail(`human finalization provenance is partial (${presentFinalization.length}/${finalizationPaths.length}); require first-pass + overlay + final + approval + v3.2.6 methodology addendum`)
}
for (const path of presentFinalization) addFile(path, 'human-adjudication')

// analysisRunId from the sealed key's _meta line only — item rows stay sealed.
const keyMeta = JSON.parse(readFileSync(join(HC, 'sealed-key.jsonl'), 'utf8').split('\n')[0])
if (!keyMeta._meta || !keyMeta.analysisRunId) fail('sealed-key.jsonl: no _meta/analysisRunId line')

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let codeCommit
try {
  codeCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
} catch (e) { fail(`code commit unavailable: ${e.message}`) }

const relFiles = files.map((f) => ({ ...f, path: relative(process.cwd(), f.path) }))
const aggregate = createHash('sha256')
for (const f of relFiles) aggregate.update(`${f.path}\x00${f.sha256}\n`)

const manifest = {
  manifestVersion: `pf2-provenance-${PF2_PACKET_VERSION}`,
  analysisRunId: keyMeta.analysisRunId,
  codeCommit,
  packetVersion: PF2_PACKET_VERSION,
  disclosures: [
    'The human rater saw aggregate FAMILY-LEVEL sensitivity results (per-family OK/BAD/CORRECTED counts and OK-rates) before the packet sitting. The sitting is item-level blind — no item-level ruling, arm, verdict, role, model, or outcome was visible — but it is not prior-free.',
  ],
  counts: Object.fromEntries([...new Set(relFiles.map((f) => f.kind))].map((k) => [k, relFiles.filter((f) => f.kind === k).length])),
  files: relFiles,
  aggregateSha256: aggregate.digest('hex'),
}

mkdirSync(dirname(OUT), { recursive: true })
const tmp = `${OUT}.tmp-${process.pid}`
writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`)
renameSync(tmp, OUT)
console.log(`wrote ${OUT}: ${relFiles.length} artifacts (${Object.entries(manifest.counts).map(([k, n]) => `${k} ${n}`).join(', ')})`)
console.log(`aggregate ${manifest.aggregateSha256.slice(0, 16)}… · run ${manifest.analysisRunId.slice(0, 12)}… · commit ${codeCommit.slice(0, 12)}`)
