import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

const RELEASE_NODE_VERSION = "22.23.1";
const RELEASE_NPM_VERSION = "11.18.0";
const NPM_REGISTRY = "https://registry.npmjs.org";
const PINNED_ACTION_PATTERN = /^[^@\s]+@[0-9a-f]{40}$/;
const INTERNAL_TASK_ID_PATTERN =
  /\b(?:CONN|AUTH|ARCA|VERD|TRANS|SUP|MUN|LTM|SRCH|DISK|OVER|CONS|VOICE|BILL|CONV|ARGA|EMAIL|INFRA|TUNE|DATA|ROB|WEB|DEV|DEVOPS|CONTENT|RESEARCH|AGENT|BENCH|MAINT|FIN|QA|SEC)-\d{4}\b/;

const findActionSteps = (steps, action) =>
  steps
    .map((step, index) => ({ index, step }))
    .filter(({ step }) => step?.uses?.split("@", 1)[0] === action);

const findRunSteps = (steps, pattern) =>
  steps
    .map((step, index) => ({ index, step }))
    .filter(({ step }) => pattern.test(String(step?.run ?? "")));

const assertOne = (matches, message) => {
  assert.equal(matches.length, 1, message);
  return matches[0];
};

const validateReleaseToolchain = (source) => {
  const workflow = parse(source);
  const releaseJob = workflow?.jobs?.release;
  const steps = releaseJob?.steps;

  assert.ok(
    Array.isArray(steps),
    "release workflow must define jobs.release.steps",
  );
  assert.equal(
    releaseJob["runs-on"],
    "ubuntu-latest",
    "trusted publishing must run on a GitHub-hosted runner",
  );
  assert.deepEqual(
    workflow.permissions,
    {
      contents: "write",
      "pull-requests": "write",
      "id-token": "write",
    },
    "release permissions must be the least-privilege changesets and OIDC set",
  );
  assert.deepEqual(
    workflow.concurrency,
    {
      group: "${{ github.workflow }}-${{ github.ref }}",
      "cancel-in-progress": false,
    },
    "release concurrency must serialize without cancelling an in-flight publish",
  );

  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      if (typeof step?.uses === "string") {
        assert.match(
          step.uses,
          PINNED_ACTION_PATTERN,
          `${jobName} action ${step.uses} must use a full commit SHA`,
        );
      }
    }
  }

  const pnpmSetup = assertOne(
    findActionSteps(steps, "pnpm/action-setup"),
    "release workflow must define exactly one pnpm/action-setup step",
  );
  const setupNode = assertOne(
    findActionSteps(steps, "actions/setup-node"),
    "release workflow must define exactly one actions/setup-node step",
  );
  assert.equal(
    String(setupNode.step.with?.["node-version"] ?? ""),
    RELEASE_NODE_VERSION,
    `release Node must be ${RELEASE_NODE_VERSION}`,
  );
  assert.equal(
    setupNode.step.with?.["registry-url"],
    NPM_REGISTRY,
    `release registry must be ${NPM_REGISTRY}`,
  );

  const frozenInstall = assertOne(
    findRunSteps(steps, /^pnpm install --frozen-lockfile$/),
    "release workflow must define exactly one frozen pnpm install",
  );
  const build = assertOne(
    findRunSteps(steps, /^pnpm build$/),
    "release workflow must define exactly one build",
  );
  const npmSetup = assertOne(
    findRunSteps(steps, /(?:^|\n)\s*npm (?:install|i) (?:-g|--global) npm@/),
    "release workflow must define exactly one active global npm install",
  );

  const npmInstall = String(npmSetup.step.run ?? "").match(
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

  const changesets = assertOne(
    findActionSteps(steps, "changesets/action"),
    "release workflow must define exactly one changesets/action step",
  );
  assert.equal(changesets.step.with?.publish, "pnpm release");
  assert.equal(changesets.step.with?.version, "pnpm changeset version");
  assert.equal(
    changesets.step.env?.GITHUB_TOKEN,
    "${{ secrets.GITHUB_TOKEN }}",
  );

  assert.ok(
    pnpmSetup.index < setupNode.index &&
      setupNode.index < frozenInstall.index &&
      frozenInstall.index < build.index &&
      build.index < npmSetup.index &&
      npmSetup.index < changesets.index,
    "release toolchain must execute pnpm setup, Node setup, frozen install, build, npm setup, then changesets",
  );
};

test("release workflow pins the supported trusted-publishing toolchain", async () => {
  const releaseWorkflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  validateReleaseToolchain(releaseWorkflow);
});

test("commented Node pins cannot shadow the active release value", async () => {
  const releaseWorkflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const commentShadow = releaseWorkflow.replace(
    `          node-version: ${RELEASE_NODE_VERSION}`,
    `          # node-version: ${RELEASE_NODE_VERSION}
          node-version: 20.20.2`,
  );

  assert.throws(
    () => validateReleaseToolchain(commentShadow),
    new RegExp(
      `release Node must be ${RELEASE_NODE_VERSION.replaceAll(".", "\\.")}`,
    ),
  );
});

test("commented npm pins cannot shadow the active release command", async () => {
  const releaseWorkflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const commentShadow = releaseWorkflow.replace(
    `        run: npm install -g npm@${RELEASE_NPM_VERSION}`,
    `        # run: npm install -g npm@${RELEASE_NPM_VERSION}
        run: npm install -g npm@latest`,
  );

  assert.throws(
    () => validateReleaseToolchain(commentShadow),
    /release npm install must contain one exact version/,
  );
});

test("duplicate Node setup cannot shadow the active release toolchain", async () => {
  const releaseWorkflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const duplicate = releaseWorkflow.replace(
    "      - uses: actions/setup-node@",
    `      - uses: actions/setup-node@${"a".repeat(40)}
        with:
          node-version: ${RELEASE_NODE_VERSION}
          registry-url: ${NPM_REGISTRY}
      - uses: actions/setup-node@`,
  );

  assert.throws(
    () => validateReleaseToolchain(duplicate),
    /exactly one actions\/setup-node step/,
  );
});

test("duplicate npm install cannot shadow the publishing npm version", async () => {
  const releaseWorkflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const duplicate = releaseWorkflow.replace(
    "      - name: Create Release PR or publish",
    `      - name: Shadow npm setup
        run: |
          echo "shadowing the validated command"
          npm install -g npm@latest

      - name: Create Release PR or publish`,
  );

  assert.throws(
    () => validateReleaseToolchain(duplicate),
    /exactly one active global npm install/,
  );
});

test("changesets cannot run before the pinned publishing toolchain", async () => {
  const releaseWorkflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const workflow = parse(releaseWorkflow);
  const steps = workflow.jobs.release.steps;
  const changesetsIndex = steps.findIndex(
    (step) => step?.uses?.split("@", 1)[0] === "changesets/action",
  );
  const [changesets] = steps.splice(changesetsIndex, 1);
  steps.unshift(changesets);

  assert.throws(
    () => validateReleaseToolchain(JSON.stringify(workflow)),
    /release toolchain must execute/,
  );
});

test("mutable actions in sibling release jobs cannot bypass pinning", async () => {
  const releaseWorkflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const workflow = parse(releaseWorkflow);
  workflow.jobs.audit = {
    "runs-on": "ubuntu-latest",
    steps: [{ uses: "actions/checkout@v4" }],
  };

  assert.throws(
    () => validateReleaseToolchain(JSON.stringify(workflow)),
    /audit action actions\/checkout@v4 must use a full commit SHA/,
  );
});

test("pending public changesets do not expose internal task IDs", async () => {
  const changesetDirectory = new URL("../.changeset/", import.meta.url);
  const changesetFiles = (await readdir(changesetDirectory)).filter(
    (file) => file.endsWith(".md") && file !== "README.md",
  );

  for (const file of changesetFiles) {
    const source = await readFile(new URL(file, changesetDirectory), "utf8");
    assert.doesNotMatch(
      source,
      INTERNAL_TASK_ID_PATTERN,
      `${file} must use public product language instead of internal task IDs`,
    );
  }
});
