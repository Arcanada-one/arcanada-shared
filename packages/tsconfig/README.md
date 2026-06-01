# @arcanada/tsconfig

Shared TypeScript base configurations for the Arcanada ecosystem.

## Install

```bash
pnpm add -D @arcanada/tsconfig typescript
```

## Usage

Extend the profile that matches the project:

```jsonc
// NestJS service
{ "extends": "@arcanada/tsconfig/nestjs" }

// React app / library
{ "extends": "@arcanada/tsconfig/react" }

// Plain TS library / tooling
{ "extends": "@arcanada/tsconfig/base" }
```

## Profiles

| Profile  | Notes                                                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `base`   | Strict, ES2022, bundler resolution, `isolatedModules: true`, declaration + sourcemaps.                                                   |
| `nestjs` | Extends `base`; `isolatedModules: false`, `emitDecoratorMetadata` + `experimentalDecorators` (NestJS DI reflection), `module: NodeNext`. |
| `react`  | Extends `base`; `jsx: react-jsx`, DOM libs.                                                                                              |

`composite` / `incremental` are intentionally **not** set in the published
profiles — set them in the consuming repo's own `tsconfig.json` where the build
topology (project references, `outDir`) is known.
