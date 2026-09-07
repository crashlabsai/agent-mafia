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
- `docs/sweeps/results/analysis-v32/`: the curated v3.2 analysis bundle,
  including extraction records, adjudication records, final ledgers,
  statistics, release checksums, and a data notice.

The logs contain synthetic seat names, model-generated game dialogue, action
attempts, timestamps, token counts, provider response identifiers, and
provider-supplied reasoning traces or summaries when a provider exposed them.
They do not contain human participant conversations and are intended to
contain no API credentials.

## Public-data boundary

Treat every file under `data/sweep1/` and `docs/sweeps/results/` as public.
Unpublished runs belong under `runs/`, which is gitignored. Never force-add a
raw run directory, credentials, provider account metadata, draft rulings, or
local review tools. Public analysis artifacts must be created through an
explicit allowlist with a release manifest and data notice.

If you find a credential, personal data, or other material that should not be
public, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Code pin and gate results

The analysis artifacts record the commit that produced them,
`124f05bc1ae4a80e0db6efd4dcc30da2f18478d8`, as `codeCommit` in both
`manifest.json` and `cleanroom.json`. That commit lives in the private
development repository. This repository publishes the same analysis code under
the tag `v3.2-paper`: every script and package that produces a result is
byte-identical to the recorded commit, and the tree adds only
`scripts/build-analysis-release.mjs`, `scripts/verify-analysis-release.mjs`,
and a documentation linter.

### The check for this copy

```sh
pnpm run check:analysis-release
```

It reads `RELEASE-MANIFEST.json` and binds every published file to the source
file it came from: published path, published hash, source path, source hash,
and the number of machine-local paths normalized. It passes on this tree: 182
files, 13,022 normalized paths, no secret signatures.

All ten semantic gates also pass here:

```sh
node scripts/check-semantic-gates.mjs --strict \
  --publication docs/sweeps/results/analysis-v32/publication.json \
  --ledger docs/sweeps/results/analysis-v32/ledger \
  --stats docs/sweeps/results/analysis-v32/stats \
  --opportunity docs/sweeps/results/analysis-v32/opportunity/table.jsonl
```

### The publication gates, and why four of them fail here

```sh
node scripts/check-gates.mjs \
  --manifest docs/sweeps/results/analysis-v32/manifest.json \
  --outdir docs/sweeps/results/analysis-v32 \
  --publication docs/sweeps/results/analysis-v32/publication.json \
  --cleanroom docs/sweeps/results/analysis-v32/cleanroom.json \
  --extract docs/sweeps/results/analysis-v32/extract \
  --ledger docs/sweeps/results/analysis-v32/ledger \
  --agreement docs/sweeps/results/analysis-v32/stats/agreement.json \
  --tripwire-report docs/sweeps/results/analysis-v32/tripwire/validation.json \
  --logs data/sweep1
```

Ten of the fourteen pass. The suite is written for the private working layout,
where all fourteen pass, so the four failures here are about paths and identity
rather than about the results:

- **G1** and **G4** resolve the 179 source paths the manifest pins under
  `runs/`, including the tripwire lexicon. Those files are not part of the
  public release; their published counterparts live under
  `docs/sweeps/results/analysis-v32/`.
- **G11** compares the current `HEAD` with the recorded `codeCommit`. Any
  checkout other than that commit fails it, by design.
- **G13** re-derives the claim-unit mapping from the ledger that
  `publication.json` pins by hash. The release builder rewrites machine-local
  game paths to `data/sweep1/<game>.jsonl` (13,022 across the bundle, 661 in
  that ledger), which changes the file's bytes and so its hash. Claim content
  and human rulings are untouched.

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

Verify the curated v3.2 release from the repository root:

```bash
pnpm run check:analysis-release
```

## License and attribution

Unless a file says otherwise, the repository's [MIT license](LICENSE) applies
to the source code and original project documentation. Model-generated text,
provider names, trademarks, and provider-supplied metadata remain subject to
the applicable providers' terms. Their presence does not imply endorsement.

For academic or research use, cite the repository using [CITATION.cff](CITATION.cff).
