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
      expect(body.issues[0].code).toBe("invalid_type");
    }
  });

  // The `code` is part of this package's published contract, so it is pinned
  // per validation kind rather than merely asserted to be a non-empty string.
  // A loose assertion here is what let a Zod major renumber the contract under
  // a green suite: Zod 4 renamed `invalid_string` -> `invalid_format` and
  // collapsed `invalid_enum_value` / `invalid_literal` into `invalid_value`.
  // Any future rename must fail here and be released deliberately.
  it.each([
    ["wrong type", z.object({ a: z.number() }), { a: "no" }, "invalid_type"],
    ["missing required key", z.object({ a: z.string() }), {}, "invalid_type"],
    [
      "unrecognized key",
      z.object({ a: z.number() }).strict(),
      { a: 1, b: 2 },
      "unrecognized_keys",
    ],
    [
      "string format",
      z.object({ e: z.string().email() }),
      { e: "nope" },
      "invalid_format",
    ],
    [
      "enum member",
      z.object({ k: z.enum(["a", "b"]) }),
      { k: "c" },
      "invalid_value",
    ],
    ["literal", z.object({ l: z.literal("x") }), { l: "y" }, "invalid_value"],
    ["too small", z.object({ s: z.string().min(5) }), { s: "ab" }, "too_small"],
    ["too big", z.object({ n: z.number().max(3) }), { n: 9 }, "too_big"],
    [
      "union",
      z.object({ v: z.union([z.string(), z.number()]) }),
      { v: true },
      "invalid_union",
    ],
  ])(
    "pins the published issue code for %s",
    (_label, schema, value, expectedCode) => {
      const pipe = new ZodValidationPipe(schema);
      try {
        pipe.transform(value);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const body = (err as BadRequestException).getResponse() as {
          issues: { code: string }[];
        };
        expect(body.issues[0].code).toBe(expectedCode);
      }
    },
  );

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
