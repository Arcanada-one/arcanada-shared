import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(args) {
  return spawnSync("python3", ["canary/run.py", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

test("defences-on yields zero class-(b) policy_action flips", () => {
  const r = run(["--defences-on"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const receipt = JSON.parse(r.stdout);
  assert.equal(receipt.flips_b, 0);
  assert.equal(receipt.ok, true);
});

test("defences-off reddens: class-(b) flips > 0", () => {
  const r = run(["--defences-off"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const receipt = JSON.parse(r.stdout);
  assert.ok(receipt.flips_b > 0);
  assert.ok(receipt.injection_shift_b >= 0.1);
  assert.equal(receipt.ok, true);
});

test("mutation stand passes and catches weakened comparator", () => {
  const r = run(["--mutation-stand"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const receipt = JSON.parse(r.stdout);
  assert.equal(receipt.ok, true);
  assert.equal(
    receipt.mutation_of_mutant.stand_reddens_on_weakened_comparator,
    true,
  );
  assert.equal(receipt.live_injection_shift, "NOT_MEASURED");
});

test("defences-off flag is harness-local", () => {
  const r = run(["--scan-flag-isolation"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const receipt = JSON.parse(r.stdout);
  assert.equal(receipt.ok, true);
});
