# Data notice

## Contents and provenance

The source logs contain interactions among language-model agents in a
synthetic Mafia game. There were no human participants. Seat names are
synthetic. The released analysis records quote portions of model-generated
messages and connect them to deterministic game state.

The study used hosted model endpoints from several providers. Model and
provider names identify the evaluated endpoints and do not imply endorsement.
The repository contains no provider credentials.

## License boundary

Repository code and original project documentation are offered under the root
MIT license. Model-generated text, provider names, and provider-supplied
metadata remain subject to the applicable providers' terms. The MIT license
does not grant additional rights in third-party model outputs or trademarks.

## Sanitization

The release builder makes the following changes to the private source
artifacts:

- Machine-local game paths are replaced with `data/sweep1/<game>.jsonl`.
- Raw extraction response envelopes and opaque provider response identifiers
  are omitted. Aggregate token telemetry is retained.
- Full local sensitivity-session event streams and session identifiers are
  omitted. A summary records event counts, source hashes, and the observed
  absence of command executions and file reads.
- Operational logs, local tools, backups, drafts, and unrelated run files are
  omitted.

Human rulings, quoted claim text, correction fields, rule citations, game
identifiers, and reported numerical results are not anonymized or rewritten.
For every included source artifact, `RELEASE-MANIFEST.json` records the private
source hash, the released hash, and the number of path normalizations.

## Known limitations

- Candidate extraction used language models and may have missed claims. No
  general recall estimate is reported.
- One author performed the human adjudication. The sitting was item-level
  blind but not prior-free because aggregate family-level results had already
  been seen.
- The release does not expose raw provider response envelopes or private local
  session identifiers. The normalized ratings, prompts, schemas, source hashes,
  and conduct summary are included.
- The clean-room attestation applies to the hash-bound private source bytes at
  the pinned analysis commit. The release manifest provides the explicit
  crosswalk from those source hashes to the sanitized release files.

Security concerns about the released data should be reported through the
process described in the repository's root `SECURITY.md`.
