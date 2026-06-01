import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AbstractApiKeyGuard } from "../src/guards/abstract-api-key.guard.js";

/** Minimal test double for an ExecutionContext carrying an HTTP request. */
function ctxWith(authorization?: string): ExecutionContext {
  const req = { headers: authorization ? { authorization } : {} };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

/** Concrete subclass that delegates to an injected verifier. */
class TestGuard extends AbstractApiKeyGuard {
  constructor(
    private readonly verifier: (t: string) => Promise<string | null>,
  ) {
    super();
  }
  protected verifyKey(token: string): Promise<string | null> {
    return this.verifier(token);
  }
}

describe("AbstractApiKeyGuard", () => {
  it("throws 401 when no Bearer token is present", async () => {
    const guard = new TestGuard(async () => "principal");
    await expect(guard.canActivate(ctxWith())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("throws 401 when verifyKey resolves null (rejected key)", async () => {
    const guard = new TestGuard(async () => null);
    await expect(
      guard.canActivate(ctxWith("Bearer bad")),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("returns true when verifyKey resolves a principal identifier", async () => {
    const guard = new TestGuard(async () => "agent-7");
    await expect(guard.canActivate(ctxWith("Bearer good"))).resolves.toBe(true);
  });

  it("passes the extracted token (not the raw header) to verifyKey", async () => {
    const verifier = vi.fn(async () => "ok");
    const guard = new TestGuard(verifier);
    await guard.canActivate(ctxWith("Bearer tok-42"));
    expect(verifier).toHaveBeenCalledWith("tok-42");
  });
});
