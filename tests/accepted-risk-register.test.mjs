import assert from "node:assert/strict";
import test from "node:test";
import { checkAcceptedRisk } from "../scripts/check-accepted-risk.mjs";

/**
 * @param {string} id
 * @param {unknown} re_review
 */
const entry = (id, re_review) => ({ id, re_review });

test("a covered ignore with a future re_review passes", () => {
  assert.deepEqual(
    checkAcceptedRisk({
      ignored: ["GHSA-aaaa-bbbb-cccc"],
      entries: [entry("GHSA-aaaa-bbbb-cccc", "2026-11-07")],
      today: "2026-10-08",
    }),
    [],
  );
});

test("red control: an expired register entry fails, including on the day itself", () => {
  for (const reReview of ["2026-10-07", "2026-10-08"]) {
    const problems = checkAcceptedRisk({
      ignored: ["GHSA-aaaa-bbbb-cccc"],
      entries: [entry("GHSA-aaaa-bbbb-cccc", reReview)],
      today: "2026-10-08",
    });
    assert.equal(problems.length, 1, `re_review ${reReview} must fail`);
    assert.match(problems[0], /not in the future/);
  }
});

test("red control: an ignored id missing from the register fails", () => {
  const problems = checkAcceptedRisk({
    ignored: ["GHSA-aaaa-bbbb-cccc", "GHSA-dddd-eeee-ffff"],
    entries: [entry("GHSA-aaaa-bbbb-cccc", "2026-11-07")],
    today: "2026-10-08",
  });
  assert.equal(problems.length, 1);
  assert.match(
    problems[0],
    /GHSA-dddd-eeee-ffff.*absent from accepted-risk\.yml/,
  );
});

test("a malformed or missing re_review fails instead of passing silently", () => {
  for (const reReview of [undefined, null, "soon", "2026-13"]) {
    const problems = checkAcceptedRisk({
      ignored: ["GHSA-aaaa-bbbb-cccc"],
      entries: [entry("GHSA-aaaa-bbbb-cccc", reReview)],
      today: "2026-10-08",
    });
    assert.equal(problems.length, 1, `${String(reReview)} must fail`);
    assert.match(problems[0], /not an ISO date/);
  }
});

test("a register entry for an id that is not ignored is not an error", () => {
  assert.deepEqual(
    checkAcceptedRisk({
      ignored: [],
      entries: [entry("GHSA-aaaa-bbbb-cccc", "2020-01-01")],
      today: "2026-10-08",
    }),
    [],
  );
});

test("a malformed today is rejected", () => {
  assert.throws(
    () => checkAcceptedRisk({ ignored: [], entries: [], today: "08/10/2026" }),
    /today must be YYYY-MM-DD/,
  );
});

test("live register covers picomatch GHSA-fc5q-39xc-vjpf while 4.0.8 is unpublished", async () => {
  const { readRegister } = await import("../scripts/check-accepted-risk.mjs");
  const id = "GHSA-fc5q-39xc-vjpf";
  const { ignored, entries } = await readRegister(
    new URL("../", import.meta.url),
  );
  assert.ok(
    ignored.includes(id),
    `${id} must be in pnpm-workspace.yaml auditConfig.ignoreGhsas (build-test pnpm audit)`,
  );
  assert.ok(
    entries.some((entry) => entry.id === id),
    `${id} must have an accepted-risk.yml entry with a future re_review`,
  );
  const problems = checkAcceptedRisk({
    ignored,
    entries,
    today: new Date().toISOString().slice(0, 10),
  });
  assert.deepEqual(problems, []);
});
