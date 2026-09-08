// Byte-faithful ledger projection — analysis v3.2 §4.
//
// v3.1 had no comparison between a ledger record and the archived instrument
// reading it was supposed to project, so a field injected by a downstream
// stage was indistinguishable from a field the instrument produced. That is
// the downstream-injection class; sweep1-39 (audit row 4) is its confirmed
// instance: claimedNight=1 existed ONLY in the derived record, was absent from
// machine.fields, and the R15 night guard then scored a true claim false.
//
// Pure, no I/O: build-ledger.mjs supplies the archived reading and this module
// says whether the record projects it.

/** Scoring fields — the ones a wrong value is fatal for. `denial` flips a
 *  gradeable claim to RECORDED (R11) and `seat` selects the entire ground
 *  truth (R18); the review found both invisible to the first version of this
 *  check, which is exactly the injection class §4 exists to close. */
export const PROJECTED_FIELDS = ['role', 'target', 'result', 'claimedNight', 'referencedDay', 'conditional', 'denial']

// R12's one sanctioned normalization: a target's spelling ("Liv" vs "seat-2")
// varies between candidate sources. Everything else compares by bytes.
const norm = (field, v) => (field === 'target' ? String(v).trim().toLowerCase() : v)

/**
 * Every way `record` fails to be a byte-faithful projection of `reading` (§4).
 * Returns [] when it is one.
 *
 * A field's value must be traceable to exactly one of:
 *   - the archived reading's machine.fields (a classifier field, §1);
 *   - a corrected.<field> from a stored CORRECTED ruling (§3);
 *   - a miss-recovery record, whose provenance is the negative-sample reading.
 *
 * `reading` is the archived extraction record for the same (seed, seq, kind),
 * or null when none exists — which is itself an error unless the ledger record
 * is a recorded miss-recovery.
 */
export function projectionErrors(record, reading) {
  const at = `${record.seed ?? '?'} seq ${record.seq ?? '?'} (${record.kind ?? '?'})`
  const errors = []
  // Human-authority exemptions: a recovered recall-miss has no machine reading
  // by construction, and a recovered machine-REJECT's proposition is what the
  // adjudicator saw on the sheet and ruled on (§6.1) — the human ruling, not a
  // classifier reading, is its provenance. Everything else must project.
  const recovered = record.machineDecision === 'missed-recovered' ||
    record.machineDecision === 'rejected' ||
    (Array.isArray(record.sources) && record.sources.includes('negative-sample'))

  if (!reading) {
    if (!recovered) {
      errors.push(`${at}: no archived instrument reading — the ledger record has no reading to project (§4)`)
    }
    return errors
  }
  if (reading.seat !== undefined && record.seat !== undefined && reading.seat !== record.seat) {
    errors.push(`${at}: seat "${record.seat}" is not the archived reading's "${reading.seat}" — re-attribution flips the entire ground-truth comparison (§4/R18)`)
  }
  if (reading.kind !== undefined && record.kind !== undefined && reading.kind !== record.kind &&
      record.corrected?.kind !== record.kind) {
    errors.push(`${at}: kind "${record.kind}" is neither the reading's "${reading.kind}" nor a stored correction (§4)`)
  }
  if (typeof reading.quote === 'string' && typeof record.quote === 'string' &&
      reading.quote !== record.quote && record.corrected?.quote !== record.quote) {
    errors.push(`${at}: quote is neither the reading's bytes nor a stored correction (§4)`)
  }

  const machineFields = reading.machine?.fields ?? {}
  for (const f of PROJECTED_FIELDS) {
    const v = record[f]
    if (v === undefined || v === null) continue
    if (record.corrected && f in record.corrected) continue // §3: recorded correction
    if (f in machineFields && norm(f, machineFields[f]) === norm(f, v)) continue
    errors.push(
      `${at}: field ${f}=${JSON.stringify(v)} appears in the ledger record but not in the archived ` +
      `reading's machine.fields (${JSON.stringify(machineFields[f] ?? null)}) and carries no stored ` +
      `correction — downstream injection (§4)`,
    )
  }
  return errors
}
