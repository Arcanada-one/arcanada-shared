import { afterEach, describe, expect, it } from "vitest";
import { PARAMS_PROVIDER_TOKEN, type Params } from "nestjs-pino";
import type { Options } from "pino-http";
import { createLoggerModule } from "../src/create-logger-module.js";
import { DEFAULT_REDACT_PATHS } from "../src/redact-paths.js";

/** Pulls the `pino-params` provider's `useValue` out of the DynamicModule the
 * factory returns — `LoggerModule.forRoot` always registers it this way. */
function paramsOf(mod: ReturnType<typeof createLoggerModule>): Params {
  const provider = mod.providers?.find(
    (p): p is { provide: string; useValue: Params } =>
      typeof p === "object" &&
      p !== null &&
      "provide" in p &&
      p.provide === PARAMS_PROVIDER_TOKEN,
  );
  if (!provider) throw new Error("pino-params provider not found");
  return provider.useValue;
}

describe("createLoggerModule", () => {
  const originalLogLevel = process.env.LOG_LEVEL;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.LOG_LEVEL = originalLogLevel;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("uses DEFAULT_REDACT_PATHS with remove:true when no extra paths are given", () => {
    const pinoHttp = paramsOf(createLoggerModule()).pinoHttp as Options;
    expect(pinoHttp.redact).toEqual({
      paths: [...DEFAULT_REDACT_PATHS],
      remove: true,
    });
  });

  it("appends extraRedactPaths after the defaults without mutating the shared constant", () => {
    const before = [...DEFAULT_REDACT_PATHS];
    const pinoHttp = paramsOf(
      createLoggerModule(["req.body.emails", "res.body.matches"]),
    ).pinoHttp as Options;

    expect((pinoHttp.redact as { paths: string[] }).paths).toEqual([
      ...DEFAULT_REDACT_PATHS,
      "req.body.emails",
      "res.body.matches",
    ]);
    expect(DEFAULT_REDACT_PATHS).toEqual(before);
  });

  it("defaults LOG_LEVEL to info when unset", () => {
    delete process.env.LOG_LEVEL;
    const pinoHttp = paramsOf(createLoggerModule()).pinoHttp as Options;
    expect(pinoHttp.level).toBe("info");
  });

  it("honours a custom LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "debug";
    const pinoHttp = paramsOf(createLoggerModule()).pinoHttp as Options;
    expect(pinoHttp.level).toBe("debug");
  });

  it("excludes /health from autoLogging but logs everything else", () => {
    const pinoHttp = paramsOf(createLoggerModule()).pinoHttp as Options;
    const autoLogging = pinoHttp.autoLogging;
    if (typeof autoLogging !== "object" || !autoLogging) {
      throw new Error("expected autoLogging.ignore to be configured");
    }
    expect(autoLogging.ignore?.({ url: "/health" } as never)).toBe(true);
    expect(autoLogging.ignore?.({ url: "/anything-else" } as never)).toBe(
      false,
    );
  });

  it("enables pino-pretty transport only in development", () => {
    process.env.NODE_ENV = "development";
    const dev = paramsOf(createLoggerModule()).pinoHttp as Options;
    expect(dev.transport).toEqual({
      target: "pino-pretty",
      options: { colorize: true, singleLine: true },
    });

    process.env.NODE_ENV = "production";
    const prod = paramsOf(createLoggerModule()).pinoHttp as Options;
    expect(prod.transport).toBeUndefined();
  });

  it("returns an nestjs-pino LoggerModule DynamicModule", () => {
    const mod = createLoggerModule();
    expect(mod.module).toBeDefined();
    expect(mod.exports).toBeDefined();
  });
});
