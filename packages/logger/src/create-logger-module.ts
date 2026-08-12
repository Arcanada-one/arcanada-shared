import type { DynamicModule } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { DEFAULT_REDACT_PATHS } from "./redact-paths.js";

/**
 * Builds the ecosystem's canonical `nestjs-pino` `LoggerModule`.
 *
 * Behaviour mirrors Auth Arcana's original production setup:
 * - `LOG_LEVEL` env var controls the pino level, defaulting to `"info"`.
 * - `/health` requests are excluded from access logging.
 * - Redaction uses {@link DEFAULT_REDACT_PATHS} plus any consumer-supplied
 *   `extraRedactPaths`, with `remove: true` (matched fields are deleted from
 *   the log line, not masked).
 * - `pino-pretty` transport is enabled only when `NODE_ENV === "development"`.
 *
 * @param extraRedactPaths - additional fast-redact glob paths appended after
 * {@link DEFAULT_REDACT_PATHS}, for service-specific secret/PII fields (e.g.
 * an OIDC provider's `client_secret` wrapper objects, or a PII field set).
 */
export function createLoggerModule(
  extraRedactPaths: readonly string[] = [],
): DynamicModule {
  return LoggerModule.forRoot({
    pinoHttp: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: {
        paths: [...DEFAULT_REDACT_PATHS, ...extraRedactPaths],
        remove: true,
      },
      autoLogging: { ignore: (req) => req.url === "/health" },
      // Conditional spread (not `transport: cond ? {...} : undefined`) — under
      // `exactOptionalPropertyTypes` the pino-http `transport?:` property does
      // not accept an explicit `undefined` value; the key must be entirely
      // absent outside development.
      ...(process.env.NODE_ENV === "development"
        ? {
            transport: {
              target: "pino-pretty",
              options: { colorize: true, singleLine: true },
            },
          }
        : {}),
    },
  });
}
