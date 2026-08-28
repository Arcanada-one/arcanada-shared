import { describe, expect, it } from "vitest";
import {
  buildPrincipalTracker,
  createThrottlerOptions,
  normalizeTrackerKey,
} from "../src/throttler-options.js";

describe("createThrottlerOptions", () => {
  it("emits the three named throttlers with sane defaults", () => {
    const opts = createThrottlerOptions();
    const names = opts.throttlers.map((t) => t.name);
    expect(names).toEqual(["short", "medium", "long"]);
    // Defaults are positive and strictly ordered short < medium < long by TTL.
    // ttl/limit are typed `Resolvable<number>` upstream; our defaults are plain
    // numbers, so narrow them for the numeric assertions.
    const [short, medium, long] = opts.throttlers;
    expect(short.ttl as number).toBeLessThan(medium.ttl as number);
    expect(medium.ttl as number).toBeLessThan(long.ttl as number);
    expect(short.limit as number).toBeGreaterThan(0);
  });

  it("lets the caller override an individual tier without losing the others", () => {
    const opts = createThrottlerOptions({ short: { limit: 3, ttl: 1000 } });
    const short = opts.throttlers.find((t) => t.name === "short");
    expect(short).toMatchObject({ limit: 3, ttl: 1000 });
    // Untouched tiers keep their defaults.
    expect(opts.throttlers.find((t) => t.name === "long")).toBeDefined();
  });

  it("forwards an injected ThrottlerStorage instance verbatim", () => {
    const storage = { increment: () => Promise.resolve() } as never;
    const opts = createThrottlerOptions({ storage });
    expect(opts.storage).toBe(storage);
  });
});

describe("buildPrincipalTracker", () => {
  it("prefers the authenticated user id over the IP", async () => {
    const track = buildPrincipalTracker();
    const key = await track({ user: { id: "u-42" }, ip: "1.2.3.4" });
    expect(key).toBe("user:u-42");
  });

  it("falls back to the IP for anonymous requests", async () => {
    const track = buildPrincipalTracker();
    expect(await track({ ip: "1.2.3.4" })).toBe("ip:1.2.3.4");
  });

  it("falls back to a constant when neither user nor IP is present", async () => {
    const track = buildPrincipalTracker();
    expect(await track({})).toBe("anonymous");
  });
});

describe("normalizeTrackerKey (security: key-injection defence)", () => {
  it("strips Redis key separators so a crafted user id cannot forge a key", () => {
    // A user id carrying ':' ';' ',' or spaces must not forge a different bucket.
    expect(normalizeTrackerKey("a:b c;d,e")).toBe("a-b-c-d-e");
  });

  it("collapses whitespace and lowercases", () => {
    expect(normalizeTrackerKey("Mixed Case")).toBe("mixed-case");
  });

  it("is idempotent on an already-clean identifier", () => {
    expect(normalizeTrackerKey("clean-id-123")).toBe("clean-id-123");
  });
});
