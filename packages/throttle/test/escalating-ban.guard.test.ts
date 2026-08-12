import { describe, expect, it } from "vitest";
import { ExecutionContext, HttpException } from "@nestjs/common";
import { EscalatingBanGuard } from "../src/escalating-ban.guard.js";

/** Builds an ExecutionContext carrying a minimal HTTP request double. */
function ctxFor(req: {
  user?: { id?: string | number };
  ip?: string;
}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

/**
 * Drives the guard until it bans, then reads the remaining-ban window so a test
 * can assert how long the principal is locked out. Returns the ban duration in
 * seconds observed right after the ban was (re)applied.
 */
async function provokeBanAndMeasure(
  guard: EscalatingBanGuard,
  req: { user?: { id?: string | number }; ip?: string },
  attempts: number,
): Promise<number> {
  const ctx = ctxFor(req);
  for (let i = 0; i < attempts; i++) {
    try {
      await guard.canActivate(ctx);
    } catch {
      // swallow — we measure the ban window below
    }
  }
  return guard.banSecondsRemaining(req);
}

describe("escalating ban grows block duration for authenticated user", () => {
  // V-AC-2 anchor test: the ban window for an *authenticated* principal must
  // grow on repeated rounds of violations (Fibonacci ladder), not stay flat.
  it("lengthens the ban on each fresh round of violations", async () => {
    // threshold 2 violations / 60s window; tiny window so test is fast.
    const guard = new EscalatingBanGuard({
      violationThreshold: 2,
      violationWindowSeconds: 60,
    });
    const req = { user: { id: "auth-user-1" }, ip: "10.0.0.1" };

    // Round 1: cross the threshold → first ban (n=1 → 1 min = 60s).
    const firstBan = await provokeBanAndMeasure(guard, req, 3);
    expect(firstBan).toBeGreaterThan(0);

    // Lift the ban so a second round can register, then provoke again.
    guard.__unblockForTest(req);
    const secondBan = await provokeBanAndMeasure(guard, req, 3);

    // The second ban must be strictly longer than the first (escalation).
    expect(secondBan).toBeGreaterThan(firstBan);
  });

  it("escalates by user id even when the source IP changes between rounds", async () => {
    // Threat T3: a banned principal must not reset the ladder by rotating IPs.
    const guard = new EscalatingBanGuard({
      violationThreshold: 2,
      violationWindowSeconds: 60,
    });

    const firstBan = await provokeBanAndMeasure(
      guard,
      { user: { id: "auth-user-2" }, ip: "10.0.0.1" },
      3,
    );
    guard.__unblockForTest({ user: { id: "auth-user-2" } });
    // Same user, different IP — escalation must still apply.
    const secondBan = await provokeBanAndMeasure(
      guard,
      { user: { id: "auth-user-2" }, ip: "203.0.113.9" },
      3,
    );
    expect(secondBan).toBeGreaterThan(firstBan);
  });
});

describe("EscalatingBanGuard request handling", () => {
  it("allows traffic below the violation threshold", async () => {
    const guard = new EscalatingBanGuard({ violationThreshold: 5 });
    const ctx = ctxFor({ user: { id: "calm-user" } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("rejects with HTTP 429 once the principal is banned", async () => {
    const guard = new EscalatingBanGuard({
      violationThreshold: 1,
      violationWindowSeconds: 60,
    });
    const ctx = ctxFor({ ip: "198.51.100.7" });
    // First two requests trip the threshold and apply the ban...
    await guard.canActivate(ctx).catch(() => undefined);
    await guard.canActivate(ctx).catch(() => undefined);
    // ...the next one is rejected by the active ban.
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });

  it("fails closed (503) when the limiter backend throws", async () => {
    const guard = new EscalatingBanGuard({ failClosed: true });
    // Force the limiter to throw a non-RateLimiterRes error.
    guard.__breakLimiterForTest();
    const ctx = ctxFor({ user: { id: "x" } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
  });
});
