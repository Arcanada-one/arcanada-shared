import { describe, expect, it } from "vitest";
import { extractBearer } from "../src/guards/extract-bearer.js";

describe("extractBearer", () => {
  it("extracts the token from a well-formed Bearer header", () => {
    expect(extractBearer("Bearer abc123")).toBe("abc123");
  });

  it("is case-insensitive on the scheme keyword", () => {
    expect(extractBearer("bearer abc123")).toBe("abc123");
    expect(extractBearer("BEARER abc123")).toBe("abc123");
  });

  it("returns null for a missing header", () => {
    expect(extractBearer(undefined)).toBeNull();
    expect(extractBearer("")).toBeNull();
  });

  it("returns null for a non-Bearer scheme", () => {
    expect(extractBearer("Basic dXNlcjpwYXNz")).toBeNull();
  });

  it("returns null when the token part is empty or whitespace-only", () => {
    expect(extractBearer("Bearer ")).toBeNull();
    expect(extractBearer("Bearer    ")).toBeNull();
  });

  it("captures only the first whitespace-delimited token", () => {
    expect(extractBearer("Bearer abc123 trailing")).toBe("abc123");
  });
});
