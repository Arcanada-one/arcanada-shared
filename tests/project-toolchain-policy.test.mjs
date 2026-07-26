import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

const NODE_VERSION = "22.23.1";
const PNPM_VERSION = "11.17.0";
const PINNED_ACTION_PATTERN = /^[^@\s]+@[0-9a-f]{40}$/;

const assertAllActionsPinned = (workflow) => {
  for (const [jobName, job] of Object.entries(workflow?.jobs ?? {})) {
    if (typeof job?.uses === "string") {
      assert.match(
        job.uses,
        PINNED_ACTION_PATTERN,
        `${jobName} reusable workflow ${job.uses} must use a full commit SHA`,
      );
    }

    for (const step of job?.steps ?? []) {
      if (typeof step?.uses !== "string") {
        continue;
      }

      assert.match(
        step.uses,
        PINNED_ACTION_PATTERN,
        `${jobName} action ${step.uses} must use a full commit SHA`,
      );
    }
  }
};

test("project and CI pin the Node 22 and pnpm 11 audit toolchain", async () => {
  const [packageSource, ciSource] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  ]);

  const packageManifest = JSON.parse(packageSource);
  assert.equal(packageManifest.packageManager, `pnpm@${PNPM_VERSION}`);
  assert.equal(packageManifest.engines?.node, ">=22.14.0");
  assert.equal(packageManifest.engines?.pnpm, ">=11");

  const ciWorkflow = parse(ciSource);
  assertAllActionsPinned(ciWorkflow);

  const steps = ciWorkflow?.jobs?.["build-test"]?.steps;
  assert.ok(
    Array.isArray(steps),
    "CI workflow must define the build-test steps",
  );

  const setupNodeSteps = steps.filter(
    (step) =>
      typeof step?.uses === "string" &&
      step.uses.startsWith("actions/setup-node@"),
  );
  assert.equal(
    setupNodeSteps.length,
    1,
    "CI workflow must define exactly one active actions/setup-node step",
  );
  const [setupNode] = setupNodeSteps;
  assert.equal(String(setupNode.with?.["node-version"] ?? ""), NODE_VERSION);
});

test("CI pinning rejects mutable reusable sibling workflows", () => {
  assert.throws(
    () =>
      assertAllActionsPinned({
        jobs: {
          audit: {
            uses: "example/repo/.github/workflows/audit.yml@v1",
          },
        },
      }),
    /audit reusable workflow .* must use a full commit SHA/,
  );
});
