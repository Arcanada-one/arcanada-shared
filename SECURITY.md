# Security Policy

## Reporting a vulnerability

Report security issues privately to **security@arcanada.one**. Do not open a
public issue for a suspected vulnerability. You will receive an acknowledgement
within 72 hours.

## Supply-chain guarantees

- **Publishing.** After a one-time operator-controlled first publication,
  packages are published only from the GitHub Actions release workflow via npm
  **OIDC Trusted Publishing**. Bootstrap credentials are never stored in the
  repository or GitHub Actions; the release preflight blocks absent packages.
  Every automated publication carries a provenance attestation. Dependency
  installation, verification, Changesets versioning, building, and `npm pack`
  all run in a read-only job. The write-capable jobs install no repository
  dependencies and consume only checksum-bound patches or scanned tarballs.
- **Release gate.** The release workflow is protected by `CODEOWNERS`; a
  publish cannot run without a reviewed merge to `main`. (OIDC eliminates token
  leakage but not a compromised pipeline — the review gate is the second
  layer.)
- **Secret hygiene.** This is a public repository and contains no secrets.
  `gitleaks` runs as a CI merge gate. Consumer configuration (tokens, URLs,
  credentials) is supplied via environment variables at the consuming
  application, never committed here.
- **Dependency audit.** `pnpm audit --audit-level=high` runs in CI.

## Supported versions

Each package is versioned independently. Security fixes target the latest
published minor of each package.
