import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

const RELEASE_NODE_VERSION = "22.23.1";
const RELEASE_NPM_VERSION = "11.18.0";

const validateReleaseToolchain = (source) => {
  const workflow = parse(source);
  const steps = workflow?.jobs?.release?.steps;

  assert.ok(
    Array.isArray(steps),
    "release workflow must define jobs.release.steps",
  );

  const setupNode = steps.find(
    (step) =>
      typeof step?.uses === "string" &&
      step.uses.startsWith("actions/setup-node@"),
  );
  assert.ok(setupNode, "release workflow must use actions/setup-node");
  assert.equal(
    String(setupNode.with?.["node-version"] ?? ""),
    RELEASE_NODE_VERSION,
    `release Node must be ${RELEASE_NODE_VERSION}`,
  );

  const npmSetup = steps.find(
    (step) => step?.name === "Ensure npm supports trusted publishing",
  );
  assert.ok(
    npmSetup,
    "release workflow must define the trusted-publishing npm setup step",
  );

  const npmInstall = String(npmSetup.run ?? "").match(
    /^npm install -g npm@(\d+\.\d+\.\d+)$/,
  );
  assert.ok(
    npmInstall,
    "release npm install must contain one exact version and no moving tag",
  );
  assert.equal(
    npmInstall[1],
    RELEASE_NPM_VERSION,
    `release npm must be ${RELEASE_NPM_VERSION}`,
  );
};

test("release workflow pins the supported trusted-publishing toolchain", async () => {
  const releaseWorkflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  validateReleaseToolchain(releaseWorkflow);
});

test("commented Node pins cannot shadow the active release value", () => {
  const commentShadow = `
jobs:
  release:
    steps:
      # node-version: ${RELEASE_NODE_VERSION}
      - uses: actions/setup-node@v4
        with:
          node-version: 20.20.2
      - name: Ensure npm supports trusted publishing
        run: npm install -g npm@${RELEASE_NPM_VERSION}
`;

  assert.throws(
    () => validateReleaseToolchain(commentShadow),
    new RegExp(
      `release Node must be ${RELEASE_NODE_VERSION.replaceAll(".", "\\.")}`,
    ),
  );
});

test("commented npm pins cannot shadow the active release command", () => {
  const commentShadow = `
jobs:
  release:
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: ${RELEASE_NODE_VERSION}
      # run: npm install -g npm@${RELEASE_NPM_VERSION}
      - name: Ensure npm supports trusted publishing
        run: npm install -g npm@latest
`;

  assert.throws(
    () => validateReleaseToolchain(commentShadow),
    /release npm install must contain one exact version/,
  );
});
