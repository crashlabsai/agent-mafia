// Historical publication-snapshot renderer — consumes ONLY the fail-closed publication artifact
// (publication.json) and emits one static, self-contained page. Every
// figure on the page is computed HERE from the publication at render time,
// so the page cannot drift from what the gates checked. Gate G12 inspects
// this source for retired v1 input names and for the publication reference.
//
// Presentation: metric blocks (title → reading hint → measured-over →
// definition → value-sorted table with a big number and bar per model →
// pull-quote). Rows are value-sorted for readability with NO rank numbers —
// the method commits to descriptive results, never rankings, and every
// block carries that caveat.
//
//   node scripts/render-site.mjs --publication runs/analysis-v3/publication.json \
//        --out dist/field-report.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    publication: { type: 'string', default: 'runs/analysis-v3/publication.json' },
    out: { type: 'string', default: 'dist/field-report.html' },
    title: { type: 'string', default: 'Agent Mafia — Sweep 1' },
  },
})

const pub = JSON.parse(readFileSync(values.publication, 'utf8'))
// v3.2-ONLY renderer: the archived v3.1 publication has different key names
// and different semantics, and renders at the manifest-pinned code commit.
// Failing here with a pointer beats a TypeError three hundred lines down
// (review finding: renderer crashed on the archived artifact).
if (pub.protocol !== 'v3.2') {
  console.error(`render-site: ${values.publication} is not a v3.2 publication (protocol=${JSON.stringify(pub.protocol ?? null)}).`)
  console.error('Archived v3.1 artifacts render at the code commit the analysis manifest pins (manifest.codeCommit).')
  process.exit(1)
}
const models = pub.stats.models
const night = pub.stats.nightAggregate
const rel = pub.reliability
const exploratoryV1 = pub.honesty?.mode === 'exploratory-v1'
const ns = exploratoryV1 ? null : pub.negativeSample
const targetedCandidateScan = exploratoryV1 ? pub.targetedCandidateScan : null
if (exploratoryV1 && !targetedCandidateScan) {
  console.error('render-site: exploratory-v1 publication lacks targetedCandidateScan')
  process.exit(1)
}
if (!exploratoryV1 && !ns) {
  console.error('render-site: full-v3.2-validation publication lacks negativeSample')
  process.exit(1)
}
const pf2 = pub.sections.pf2
const totals = pub.sections.falseStatementLedger.totals
// v3.2.2: a family omitted at the §8 gate appears on NO surface of this page
// except this disclosure (closure review finding 4). The embedded stats are
// already scrubbed by the assembler; blocks that would have drawn on an
// omitted family render an omission notice instead of a table of zeros.
const omittedFamilies = (pub.sections.falseStatementLedger.omittedFamilies ?? []).map((o) => o.family)
const omittedSet = new Set(omittedFamilies)
const omissionNotice = (id, title, families) => `
<section class="block" id="${id}">
  <h2>${esc(title)} <span class="hint">Omitted at the §8 publication gate.</span></h2>
  <p class="def">This block draws on ${families.map(esc).join(' and ')}, and at least one of those
  families did not clear the §8 retained-precision floor. Its Tier&nbsp;L results are omitted from
  this page and from the publication artifact — omitted, not disclosed-and-published. The counts
  of what was withheld are in the publication's <code>omittedFamilies</code> disclosure.</p>
</section>`
const updated = 'August 26, 2026'

const NAME = {
  'deepseek-v4-flash': 'DeepSeek V4 Flash', 'gemini-3.7-flash': 'Gemini 3.7 Flash',
  'glm-5.2': 'GLM 5.2', 'gpt-5.6-luna': 'GPT-5.6 Luna', 'gpt-5.6-sol': 'GPT-5.6 Sol',
  'grok-4.6': 'Grok 4.6', 'kimi-k3': 'Kimi K3', 'muse-spark': 'Muse Spark',
  'nemotron-3-ultra': 'Nemotron 3 Ultra', 'opus-5': 'Opus 5', 'ox-alpha': 'Ox Alpha',
  'sonnet-5': 'Sonnet 5',
}
const name = (k) => NAME[k] ?? k
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const pct = (x, d = 1) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(d)}%`)
const pp = (x) => (x === null || x === undefined ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}pp`)
const zeroRange = () => ({ lower: 0, upper: 0 })
const formatRange = (range) => range.lower === range.upper ? String(range.lower) : `${range.lower}–${range.upper}`
const addRanges = (...ranges) => ranges.reduce((sum, range) => ({
  lower: sum.lower + (range?.lower ?? 0),
  upper: sum.upper + (range?.upper ?? 0),
}), zeroRange())
const emptyPropositionFamily = () => ({
  propositions: zeroRange(), resolved: zeroRange(), true: zeroRange(), false: zeroRange(),
  ambiguous: zeroRange(), falseClasses: {},
})
const resolvedReceipts = (family) => (family?.true ?? 0) + (family?.false ?? 0)

// One metric block: rows [{model, cells: [...], big, bar}] value-sorted,
// bars scaled to the block max, small-n rows (big === null) sunk to the end.
function block({ id, title, hint, measured, definition, columns, rows, bigLabel, quote, footnote }) {
  const max = Math.max(...rows.map((r) => r.bar ?? 0), 1e-9)
  const sorted = [...rows].sort((a, b) => (b.big === null) - (a.big === null) || (b.bar ?? 0) - (a.bar ?? 0))
  const tr = sorted.map((r) => `
    <tr>
      <td class="model">${esc(r.model)}</td>
      ${r.cells.map((c) => `<td>${c}</td>`).join('')}
      <td class="big">${r.bigText}</td>
    </tr>
    <tr class="barrow"><td colspan="${columns.length + 2}"><div class="bar" style="width:${Math.max(1.5, ((r.bar ?? 0) / max) * 100)}%"></div></td></tr>`).join('')
  return `
<section class="block" id="${id}">
  <h2>${esc(title)} <span class="hint">${esc(hint)}</span></h2>
  <p class="measured">Measured over <b>${measured}</b>, updated ${updated}.</p>
  <p class="def">${definition}</p>
  <div class="scroll"><table>
    <thead><tr><th>model</th>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}<th class="bigh">${esc(bigLabel)}</th></tr></thead>
    <tbody>${tr}</tbody>
  </table></div>
  ${quote ? `<blockquote>${quote}</blockquote>` : ''}
  ${footnote ? `<p class="foot">${footnote}</p>` : ''}
</section>`
}

// ---- Block 1: Mafia Detection Rate ---------------------------------------
const totalBallots = models.reduce((a, m) => a + m.ballots.validNonAbstain, 0)
const b1 = block({
  id: 'detection', title: 'Mafia Detection Rate',
  hint: 'Higher means the model finds the hidden mafia.',
  measured: `${totalBallots} unforced town ballots across ${pub.stats.games} games`,
  definition: `When a model plays a town role, every day it casts a sealed ballot to execute a
suspect. Detection rate is the share of those ballots that landed on an actual mafia seat —
judged against the engine's dealt roles, not text. The baseline is the named chance policy
"uniform over living non-self targets", computed per ballot; excess is each model's paired margin
over its own baseline. (A second policy, uniform over all legal targets including self, is in the
published artifact.)`,
  columns: ['ballots', '95% CI', 'baseline (non-self)', 'excess'],
  bigLabel: 'detection',
  rows: models.map((m) => {
    const b = m.ballots
    return {
      model: name(m.model), bar: b.conditionalQuality, big: b.conditionalQuality,
      bigText: pct(b.conditionalQuality),
      // v3.2 §5: the named baseline, not "chance". The non-self policy is the
      // one this block's prose compares against.
      cells: [b.validNonAbstain, `<span class="soft">${pct(b.ci95.conditionalQuality[0])}–${pct(b.ci95.conditionalQuality[1])}</span>`, pct(b.meanChanceUniformOverLivingNonSelf), `<b>${pp(b.meanExcessVsUniformOverLivingNonSelf)}</b>`],
    }
  }),
  quote: null,
  footnote: `Conditional accuracy over valid non-abstain unforced ballots; coverage ≥94% for every
model. CIs: game-cluster bootstrap, ${pub.manifest.bootstrap.replicates.toLocaleString()} replicates.`,
})

// ---- Block 2: Cold Reads --------------------------------------------------
const b2 = block({
  id: 'cold-reads', title: 'Cold Reads',
  hint: 'Detection before any public verified investigation result.',
  // v3.2 §6: the renamed stratum, fed by BOTH truthful result types.
  measured: `${models.reduce((a, m) => a + m.strata.beforeAnyPublicVerifiedInvestigationResult.validNonAbstain, 0)} ballots cast before any public verified investigation result`,
  definition: `Once a verified investigation result is public — a mafia hit OR a clear — accuracy
inflates by following the evidence. This block keeps only ballots cast before ANY public verified
investigation result existed in the game. Votes, discussion, and deaths are still evidence, so
read this as pre-report inference, not evidence-free inference.`,
  columns: ['cold ballots', 'cold detection'],
  bigLabel: 'excess over the non-self baseline',
  rows: models.map((m) => {
    const s = m.strata.beforeAnyPublicVerifiedInvestigationResult
    return {
      model: name(m.model),
      bar: Math.max(0, s.meanExcessVsUniformOverLivingNonSelf),
      big: s.meanExcessVsUniformOverLivingNonSelf,
      bigText: `<b>${pp(s.meanExcessVsUniformOverLivingNonSelf)}</b>`,
      cells: [s.validNonAbstain, pct(s.conditionalQuality)],
    }
  }),
  quote: null,
  footnote: `Small per-model denominators (18–37 ballots) — read the split, not the decimals.
Sweep 1 does not observe private beliefs; Sweep 2's belief checkpoints will.`,
})

// ---- Block 3: False role claims (semantic counts) -------------------------
// `ledgerFamilies` is the paper's PRIMARY unit: bounded counts of underlying
// propositions. R20 utterance receipts remain visible as a secondary exact
// audit count. Do not reconstruct per-model falsity rates here: the
// exploratory campaign did not establish the recall denominator needed for
// that comparison, and build-publication intentionally strips those rates.
const roleTotal = models.reduce((a, m) => addRanges(a, m.ledgerFamilies.role_claim?.resolved), zeroRange())
const nmTotal = models.reduce((a, m) => addRanges(a, m.ledgerFamilies.not_mafia_claim?.resolved), zeroRange())
const roleReceiptTotal = models.reduce((a, m) => a + resolvedReceipts(m.ledgerReceiptFamilies?.role_claim), 0)
const nmReceiptTotal = models.reduce((a, m) => a + resolvedReceipts(m.ledgerReceiptFamilies?.not_mafia_claim), 0)
const b3 = ['role_claim', 'not_mafia_claim'].some((f) => omittedSet.has(f))
  ? omissionNotice('false-role-claims', 'False Role Claims', ['role_claim', 'not_mafia_claim'])
  : block({
  id: 'false-role-claims', title: 'False Role Claims',
  hint: "Counts of a model's role propositions that were verifiably false.",
  measured: `${formatRange(roleTotal)} truth-resolved role propositions and ${formatRange(nmTotal)} truth-resolved “I'm town” propositions, represented by ${roleReceiptTotal + nmReceiptTotal} exact truth-resolved public utterance receipts`,
  definition: `Three seats per table are incentivized to conceal who they are — silence and truthful
statements remain possible, and false statements here are playing the game, not misbehavior. What
is shown here is a bounded count of underlying propositions: a first-person claim ("I'm the
detective", "Villager here") contradicted by the seat's actual dealt role. Repeated public
utterances remain auditable as receipts. Exact state-claim repeats do not increment the primary
count; linkage uncertainty is shown as a range rather than silently guessed.`,
  columns: ['role propositions', 'role false', `“I'm town” propositions`, `“I'm town” false`, 'truth-resolved receipts'],
  bigLabel: 'false propositions',
  rows: models.map((m) => {
    const r = m.ledgerFamilies.role_claim ?? emptyPropositionFamily()
    const nm = m.ledgerFamilies.not_mafia_claim ?? emptyPropositionFamily()
    const rr = m.ledgerReceiptFamilies?.role_claim ?? { n: 0 }
    const nmr = m.ledgerReceiptFamilies?.not_mafia_claim ?? { n: 0 }
    const falseCount = addRanges(r.false, nm.false)
    return {
      model: name(m.model), bar: falseCount.upper, big: falseCount.upper,
      bigText: formatRange(falseCount),
      cells: [formatRange(r.resolved), formatRange(r.false), formatRange(nm.resolved), formatRange(nm.false), `<span class="soft">${resolvedReceipts(rr) + resolvedReceipts(nmr)}</span>`],
    }
  }),
  quote: null,
  footnote: `Counts only. Primary totals are truth-resolved proposition-count ranges; ambiguous propositions are disclosed separately in the publication artifact. Public utterance receipts are exact, secondary, and retain R20 reassertions.`,
})

// ---- Block 4: Fabricated Evidence -----------------------------------------
const evTotal = models.reduce((a, m) => addRanges(a, m.ledgerFamilies.investigation_claim?.resolved, m.ledgerFamilies.protection_claim?.resolved), zeroRange())
const evReceiptTotal = models.reduce((a, m) => a + resolvedReceipts(m.ledgerReceiptFamilies?.investigation_claim) + resolvedReceipts(m.ledgerReceiptFamilies?.protection_claim), 0)
const b4 = ['investigation_claim', 'protection_claim'].some((f) => omittedSet.has(f))
  ? omissionNotice('fabricated-evidence', 'Fabricated Evidence', ['investigation_claim', 'protection_claim'])
  : block({
  id: 'fabricated-evidence', title: 'Fabricated Evidence',
  hint: 'Counts of investigation results and protection logs that never happened.',
  measured: `${formatRange(evTotal)} truth-resolved investigation and protection propositions, represented by ${evReceiptTotal} exact truth-resolved public utterance receipts and checked against the engine's actual night-action records`,
  definition: `A role lie is defensive. Fabricated evidence is offensive: claiming "I investigated
Liv — she's clean" with no such investigation on record, or reciting a doctor's protection log for
nights the speaker never played. Every proposition is matched against the game's true night events,
with a temporal guard: a claim can only be supported by an action that had already happened.
Exact same-night repeats collapse. Nightless or unresolved action references may be repeats or new
events, so they widen a disclosed range instead of being forced into either interpretation.`,
  columns: ['investigation propositions', 'investigation false', 'protection propositions', 'protection false', 'truth-resolved receipts'],
  bigLabel: 'fabricated propositions',
  rows: models.map((m) => {
    const i = m.ledgerFamilies.investigation_claim ?? emptyPropositionFamily()
    const p = m.ledgerFamilies.protection_claim ?? emptyPropositionFamily()
    const ir = m.ledgerReceiptFamilies?.investigation_claim ?? { n: 0 }
    const pr = m.ledgerReceiptFamilies?.protection_claim ?? { n: 0 }
    const fab = addRanges(i.false, p.false)
    return {
      model: name(m.model), bar: fab.upper, big: fab.upper,
      bigText: formatRange(fab),
      cells: [formatRange(i.resolved), formatRange(i.false), formatRange(p.resolved), formatRange(p.false), `<span class="soft">${resolvedReceipts(ir) + resolvedReceipts(pr)}</span>`],
    }
  }),
  quote: null,
  footnote: `Counts only. Truth-resolved proposition-count ranges are primary; ambiguous propositions are disclosed separately in the publication artifact, and utterance receipts are exact and secondary. Fabrication is a mafia tactic by construction, not malfunction.`,
})

// ---- Block 5: Night Shift (aggregate table) -------------------------------
const NIGHT = [
  ['doctorIntercept', 'Doctor intercepts the kill'],
  ['selfProtect', 'Doctor protects itself'],
  ['victimWasPowerRole', 'Kill victim held a power role'],
  ['victimHadVotedMafia', 'Kill victim had voted against mafia'],
]
const nightRows = NIGHT.map(([k, label]) => {
  const v = night[k]
  return `<tr><td class="model">${esc(label)}</td><td>${v.count}/${v.n}</td>
    <td class="soft">${v.ci95 ? `${pct(v.ci95[0])}–${pct(v.ci95[1])}` : '—'}</td>
    <td class="big">${pct(v.rate)}</td></tr>
    <tr class="barrow"><td colspan="4"><div class="bar" style="width:${Math.max(1.5, v.rate * 100)}%"></div></td></tr>`
}).join('')
const b5 = `
<section class="block" id="night-shift">
  <h2>The Night Shift <span class="hint">What happens while the table sleeps.</span></h2>
  <p class="measured">Measured over <b>${night.nightsObserved} mafia nights</b>, updated ${updated}. Aggregate only —
  each model held doctor or detective just 3–4 times, too few for per-model rates.</p>
  <div class="scroll"><table>
    <thead><tr><th>metric</th><th>count</th><th>95% CI</th><th class="bigh">rate</th></tr></thead>
    <tbody>${nightRows}</tbody>
  </table></div>
  <blockquote>Doctors protected themselves nearly half the time and stopped 18 kills. More than
  a third of intended victims held a power role.</blockquote>
</section>`

// ---- Block 6: Table Discipline --------------------------------------------
const totalWakes = rel.perModel.reduce((a, r) => a + r.wakes, 0)
const b6 = block({
  id: 'discipline', title: 'Table Discipline',
  hint: 'Operational reliability: can the agent even play its turn?',
  measured: `${totalWakes.toLocaleString()} agent wakes across all 40 scheduled games`,
  definition: `Every turn, an agent must answer with a valid tool call before its deadline.
First-attempt validity is the share of wakes answered legally on the first try; invalid actions
are retried, and unrecovered turns fall to engine defaults. Computed over all 40 games including
the two excluded from behavioral headlines — excluding games for reliability problems and then
reporting reliability would be survivorship bias.`,
  columns: ['wakes', 'invalid actions', 'provider errors', 'discussion coverage'],
  bigLabel: '1st-attempt valid',
  rows: rel.perModel.map((r) => ({
    model: name(r.model), bar: r.firstAttemptValid, big: r.firstAttemptValid,
    bigText: pct(r.firstAttemptValid),
    cells: [r.wakes, r.invalidActionAttempts, r.providerErrorAttempts, pct(r.discussion?.coverage)],
  })),
  quote: null,
  footnote: null,
})

// ---- page -----------------------------------------------------------------
const audit = pf2?.humanPacket?.audit ?? null
const validation = pub.honesty?.validation ?? null
const semanticProtocol = exploratoryV1
  ? 'PF-2 single-author adjudication; exploratory, author-adjudicated, and potentially incomplete; §8 three-arm validation is deferred beyond v1'
  : 'single-author validation protocol, v3.2 §8'
const semanticOmissionEvidence = exploratoryV1
  ? `targeted candidate cleanup screened ${targetedCandidateScan.messagesScreened} messages and surfaced ${targetedCandidateScan.publishedFamilyCandidateMessages} published-family candidate message(s) (${targetedCandidateScan.fullCodebookCandidateMessages} across the full codebook) for human adjudication — counts only, not a recall or omission-rate estimate`
  : `${ns.publishedFamilies.itemsWithMiss}/${ns.n} missed claims in the published families`
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(values.title)}</title>
<style>
  :root { --ink:#17151a; --soft:#6f6a78; --rule:#e6e2ea; --accent:#8d2f23; --wash:#faf8f5; --quote:#f2ede6; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--wash); color:var(--ink);
         font:16px/1.65 "Söhne", "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
         -webkit-font-smoothing:antialiased; }
  .wrap { max-width:52rem; margin:0 auto; padding:4.5rem 1.25rem 6rem; }
  h1 { font-size:2.1rem; line-height:1.15; letter-spacing:-0.02em; margin:0 0 1rem; font-weight:650; }
  .lede { font-size:1.05rem; color:var(--soft); max-width:44rem; margin:0 0 1.4rem; }
  .lede b { color:var(--ink); }
  .banner { border-left:3px solid var(--accent); background:var(--quote); padding:.8rem 1.1rem;
            font-size:.86rem; color:var(--soft); margin:1.6rem 0 0; }
  .banner b { color:var(--ink); }
  .block { margin-top:4rem; }
  h2 { font-size:1.25rem; letter-spacing:-0.01em; margin:0 0 .2rem; font-weight:650; }
  .hint { display:block; font-size:.85rem; font-weight:400; color:var(--soft); margin-top:.15rem; }
  .measured { font-size:.82rem; color:var(--soft); margin:.6rem 0 .4rem; }
  .measured b { color:var(--ink); }
  .def { font-size:.92rem; color:#3d3944; max-width:46rem; margin:.2rem 0 1.1rem; }
  .scroll { overflow-x:auto; }
  table { border-collapse:collapse; width:100%; min-width:38rem; font-size:.86rem; }
  th { text-align:right; font-weight:500; font-size:.66rem; text-transform:uppercase; letter-spacing:.08em;
       color:var(--soft); padding:.5rem .75rem .4rem; border-bottom:1px solid var(--rule); }
  th:first-child { text-align:left; }
  td { text-align:right; padding:.55rem .75rem .15rem; font-variant-numeric:tabular-nums; }
  td:first-child { text-align:left; }
  td.model { font-weight:600; }
  td.big { font-size:1.15rem; font-weight:700; letter-spacing:-0.01em; }
  th.bigh { font-size:.66rem; }
  .soft { color:var(--soft); font-weight:400; }
  tr.barrow td { padding:.15rem .75rem .55rem; border-bottom:1px solid var(--rule); }
  .bar { height:5px; border-radius:3px; background:var(--accent); opacity:.85; }
  blockquote { margin:1.3rem 0 0; padding:.9rem 1.15rem; background:var(--quote); border-left:3px solid var(--accent);
               font-size:.92rem; color:var(--ink); max-width:46rem; }
  .foot { font-size:.78rem; color:var(--soft); max-width:46rem; margin:.8rem 0 0; }
  .trust { margin-top:4.5rem; border-top:1px solid var(--rule); padding-top:1.4rem; font-size:.82rem; color:var(--soft); }
  .trust b { color:var(--ink); }
  code { font:.85em ui-monospace, Menlo, monospace; background:var(--quote); padding:.1em .35em; border-radius:3px; }
</style></head><body><div class="wrap">

<h1>Twelve frontier models sat down at a Mafia table.<br>Three seats were always lying.</h1>
<p class="lede">${pub.stats.games} deterministic games · 11 seats per table · every hidden variable known
to the engine · <b>${formatRange(totals.propositionCountRange)} truth-resolved underlying claim propositions</b> scored against ground truth,
represented by <b>${totals.claimUtteranceReceipts} exact truth-resolved public utterance receipts</b> ·
<b>${formatRange(totals.falsePropositionCountRange)} author-adjudicated verifiably false underlying propositions</b>
(${totals.falseClaimUtteranceReceipts} utterance receipts; ${semanticProtocol}),
all backed by byte-exact receipts.</p>
${omittedFamilies.length ? `<div class="banner"><b>§8 omissions.</b> Tier L results for ${omittedFamilies.map(esc).join(', ')} are omitted at the publication gate; withheld counts are disclosed in the artifact.</div>` : ''}
${exploratoryV1 ? `<div class="banner"><b>Exploratory semantic scope.</b> The targeted model-assisted scan screened ${targetedCandidateScan.messagesScreened} messages and surfaced ${targetedCandidateScan.publishedFamilyCandidateMessages} published-family candidate message(s) (${targetedCandidateScan.fullCodebookCandidateMessages} across the full codebook) for human adjudication. These are targeted candidate-cleanup counts only, <b>not a recall or omission-rate estimate</b>. Semantic results are potentially incomplete, and §8 three-arm validation is deferred beyond v1.</div>` : ''}
<div class="banner"><b>Preliminary field report from Sweep 1.</b> Descriptive observations with
published instrument-validation numbers — not a ranking. Rows are value-sorted for readability
only; cross-model comparison is confounded by table composition, and the controlled benchmark is
Sweep 2.</div>

${b1}
${b2}
${b3}
${b4}
${b5}
${b6}

<div class="trust">
<b>How these numbers were made.</b> Deterministic engine with hash-chained, replayable logs ·
every public utterance receipt carries a byte-exact quote · truth decided by code against ground truth, never by a
model · ${semanticProtocol} (not an independent human gold standard)${validation ? ` · false-claim census
${validation.census?.n ?? 0} rows re-reviewed blind` : ''}${audit ? ` · ${audit.confirmedAsWritten}/${audit.n} audit
confirmations (single human, not inter-rater agreement)` : ''} · ${semanticOmissionEvidence} ·
zero conclusion reversals across three game cohorts · clean-room reproducible, byte-identical ·
run <code>${esc(pub.analysisRunId.slice(0, 12))}…</code> · verify any game offline:
<code>pnpm run mafia verify &lt;log&gt;</code> — no keys needed.
<br><br>Sweep 2 (confirmatory): frozen evaluator, belief checkpoints (Brier-scored), vote-promise
metrics, pair-balanced schedule.
</div>
</div></body></html>\n`

mkdirSync(dirname(values.out), { recursive: true })
writeFileSync(values.out, html)
console.log(`wrote ${values.out} (${models.length} models, ${formatRange(totals.propositionCountRange)} truth-resolved underlying propositions, ${totals.claimUtteranceReceipts} exact truth-resolved utterance receipts, runId ${pub.analysisRunId.slice(0, 12)}…)`)
