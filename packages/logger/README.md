# @arcanada/logger

Canonical `nestjs-pino` `LoggerModule` for the Arcanada ecosystem, extracted
from the ecosystem's first production pino configuration in Auth Arcana.

- **`DEFAULT_REDACT_PATHS`** — a generic, frozen list of fast-redact glob
  paths: auth headers (`Authorization`, `Cookie`, `Set-Cookie`) and the common
  secret-bearing field names (`password`, `token`, `secret`, `client_secret`,
  `api_key`/`apiKey`).
- **`createLoggerModule(extraRedactPaths?)`** — builds the `LoggerModule` with
  `LOG_LEVEL`-driven level, `/health` excluded from access logs, `pino-pretty`
  in development only, and `remove: true` redaction (matched fields are
  deleted from the log line, not masked).

`nestjs-pino` / `pino` are **peer** dependencies, never bundled.

## Install

```bash
pnpm add @arcanada/logger nestjs-pino pino
```

### pnpm `injected: true` is required

Same DI-identity caveat as `@arcanada/nest-common` — `nestjs-pino`'s
`LoggerModule` is `@Global()`, so a second copy of `@nestjs/core` pulled in by
a symlinked shared package breaks its provider wiring:

```yaml
# pnpm-workspace.yaml (or the consumer's package.json "pnpm" field)
dependenciesMeta:
  "@arcanada/logger":
    injected: true
```

## Usage

```ts
import { Module } from "@nestjs/common";
import { createLoggerModule } from "@arcanada/logger";

@Module({
  imports: [createLoggerModule()],
})
export class AppModule {}
```

### Adding service-specific redact paths

`DEFAULT_REDACT_PATHS` covers what any ecosystem service is likely to log.
Service-specific secret/PII fields — an OIDC provider's `client_secret`
wrapper objects, an admin-lookup PII field — are passed as
`extraRedactPaths`, appended after the defaults rather than forking the list:

```ts
createLoggerModule([
  "oidcClient.client_secret",
  "req.body.emails",
  "req.body.emails.*",
  "res.body.matches",
]);
```

## License

MIT
