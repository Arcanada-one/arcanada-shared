# arcanada-shared

Reusable cross-project modules for the Arcanada ecosystem, published as
independent packages under the [`@arcanada`](https://www.npmjs.com/org/arcanada)
npm scope.

The ecosystem runs on a single stack (NestJS, TypeScript, Zod, pino,
Redis, React) and re-implements the same building blocks across many repos.
This monorepo extracts those building blocks once, so a security fix, a
dependency bump, or a new pattern rolls out everywhere at once.

> **Boundary.** Public repository, no secrets, no project-specific folder
> structure — implementation only. Secret configuration and proprietary
> business logic stay in the private project repositories.

## Packages

| Package                                             | Description                                                   | Status    |
| --------------------------------------------------- | ------------------------------------------------------------- | --------- |
| [`@arcanada/tsconfig`](packages/tsconfig)           | Shared TypeScript base configs (`base` / `nestjs` / `react`). | available |
| [`@arcanada/eslint-config`](packages/eslint-config) | Flat ESLint config factories (`nestjs()` / `react()`).        | available |

More packages (`@arcanada/throttle`, `@arcanada/nest-common`,
`@arcanada/logger`, `@arcanada/ui`, …) land as the ecosystem extracts further
duplicated code.

## Development

```bash
pnpm install
pnpm build      # tsc --build across all packages
pnpm test       # Vitest
pnpm lint       # eslint + prettier --check
```

Requires Node `>=20` and pnpm `>=10`. Shared dev-dependency versions are pinned
once in `pnpm-workspace.yaml` under `catalog:`.

## Releasing

Versioning is handled by [Changesets](https://github.com/changesets/changesets)
(independent versioning per package). Add a changeset when you change a
published package:

```bash
pnpm changeset
```

On merge to `main`, the release workflow opens a Version PR; merging it
publishes the changed packages to npm via **OIDC Trusted Publishing** (no
long-lived npm token in CI) with provenance attestations.

## License

[MIT](LICENSE)
