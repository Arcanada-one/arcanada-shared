---
"@arcanada/logger": minor
---

Initial release of `@arcanada/logger`: a canonical `nestjs-pino` `LoggerModule`
factory extracted from Auth Arcana's original pino setup (`AUTH-0074`) —
`createLoggerModule(extraRedactPaths?)` with `LOG_LEVEL`-driven level, `/health`
excluded from access logs, `pino-pretty` in development only, and a frozen
`DEFAULT_REDACT_PATHS` list (auth headers + common secret-bearing field names,
`remove: true`) that consumers extend via `extraRedactPaths` instead of
forking. Framework dependencies (`nestjs-pino`, `pino`, `@nestjs/common`) are
peer-only.
