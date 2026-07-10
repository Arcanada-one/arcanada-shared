import { describe, expect, it } from "vitest";
import { DEFAULT_REDACT_PATHS } from "../src/redact-paths.js";

describe("DEFAULT_REDACT_PATHS", () => {
  it("redacts the Authorization, Cookie and Set-Cookie headers", () => {
    expect(DEFAULT_REDACT_PATHS).toContain("req.headers.authorization");
    expect(DEFAULT_REDACT_PATHS).toContain("req.headers.cookie");
    expect(DEFAULT_REDACT_PATHS).toContain('req.headers["set-cookie"]');
  });

  it("redacts common secret-bearing field names at any first-level key", () => {
    expect(DEFAULT_REDACT_PATHS).toContain("*.password");
    expect(DEFAULT_REDACT_PATHS).toContain("*.token");
    expect(DEFAULT_REDACT_PATHS).toContain("*.secret");
    expect(DEFAULT_REDACT_PATHS).toContain("*.client_secret");
    expect(DEFAULT_REDACT_PATHS).toContain("*.api_key");
    expect(DEFAULT_REDACT_PATHS).toContain("*.apiKey");
  });

  it("redacts client_secret explicitly in request and response bodies", () => {
    expect(DEFAULT_REDACT_PATHS).toContain("req.body.client_secret");
    expect(DEFAULT_REDACT_PATHS).toContain("res.body.client_secret");
  });

  it("is frozen — consumers cannot mutate the shared default list", () => {
    expect(Object.isFrozen(DEFAULT_REDACT_PATHS)).toBe(true);
    expect(() => {
      (DEFAULT_REDACT_PATHS as string[]).push("oops");
    }).toThrow();
  });
});
