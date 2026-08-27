# Published data

Sweep 1 is distributed with the repository so every public result can be
checked against its source record.

## What is published

- `data/sweep1/sweep1-*.jsonl`: the 40 append-only game logs.
- `docs/sweeps/results/sweep1-roots.txt`: the final hash-chain root for each
  game.
- `docs/sweeps/results/analysis-v31-manifest.json`: the evaluation code,
  specification, inputs, and archived-reading hashes used for the release.
- `docs/sweeps/results/analysis-v31-publication.json`: the generated
  claim-level publication artifact.

The logs contain synthetic seat names, model-generated game dialogue, action
attempts, timestamps, token counts, provider response identifiers, and
provider-supplied reasoning traces or summaries when a provider exposed them.
They do not contain human participant conversations and are intended to
contain no API credentials.

## Public-data boundary

Treat every file under `data/sweep1/` and `docs/sweeps/results/` as public.
Unpublished runs belong under `runs/`, which is gitignored. Never add raw run
directories, credentials, provider account metadata, or reviewer working files
to the repository.

If you find a credential, personal data, or other material that should not be
public, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Integrity and reproducibility

Each JSONL event includes the previous event hash. `mafia verify` validates the
chain and replays the game through the deterministic engine:

```bash
pnpm install --frozen-lockfile
pnpm run mafia verify data/sweep1/sweep1-21.jsonl
```

The analysis manifest pins the evaluation commit and the sha256 of the frozen
specification. Published data must never be edited by hand. A change requires
regenerating the affected artifacts, updating every dependent hash, running all
publication gates, and documenting the reason.

## License and attribution

Unless a file says otherwise, the repository's [MIT license](LICENSE) applies
to the source code, documentation, and published dataset artifacts. Model and
provider names remain the property of their respective owners; their presence
does not imply endorsement.

For academic or research use, cite the repository using [CITATION.cff](CITATION.cff).
