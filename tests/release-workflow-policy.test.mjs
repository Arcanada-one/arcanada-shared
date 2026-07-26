import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

const RELEASE_NODE_VERSION = "22.23.1";
const RELEASE_NPM_VERSION = "11.18.0";
const NPM_REGISTRY = "https://registry.npmjs.org";
const RELEASE_ARTIFACT_NAME = "release-build-${{ github.sha }}";
const PINNED_ACTION_PATTERN = /^[^@\s]+@[0-9a-f]{40}$/;
const UNIVERSAL_TASK_PREFIXES = [
  "INFRA",
  "WEB",
  "DEV",
  "DEVOPS",
  "CONTENT",
  "RESEARCH",
  "AGENT",
  "BENCH",
  "MAINT",
  "FIN",
  "QA",
  "SEC",
  "QCK",
  "TUNE",
  "ROB",
  "DATA",
];
const ARCANADA_TASK_PREFIXES = [
  "ARCA",
  "CUBR",
  "VERD",
  "AUTH",
  "BILL",
  "CONV",
  "MUN",
  "TRANS",
  "SUP",
  "OVER",
  "CONS",
  "VOICE",
  "LTM",
  "SRCH",
  "CONN",
  "ARGA",
  "EMAIL",
  "ARAS",
  "STATUS",
  "ADSR",
  "LEGAL",
  "PUB",
  "SPACE",
  "SHARED",
  "CTRL",
  "WIKI",
  "DISK",
];
const INTERNAL_TASK_PREFIXES = [
  ...UNIVERSAL_TASK_PREFIXES,
  ...ARCANADA_TASK_PREFIXES,
];
const INTERNAL_TASK_ID_PATTERN = new RegExp(
  `\\b(?:${INTERNAL_TASK_PREFIXES.join("|")})-\\d{4}\\b`,
);
const GLOBAL_TOOLCHAIN_MUTATION_PATTERN =
  /(?=[^\n]*\b(?:npm|pnpm)\b)(?=[^\n]*\b(?:add|install|i|update|upgrade)\b)(?=[^\n]*(?:-g\b|--global(?:=true)?\b|--location(?:=|\s+)global\b))[^\n]+|\bcorepack\s+(?:install|prepare|use)\b[^\n]*(?:--global(?:\s|$)|--activate(?:\s|$))/;

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

const assertPinnedUses = (workflow) => {
  for (const [jobName, job] of Object.entries(workflow?.jobs ?? {})) {
    if (typeof job?.uses === "string") {
      assert.match(
        job.uses,
        PINNED_ACTION_PATTERN,
        `${jobName} reusable workflow ${job.uses} must use a full commit SHA`,
      );
    }

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
};

const assertCheckoutDoesNotPersistCredentials = (steps, jobName) => {
  const checkout = assertOne(
    findActionSteps(steps, "actions/checkout"),
    `${jobName} must define exactly one checkout`,
  );
  assert.equal(
    checkout.step.with?.["persist-credentials"],
    false,
    `${jobName} checkout must not persist credentials`,
  );
  return checkout;
};

const validateReleaseWorkflow = (source) => {
  const workflow = parse(source);
  const verifyJob = workflow?.jobs?.verify;
  const preflightJob = workflow?.jobs?.preflight;
  const releaseJob = workflow?.jobs?.release;
  const verifySteps = verifyJob?.steps;
  const preflightSteps = preflightJob?.steps;
  const releaseSteps = releaseJob?.steps;

  assert.deepEqual(
    workflow.permissions,
    {},
    "release workflow must default the token to no permissions",
  );
  assert.deepEqual(
    verifyJob?.permissions,
    { contents: "read" },
    "verify job must be read-only",
  );
  assert.deepEqual(
    preflightJob?.permissions,
    { contents: "read" },
    "registry preflight job must be read-only",
  );
  assert.deepEqual(
    releaseJob?.permissions,
    {
      contents: "write",
      "pull-requests": "write",
      "id-token": "write",
    },
    "release job must use only Changesets and OIDC permissions",
  );
  assert.deepEqual(
    releaseJob?.needs,
    ["verify", "preflight"],
    "release job must wait for unprivileged verification and registry preflight",
  );
  assert.equal(
    preflightJob?.["runs-on"],
    "ubuntu-latest",
    "registry preflight must run on a GitHub-hosted runner",
  );
  assert.equal(
    verifyJob?.["runs-on"],
    "ubuntu-latest",
    "verify must run on a GitHub-hosted runner",
  );
  assert.equal(
    releaseJob?.["runs-on"],
    "ubuntu-latest",
    "trusted publishing must run on a GitHub-hosted runner",
  );
  assert.deepEqual(
    workflow.concurrency,
    {
      group: "${{ github.workflow }}-${{ github.ref }}",
      "cancel-in-progress": false,
    },
    "release concurrency must serialize without cancelling an in-flight publish",
  );
  assert.ok(
    Array.isArray(preflightSteps),
    "release workflow must define jobs.preflight.steps",
  );
  assert.ok(
    Array.isArray(verifySteps),
    "release workflow must define jobs.verify.steps",
  );
  assert.ok(
    Array.isArray(releaseSteps),
    "release workflow must define jobs.release.steps",
  );

  assertPinnedUses(workflow);
  assertCheckoutDoesNotPersistCredentials(verifySteps, "verify");
  assertCheckoutDoesNotPersistCredentials(preflightSteps, "preflight");
  assertCheckoutDoesNotPersistCredentials(releaseSteps, "release");

  const verifySetupNode = assertOne(
    findActionSteps(verifySteps, "actions/setup-node"),
    "verify must define exactly one actions/setup-node step",
  );
  assert.equal(
    String(verifySetupNode.step.with?.["node-version"] ?? ""),
    RELEASE_NODE_VERSION,
  );
  assertOne(
    findRunSteps(verifySteps, /^pnpm install --frozen-lockfile$/),
    "verify must run exactly one frozen install",
  );
  assertOne(findRunSteps(verifySteps, /^pnpm lint$/), "verify must run lint");
  assertOne(
    findRunSteps(verifySteps, /^pnpm typecheck$/),
    "verify must run typecheck",
  );
  assertOne(
    findRunSteps(verifySteps, /^pnpm build$/),
    "verify must build release artifacts",
  );
  assertOne(
    findRunSteps(verifySteps, /^pnpm test$/),
    "verify must run the complete test suite",
  );
  const audit = assertOne(
    findRunSteps(verifySteps, /^pnpm audit --audit-level=high$/),
    "verify must run the full high-severity audit",
  );
  assert.doesNotMatch(String(audit.step.run), /--prod(?:uction)?\b/);

  const artifactUpload = assertOne(
    findActionSteps(verifySteps, "actions/upload-artifact"),
    "verify must upload exactly one immutable build artifact",
  );
  assert.equal(artifactUpload.step.with?.name, RELEASE_ARTIFACT_NAME);
  assert.equal(artifactUpload.step.with?.["if-no-files-found"], "error");
  assert.equal(artifactUpload.step.with?.overwrite, false);

  const preflightSetupNode = assertOne(
    findActionSteps(preflightSteps, "actions/setup-node"),
    "preflight must define exactly one actions/setup-node step",
  );
  assert.equal(
    String(preflightSetupNode.step.with?.["node-version"] ?? ""),
    RELEASE_NODE_VERSION,
  );
  assertOne(
    findRunSteps(preflightSteps, /^node scripts\/release-preflight\.mjs$/),
    "preflight job must run the registry preflight exactly once",
  );

  const releaseSetupNode = assertOne(
    findActionSteps(releaseSteps, "actions/setup-node"),
    "release must define exactly one actions/setup-node step",
  );
  assert.equal(
    String(releaseSetupNode.step.with?.["node-version"] ?? ""),
    RELEASE_NODE_VERSION,
  );
  assert.equal(
    releaseSetupNode.step.with?.["registry-url"],
    NPM_REGISTRY,
    `release registry must be ${NPM_REGISTRY}`,
  );

  const lifecycleFreeInstall = assertOne(
    findRunSteps(
      releaseSteps,
      /^pnpm install --frozen-lockfile --ignore-scripts$/,
    ),
    "privileged release must install with lifecycle scripts disabled",
  );
  const toolchainMutations = findRunSteps(
    releaseSteps,
    GLOBAL_TOOLCHAIN_MUTATION_PATTERN,
  );
  const npmSetup = assertOne(
    toolchainMutations,
    "release must define exactly one global npm/pnpm toolchain mutation",
  );
  assert.equal(
    String(npmSetup.step.run ?? ""),
    `npm install --global --ignore-scripts npm@${RELEASE_NPM_VERSION}`,
    "release npm install must be exact and lifecycle-free",
  );

  const artifactDownload = assertOne(
    findActionSteps(releaseSteps, "actions/download-artifact"),
    "release must download exactly one build artifact",
  );
  assert.equal(artifactDownload.step.with?.name, RELEASE_ARTIFACT_NAME);
  const artifactVerify = assertOne(
    findRunSteps(releaseSteps, /sha256sum --check/),
    "release must verify the inner build-artifact checksum",
  );
  const changesets = assertOne(
    findActionSteps(releaseSteps, "changesets/action"),
    "release must define exactly one changesets/action step",
  );
  assert.equal(changesets.step.with?.publish, "pnpm release");
  assert.equal(changesets.step.with?.version, "pnpm changeset version");
  assert.equal(
    changesets.step.env?.GITHUB_TOKEN,
    "${{ secrets.GITHUB_TOKEN }}",
  );

  assert.ok(
    lifecycleFreeInstall.index < npmSetup.index &&
      npmSetup.index < artifactDownload.index &&
      artifactDownload.index < artifactVerify.index &&
      artifactVerify.index < changesets.index,
    "release must install without scripts, verify the artifact, then invoke Changesets",
  );

  for (const { step } of findRunSteps(
    releaseSteps,
    /\bpnpm (?:lint|typecheck|build|test|audit)\b/,
  )) {
    assert.fail(
      `privileged release job must not run verification/build command: ${step.run}`,
    );
  }
};

test("release workflow separates verification from privileged publishing", async () => {
  const releaseWorkflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  validateReleaseWorkflow(releaseWorkflow);
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
    () => validateReleaseWorkflow(commentShadow),
    new RegExp(RELEASE_NODE_VERSION.replaceAll(".", "\\.")),
  );
});

test("duplicate Node setup cannot shadow the release toolchain", async () => {
  const releaseWorkflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const duplicate = releaseWorkflow.replace(
    "      - uses: actions/setup-node@",
    `      - uses: actions/setup-node@${"a".repeat(40)}
        with:
          node-version: ${RELEASE_NODE_VERSION}
      - uses: actions/setup-node@`,
  );

  assert.throws(
    () => validateReleaseWorkflow(duplicate),
    /exactly one actions\/setup-node step/,
  );
});

for (const [label, mutation] of [
  ["reordered npm global flags", "npm install npm@latest --global"],
  ["leading npm global flag", "npm --global install npm@latest"],
  ["npm global location", "npm install npm@latest --location=global"],
  ["sudo npm global install", "sudo npm install -g npm@latest"],
  ["pnpm global add", "pnpm add --global npm@latest"],
  ["leading pnpm global flag", "pnpm --global add npm@latest"],
  ["corepack activation", "corepack prepare pnpm@latest --activate"],
]) {
  test(`${label} cannot shadow the publishing toolchain`, async () => {
    const releaseWorkflow = await readFile(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    );
    const duplicate = releaseWorkflow.replace(
      "      - name: Create Release PR or publish",
      `      - name: Shadow toolchain
        run: ${mutation}

      - name: Create Release PR or publish`,
    );

    assert.throws(
      () => validateReleaseWorkflow(duplicate),
      /exactly one global npm\/pnpm toolchain mutation/,
    );
  });
}

test("changesets cannot run without the registry preflight dependency", async () => {
  const releaseWorkflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const workflow = parse(releaseWorkflow);
  workflow.jobs.release.needs = ["verify"];

  assert.throws(
    () => validateReleaseWorkflow(JSON.stringify(workflow)),
    /release job must wait for unprivileged verification and registry preflight/,
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
    () => validateReleaseWorkflow(JSON.stringify(workflow)),
    /audit action actions\/checkout@v4 must use a full commit SHA/,
  );
});

test("mutable reusable sibling workflows cannot bypass pinning", async () => {
  const releaseWorkflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const workflow = parse(releaseWorkflow);
  workflow.jobs.audit = {
    uses: "example/repo/.github/workflows/audit.yml@v1",
  };

  assert.throws(
    () => validateReleaseWorkflow(JSON.stringify(workflow)),
    /audit reusable workflow .* must use a full commit SHA/,
  );
});

test("every declared universal and Arcanada task prefix is rejected", () => {
  for (const prefix of INTERNAL_TASK_PREFIXES) {
    assert.match(`${prefix}-0001`, INTERNAL_TASK_ID_PATTERN);
  }
});

test("previously omitted task-ID families cannot bypass detection", () => {
  for (const taskId of [
    "SHARED-0001",
    "CUBR-0067",
    "CTRL-0027",
    "QCK-0001",
    "STATUS-0001",
  ]) {
    assert.match(taskId, INTERNAL_TASK_ID_PATTERN);
  }
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
