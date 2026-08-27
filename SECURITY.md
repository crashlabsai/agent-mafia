# Security policy

## Supported version

Security fixes are made on the current `main` branch. Historical research
artifacts remain immutable unless a disclosure requires removal or replacement.

## Reporting a vulnerability

Please use GitHub's private vulnerability-reporting flow for this repository.
Do not open a public issue for leaked credentials, personal data, command
execution, path traversal, or a way to expose unpublished game logs.

Include the affected commit, file or endpoint, reproduction steps, impact, and
any suggested mitigation. Do not access data that is not yours and do not test
against third-party provider APIs without authorization.

If a credential appears in repository history, treat it as compromised even if
the file was later deleted: revoke it first, then rotate it and repair the
history as needed.

## Security boundaries

- The observer UI binds to `127.0.0.1` because it can read local logs and start
  processes. Do not expose it directly to a network.
- The hosted results server requires bearer authentication and should be
  deployed only behind TLS.
- Provider keys belong in `.env` or the deployment secret store. `.env` files
  are gitignored; `.env.example` contains names only.
- Published logs intentionally expose the fields described in [DATA.md](DATA.md).

Coordinated disclosure is appreciated. Please allow time for a fix before
publishing details.
