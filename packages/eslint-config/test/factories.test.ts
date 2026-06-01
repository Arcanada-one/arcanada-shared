import { describe, expect, it } from "vitest";
import { base, nestjs, react } from "../src/index.js";

describe("@arcanada/eslint-config factories", () => {
  it("base() returns a non-empty flat-config array", () => {
    const cfg = base();
    expect(Array.isArray(cfg)).toBe(true);
    expect(cfg.length).toBeGreaterThan(0);
  });

  it("base() configures the TypeScript parser and shared rules", () => {
    const [block] = base() as Array<Record<string, any>>;
    expect(block.plugins["@typescript-eslint"]).toBeDefined();
    expect(block.rules.eqeqeq).toEqual(["error", "always"]);
  });

  it("nestjs() extends base and relaxes unused-args for DI", () => {
    const cfg = nestjs() as Array<Record<string, any>>;
    expect(cfg.length).toBeGreaterThan(base().length - 1);
    const last = cfg[cfg.length - 1];
    expect(last.rules["@typescript-eslint/no-unused-vars"][1].args).toBe(
      "none",
    );
  });

  it("react() extends base and enables jsx parsing", () => {
    const cfg = react() as Array<Record<string, any>>;
    const jsxBlock = cfg.find(
      (b) => b.languageOptions?.parserOptions?.ecmaFeatures?.jsx === true,
    );
    expect(jsxBlock).toBeDefined();
  });
});
