# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- **Release publish moves to self-hosted + `NPM_TOKEN`.** Operator decision
  2026-11-18: npm Trusted Publishing / OIDC is accepted only from
  GitHub-hosted runners, so `.github/workflows/release.yml` `publish` now runs
  on `[self-hosted, Linux, X64, ci-general]` with `NODE_AUTH_TOKEN` from
  `secrets.NPM_TOKEN`, drops `id-token: write`, and omits `--provenance`
  (unsupported off GitHub-hosted). CI adds an `npm publish --dry-run` step
  that needs no secret.
