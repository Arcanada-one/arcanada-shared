/**
 * Canonical secret/PII redact-paths for the Arcanada ecosystem's pino loggers.
 *
 * Extracted from Auth Arcana's original pino setup (`AUTH-0074` —
 * `src/shared/logger/pino.module.ts`), the ecosystem's first production pino
 * configuration. Paths use fast-redact glob syntax: `*.field` matches any
 * first-level key; explicit dotted paths target specific request/response
 * wrapper fields emitted by `pino-http` / `nestjs-pino`.
 *
 * This list is deliberately generic — the common secret-bearing header and
 * field names any ecosystem service is likely to log (auth headers, cookies,
 * password/token/secret/api-key fields). Service-specific fields (e.g. Auth
 * Arcana's own admin-email-lookup PII case, `AUTH-0083`) are NOT included
 * here; pass them via {@link createLoggerModule}'s `extraRedactPaths`
 * parameter instead of forking this list.
 */
export const DEFAULT_REDACT_PATHS: readonly string[] = Object.freeze([
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["set-cookie"]',
  "*.password",
  "*.token",
  "*.secret",
  "*.client_secret",
  "*.api_key",
  "*.apiKey",
  "req.body.client_secret",
  "res.body.client_secret",
]);
