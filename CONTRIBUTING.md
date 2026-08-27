# Contributing

Thanks for helping improve agent-mafia. Changes should preserve deterministic
replay, seat-information parity, and the provenance of published results.

## Development setup

Requirements: Node 22.18 or newer and pnpm 11.13.1.

```bash
pnpm install --frozen-lockfile
pnpm run check
```

Work on a feature branch and open a pull request against `main`. Do not push
directly to `main`. CI must pass before merge.

## Pull-request expectations

- Add or update tests for behavioral changes.
- Keep `observe(state, seat)` as the sole seat-information boundary.
- Preserve deterministic behavior and replay compatibility.
- Use the terminology in `README.md`; the terminology check runs in CI.
- Update public documentation when commands, schemas, or limitations change.
- Do not include credentials, local agent instructions, unpublished runs, or
  reviewer scratch files.

## Published data

Files under `data/sweep1/` and `docs/sweeps/results/` are release artifacts, not
ordinary fixtures. Do not edit them manually. Any proposed change must include
the regeneration command, updated hashes, publication-gate output, and a clear
explanation of why the public metric changed. See [DATA.md](DATA.md).

## Security reports

Use the private process in [SECURITY.md](SECURITY.md) for security-sensitive
findings. Do not put exploit details or possible secrets in a public issue.
