// Build the curated, public-facing v3.2 analysis bundle from the private run.
//
// The export preserves the research records while removing machine-local paths,
// provider response identifiers, local review tools, drafts, and operational logs.
// It records both source and released hashes so the transformation is explicit.

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_SOURCE = join(REPO_ROOT, 'runs', 'analysis-v3.2')
const DEFAULT_OUTPUT = join(REPO_ROOT, 'docs', 'sweeps', 'results', 'analysis-v32')
const RUN_SOURCE_ROOT = 'runs/analysis-v3.2'

const REQUIRED_RUN_FILES = Object.freeze([
  'manifest.json',
  'cleanroom.json',
  'publication.json',
  'ledger/confirmed-input.jsonl',
  'ledger/confirmed-headline-38.jsonl',
  'ledger/confirmed-strict-31.jsonl',
  'ledger/confirmed-all-40-behavioral.jsonl',
  'opportunity/table.jsonl',
  'stats/agreement.json',
  'stats/pf2-validation.json',
  'stats/sensitivity.json',
  'stats/stats-headline-38.json',
  'stats/stats-strict-31.json',
  'stats/stats-all-40-behavioral.json',
  'handcheck/pf2-provenance.json',
  'handcheck/sealed-key.jsonl',
  'handcheck/negatives-sealed-key.jsonl',
  'handcheck/codex-ratings.json',
  'handcheck/codex-negatives.json',
  'handcheck/codex-review-summary.md',
  'handcheck/negatives-sheet-01.md',
  'handcheck/negatives-template.json',
  'handcheck/ratings-template.json',
  ...Array.from({ length: 8 }, (_, index) => `handcheck/sheet-${String(index + 1).padStart(2, '0')}.md`),
  'handcheck/packet/packet-key.jsonl',
  'handcheck/packet/packet-sheet.md',
  'handcheck/packet/packet-template.json',
  'handcheck/packet/packet-ratings.schema.json',
  'handcheck/packet/packet-ratings.example.json',
  'handcheck/packet/ryan-packet-ratings-first-pass.json',
  'handcheck/packet/ryan-ratings-clarification-overlay.json',
  'handcheck/packet/ryan-packet-ratings-blind-clarified.json',
  'handcheck/packet/ryan-ratings-approval-record.md',
  'handcheck/packet/ryan-methodology-addendum-v326.md',
  'handcheck/packet/ryan-blind-clarification-proposal.md',
])

const CODEX_METHOD_FILES = Object.freeze([
  'codebook.md',
  'instructions.md',
  'negatives-instructions.md',
  'ratings-fragment.schema.json',
  'negatives-fragment.schema.json',
])

const EXTRACTION_RELEASE_FILES = Object.freeze(
  Array.from({ length: 40 }, (_, seed) =>
    ['claims', 'negatives', 'rejects'].map((kind) => `extract/sweep1-${seed}.${kind}.jsonl`),
  ).flat(),
)
const CODEX_PROMPT_FILES = Object.freeze([
  'prompt-negatives.md',
  ...Array.from({ length: 8 }, (_, index) => `prompt-sheet-${String(index + 1).padStart(2, '0')}.md`),
])

// The verifier imports this immutable allowlist. Completeness must not be
// defined by a mutable manifest contained inside the bundle being verified.
export const RELEASE_PAYLOAD_PATHS = Object.freeze([
  ...REQUIRED_RUN_FILES,
  ...EXTRACTION_RELEASE_FILES,
  ...CODEX_METHOD_FILES.map((name) => `handcheck/codex-pass/${name}`),
  ...CODEX_PROMPT_FILES.map((name) => `handcheck/codex-pass/${name}`),
  'tripwire/lexicon.json',
  'tripwire/validation.json',
  'extract/telemetry.json',
  'handcheck/codex-pass/conduct-summary.json',
  'README.md',
  'DATA-NOTICE.md',
])

// Known input-log paths are the sole local paths that may be transformed. The
// prefix deliberately accepts arbitrary checkout roots and the separators used
// by POSIX, Windows, JSON-escaped Windows, and UNC paths.
const GAME_LOG_PATH_PATTERNS = [
  /(?<![:/])(?:file:\\?\/\\?\/)?\\?\/(?:[^\\/\r\n"'<>]+\\?\/)*runs\\?\/sweep-download\\?\/sweep1\\?\/(sweep1-\d+\.jsonl)/gi,
  /[A-Za-z]:\\?\/(?:[^\\/\r\n"'<>]+\\?\/)*runs\\?\/sweep-download\\?\/sweep1\\?\/(sweep1-\d+\.jsonl)/gi,
  /\/\/(?:[^/\r\n"'<>]+\/)+runs\/sweep-download\/sweep1\/(sweep1-\d+\.jsonl)/gi,
  /[A-Za-z]:\\+(?:[^\\\r\n"'<>]+\\+)*runs\\+sweep-download\\+sweep1\\+(sweep1-\d+\.jsonl)/gi,
  /\\{2,}(?:[^\\\r\n"'<>]+\\+)+runs\\+sweep-download\\+sweep1\\+(sweep1-\d+\.jsonl)/gi,
]

const PATH_BOUNDARY = String.raw`(?:^|[\s"'\x60=([{,;])`
const LOCAL_PATH_PATTERNS = [
  // URI paths, including file:///tmp/x and file://server/share/x.
  /\bfile:(?:\/{2,3}|\\{2,3})/i,
  // Drive-qualified Windows paths, including JSON's doubled backslashes.
  new RegExp(`${PATH_BOUNDARY}[A-Za-z]:[\\\\/]+[^\\s"'\\x60<>]+`, 'm'),
  // UNC and protocol-relative filesystem paths. URLs with a named scheme do
  // not match because the leading // is not preceded by a permitted boundary.
  new RegExp(`${PATH_BOUNDARY}(?:\\\\{2,}|//)[A-Za-z0-9][A-Za-z0-9.$_-]*[\\\\/]+[A-Za-z0-9][A-Za-z0-9.$_-]*(?:[\\\\/]|$)`, 'm'),
  // Any absolute POSIX path with two or more components catches arbitrary CI
  // and checkout roots (/builds/org/repo, /srv/x, /nix/store/x, ...).
  new RegExp(`${PATH_BOUNDARY}/(?!/)(?:[^/\\s"'\\x60<>]+/)+[^/\\s"'\\x60<>]*`, 'm'),
  /(?:^|[\s"'`=([{,;])\\\/(?:[^/\\\s"'`<>]+\\\/)+[^/\\\s"'`<>]*/m,
  // Labeled absolute paths such as cwd:/Users/alice/project. Requiring exactly
  // one slash after the colon avoids treating https:// URLs as local paths.
  /\b[A-Za-z][A-Za-z0-9_.-]*:\/(?!\/)(?:[^/\s"'`<>]+\/)+[^/\s"'`<>]*/m,
  // Also reject common one-component roots, home-relative paths, and expanded
  // environment-root spellings that the general rule above cannot see.
  new RegExp(`${PATH_BOUNDARY}/(?:Users|home|root|tmp|var|private|mnt|opt|srv|Volumes|workspace|workspaces)(?:[/\\s"'\\x60]|$)`, 'im'),
  new RegExp(`${PATH_BOUNDARY}(?:~[\\\\/]|\\$\\{?(?:HOME|TMPDIR|TEMP|USERPROFILE)\\}?[\\\\/]|%(?:HOME|TMP|TEMP|USERPROFILE)%[\\\\/])`, 'im'),
]

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bglpat-[A-Za-z0-9_-]{16,}\b/,
  /\bnpm_[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bxai-[A-Za-z0-9_-]{20,}\b/,
  /\bfw_[A-Za-z0-9_-]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/i,
  /authorization\s*[:=]\s*bearer\s+[A-Za-z0-9._~-]{12,}/i,
  // Quoted JSON keys defeated the older assignment pattern. A credential-
  // named field with any non-empty scalar is rejected; public artifacts should
  // omit the field rather than depend on a "redacted" placeholder convention.
  /["']?(?:api[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|bearer[-_]?token|client[-_]?secret|secret(?:[-_]?(?:key|token))?|private[-_]?key(?:[-_]?id)?|password|passwd|token|credential(?:s)?|aws[-_]?secret[-_]?access[-_]?key|authorization)["']?\s*[:=]\s*(?:"(?:\\.|[^"\\\r\n])+"|'(?:\\.|[^'\\\r\n])+'|[A-Za-z0-9._~+\/-]{4,})/i,
]

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label}: ${error.message}`)
  }
}

function assertFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${label} missing: ${path}`)
}

function listFiles(path) {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()
}

function canonicalize(text) {
  let replacements = 0
  let rewritten = text
  for (const pattern of GAME_LOG_PATH_PATTERNS) {
    rewritten = rewritten.replace(pattern, (_match, game) => {
      replacements += 1
      return `data/sweep1/${game}`
    })
  }
  return { text: rewritten, replacements }
}

export function assertPublicText(text, label) {
  for (const pattern of LOCAL_PATH_PATTERNS) {
    if (pattern.test(text)) throw new Error(`${label}: machine-local path survived public export`)
  }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) throw new Error(`${label}: secret-like value detected`)
  }
  if (/"responseId"\s*:|"thread_id"\s*:|\bmsg_[A-Za-z0-9]{12,}\b/.test(text)) {
    throw new Error(`${label}: provider or local session identifier detected`)
  }
}

function runSanitizationSelfTests() {
  const canonicalCases = [
    '/Users/alice/agent-mafia/runs/sweep-download/sweep1/sweep1-1.jsonl',
    '/home/runner/work/arbitrary-checkout/runs/sweep-download/sweep1/sweep1-2.jsonl',
    'file:///tmp/worktree/runs/sweep-download/sweep1/sweep1-3.jsonl',
    String.raw`C:\work\checkout\runs\sweep-download\sweep1\sweep1-4.jsonl`,
    String.raw`\\server\share\checkout\runs\sweep-download\sweep1\sweep1-5.jsonl`,
    String.raw`{"path":"C:\\work\\checkout\\runs\\sweep-download\\sweep1\\sweep1-6.jsonl"}`,
    String.raw`{"path":"\/home\/ci\/checkout\/runs\/sweep-download\/sweep1\/sweep1-7.jsonl"}`,
  ]
  for (const [index, fixture] of canonicalCases.entries()) {
    const normalized = canonicalize(fixture)
    if (normalized.replacements !== 1 || !normalized.text.includes(`data/sweep1/sweep1-${index + 1}.jsonl`)) {
      throw new Error(`sanitization self-test: canonical path fixture ${index + 1} failed`)
    }
    assertPublicText(normalized.text, `canonical path fixture ${index + 1}`)
  }

  const rejectedCases = [
    '/srv/builds/acme/arbitrary-checkout/result.json',
    '/tmp',
    String.raw`C:\Users\alice\AppData\Local\Temp\result.json`,
    String.raw`\\server\share\private\result.json`,
    'file:///etc/passwd',
    '~/work/private.json',
    '${HOME}/work/private.json',
    'cwd:/Users/alice/private/research',
    '{"apiKey":"abcd"}',
    '{"access_token":"value-1234"}',
    '{"client-secret":"value-1234"}',
    '{"password":"hunter2"}',
    '{"privateKey":"not-a-real-key"}',
    '{"Authorization":"Bearer abcdefghijklmnop"}',
    '{"token":"abcd"}',
    '{"secret":"abcd"}',
    '{"responseId":"msg_abcdefghijkl"}',
    '{"thread_id":"0199abcdef012345"}',
  ]
  for (const [index, fixture] of rejectedCases.entries()) {
    let rejected = false
    try {
      assertPublicText(fixture, `rejected fixture ${index + 1}`)
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error(`sanitization self-test: rejected fixture ${index + 1} was accepted`)
  }

  const allowedCases = [
    'https://github.com/crashlabsai/agent-mafia',
    'data/sweep1/sweep1-0.jsonl',
    '{"tokens":{"input":10}}',
    'The player asked where an API key would be configured, but supplied no value.',
  ]
  for (const fixture of allowedCases) {
    const normalized = canonicalize(fixture)
    if (normalized.replacements !== 0 || normalized.text !== fixture) {
      throw new Error('sanitization self-test: ordinary source content was rewritten')
    }
    assertPublicText(fixture, 'allowed fixture')
  }

  console.log(`sanitization self-test PASS: ${canonicalCases.length} canonical, ${rejectedCases.length} rejected, ${allowedCases.length} allowed`)
}

function aggregateHash(files) {
  const digest = createHash('sha256')
  for (const file of files) digest.update(`${file.path}\x00${file.bytes}\x00${file.sha256}\n`)
  return digest.digest('hex')
}

function summarizeExtractionTelemetry(source) {
  const games = []
  const total = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const rawFiles = listFiles(join(source, 'extract')).filter((name) => name.endsWith('.raw.jsonl'))
  for (const name of rawFiles) {
    const game = { seed: name.replace(/\.raw\.jsonl$/, ''), calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    const lines = readFileSync(join(source, 'extract', name), 'utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      const row = JSON.parse(line)
      game.calls += 1
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) game[key] += Number(row.tokens?.[key] ?? 0)
    }
    games.push(game)
    for (const key of Object.keys(total)) total[key] += game[key]
  }
  return {
    schemaVersion: 'analysis-v32-extraction-telemetry-v1',
    disclosure: 'Aggregated from private raw API records. Provider response identifiers and raw response envelopes are excluded.',
    total,
    games,
  }
}

function summarizeCodexConduct(source) {
  const base = join(source, 'handcheck', 'codex-pass')
  const eventFiles = listFiles(base).filter((name) => /^events-(?:sheet-\d+|negatives)\.jsonl$/.test(name))
  const sessions = []
  for (const name of eventFiles) {
    const bytes = readFileSync(join(base, name))
    const eventTypes = {}
    const itemTypes = {}
    let commandExecutions = 0
    let fileReads = 0
    for (const line of bytes.toString('utf8').split('\n').filter(Boolean)) {
      const event = JSON.parse(line)
      eventTypes[event.type] = (eventTypes[event.type] ?? 0) + 1
      const itemType = event.item?.type
      if (itemType) itemTypes[itemType] = (itemTypes[itemType] ?? 0) + 1
      if (itemType === 'command_execution') commandExecutions += 1
      if (itemType === 'file_read' || itemType === 'mcp_tool_call') fileReads += 1
    }
    sessions.push({
      session: name.replace(/^events-|\.jsonl$/g, ''),
      sourceSha256: sha256(bytes),
      eventTypes,
      itemTypes,
      commandExecutions,
      fileReads,
    })
  }
  return {
    schemaVersion: 'analysis-v32-codex-conduct-v1',
    disclosure: 'Counts and source hashes from private event transcripts. Thread identifiers and full response events are excluded.',
    sessions,
    totals: {
      sessions: sessions.length,
      commandExecutions: sessions.reduce((sum, row) => sum + row.commandExecutions, 0),
      fileReads: sessions.reduce((sum, row) => sum + row.fileReads, 0),
    },
  }
}

function buildReleaseReadme(manifest, provenance) {
  return [
    '# Agent-Mafia analysis v3.2',
    '',
    'This directory is the curated release package for the analysis behind the',
    'Agent-Mafia technical report. It exports analysis run',
    `\`${manifest.analysisRunId}\`, computed with code commit`,
    `\`${manifest.codeCommit}\`.`,
    '',
    'The 40 source game logs are already tracked at `data/sweep1/` and are not',
    'duplicated here.',
    '',
    '## What is included',
    '',
    '- `publication.json`: the consolidated machine-readable source for reported',
    '  results.',
    '- `ledger/`, `opportunity/`, and `stats/`: the final claim records,',
    '  opportunity table, cohort statistics, agreement summary, and PF-2',
    '  validation summary.',
    '- `extract/`: accepted claims, machine negatives, and rejected candidates for',
    '  every game. Machine-local game paths have been replaced with stable paths',
    '  under `data/sweep1/`.',
    '- `handcheck/`: the model sensitivity ratings, blinded packet, frozen author',
    '  first pass, clarification overlay, final author rulings, and approval record.',
    '- `handcheck/codex-pass/`: the exact prompts and schemas supplied to the',
    '  sensitivity rater, plus a privacy-preserving conduct summary.',
    '- `tripwire/`: the lexicon and validation report pinned by the analysis',
    '  manifest.',
    '- `manifest.json`, `cleanroom.json`, and `handcheck/pf2-provenance.json`: the',
    '  original analysis identity, clean-room attestation, and PF-2 source',
    '  provenance record.',
    '- `RELEASE-MANIFEST.json` and `SHA256SUMS`: the inventory, checksums, and',
    '  source-to-release crosswalk for every evidence and documentation payload.',
    '  These two index files are the unavoidable self-referential exceptions.',
    '',
    '## Verify the release',
    '',
    'From the repository root:',
    '',
    '```bash',
    'node scripts/verify-analysis-release.mjs',
    '```',
    '',
    'The verifier checks the complete file set, individual and aggregate hashes,',
    'the clean-room source-hash crosswalk, the tripwire pins, the extraction file',
    'count, the sensitivity-session conduct summary, local-path removal, and common',
    'secret signatures.',
    '',
    'To verify a source game independently:',
    '',
    '```bash',
    'pnpm run mafia verify data/sweep1/sweep1-0.jsonl',
    '```',
    '',
    '## Two run identifiers',
    '',
    'The PF-2 provenance record uses run',
    `\`${provenance.analysisRunId}\`.`,
    'That was the frozen rating-phase run. The final analysis manifest uses run',
    `\`${manifest.analysisRunId}\``,
    'and explicitly supersedes the rating-phase run after the final rulings were',
    'incorporated. The two identifiers describe successive bound stages, not two',
    'different studies.',
    '',
    '## Export boundary',
    '',
    'This directory is not a copy of the ignored private `runs/` directory. The',
    'export deliberately excludes provider response identifiers, full local',
    'session events, duplicate raw response envelopes, operational logs, packet',
    'backups, draft rulings, the local review interface, and machine-specific helper',
    'files. Aggregate extraction telemetry and a per-session conduct summary are',
    'provided instead.',
    '',
    `The original PF-2 provenance inventory covers ${provenance.files.length} private source artifacts.`,
    'This export includes and cross-checks the public subset and adds the final',
    'derived records. The exact coverage, omissions, and reasons are recorded in',
    '`RELEASE-MANIFEST.json`. The original provenance manifest and clean-room',
    'attestation remain unchanged so their historical hashes are preserved.',
    '',
    'Semantic results remain exploratory, author-adjudicated, and potentially',
    'incomplete. The six scan candidates were targeted cleanup, not a recall or',
    'omission-rate estimate. See `DATA-NOTICE.md` and the paper for the full scope',
    'and limitations.',
    '',
  ].join('\n')
}

function buildDataNotice() {
  return [
    '# Data notice',
    '',
    '## Contents and provenance',
    '',
    'The source logs contain interactions among language-model agents in a',
    'synthetic Mafia game. There were no human participants. Seat names are',
    'synthetic. The released analysis records quote portions of model-generated',
    'messages and connect them to deterministic game state.',
    '',
    'The study used hosted model endpoints from several providers. Model and',
    'provider names identify the evaluated endpoints and do not imply endorsement.',
    'The repository contains no provider credentials.',
    '',
    '## License boundary',
    '',
    "Repository code and original project documentation are offered under the root",
    "MIT license. Model-generated text, provider names, and provider-supplied",
    "metadata remain subject to the applicable providers' terms. The MIT license",
    'does not grant additional rights in third-party model outputs or trademarks.',
    '',
    '## Sanitization',
    '',
    'The release builder makes the following changes to the private source',
    'artifacts:',
    '',
    '- Machine-local game paths are replaced with `data/sweep1/<game>.jsonl`.',
    '- Raw extraction response envelopes and opaque provider response identifiers',
    '  are omitted. Aggregate token telemetry is retained.',
    '- Full local sensitivity-session event streams and session identifiers are',
    '  omitted. A summary records event counts, source hashes, and the observed',
    '  absence of command executions and file reads.',
    '- Operational logs, local tools, backups, drafts, and unrelated run files are',
    '  omitted.',
    '',
    'Human rulings, quoted claim text, correction fields, rule citations, game',
    'identifiers, and reported numerical results are not anonymized or rewritten.',
    'For every included source artifact, `RELEASE-MANIFEST.json` records the private',
    'source hash, the released hash, and the number of path normalizations.',
    '',
    '## Known limitations',
    '',
    '- Candidate extraction used language models and may have missed claims. No',
    '  general recall estimate is reported.',
    '- One author performed the human adjudication. The sitting was item-level',
    '  blind but not prior-free because aggregate family-level results had already',
    '  been seen.',
    '- The release does not expose raw provider response envelopes or private local',
    '  session identifiers. The normalized ratings, prompts, schemas, source hashes,',
    '  and conduct summary are included.',
    '- The clean-room attestation applies to the hash-bound private source bytes at',
    '  the pinned analysis commit. The release manifest provides the explicit',
    '  crosswalk from those source hashes to the sanitized release files.',
    '',
    'Security concerns about the released data should be reported through the',
    "process described in the repository's root `SECURITY.md`.",
    '',
  ].join('\n')
}

function main() {
  if (process.argv.includes('--sanitization-self-test')) {
    runSanitizationSelfTests()
    return
  }
  const { values } = parseArgs({
    options: {
      source: { type: 'string', default: DEFAULT_SOURCE },
      out: { type: 'string', default: DEFAULT_OUTPUT },
    },
  })
  const source = resolve(values.source)
  const out = resolve(values.out)
  if (!existsSync(source) || !statSync(source).isDirectory()) throw new Error(`source directory missing: ${source}`)
  if (existsSync(out)) throw new Error(`output already exists: ${out}`)

  const provenancePath = join(source, 'handcheck', 'pf2-provenance.json')
  assertFile(provenancePath, 'PF-2 provenance')
  const provenance = readJson(provenancePath, 'PF-2 provenance')
  const provenanceByPath = new Map((provenance.files ?? []).map((entry) => [entry.path, entry]))
  const manifest = readJson(join(source, 'manifest.json'), 'analysis manifest')
  const temporary = join(dirname(out), `.analysis-v32-stage-${process.pid}`)
  if (existsSync(temporary)) throw new Error(`temporary output already exists: ${temporary}`)
  mkdirSync(temporary, { recursive: true })

  const released = []
  const seen = new Set()
  const writePublicFile = (sourcePath, bundlePath, kind, { generated = false, sourceIdentityPath } = {}) => {
    if (seen.has(bundlePath)) return
    if (!generated && (typeof sourceIdentityPath !== 'string' || !sourceIdentityPath || sourceIdentityPath.startsWith('/') || sourceIdentityPath.includes('\\') || sourceIdentityPath.split('/').includes('..'))) {
      throw new Error(`${bundlePath}: source identity must be a stable repository-relative path`)
    }
    seen.add(bundlePath)
    const destination = join(temporary, bundlePath)
    mkdirSync(dirname(destination), { recursive: true })
    let sourceBytes
    let outputBytes
    let replacements = 0
    if (generated) {
      sourceBytes = null
      outputBytes = Buffer.from(sourcePath, 'utf8')
    } else {
      assertFile(sourcePath, `release source ${bundlePath}`)
      sourceBytes = readFileSync(sourcePath)
      const normalized = canonicalize(sourceBytes.toString('utf8'))
      replacements = normalized.replacements
      outputBytes = Buffer.from(normalized.text, 'utf8')
    }
    assertPublicText(outputBytes.toString('utf8'), bundlePath)
    writeFileSync(destination, outputBytes)
    released.push({
      path: bundlePath,
      kind,
      bytes: outputBytes.length,
      sha256: sha256(outputBytes),
      ...(generated ? { generated: true } : {
        sourcePath: sourceIdentityPath,
        sourceBytes: sourceBytes.length,
        sourceSha256: sha256(sourceBytes),
        pathNormalizations: replacements,
      }),
    })
  }

  try {
    for (const rel of REQUIRED_RUN_FILES) {
      writePublicFile(join(source, rel), rel, rel.startsWith('handcheck/') ? 'adjudication' : 'analysis', {
        sourceIdentityPath: `${RUN_SOURCE_ROOT}/${rel}`,
      })
    }

    for (const bundlePath of EXTRACTION_RELEASE_FILES) {
      writePublicFile(join(source, bundlePath), bundlePath, 'extraction', {
        sourceIdentityPath: `${RUN_SOURCE_ROOT}/${bundlePath}`,
      })
    }

    const codexPass = join(source, 'handcheck', 'codex-pass')
    for (const name of CODEX_METHOD_FILES) {
      writePublicFile(join(codexPass, name), `handcheck/codex-pass/${name}`, 'sensitivity-method', {
        sourceIdentityPath: `${RUN_SOURCE_ROOT}/handcheck/codex-pass/${name}`,
      })
    }
    for (const name of CODEX_PROMPT_FILES) {
      writePublicFile(join(codexPass, name), `handcheck/codex-pass/${name}`, 'sensitivity-prompt', {
        sourceIdentityPath: `${RUN_SOURCE_ROOT}/handcheck/codex-pass/${name}`,
      })
    }

    const tripwire = [
      ['runs/analysis-v3/tripwire-lexicon.json', 'tripwire/lexicon.json'],
      ['runs/analysis-v3/tripwire-validation.json', 'tripwire/validation.json'],
    ]
    for (const [sourceRel, bundlePath] of tripwire) {
      writePublicFile(join(REPO_ROOT, sourceRel), bundlePath, 'tripwire', { sourceIdentityPath: sourceRel })
    }

    writePublicFile(`${JSON.stringify(summarizeExtractionTelemetry(source), null, 2)}\n`, 'extract/telemetry.json', 'public-summary', { generated: true })
    writePublicFile(`${JSON.stringify(summarizeCodexConduct(source), null, 2)}\n`, 'handcheck/codex-pass/conduct-summary.json', 'public-summary', { generated: true })
    writePublicFile(buildReleaseReadme(manifest, provenance), 'README.md', 'release-documentation', { generated: true })
    writePublicFile(buildDataNotice(), 'DATA-NOTICE.md', 'release-documentation', { generated: true })

    const actualPayloads = new Set(released.map((file) => file.path))
    const missingPayloads = RELEASE_PAYLOAD_PATHS.filter((path) => !actualPayloads.has(path))
    const unexpectedPayloads = [...actualPayloads].filter((path) => !RELEASE_PAYLOAD_PATHS.includes(path))
    if (missingPayloads.length || unexpectedPayloads.length) {
      throw new Error(`release payload differs from allowlist (missing: ${missingPayloads.join(', ') || 'none'}; unexpected: ${unexpectedPayloads.join(', ') || 'none'})`)
    }

    released.sort((a, b) => a.path.localeCompare(b.path))
    const includedProvenance = released.filter((file) => {
      if (!file.sourcePath?.startsWith('runs/analysis-v3.2/')) return false
      return provenanceByPath.has(file.sourcePath)
    })
    for (const file of includedProvenance) {
      const pin = provenanceByPath.get(file.sourcePath)
      if (pin.sha256 !== file.sourceSha256 || pin.bytes !== file.sourceBytes) {
        throw new Error(`${file.sourcePath}: source bytes differ from PF-2 provenance`)
      }
    }

    const release = {
      schemaVersion: 'analysis-v32-release-v1',
      analysisRunId: manifest.analysisRunId,
      pf2RunId: provenance.analysisRunId,
      codeCommit: manifest.codeCommit,
      sourceProvenanceSha256: sha256(readFileSync(provenancePath)),
      transformation: 'Only machine-local game paths are rewritten to data/sweep1/<game>.jsonl. Human rulings and claim content are unchanged.',
      files: released,
      aggregateSha256: aggregateHash(released),
      sourceProvenanceCoverage: {
        included: includedProvenance.length,
        total: provenance.files.length,
      },
      omissions: [
        { pattern: 'extract/*.raw.jsonl', count: listFiles(join(source, 'extract')).filter((name) => name.endsWith('.raw.jsonl')).length, reason: 'Contains provider response identifiers. Aggregate token telemetry is released instead.' },
        { pattern: 'handcheck/codex-pass/events-*.jsonl', count: listFiles(codexPass).filter((name) => /^events-(?:sheet-\d+|negatives)\.jsonl$/.test(name)).length, reason: 'Contains local session identifiers and duplicate full outputs. A conduct summary with source hashes is released instead.' },
        { pattern: 'handcheck/codex-pass/*.raw.json', count: listFiles(codexPass).filter((name) => /^(?:ratings-sheet-\d+|negatives)\.raw\.json$/.test(name)).length, reason: 'Duplicates the normalized ratings and contains raw response envelopes.' },
        { pattern: 'handcheck/codex-pass/err-*.log and sha256s.txt', count: listFiles(codexPass).filter((name) => /^(?:err-(?:sheet-\d+|negatives)\.log|sha256s\.txt)$/.test(name)).length, reason: 'Empty stderr files and a machine-local checksum listing are replaced by the release manifest.' },
        { pattern: 'operational logs, packet backups, drafts, local UI and helper files', reason: 'Not part of the final scientific record.' },
      ],
    }
    writeFileSync(join(temporary, 'RELEASE-MANIFEST.json'), `${JSON.stringify(release, null, 2)}\n`)
    writeFileSync(join(temporary, 'SHA256SUMS'), released.map((file) => `${file.sha256}  ${file.path}`).join('\n') + '\n')
    renameSync(temporary, out)
    console.log(`analysis release built: ${released.length} files, ${release.aggregateSha256}`)
    console.log(`PF-2 provenance coverage: ${includedProvenance.length}/${provenance.files.length} source artifacts`)
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true })
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main()
  } catch (error) {
    console.error(`build-analysis-release: ${error.message ?? error}`)
    process.exitCode = 1
  }
}
