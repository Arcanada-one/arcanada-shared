import { describe, expect, it } from "vitest";
import pino from "pino";
import { DEFAULT_REDACT_PATHS } from "../src/redact-paths.js";

/**
 * End-to-end behavioural coverage against a real `pino()` instance (not just
 * config-shape assertions) — mirrors Auth Arcana's own
 * `pino.module.spec.ts` methodology (`REDACT-NEW-01`).
 */
describe("DEFAULT_REDACT_PATHS behaviour (real pino instance)", () => {
  function captureLogger() {
    const lines: string[] = [];
    const stream = { write: (chunk: string) => void lines.push(chunk) };
    const logger = pino(
      { redact: { paths: [...DEFAULT_REDACT_PATHS], remove: true } },
      stream,
    );
    return { logger, lines };
  }

  it("removes the Authorization header value from the emitted log line", () => {
    const { logger, lines } = captureLogger();
    const secret = "Bearer " + "a".repeat(40);

    logger.info(
      { req: { headers: { authorization: secret, host: "svc.arcanada.ai" } } },
      "incoming",
    );

    expect(lines).toHaveLength(1);
    const json = JSON.parse(lines[0]);
    expect(json.req.headers.authorization).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain(secret);
    expect(json.req.headers.host).toBe("svc.arcanada.ai");
  });

  it("removes the Cookie header without touching sibling headers", () => {
    const { logger, lines } = captureLogger();

    logger.info(
      { req: { headers: { cookie: "sid=deadbeef", "user-agent": "vitest" } } },
      "incoming",
    );

    const json = JSON.parse(lines[0]);
    expect(json.req.headers.cookie).toBeUndefined();
    expect(json.req.headers["user-agent"]).toBe("vitest");
  });

  it("removes a nested password field at any first-level key via the *.password glob", () => {
    const { logger, lines } = captureLogger();

    logger.info({ user: { email: "a@b.test", password: "hunter2" } }, "signup");

    const json = JSON.parse(lines[0]);
    expect(json.user.password).toBeUndefined();
    expect(json.user.email).toBe("a@b.test");
  });

  it("removes client_secret from both request and response bodies", () => {
    const { logger, lines } = captureLogger();

    logger.info(
      {
        req: { body: { client_secret: "shh" } },
        res: { body: { client_secret: "shh2" } },
      },
      "token exchange",
    );

    const json = JSON.parse(lines[0]);
    expect(json.req.body.client_secret).toBeUndefined();
    expect(json.res.body.client_secret).toBeUndefined();
  });
});
