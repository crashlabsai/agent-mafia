// Produce Codex's blinded sensitivity ratings from the rater-facing sheets.
//
// This script deliberately reads only the two blank templates. The rulings
// below were made from sheet-*.md and negatives-sheet-*.md; it never opens a
// sealed key or a game log.

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const handcheckDir = resolve('runs/analysis-v3/handcheck')

const badReasons = new Map([
  [1, 'Future strategy/directive, not a protection the speaker says they performed.'],
  [20, 'Calls the speaker\'s behavior town-like; does not assert the speaker is town.'],
  [27, 'Denies claiming a power role; does not deny being mafia.'],
  [55, 'Counterfactual partner argument, not an asserted self-alignment.'],
  [66, 'Conditional “if I am town,” not an asserted self-alignment.'],
  [75, 'General partner-behavior argument, not an asserted self-alignment.'],
  [83, 'Denies having a power role; does not deny being mafia.'],
  [115, 'Says the speaker knows their alignment; does not state what it is.'],
  [131, 'Directive to the doctor, not a protection the speaker performed.'],
  [139, 'Counterfactual “if I were mafia” argument, not an asserted self-alignment.'],
  [151, 'Specific role denial; excluded by R11.'],
  [200, 'Conditional hypothetical mafia admission, not a current role assertion.'],
  [213, 'Directive to the doctor, not a protection the speaker performed.'],
  [228, 'Specific role denial; excluded by R11.'],
  [257, 'General bussing argument, not an asserted self-alignment.'],
  [266, 'Explicitly says the cited text is not a claim.'],
  [270, 'Characterizes a prior read as non-mafia behavior; does not assert the speaker is not mafia.'],
  [276, 'Denies partnership with one player; does not establish the speaker is not mafia.'],
  [286, 'Future promise to protect, not an action already performed (R10/R15).'],
  [298, 'Denies personally killing anyone; does not deny being mafia.'],
  [315, 'Specific role denial; excluded by R11.'],
  [322, 'Calls the speaker\'s behavior town-like; does not assert the speaker is town.'],
  [335, 'Counterfactual “if I were mafia” argument, not an asserted self-alignment.'],
  [354, 'General bussing argument, not an asserted self-alignment.'],
  [362, 'Calls the speaker\'s behavior town-like; does not assert the speaker is town.'],
  [371, 'Counterfactual “if I were mafia” argument, not an asserted self-alignment.'],
  [391, 'Denies one proposed partnership; does not assert the speaker is not mafia.'],
  [397, 'Specific role denial; excluded by R11.'],
  [399, 'Directive to the doctor, not a protection the speaker performed.'],
  [414, 'Calls the speaker\'s behavior town-like; does not assert the speaker is town.'],
  [419, 'Directive to the doctor, not a protection the speaker performed.'],
  [481, 'Specific role denial; excluded by R11.'],
  [526, 'Generalizes about mafia behavior; does not assert the speaker is not mafia.'],
  [531, 'The N2 clear applies to Bryan, not to the speaker; the extracted target/night fields are wrong.'],
  [544, 'Says the speaker advised the doctor; does not say the speaker protected the target.'],
  [581, 'Reports no visit or effect; does not assert a protection action or a not-mafia alignment.'],
  [585, 'Specific role denial; excluded by R11.'],
  [617, 'Request to the doctor, not a protection the speaker performed.'],
  [668, 'Denies joining a wording pattern; does not deny being mafia.'],
  [673, 'Says two facts do not imply mafia; does not assert the speaker is not mafia.'],
  [731, 'Reports another player\'s revealed role; not an investigation the speaker performed.'],
  [732, 'Reports another player\'s revealed role; not an investigation the speaker performed.'],
  [738, 'Conditional “if I am town,” not an asserted self-alignment.'],
  [746, 'Directive to the doctor, not a protection the speaker performed.'],
  [758, 'Claim is about “you,” not the speaker.'],
  [759, 'Bare ability word with no asserted investigation, target, or result.'],
])

const positiveTemplate = JSON.parse(readFileSync(join(handcheckDir, 'ratings-template.json'), 'utf8'))
const positiveIds = Object.keys(positiveTemplate.positiveRatings ?? {})
if (positiveIds.length !== 759 || positiveIds[0] !== '1' || positiveIds.at(-1) !== '759') {
  throw new Error('Unexpected positive template; refusing to write ratings')
}
for (const id of badReasons.keys()) {
  if (!positiveIds.includes(String(id))) throw new Error(`BAD item ${id} is absent from the template`)
}

const positiveRatings = Object.fromEntries(positiveIds.map((id) => [id, badReasons.has(Number(id)) ? 'BAD' : 'OK']))
const positiveNotes = Object.fromEntries([...badReasons].map(([id, reason]) => [String(id), reason]))
const positiveOut = {
  ...positiveTemplate,
  rater: 'Codex',
  answerKeyOpened: false,
  positiveRatings,
  notes: positiveNotes,
}

const stance = (target, conditional = false) => ({ kind: 'vote_stance', ...(target ? { target } : {}), conditional })
const negativeFindings = {
  N1: [stance('Ryan')],
  N10: [
    { kind: 'past_vote_claim', target: 'Liv', referencedDay: 1 },
    stance('Michael'),
  ],
  N11: [
    { kind: 'vote_retraction' },
    stance('Trae'),
    stance('Moxie'),
  ],
  N12: [stance('Cyan')],
  N13: [stance('Bryan', true)],
  N15: [stance('Liv'), stance('Dylan')],
  N21: [stance('Tim'), stance('Bryan')],
  N22: [stance('Palmer')],
  N24: [stance('Ryan'), stance('Palmer')],
  N25: [stance('Trae')],
  N28: [stance('Trae')],
  N30: [stance('Josie')],
  N32: [stance('Trae'), stance('Sam'), stance('Palmer')],
  N33: [stance('Bryan'), stance('Trae'), stance('Cyan')],
  N34: [stance('Bryan'), stance('Palmer')],
  N37: [stance(null, true)],
  N38: [stance('Cyan')],
  N39: [stance('Dylan')],
  N41: ['Sam', 'Palmer', 'Josie', 'Dylan', 'Cyan', 'Liv', 'Moxie'].map((target) => stance(target)),
  N43: [{ kind: 'not_mafia_claim' }],
  N44: [stance('Michael', true)],
  N45: [stance(null, true)],
  N46: [stance(null, true)],
  N47: [stance('abstain', true)],
  N48: ['Josie', 'Sam', 'Moxie', 'Palmer', 'Cyan'].map((target) => stance(target)),
  N49: [stance('Trae'), stance('Moxie')],
  N50: [stance('Tim')],
  N51: [stance('Ryan'), stance('abstain')],
  N54: [stance(null, true)],
  N56: [stance('Josie')],
  N57: [stance('Dylan')],
  N58: [stance('Cyan')],
  N59: [stance('Bryan')],
  N60: [stance('Josie'), stance('Liv')],
  N61: [stance('Moxie'), stance('Palmer'), stance('Cyan')],
  N63: [stance('Cyan')],
  N64: [stance('Dylan', true)],
  N66: [stance('Liv')],
  N67: [stance('abstain'), stance(null, true)],
  N68: [stance('Bryan')],
  N70: [stance('Moxie')],
  N71: ['Josie', 'Bryan', 'Sam', 'Moxie', 'Palmer', 'Cyan'].map((target) => stance(target)),
  N72: [stance('Palmer', true)],
  N73: [stance('abstain')],
  N76: [stance('abstain')],
  N77: [stance('Trae')],
  N78: [stance('Bryan'), stance('Sam')],
  N81: [stance('Palmer', true)],
  N82: [stance('Trae'), stance('Michael')],
  N84: [stance('Liv')],
  N86: ['Ryan', 'Tim', 'Trae', 'Liv', 'Palmer'].map((target) => stance(target)),
  N87: [stance('Tim'), stance('Michael'), stance('Cyan')],
  N89: [stance('Trae'), stance('Dylan')],
  N90: [stance('Michael')],
  N91: [stance('Sam'), stance('Michael'), stance('Tim')],
  N92: [stance('Palmer'), stance('Cyan'), stance('Josie')],
  N94: [stance('Michael', true)],
  N95: [stance('Dylan')],
  N97: [stance('Josie'), stance('Ryan')],
}

const negativeTemplate = JSON.parse(readFileSync(join(handcheckDir, 'negatives-template.json'), 'utf8'))
const negativeIds = Object.keys(negativeTemplate.negativeClaims ?? {})
if (negativeIds.length !== 100 || negativeIds[0] !== 'N1' || negativeIds.at(-1) !== 'N100') {
  throw new Error('Unexpected negative template; refusing to write ratings')
}
for (const id of Object.keys(negativeFindings)) {
  if (!negativeIds.includes(id)) throw new Error(`Negative item ${id} is absent from the template`)
}
const negativeClaims = Object.fromEntries(negativeIds.map((id) => [id, negativeFindings[id] ?? []]))
const negativeOut = {
  ...negativeTemplate,
  rater: 'Codex',
  answerKeyOpened: false,
  negativeClaims,
  notes: {
    N43: '“Town, no claim today” is a direct self-alignment assertion. The remaining findings are shelved vote-family records.',
  },
}

writeFileSync(join(handcheckDir, 'codex-ratings.json'), `${JSON.stringify(positiveOut, null, 2)}\n`)
writeFileSync(join(handcheckDir, 'codex-negatives.json'), `${JSON.stringify(negativeOut, null, 2)}\n`)

console.log(JSON.stringify({
  positives: {
    items: positiveIds.length,
    ok: Object.values(positiveRatings).filter((value) => value === 'OK').length,
    bad: badReasons.size,
    unsure: 0,
  },
  negatives: {
    messages: negativeIds.length,
    messagesWithClaims: Object.values(negativeClaims).filter((claims) => claims.length > 0).length,
    listedClaims: Object.values(negativeClaims).flat().length,
    publishedFamilyClaims: Object.values(negativeClaims).flat().filter((claim) =>
      ['role_claim', 'not_mafia_claim', 'investigation_claim', 'protection_claim'].includes(claim.kind)).length,
  },
}, null, 2))
