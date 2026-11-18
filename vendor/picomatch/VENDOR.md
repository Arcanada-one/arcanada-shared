# Vendored picomatch 4.0.8 (pre-publish)

Source: [micromatch/picomatch#267](https://github.com/micromatch/picomatch/pull/267)
(`fix: collapse single-branch wildcard extglobs (GHSA-fc5q-39xc-vjpf)`),
based on npm `4.0.7` plus that PR's changes. Package `version` set to `4.0.8`
so `pnpm audit --audit-level=high` accepts the advisory patched range `>=4.0.8`
while upstream has not published that tag (measured 2026-11-18: npm latest `4.0.7`).

`reverse_if`: delete this vendor directory and the `pnpm-workspace.yaml` override
once `npm view picomatch version` reports `>=4.0.8` from the official registry
and CI audit is green without the override.
