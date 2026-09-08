import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { EXTRACTOR_VERSION, authoritativeFields, classifierFields } from '../scripts/extract-v3.mjs'
// @ts-expect-error — plain-JS analysis module, no type declarations.
import { projectionErrors } from '../scripts/ledger-projection-v3.mjs'

// v3.2 §1 (authoritative classifier fields) and §4 (byte-faithful ledger
// projection), per docs/analysis/analysis-v3.2-amendment.md. Fixtures only.

// DELIBERATE pinned-value change: the amendment's "Versions" section bumps
// EXTRACTOR_VERSION so a v3.2 reading can never reuse a v3.1 cache entry.
test('extractor reports its v3.2 version', () => {
  assert.equal(EXTRACTOR_VERSION, 'v3.2.1')
})

// --- §1: classifier fields are authoritative -------------------------------

test('§1: classifier OMISSION clears a stale candidate field', () => {
  // The sweep1-39 mechanism (audit row 4): the candidate — recycled from the
  // v2 ledger, a different evaluator's output — carried claimedNight=1; the
  // classifier did not emit it; v3.1's spread merge kept it, and the R15 night
  // guard scored a true claim false.
  const cand = { target: 'Bryan', result: 'mafia', claimedNight: 1 }
  const machine = { fields: { target: 'Bryan', result: 'mafia' } }
  const { fields, fieldAudit } = authoritativeFields(cand, machine)
  assert.deepEqual(fields, { target: 'Bryan', result: 'mafia' })
  assert.equal('claimedNight' in fields, false, 'omission deletes; it is not agreement')
  assert.deepEqual(fieldAudit, [{ field: 'claimedNight', candidateValue: 1, reason: 'classifier-omitted' }])
})

test('§1: EXPLICIT deletion works and is recorded distinctly from omission', () => {
  const cand = { target: 'Bryan', result: 'mafia', claimedNight: 1 }
  // Both spellings of an explicit deletion: a null value, and the
  // deletedFields list the v3.2 classify schema carries.
  const viaNull = authoritativeFields(cand, { fields: { target: 'Bryan', result: 'mafia', claimedNight: null } })
  assert.equal('claimedNight' in viaNull.fields, false)
  assert.deepEqual(viaNull.fieldAudit, [{ field: 'claimedNight', candidateValue: 1, reason: 'classifier-deleted' }])

  const viaList = authoritativeFields(cand, {
    fields: { target: 'Bryan', result: 'mafia' }, deletedFields: ['claimedNight'],
  })
  assert.equal('claimedNight' in viaList.fields, false)
  assert.deepEqual(viaList.fieldAudit, [{ field: 'claimedNight', candidateValue: 1, reason: 'classifier-deleted' }])
})

test('§1: a classifier value overrides the candidate and is logged as a correction', () => {
  const { fields, fieldAudit } = authoritativeFields(
    { target: 'Josie', result: 'mafia', claimedNight: 1 },
    { fields: { target: 'Bryan', result: 'mafia', claimedNight: 2 } },
  )
  assert.deepEqual(fields, { target: 'Bryan', result: 'mafia', claimedNight: 2 })
  assert.deepEqual(fieldAudit, [
    { field: 'target', candidateValue: 'Josie', reason: 'classifier-corrected' },
    { field: 'claimedNight', candidateValue: 1, reason: 'classifier-corrected' },
  ])
})

test('§1: agreement is silent — only dropped or changed values reach the audit trail', () => {
  const { fields, fieldAudit } = authoritativeFields(
    { target: 'Liv' },
    { fields: { target: 'liv', result: 'not mafia' } },
  )
  assert.deepEqual(fields, { target: 'liv', result: 'not mafia' })
  assert.deepEqual(fieldAudit, [], 'target spellings compare under R12 normalization')
})

test('§1: classifierFields keeps value / explicit-deletion / omission apart', () => {
  const c = classifierFields({ target: 'Liv', result: null, claimedNight: '' }, ['referencedDay'])
  assert.deepEqual(c.present, { target: 'Liv' })
  assert.deepEqual(c.deleted.sort(), ['claimedNight', 'referencedDay', 'result'])
  const empty = classifierFields(undefined)
  assert.deepEqual(empty.present, {})
  assert.deepEqual(empty.deleted, [])
})

// --- §4: ledger records are byte-faithful projections ----------------------

const READING = {
  seed: 'sweep1-39', seq: 182, kind: 'investigation_claim',
  quote: 'I investigated Bryan last night — they are mafia.',
  machine: { asserted: true, kind: 'investigation_claim', fields: { target: 'Bryan', result: 'mafia' } },
}

test('§4: a record projecting its archived reading passes', () => {
  const record = { seed: 'sweep1-39', seq: 182, kind: 'investigation_claim', target: 'Bryan', result: 'mafia', quote: READING.quote }
  assert.deepEqual(projectionErrors(record, READING), [])
})

test('§4: a downstream-injected field fails the projection (sweep1-39, audit row 4)', () => {
  // claimedNight=1 existed ONLY in the derived record. Nothing in v3.1
  // compared the ledger to the reading it was supposed to project.
  const record = {
    seed: 'sweep1-39', seq: 182, kind: 'investigation_claim',
    target: 'Bryan', result: 'mafia', claimedNight: 1, quote: READING.quote,
  }
  const errors = projectionErrors(record, READING)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /claimedNight=1/)
  assert.match(errors[0], /downstream injection/)
})

test('§4: a stored CORRECTED ruling is a legitimate provenance for a field', () => {
  const record = {
    seed: 'sweep1-39', seq: 182, kind: 'investigation_claim',
    target: 'Liv', result: 'mafia', quote: READING.quote,
    corrected: { target: 'Liv', rule: 'R12', replaced: { target: 'Bryan' } },
  }
  assert.deepEqual(projectionErrors(record, READING), [])
})

test('§4: a record with no archived reading fails unless it is a recovered miss', () => {
  const orphan = { seed: 'sweep1-39', seq: 999, kind: 'role_claim', role: 'doctor' }
  assert.match(projectionErrors(orphan, null)[0], /no archived instrument reading/)

  const recovered = { ...orphan, machineDecision: 'missed-recovered', sources: ['negative-sample'] }
  assert.deepEqual(projectionErrors(recovered, null), [])
})

test('§4: an unrecorded kind or quote change is an injection too', () => {
  const kindSwap = { seed: 'sweep1-39', seq: 182, kind: 'role_claim', quote: READING.quote }
  assert.match(projectionErrors(kindSwap, READING)[0], /is neither the reading's/)

  const quoteSwap = {
    seed: 'sweep1-39', seq: 182, kind: 'investigation_claim',
    target: 'Bryan', result: 'mafia', quote: 'I investigated Bryan',
  }
  assert.match(projectionErrors(quoteSwap, READING)[0], /quote is neither/)
})
