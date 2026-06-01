import { ArgumentsHost, HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Rfc7807ExceptionFilter } from "../src/rfc7807/rfc7807-exception.filter.js";
import { ProblemException } from "../src/rfc7807/problem-exception.js";
import type { ProblemDetails } from "../src/rfc7807/problem-details.types.js";

const BASE = "https://errors.example.test/errors";

/** Captures the reply written by the filter. */
function hostWith(url = "/resource") {
  const sent: { status?: number; contentType?: string; body?: ProblemDetails } =
    {};
  const reply = {
    code(status: number) {
      sent.status = status;
      return reply;
    },
    header(name: string, value: string) {
      if (name === "Content-Type") sent.contentType = value;
      return reply;
    },
    send(body: ProblemDetails) {
      sent.body = body;
      return reply;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: "trace-1", url }),
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;
  return { host, sent };
}

function makeFilter(mapException?: (e: unknown) => ProblemDetails | null) {
  return new Rfc7807ExceptionFilter(
    mapException ? { baseUri: BASE, mapException } : { baseUri: BASE },
  );
}

describe("Rfc7807ExceptionFilter", () => {
  it("always emits application/problem+json with the parameterised base URI", () => {
    const { host, sent } = hostWith();
    makeFilter().catch(new HttpException("bad", 400), host);
    expect(sent.contentType).toBe("application/problem+json");
    expect(sent.body?.type.startsWith(BASE)).toBe(true);
  });

  it("passes ProblemException through with its code and detail", () => {
    const { host, sent } = hostWith();
    makeFilter().catch(
      new ProblemException(BASE, "invalid_token", "expired"),
      host,
    );
    expect(sent.status).toBe(401);
    expect(sent.body?.code).toBe("invalid_token");
    expect(sent.body?.detail).toBe("expired");
  });

  it("maps a generic HttpException 4xx to invalid_request with detail", () => {
    const { host, sent } = hostWith();
    makeFilter().catch(new HttpException("nope", 400), host);
    expect(sent.status).toBe(400);
    expect(sent.body?.code).toBe("invalid_request");
  });

  it("maps a 429 HttpException to rate_limited", () => {
    const { host, sent } = hostWith();
    makeFilter().catch(new HttpException("slow down", 429), host);
    expect(sent.status).toBe(429);
    expect(sent.body?.code).toBe("rate_limited");
  });

  it("maps a ZodError to a 400 invalid_request", () => {
    const { host, sent } = hostWith();
    const err = z.string().safeParse(123);
    makeFilter().catch((err as { error: unknown }).error, host);
    expect(sent.status).toBe(400);
    expect(sent.body?.code).toBe("invalid_request");
  });

  it("maps an unknown exception to 500 and OMITS detail (info-disclosure guard)", () => {
    const { host, sent } = hostWith();
    makeFilter().catch(new Error("internal stack secret /etc/passwd"), host);
    expect(sent.status).toBe(500);
    expect(sent.body?.code).toBe("internal_error");
    expect(sent.body?.detail).toBeUndefined();
  });

  it("omits detail for a 5xx HttpException even when a message is present", () => {
    const { host, sent } = hostWith();
    makeFilter().catch(new HttpException("db down at 10.0.0.5", 503), host);
    expect(sent.status).toBe(503);
    expect(sent.body?.detail).toBeUndefined();
  });

  it("uses the mapException hook result when it returns a problem", () => {
    const mapped: ProblemDetails = {
      type: `${BASE}/interaction_session_not_found`,
      title: "Interaction expired",
      status: 410,
      code: "interaction_session_not_found",
      instance: "/resource",
    };
    const hook = vi.fn(() => mapped);
    const { host, sent } = hostWith();
    makeFilter(hook).catch({ name: "SessionNotFound" }, host);
    expect(hook).toHaveBeenCalled();
    expect(sent.status).toBe(410);
    expect(sent.body?.code).toBe("interaction_session_not_found");
  });

  it("falls through to the built-in chain when mapException returns null", () => {
    const hook = vi.fn(() => null);
    const { host, sent } = hostWith();
    makeFilter(hook).catch(new HttpException("bad", 400), host);
    expect(hook).toHaveBeenCalled();
    expect(sent.status).toBe(400);
    expect(sent.body?.code).toBe("invalid_request");
  });
});
