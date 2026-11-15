# Private package change history

This package is private and unpublished. Entries here record source changes.
They do not publish a package, change its version, or establish deployment.

## 2026-11-15 — Live Lab scoped controls

The pending note below moved from the public release queue to this private
history. Its original text is preserved verbatim, including the proposed
`minor` bump. That proposal was not applied; the package version remains
unchanged.

Original source: [pending changeset][source].

Original Git blob: `9033223deadf6bfc2416328dca75db880c9c318b`.

```text
---
"@arcanada/oidc-bff": minor
---

Add Live Lab scoped controls and site profile loaders on the existing Auth Arcana BFF session package (KCLIVE-02 rematch). Identity alone is not a grant; client IDs are env-bound, never invented.
```

The public release allowlist and both access-contracts changesets are unchanged.
Private package changes belong in this history while the package is unpublished.
A future public release or private version policy needs its own reviewed change.

[source]: https://github.com/Arcanada-one/arcanada-shared/blob/47e3146d868026037281329854302b9e41bfb104/.changeset/kc-klive-02-oidc-bff-scoped.md
