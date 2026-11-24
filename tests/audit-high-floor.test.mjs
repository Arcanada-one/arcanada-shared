import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Main CI failed on run 44143466288 (build-test) because
 * `pnpm audit --audit-level=high` reported GHSA-fc5q-39xc-vjpf (picomatch).
 * That advisory was withdrawn upstream on 2026-11-18T15:38:56Z; this test
 * keeps the high floor green so a withdrawn high cannot silently return as a
 * stale red main without a new measurement.
 */
test("pnpm audit --audit-level=high exits 0 on the current lockfile", () => {
  const result = spawnSync(
    "corepack",
    ["pnpm@11.17.0", "audit", "--audit-level=high"],
    {
      cwd: root,
      encoding: "utf8",
      env: process.env,
    },
  );
  assert.equal(
    result.status,
    0,
    `audit high must exit 0; stdout=${result.stdout}\nstderr=${result.stderr}`,
  );
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /GHSA-fc5q-39xc-vjpf/,
    "withdrawn GHSA-fc5q must not appear in high audit output",
  );
});
