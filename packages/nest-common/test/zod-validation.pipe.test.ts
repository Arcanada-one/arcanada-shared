import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ZodValidationPipe } from "../src/zod-validation.pipe.js";

describe("ZodValidationPipe", () => {
  const schema = z.object({ a: z.number() }).strict();

  it("returns the parsed value for valid input", () => {
    const pipe = new ZodValidationPipe(schema);
    expect(pipe.transform({ a: 1 })).toEqual({ a: 1 });
  });

  it("throws BadRequestException with the canonical issues shape", () => {
    const pipe = new ZodValidationPipe(schema);
    try {
      pipe.transform({ a: "no" });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as {
        message: string;
        issues: { path: string; message: string; code: string }[];
      };
      expect(body.message).toBe("Validation failed");
      expect(body.issues[0].path).toBe("a");
      // canonical shape carries the zod issue code on every entry
      expect(typeof body.issues[0].code).toBe("string");
      expect(body.issues[0].code.length).toBeGreaterThan(0);
    }
  });

  it("joins nested paths with a dot and labels the root", () => {
    const nested = z.object({ user: z.object({ email: z.string() }) });
    const pipe = new ZodValidationPipe(nested);
    try {
      pipe.transform({ user: { email: 123 } });
      expect.fail("should have thrown");
    } catch (err) {
      const body = (err as BadRequestException).getResponse() as {
        issues: { path: string }[];
      };
      expect(body.issues[0].path).toBe("user.email");
    }
  });

  it("labels a root-level issue as (root)", () => {
    const pipe = new ZodValidationPipe(z.string());
    try {
      pipe.transform(123);
      expect.fail("should have thrown");
    } catch (err) {
      const body = (err as BadRequestException).getResponse() as {
        issues: { path: string }[];
      };
      expect(body.issues[0].path).toBe("(root)");
    }
  });

  it("reports every issue, not just the first", () => {
    const pipe = new ZodValidationPipe(
      z.object({ a: z.number(), b: z.number() }),
    );
    try {
      pipe.transform({ a: "x", b: "y" });
      expect.fail("should have thrown");
    } catch (err) {
      const body = (err as BadRequestException).getResponse() as {
        issues: unknown[];
      };
      expect(body.issues.length).toBe(2);
    }
  });
});
