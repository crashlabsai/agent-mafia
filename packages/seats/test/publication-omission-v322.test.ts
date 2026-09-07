import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { derivePublishability, familyLeaks, scrubOmittedFamilies } from '../../../scripts/publication-omission.mjs'

// v3.2.2 §8 omission — an omitted family appears on NO publication surface
// (closure review finding 4), and publishability is DERIVED from validated
// counts, never trusted from a stored boolean (finding 3).

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const dirs: string[] = []
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

test('§8: publishability derives from counts and the frozen floor — a stored boolean is ignored', () => {
  // 40 upheld of 40: Wilson lower bound ≈ 0.912 ≥ 0.9 → publishable.
  assert.equal(derivePublishability({ n: 40, upheld: 40 }).publishable, true)
  // 12 of 12 upheld: lower bound ≈ 0.76 → NOT publishable, whatever any flag says.
  assert.equal(derivePublishability({ n: 12, upheld: 12 }).publishable, false)
  // Thin census (< 10) never publishes a rate-gated family.
  assert.equal(derivePublishability({ n: 3, upheld: 3 }).publishable, false)
  assert.equal(derivePublishability({ n: 0, upheld: 0 }).publishable, false)
})

test('§8: scrubOmittedFamilies removes the family from every embedded stats surface', () => {
  const stats = {
    models: [
      { model: 'a', ledgerFamilies: { role_claim: { n: 5 }, protection_claim: { n: 2 } } },
      { model: 'b', ledgerFamilies: { protection_claim: { n: 1 } } },
    ],
    nightAggregate: { doctorIntercept: { count: 1, n: 2 } },
  }
  const scrubbed = scrubOmittedFamilies(stats, ['protection_claim'])
  assert.equal(familyLeaks(scrubbed, 'protection_claim').length, 0)
  assert.ok(scrubbed.models[0].ledgerFamilies.role_claim, 'other families untouched')
  assert.ok(scrubbed.nightAggregate.doctorIntercept, 'engine-derived sections untouched')
  assert.deepEqual(scrubbed.omittedFamilies, ['protection_claim'], 'the one sanctioned mention')
  // familyLeaks catches both key-form and kind-form appearances.
  assert.ok(familyLeaks(stats, 'protection_claim').length >= 2, 'the unscrubbed stats do leak')
  assert.ok(familyLeaks({ claims: [{ kind: 'protection_claim' }] }, 'protection_claim').length === 1)
})

test('§8 e2e: an omitted family appears nowhere in the rendered HTML except the disclosure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omission-render-'))
  dirs.push(dir)
  const range = (lower: number, upper = lower) => ({ lower, upper })
  const propositionFamily = (lo: number, hi: number) => ({
    propositions: range(lo, hi), resolved: range(lo, hi),
    true: range(1), false: range(Math.max(0, lo - 1), Math.max(0, hi - 1)),
    ambiguous: range(0), falseClasses: {},
  })
  const exactStateFamily = propositionFamily(3, 3)
  const uncertainActionFamily = {
    propositions: range(2, 3), resolved: range(1, 2),
    true: range(1), false: range(0, 1), ambiguous: range(1), falseClasses: {},
  }
  const receiptFamily = { n: 3, true: 1, false: 2, ambiguous: 0 }
  const model = (m: string) => ({
    model: m,
    ballots: {
      validNonAbstain: 10, conditionalQuality: 0.5,
      ci95: { conditionalQuality: [0.3, 0.7] },
      meanChanceUniformOverLivingNonSelf: 0.33, meanExcessVsUniformOverLivingNonSelf: 0.17,
    },
    strata: { beforeAnyPublicVerifiedInvestigationResult: { validNonAbstain: 4, conditionalQuality: 0.4, meanExcessVsUniformOverLivingNonSelf: 0.05 } },
    // protection_claim already scrubbed by the assembler — the renderer
    // consumes the publication as built.
    ledgerFamilies: {
      role_claim: exactStateFamily,
      not_mafia_claim: exactStateFamily,
      investigation_claim: uncertainActionFamily,
    },
    ledgerReceiptFamilies: {
      role_claim: { ...receiptFamily, n: 4 },
      not_mafia_claim: { ...receiptFamily, n: 5 },
      investigation_claim: { ...receiptFamily, n: 6 },
    },
  })
  const publication = {
    protocol: 'v3.2',
    analysisRunId: 'run-x'.padEnd(20, '0'),
    negativeSample: { n: 100, publishedFamilies: { itemsWithMiss: 1, missRate: 0.01, wilson95: [0, 0.05] }, fullCodebook: { itemsWithMiss: 2, missRate: 0.02, wilson95: [0, 0.07] } },
    honesty: { validation: { census: { n: 9 } } },
    reliability: { perModel: [{ model: 'model-a', wakes: 100, firstAttemptValid: 0.9, invalidActionAttempts: 5, providerErrorAttempts: 1, discussion: { coverage: 0.95 } }] },
    sections: {
      falseStatementLedger: {
        totals: {
          propositionCountRange: range(8, 9), claimUtteranceReceipts: 15,
          falsePropositionCountRange: range(4, 5), falseClaimUtteranceReceipts: 6,
        },
        omittedFamilies: [{ family: 'protection_claim', reason: 'below the §8 floor', omittedCounts: { true: 1, false: 2, ambiguous: 0 } }],
      },
      pf2: null,
    },
    stats: { games: 5, models: [model('model-a')], nightAggregate: { doctorIntercept: { count: 1, n: 10, rate: 0.1, ci95: [0, 0.2] }, selfProtect: { count: 4, n: 10, rate: 0.4, ci95: [0.2, 0.6] }, victimWasPowerRole: { count: 3, n: 10, rate: 0.3, ci95: [0.1, 0.5] }, victimHadVotedMafia: { count: 5, n: 10, rate: 0.5, ci95: [0.3, 0.7] }, nightsObserved: 10 }, omittedFamilies: ['protection_claim'] },
    manifest: { bootstrap: { replicates: 20000 } },
  }
  const pubPath = join(dir, 'publication.json')
  writeFileSync(pubPath, JSON.stringify(publication))
  const outPath = join(dir, 'page.html')
  const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'render-site.mjs'), '--publication', pubPath, '--out', outPath], { cwd: REPO, encoding: 'utf8' })
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
  const html = readFileSync(outPath, 'utf8')
  // The family is named ONLY in omission disclosures; no counts, rows, or
  // rates for it anywhere.
  const mentions = html.split('protection_claim').length - 1
  assert.ok(mentions >= 1, 'the omission is disclosed on the page')
  assert.match(html, /Omitted at the §8 publication gate|§8 omissions/)
  const disclosureFree = html
    .replace(/<div class="banner"><b>§8 omissions\.<\/b>[\s\S]*?<\/div>/, '')
    .replace(/<section class="block" id="fabricated-evidence">[\s\S]*?<\/section>/, '')
  assert.equal(disclosureFree.includes('protection_claim'), false, 'no non-disclosure surface names the family')
  assert.doesNotMatch(disclosureFree, /Fabricated Evidence[\s\S]*<table>/, 'no Tier L table for the omitted block')
  const roleBlock = html.match(/<section class="block" id="false-role-claims">[\s\S]*?<\/section>/)?.[0]
  assert.ok(roleBlock, 'the retained semantic block renders')
  assert.match(roleBlock, /truth-resolved role propositions/)
  assert.match(roleBlock, /utterance receipts/)
  assert.doesNotMatch(roleBlock.replace(/style="[^"]*"/g, ''), /false-claim rate|\d+(?:\.\d+)?%/, 'semantic block renders counts, never a reconstructed per-model rate')
  assert.match(html, /8–9 truth-resolved underlying claim propositions/)
  assert.match(html, /15 exact truth-resolved public utterance receipts/)

  // Render the non-omitted evidence block too, and pin the same count-only
  // contract independently of the omission notice exercised above.
  const complete = JSON.parse(JSON.stringify(publication))
  complete.sections.falseStatementLedger.omittedFamilies = []
  complete.stats.omittedFamilies = []
  complete.stats.models[0].ledgerFamilies.protection_claim = uncertainActionFamily
  complete.stats.models[0].ledgerReceiptFamilies.protection_claim = { ...receiptFamily, n: 7 }
  const completePath = join(dir, 'publication-complete.json')
  writeFileSync(completePath, JSON.stringify(complete))
  const completeOut = join(dir, 'page-complete.html')
  const completeRender = spawnSync(process.execPath, [join(REPO, 'scripts', 'render-site.mjs'), '--publication', completePath, '--out', completeOut], { cwd: REPO, encoding: 'utf8' })
  assert.equal(completeRender.status, 0, `${completeRender.stdout}${completeRender.stderr}`)
  const completeHtml = readFileSync(completeOut, 'utf8')
  const evidenceBlock = completeHtml.match(/<section class="block" id="fabricated-evidence">[\s\S]*?<\/section>/)?.[0]
  assert.ok(evidenceBlock, 'the retained evidence block renders')
  assert.match(evidenceBlock, /2–4 truth-resolved investigation and protection propositions/)
  assert.match(evidenceBlock, /utterance receipts/)
  assert.doesNotMatch(evidenceBlock.replace(/style="[^"]*"/g, ''), /fabrication rate|\d+(?:\.\d+)?%/, 'evidence block renders counts, never a reconstructed per-model rate')

  const exploratory = JSON.parse(JSON.stringify(complete))
  delete exploratory.negativeSample
  exploratory.honesty = { mode: 'exploratory-v1' }
  exploratory.targetedCandidateScan = {
    rater: 'author',
    messagesScreened: 100,
    publishedFamilyCandidateMessages: 6,
    fullCodebookCandidateMessages: 12,
    interpretation: 'targeted cleanup only, not a recall or omission-rate estimate',
  }
  const exploratoryPath = join(dir, 'publication-exploratory.json')
  writeFileSync(exploratoryPath, JSON.stringify(exploratory))
  const exploratoryOut = join(dir, 'page-exploratory.html')
  const exploratoryRender = spawnSync(process.execPath, [join(REPO, 'scripts', 'render-site.mjs'), '--publication', exploratoryPath, '--out', exploratoryOut], { cwd: REPO, encoding: 'utf8' })
  assert.equal(exploratoryRender.status, 0, `${exploratoryRender.stdout}${exploratoryRender.stderr}`)
  const exploratoryHtml = readFileSync(exploratoryOut, 'utf8')
  assert.match(exploratoryHtml, /targeted model-assisted scan screened 100 messages/)
  assert.match(exploratoryHtml, /6 published-family candidate message\(s\)/)
  assert.match(exploratoryHtml, /12 across the full codebook/)
  assert.match(exploratoryHtml, /not a recall or omission-rate estimate/)
  assert.match(exploratoryHtml, /potentially incomplete/)
  assert.match(exploratoryHtml, /§8 three-arm validation is deferred beyond v1/)
  assert.doesNotMatch(exploratoryHtml, /missed claims in the published families|single-author validation protocol, v3\.2 §8/)
})
