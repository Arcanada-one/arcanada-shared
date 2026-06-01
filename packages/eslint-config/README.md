# @arcanada/eslint-config

Shared flat ESLint config factories for the Arcanada ecosystem (ESLint 9).

## Install

```bash
pnpm add -D @arcanada/eslint-config eslint
```

## Usage

```js
// eslint.config.js (NestJS service)
import { nestjs } from "@arcanada/eslint-config";

export default [{ ignores: ["dist/**", "node_modules/**"] }, ...nestjs()];
```

```js
// React app
import { react } from "@arcanada/eslint-config";
export default [...react()];
```

## Factories

| Factory    | Use                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `base()`   | TypeScript parser + shared rules (`no-unused-vars` underscore convention, `eqeqeq`, restricted `no-console`). |
| `nestjs()` | `base()` plus relaxed unused-args (constructor DI) and no `no-console` noise.                                 |
| `react()`  | `base()` plus JSX/TSX parsing. React-specific plugins are left to the app.                                    |

Each factory returns a flat-config **array** — spread it into your
`eslint.config.js` default export.
