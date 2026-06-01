import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");

function loadProfile(name: string): Record<string, unknown> {
  const raw = readFileSync(join(pkgRoot, `${name}.json`), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function compilerOptions(name: string): Record<string, unknown> {
  const profile = loadProfile(name);
  return (profile.compilerOptions ?? {}) as Record<string, unknown>;
}

describe("@arcanada/tsconfig profiles", () => {
  it("base enforces strict mode", () => {
    expect(compilerOptions("base").strict).toBe(true);
  });

  it("base keeps isolatedModules on for bundler/tree-shaking safety", () => {
    expect(compilerOptions("base").isolatedModules).toBe(true);
  });

  it("nestjs disables isolatedModules so decorator metadata survives", () => {
    const opts = compilerOptions("nestjs");
    expect(opts.isolatedModules).toBe(false);
    expect(opts.emitDecoratorMetadata).toBe(true);
    expect(opts.experimentalDecorators).toBe(true);
  });

  it("nestjs extends base", () => {
    expect(loadProfile("nestjs").extends).toBe("./base.json");
  });

  it("react sets the jsx transform and DOM libs", () => {
    const profile = loadProfile("react");
    const opts = (profile.compilerOptions ?? {}) as Record<string, unknown>;
    expect(profile.extends).toBe("./base.json");
    expect(opts.jsx).toBe("react-jsx");
    expect(opts.lib).toContain("DOM");
  });

  it("every profile is parseable JSON exposed via exports map", () => {
    const exportsMap = (loadPackageJson().exports ?? {}) as Record<
      string,
      string
    >;
    for (const sub of ["./base", "./nestjs", "./react"]) {
      expect(exportsMap[sub]).toBeDefined();
    }
  });
});

function loadPackageJson(): Record<string, unknown> {
  const raw = readFileSync(join(pkgRoot, "package.json"), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}
