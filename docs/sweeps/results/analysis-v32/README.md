# Agent-Mafia analysis v3.2

This directory is the curated release package for the analysis behind the
Agent-Mafia technical report. It exports analysis run
`4111e1be2298221851751015c34173e4a56cf0be23f31a6ef1f6134d35962554`, computed with code commit
`124f05bc1ae4a80e0db6efd4dcc30da2f18478d8`.

The 40 source game logs are already tracked at `data/sweep1/` and are not
duplicated here.

## What is included

- `publication.json`: the consolidated machine-readable source for reported
  results.
- `ledger/`, `opportunity/`, and `stats/`: the final claim records,
  opportunity table, cohort statistics, agreement summary, and PF-2
  validation summary.
- `extract/`: accepted claims, machine negatives, and rejected candidates for
  every game. Machine-local game paths have been replaced with stable paths
  under `data/sweep1/`.
- `handcheck/`: the model sensitivity ratings, blinded packet, frozen author
  first pass, clarification overlay, final author rulings, and approval record.
- `handcheck/codex-pass/`: the exact prompts and schemas supplied to the
  sensitivity rater, plus a privacy-preserving conduct summary.
- `tripwire/`: the lexicon and validation report pinned by the analysis
  manifest.
- `manifest.json`, `cleanroom.json`, and `handcheck/pf2-provenance.json`: the
  original analysis identity, clean-room attestation, and PF-2 source
  provenance record.
- `RELEASE-MANIFEST.json` and `SHA256SUMS`: the inventory, checksums, and
  source-to-release crosswalk for every evidence and documentation payload.
  These two index files are the unavoidable self-referential exceptions.

## Verify the release

From the repository root:

```bash
node scripts/verify-analysis-release.mjs
```

The verifier checks the complete file set, individual and aggregate hashes,
the clean-room source-hash crosswalk, the tripwire pins, the extraction file
count, the sensitivity-session conduct summary, local-path removal, and common
secret signatures.

To verify a source game independently:

```bash
pnpm run mafia verify data/sweep1/sweep1-0.jsonl
```

## Two run identifiers

The PF-2 provenance record uses run
`641bb60eef9a6da9216da7632efb4e88fb3678e53e74814bf16d6cb45f8b20f4`.
That was the frozen rating-phase run. The final analysis manifest uses run
`4111e1be2298221851751015c34173e4a56cf0be23f31a6ef1f6134d35962554`
and explicitly supersedes the rating-phase run after the final rulings were
incorporated. The two identifiers describe successive bound stages, not two
different studies.

## Export boundary

This directory is not a copy of the ignored private `runs/` directory. The
export deliberately excludes provider response identifiers, full local
session events, duplicate raw response envelopes, operational logs, packet
backups, draft rulings, the local review interface, and machine-specific helper
files. Aggregate extraction telemetry and a per-session conduct summary are
provided instead.

The original PF-2 provenance inventory covers 228 private source artifacts.
This export includes and cross-checks the public subset and adds the final
derived records. The exact coverage, omissions, and reasons are recorded in
`RELEASE-MANIFEST.json`. The original provenance manifest and clean-room
attestation remain unchanged so their historical hashes are preserved.

Semantic results remain exploratory, author-adjudicated, and potentially
incomplete. The six scan candidates were targeted cleanup, not a recall or
omission-rate estimate. See `DATA-NOTICE.md` and the paper for the full scope
and limitations.
