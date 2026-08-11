import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

const NODE_VERSION = "22.23.1";
const PNPM_VERSION = "11.17.0";
const PINNED_ACTION_PATTERN = /^[^@\s]+@[0-9a-f]{40}$/;
const NODE_MAJOR = Number(NODE_VERSION.split(".")[0]);

const majorOfRange = (range) => {
  const match = /(\d+)\./.exec(String(range));
  return match ? Number(match[1]) : Number.NaN;
};

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

test("@types/node major tracks the supported Node major", async () => {
  const workspaceSource = await readFile(
    new URL("../pnpm-workspace.yaml", import.meta.url),
    "utf8",
  );
  const catalog = parse(workspaceSource)?.catalog ?? {};
  const typesNode = catalog["@types/node"];

  assert.ok(
    typeof typesNode === "string",
    "pnpm-workspace.yaml catalog must pin @types/node",
  );

  // `@types/node` describes a specific Node major. Ahead of `engines.node` it
  // stops being a gate and becomes a liability: the typecheck accepts APIs the
  // supported runtime does not have, so CI is green and consumers crash. Move
  // this only together with `engines.node` and the CI `node-version`.
  assert.equal(
    majorOfRange(typesNode),
    NODE_MAJOR,
    `@types/node (${typesNode}) must describe Node ${NODE_MAJOR}, the version CI runs and engines.node requires`,
  );
});

test("toolchain major comparison reads the leading major of a range", () => {
  assert.equal(majorOfRange("^22.10.2"), 22);
  assert.equal(majorOfRange("^26.2.0"), 26);
  assert.notEqual(majorOfRange("^26.2.0"), NODE_MAJOR);
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
