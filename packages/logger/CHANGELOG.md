# @arcanada/logger

## 0.2.0

### Minor Changes

- 1cedd7c: Initial release of `@arcanada/logger`: a canonical `nestjs-pino` `LoggerModule`
  factory derived from the logging setup originally proven in Auth Arcana —
  `createLoggerModule(extraRedactPaths?)` with `LOG_LEVEL`-driven level, `/health`
  excluded from access logs, `pino-pretty` in development only, and a frozen
  `DEFAULT_REDACT_PATHS` list (auth headers + common secret-bearing field names,
  `remove: true`) that consumers extend via `extraRedactPaths` instead of
  forking. Framework dependencies (`nestjs-pino`, `pino`, `@nestjs/common`) are
  peer-only.
