// Tripwire — the §3.1 lexical recall net for analysis v3.
//
// The lexicon is generated mechanically from the codebook's canonical forms
// for the four PUBLISHED families (role / not-mafia / investigation /
// protection). It is a recall instrument, not a classifier: any hit only
// nominates a message as a candidate (extract-v3) or for the human recall
// queue; precision is the classifier's and the human's job. Patterns are
// therefore deliberately broad and must never be used to assert a claim.
//
// Matching happens over normalized text (R19's normalization: curly
// apostrophes/quotes and unicode dashes folded to ASCII, whitespace
// collapsed, lowercased) so the ASCII patterns below also cover the curly
// and spacing variants that appear in real logs. The SAME normalization is
// exported for quote LOCATION (R19: normalized matching may locate a quote;
// the stored quote is always the exact source substring).
//
// §3.1 gate: before freeze the lexicon must show ≥95% quote-level coverage
// per published family against the archived v2 ledger. `validate` measures
// exactly that, offline, and exits 1 below threshold. Coverage is
// whole-lexicon coverage (any family's pattern hits the quote): the net has
// one recall queue, so a role-claim quote caught by the investigation
// patterns is caught. The per-family-pattern breakdown is reported as a
// diagnostic alongside.
//
//   node scripts/tripwire.mjs generate [--out runs/analysis-v3/tripwire-lexicon.json]
//   node scripts/tripwire.mjs validate [--v2-dir runs/analysis/extract] \
//        [--report runs/analysis-v3/tripwire-validation.json] [--threshold 0.95]
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

export const TRIPWIRE_VERSION = 'v3.1.0'

// ---------------------------------------------------------------------------
// Normalization (R19). One implementation for both lexicon matching and quote
// location; extract-v3 imports normalizeIndexed to map normalized match
// positions back to exact source offsets.
// ---------------------------------------------------------------------------

const normChar = (c) => {
  if ('‘’ʼ'.includes(c)) return "'"
  if ('“”'.includes(c)) return '"'
  if ('–—'.includes(c)) return '-'
  if (/\s/.test(c)) return ' '
  return c.toLowerCase()
}

/** Normalized text plus map[i] = source index of normalized char i. */
export function normalizeIndexed(source) {
  let out = ''
  const map = []
  for (let i = 0; i < source.length; i++) {
    const c = normChar(source[i])
    if (c === ' ' && (out === '' || out.endsWith(' '))) continue
    out += c
    map.push(i)
  }
  while (out.endsWith(' ')) {
    out = out.slice(0, -1)
    map.pop()
  }
  return { text: out, map }
}

export const normalizeText = (source) => normalizeIndexed(source).text

// ---------------------------------------------------------------------------
// Mechanical lexicon generation. The building blocks below are the codebook's
// canonical vocabulary (§2.1): first-person subjects with their contractions,
// role nouns and their table synonyms, and the family verbs expanded across
// tense. Every family pattern is a composition of these blocks — no pattern
// is tuned to a specific game or model.
// ---------------------------------------------------------------------------

/** Regular-verb tense expansion: base, -s, -ed, -ing (e-drop handled). */
const verbForms = (stem) =>
  stem.endsWith('e')
    ? `${stem.slice(0, -1)}(?:e|es|ed|ing)`
    : `${stem}(?:s|ed|ing)?`

// First-person subjects; apostrophes are ASCII because matching runs over
// normalized text (curly forms fold to these).
const FIRST = String.raw`(?:i am|i'm|im\b|i was|i have been|i've been|me[:,]|and i\b|i,)`
// Filler that canonically sits between subject and role noun.
const FILL = String.raw`(?:(?:the|a|an|plain|vanilla|real|just|also|only|simple|regular|ordinary|actual|still|truly|genuinely|literally|100%|confirmed|your|this game's) )*`
// Role nouns and the table's synonyms for them (cop/seer/medic), plus the
// alignment nouns players use as role shorthand.
const ROLE = String.raw`(?:villagers?|village|detective|doctor|mafia|godfather|medic|cop|seer|investigators?|town(?:ie)?|vanilla|partner)`

// family -> [{ id, pattern }] — pattern sources over normalized text.
const FAMILY_TEMPLATES = {
  role_claim: {
    'first-person-role': `${FIRST} ${FILL}${ROLE}\\b`,
    'my-role-is': `my role is`,
    'role-colon': `role[:=] ?${ROLE}`,
    'i-claim': `(?:i|i'll|i will|i already) claim(?:ed)?\\b`,
    claiming: `claiming ${FILL}${ROLE}`,
    'as-role': `as ${FILL}${ROLE}\\b`,
    'name-here-role': `here [-:]*${FILL}${ROLE}`,
    'leading-role': `^${FILL}${ROLE}\\b`,
    'name-then-role': `^\\w+ ${FILL}${ROLE}\\b`,
    'punct-then-role': `[.,;-] ?${FILL}${ROLE}\\b`,
    'claim-colon-role': `claim(?:ed|s)?[: ]+${FILL}${ROLE}`,
    'flip-role': `flip(?:s|ped)? ${FILL}${ROLE}`,
    'hard-claim': `hard claim`,
    'seat-role': `seat.?\\d+.? ?${FILL}${ROLE}`,
    'parenthetical-role': `\\(${ROLE}\\)`,
    'reveal-role': `reveal(?:s|ed|ing)? ${FILL}${ROLE}`,
    'my-role-noun': `(?:is|as) my ${FILL}${ROLE}`,
    'real-role': `(?:real|actual|true|genuine) ${ROLE}`,
    'my-ability-noun': `my (?:claim|${verbForms('check')}|investigation|results?|clears?|n\\d+)\\b`,
  },
  not_mafia_claim: {
    town: `\\btown\\b`,
    'not-mafia': `\\bnot (?:the )?(?:mafia|a wolf|evil|scum)\\b`,
    innocent: `\\binnocen\\w*`,
    cleared: `\\bclear(?:ed|s)?\\b`,
    clean: `\\bclean\\b`,
    'not-me': `it isn'?t me|it'?s not me|not me\\b|isn'?t me\\b`,
    'no-power-role': `no (?:special|power) role`,
    alignment: `my (?:own )?alignment`,
    framed: `\\bfram(?:e|ed|ing)\\b`,
    'no-kills': `killed nobody|not a killer`,
    'not-partner': `not .{0,24}partner`,
  },
  investigation_claim: {
    investigate: `\\b${verbForms('investigate')}\\w*`,
    check: `\\b${verbForms('check')}\\b`,
    'night-number': `\\bn\\d+\\b`,
    'night-word': `night \\d+`,
    'night-relative': `last night|tonight`,
    result: `\\bresults?\\b`,
    'is-mafia': `\\bis (?:not )?mafia\\b`,
    'came-back': `\\b(?:came back|${verbForms('return')}|${verbForms('show')})\\b`,
    mafia: `\\bmafia\\b`,
    'clean-clear': `\\bclean\\b|\\bclear(?:ed|s)?\\b`,
    'guilty-innocent': `\\bguilty\\b|\\binnocent\\b`,
    'red-green': `\\bred\\b|\\bgreen\\b`,
    town: `\\btown\\b`,
  },
  protection_claim: {
    protect: `\\b${verbForms('protect')}\\w*`,
    save: `\\bsav(?:e|ed|ing)\\b`,
    shield: `\\b${verbForms('shield')}\\w*`,
    heal: `\\b${verbForms('heal')}\\w*`,
    'self-protect': `self.?protect`,
    'night-number': `\\bn\\d+\\b`,
    'night-word': `night \\d+`,
    'night-relative': `last night|tonight`,
    guard: `\\b${verbForms('guard')}\\w*`,
    doctor: `\\bdoctor\\b|\\bdoc\\b`,
  },
}

export const PUBLISHED_FAMILIES = Object.keys(FAMILY_TEMPLATES)

/** The lexicon as data: expanded pattern sources, importable and hashable. */
export function buildLexicon() {
  const families = {}
  for (const [family, templates] of Object.entries(FAMILY_TEMPLATES)) {
    families[family] = Object.entries(templates).map(([id, pattern]) => ({ id, pattern }))
  }
  return { version: TRIPWIRE_VERSION, normalization: 'R19: curly->ascii, dashes->-, whitespace collapsed, lowercased', families }
}

export const lexiconSha256 = (lexicon = buildLexicon()) =>
  createHash('sha256').update(JSON.stringify(lexicon)).digest('hex')

/** family -> RegExp[] (patterns run over ALREADY-normalized text). */
export function compileLexicon(lexicon = buildLexicon()) {
  const compiled = {}
  for (const [family, patterns] of Object.entries(lexicon.families)) {
    compiled[family] = patterns.map(({ id, pattern }) => ({ id, re: new RegExp(pattern, 'i') }))
  }
  return compiled
}

/** All family hits in normalized text: [{ family, patternId, match, index }]. */
export function lexiconHits(normText, compiled) {
  const hits = []
  for (const [family, patterns] of Object.entries(compiled)) {
    for (const { id, re } of patterns) {
      const m = re.exec(normText)
      if (m) {
        hits.push({ family, patternId: id, match: m[0], index: m.index })
        break // one hit per family is enough to trip the net
      }
    }
  }
  return hits
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const writeAtomic = (path, data) => {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

function validate(v2Dir, reportPath, threshold) {
  const lexicon = buildLexicon()
  const compiled = compileLexicon(lexicon)
  const files = readdirSync(v2Dir).filter((f) => f.endsWith('.claims.jsonl')).sort()
  if (files.length === 0) {
    console.error(`tripwire validate: no *.claims.jsonl in ${v2Dir}`)
    process.exit(1)
  }
  const perFamily = Object.fromEntries(
    PUBLISHED_FAMILIES.map((f) => [f, { n: 0, lexiconMatched: 0, familyMatched: 0, misses: [] }]),
  )
  let claimsSeen = 0
  for (const f of files) {
    for (const line of readFileSync(join(v2Dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue
      const rec = JSON.parse(line)
      // v2 kind names for the published families are identical to v3's.
      if (rec._meta || !perFamily[rec.kind]) continue
      claimsSeen += 1
      const stats = perFamily[rec.kind]
      stats.n += 1
      const norm = normalizeText(rec.quote)
      if (lexiconHits(norm, compiled).length > 0) stats.lexiconMatched += 1
      else stats.misses.push({ file: f, seq: rec.seq, quote: rec.quote })
      if (compiled[rec.kind].some(({ re }) => re.test(norm))) stats.familyMatched += 1
    }
  }
  let pass = true
  const families = {}
  for (const [family, s] of Object.entries(perFamily)) {
    const lexiconCoverage = s.n === 0 ? 1 : s.lexiconMatched / s.n
    const familyCoverage = s.n === 0 ? 1 : s.familyMatched / s.n
    if (lexiconCoverage < threshold) pass = false
    families[family] = { n: s.n, lexiconMatched: s.lexiconMatched, lexiconCoverage, familyMatched: s.familyMatched, familyCoverage, misses: s.misses }
    console.log(
      `${family.padEnd(22)} n=${String(s.n).padStart(4)}  lexicon ${(100 * lexiconCoverage).toFixed(1)}%  own-family ${(100 * familyCoverage).toFixed(1)}%  misses ${s.misses.length}`,
    )
  }
  const report = {
    tripwireVersion: TRIPWIRE_VERSION,
    lexiconSha256: lexiconSha256(lexicon),
    v2Dir,
    files: files.length,
    publishedFamilyClaims: claimsSeen,
    threshold,
    pass,
    families,
    lexicon,
    validatedAt: new Date().toISOString(),
  }
  writeAtomic(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(`${pass ? 'PASS' : 'FAIL'} (threshold ${(100 * threshold).toFixed(0)}% per published family) -> ${reportPath}`)
  if (!pass) process.exit(1)
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMain) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', default: 'runs/analysis-v3/tripwire-lexicon.json' },
      'v2-dir': { type: 'string', default: 'runs/analysis/extract' },
      report: { type: 'string', default: 'runs/analysis-v3/tripwire-validation.json' },
      threshold: { type: 'string', default: '0.95' },
    },
  })
  const mode = positionals[0]
  if (mode === 'generate') {
    const lexicon = buildLexicon()
    writeAtomic(values.out, JSON.stringify(lexicon, null, 2) + '\n')
    console.log(`lexicon ${TRIPWIRE_VERSION} sha256=${lexiconSha256(lexicon)} -> ${values.out}`)
  } else if (mode === 'validate') {
    validate(values['v2-dir'], values.report, Number(values.threshold))
  } else {
    console.error('usage: tripwire.mjs generate [--out f] | validate [--v2-dir d] [--report f] [--threshold 0.95]')
    process.exit(1)
  }
}
