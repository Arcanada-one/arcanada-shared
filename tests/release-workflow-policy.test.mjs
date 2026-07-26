import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";
import {
  INTERNAL_TASK_ID_PATTERN,
  INTERNAL_TASK_PREFIXES,
  isGlobalToolchainMutation,
  normalizeShellCommand,
} from "../scripts/release-policy.mjs";

const RELEASE_NODE_VERSION = "22.23.1";
const RELEASE_NPM_VERSION = "11.18.0";
const NPM_REGISTRY = "https://registry.npmjs.org";
const RELEASE_ARTIFACT_NAME = "release-plan-${{ github.sha }}";
const PINNED_ACTION_PATTERN = /^[^@\s]+@[0-9a-f]{40}$/;
const PRIVILEGED_JOB_KEYS = ["if", "needs", "permissions", "runs-on", "steps"];
const PRIVILEGED_STEP_ALLOWLIST = {
  "version-pr": [
    {
      kind: "action",
      keys: ["uses", "with"],
      uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      with: { "persist-credentials": false },
    },
    {
      kind: "action",
      keys: ["uses", "with"],
      uses: "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
      with: {
        name: RELEASE_ARTIFACT_NAME,
        path: "${{ runner.temp }}/release-artifact",
      },
    },
    {
      kind: "run",
      keys: ["env", "name", "run"],
      name: "Verify and restore version plan",
      runSha256:
        "4e029a13152db68fefc9004786ba284ee156436c1063f32c37cc37e5e32ed2bb",
      env: {
        RELEASE_ARCHIVE: "release-plan-${{ github.sha }}.tar.gz",
      },
    },
    {
      kind: "run",
      keys: ["env", "name", "run"],
      name: "Open a fresh Version Packages pull request",
      runSha256:
        "58e5d4f647ab7cd8d89dba55236f7ad31fd1aaae5781c609a0ea54102a4dd354",
      env: {
        GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
        GH_REPO: "${{ github.repository }}",
        RELEASE_BRANCH: "changeset-release/${{ github.sha }}",
      },
    },
  ],
  publish: [
    {
      kind: "action",
      keys: ["uses", "with"],
      uses: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      with: {
        "node-version": RELEASE_NODE_VERSION,
        "package-manager-cache": false,
        "registry-url": NPM_REGISTRY,
      },
    },
    {
      kind: "run",
      keys: ["name", "run"],
      name: "Ensure npm supports trusted publishing",
      runSha256:
        "a16e577dc0083813577f02572b1638388f68ce69b13b1fec5fd8144d75dc370c",
      env: {},
    },
    {
      kind: "action",
      keys: ["uses", "with"],
      uses: "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
      with: {
        name: RELEASE_ARTIFACT_NAME,
        path: "${{ runner.temp }}/release-artifact",
      },
    },
    {
      kind: "run",
      keys: ["env", "name", "run"],
      name: "Verify and restore publish plan",
      runSha256:
        "d5f8abdc93f5fe8eecacdb9a7e296abb7b258e35c8419ea89aade596bd2fc3fc",
      env: {
        RELEASE_ARCHIVE: "release-plan-${{ github.sha }}.tar.gz",
      },
    },
    {
      kind: "run",
      keys: ["env", "name", "run"],
      name: "Publish only validated package tarballs",
      runSha256:
        "3c89d51d5a00cf71e5cf2dffae4d571a8643f3d55ce89ee0ac793c02097598e4",
      env: {
        GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
        GH_REPO: "${{ github.repository }}",
      },
    },
  ],
};

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
};

const assertArtifactDownload = (steps, jobName) => {
  const download = assertOne(
    findActionSteps(steps, "actions/download-artifact"),
    `${jobName} must download exactly one prepared release plan`,
  );
  assert.equal(download.step.with?.name, RELEASE_ARTIFACT_NAME);
  assertOne(
    findRunSteps(steps, /sha256sum --check/),
    `${jobName} must verify the release-plan checksum`,
  );
};

const privilegedStepShape = (step) => {
  const keys = Object.keys(step).sort();
  if (typeof step?.uses === "string") {
    return {
      kind: "action",
      keys,
      uses: step.uses,
      with: step.with ?? {},
    };
  }
  if (typeof step?.run === "string") {
    return {
      kind: "run",
      keys,
      name: step.name ?? "",
      runSha256: createHash("sha256").update(step.run).digest("hex"),
      env: step.env ?? {},
    };
  }
  return { kind: "unknown", keys };
};

const assertPrivilegedStepAllowlist = (jobName, job) => {
  assert.deepEqual(
    Object.keys(job ?? {}).sort(),
    PRIVILEGED_JOB_KEYS,
    `${jobName} privileged step allowlist rejects unknown job-level configuration`,
  );
  assert.deepEqual(
    (job?.steps ?? []).map(privilegedStepShape),
    PRIVILEGED_STEP_ALLOWLIST[jobName],
    `${jobName} privileged step allowlist rejects unknown, reordered, or credential-bearing steps`,
  );
};

const validateReleaseWorkflow = (source) => {
  const workflow = parse(source);
  const prepareJob = workflow?.jobs?.prepare;
  const versionJob = workflow?.jobs?.["version-pr"];
  const publishJob = workflow?.jobs?.publish;
  const prepareSteps = prepareJob?.steps;
  const versionSteps = versionJob?.steps;
  const publishSteps = publishJob?.steps;

  assert.deepEqual(
    workflow.permissions,
    {},
    "release workflow must default the token to no permissions",
  );
  assert.deepEqual(
    workflow.concurrency,
    {
      group: "${{ github.workflow }}-${{ github.ref }}",
      "cancel-in-progress": false,
    },
    "release concurrency must serialize without cancelling an in-flight publish",
  );
  assert.deepEqual(prepareJob?.permissions, { contents: "read" });
  assert.equal(prepareJob?.outputs?.mode, "${{ steps.plan.outputs.mode }}");
  assert.deepEqual(versionJob?.permissions, {
    contents: "write",
    "pull-requests": "write",
  });
  assert.deepEqual(publishJob?.permissions, {
    contents: "write",
    "id-token": "write",
  });
  assert.equal(versionJob?.needs, "prepare");
  assert.equal(publishJob?.needs, "prepare");
  assert.equal(versionJob?.if, "needs.prepare.outputs.mode == 'version'");
  assert.equal(publishJob?.if, "needs.prepare.outputs.mode == 'publish'");
  assert.equal(prepareJob?.["runs-on"], "ubuntu-latest");
  assert.equal(versionJob?.["runs-on"], "ubuntu-latest");
  assert.equal(publishJob?.["runs-on"], "ubuntu-latest");
  assert.ok(Array.isArray(prepareSteps));
  assert.ok(Array.isArray(versionSteps));
  assert.ok(Array.isArray(publishSteps));

  assertPinnedUses(workflow);
  assertPrivilegedStepAllowlist("version-pr", versionJob);
  assertPrivilegedStepAllowlist("publish", publishJob);
  assertCheckoutDoesNotPersistCredentials(prepareSteps, "prepare");
  assertCheckoutDoesNotPersistCredentials(versionSteps, "version-pr");
  assert.equal(
    findActionSteps(publishSteps, "actions/checkout").length,
    0,
    "publish must not check out or execute repository content",
  );

  const prepareNode = assertOne(
    findActionSteps(prepareSteps, "actions/setup-node"),
    "prepare must define exactly one Node setup",
  );
  assert.equal(
    String(prepareNode.step.with?.["node-version"]),
    RELEASE_NODE_VERSION,
  );
  for (const [pattern, message] of [
    [/^pnpm install --frozen-lockfile$/, "frozen install"],
    [/^pnpm lint$/, "lint"],
    [/^pnpm typecheck$/, "typecheck"],
    [/^pnpm build$/, "build"],
    [/^pnpm test$/, "complete test suite"],
    [/^pnpm audit --audit-level=high$/, "full audit"],
    [/^node scripts\/prepare-release-plan\.mjs$/, "release-plan preparation"],
  ]) {
    assertOne(
      findRunSteps(prepareSteps, pattern),
      `prepare must run exactly one ${message}`,
    );
  }
  const audit = assertOne(
    findRunSteps(prepareSteps, /^pnpm audit --audit-level=high$/),
    "prepare must run the full high-severity audit",
  );
  assert.doesNotMatch(String(audit.step.run), /--prod(?:uction)?\b/);
  const planStep = assertOne(
    prepareSteps
      .map((step, index) => ({ index, step }))
      .filter(({ step }) => step?.id === "plan"),
    "prepare must expose exactly one release-plan output step",
  );
  assert.equal(planStep.step.run, "node scripts/prepare-release-plan.mjs");
  const upload = assertOne(
    findActionSteps(prepareSteps, "actions/upload-artifact"),
    "prepare must upload exactly one immutable release plan",
  );
  assert.equal(upload.step.with?.name, RELEASE_ARTIFACT_NAME);
  assert.equal(upload.step.with?.["if-no-files-found"], "error");
  assert.equal(upload.step.with?.overwrite, false);

  assertArtifactDownload(versionSteps, "version-pr");
  assertArtifactDownload(publishSteps, "publish");
  assertOne(
    findRunSteps(versionSteps, /git apply --index/),
    "version-pr must apply only the prepared version patch",
  );
  assertOne(
    findRunSteps(versionSteps, /gh pr create/),
    "version-pr must create a fresh pull request",
  );
  assertOne(
    findRunSteps(versionSteps, /gh pr close/),
    "version-pr must supersede stale Version Packages pull requests",
  );
  assert.equal(
    findRunSteps(versionSteps, /(?:--force|-f)\b/).length,
    0,
    "version-pr must never force-push",
  );

  const publishNode = assertOne(
    findActionSteps(publishSteps, "actions/setup-node"),
    "publish must define exactly one Node setup",
  );
  assert.equal(
    String(publishNode.step.with?.["node-version"]),
    RELEASE_NODE_VERSION,
  );
  assert.equal(publishNode.step.with?.["registry-url"], NPM_REGISTRY);
  const mutations = publishSteps
    .map((step, index) => ({ index, step }))
    .filter(({ step }) => isGlobalToolchainMutation(step?.run));
  const npmSetup = assertOne(
    mutations,
    "publish must define exactly one global toolchain mutation",
  );
  assert.equal(
    normalizeShellCommand(npmSetup.step.run),
    `npm install --global --ignore-scripts npm@${RELEASE_NPM_VERSION}`,
  );
  assertOne(
    findRunSteps(
      publishSteps,
      /npm publish "\$package_file" --access public --provenance --ignore-scripts/,
    ),
    "publish must publish only prepared tarball files without scripts",
  );
  assertOne(
    findRunSteps(publishSteps, /grep -aERq.*INFRA.*DISK/s),
    "publish must independently reject task IDs in tarball content",
  );

  for (const [jobName, steps] of [
    ["version-pr", versionSteps],
    ["publish", publishSteps],
  ]) {
    const usesChangesets = findActionSteps(steps, "changesets/action");
    assert.equal(
      usesChangesets.length,
      0,
      `${jobName} must not execute Changesets`,
    );
    for (const { step } of findRunSteps(
      steps,
      /\bpnpm\b|\bnpm\s+(?:ci|add|i)\b|\bnpm\s+install(?! --global --ignore-scripts npm@11\.18\.0\b)/,
    )) {
      assert.fail(
        `${jobName} must not install or execute repository dependencies: ${step.run}`,
      );
    }
  }
};

test("release workflow prepares code read-only and publishes without repo dependencies", async () => {
  validateReleaseWorkflow(
    await readFile(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    ),
  );
});

test("duplicate Node setup cannot shadow either release toolchain", async () => {
  const workflow = parse(
    await readFile(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    ),
  );
  workflow.jobs.publish.steps.unshift({
    uses: `actions/setup-node@${"a".repeat(40)}`,
    with: { "node-version": RELEASE_NODE_VERSION },
  });
  assert.throws(
    () => validateReleaseWorkflow(JSON.stringify(workflow)),
    /privileged step allowlist/,
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
  [
    "multiline npm continuation",
    String.raw`npm install \
      --global npm@latest`,
  ],
  [
    "multiline npm location",
    String.raw`sudo npm \
      --location global \
      install npm@latest`,
  ],
  [
    "multiline pnpm continuation",
    String.raw`pnpm \
      add npm@latest \
      -g`,
  ],
]) {
  test(`${label} cannot shadow the publishing toolchain`, async () => {
    assert.equal(
      isGlobalToolchainMutation(mutation),
      true,
      `mutation classifier missed ${JSON.stringify(mutation)}`,
    );
    const workflow = parse(
      await readFile(
        new URL("../.github/workflows/release.yml", import.meta.url),
        "utf8",
      ),
    );
    workflow.jobs.publish.steps.push({
      name: "Shadow toolchain",
      run: mutation,
    });
    assert.throws(
      () => validateReleaseWorkflow(JSON.stringify(workflow)),
      /privileged step allowlist/,
    );
  });
}

test("publish cannot bypass the read-only release-plan dependency", async () => {
  const workflow = parse(
    await readFile(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    ),
  );
  workflow.jobs.publish.needs = [];
  assert.throws(
    () => validateReleaseWorkflow(JSON.stringify(workflow)),
    /Expected values to be strictly equal/,
  );
});

test("mutable actions in sibling release jobs cannot bypass pinning", async () => {
  const workflow = parse(
    await readFile(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    ),
  );
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
  const workflow = parse(
    await readFile(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    ),
  );
  workflow.jobs.audit = {
    uses: "example/repo/.github/workflows/audit.yml@v1",
  };
  assert.throws(
    () => validateReleaseWorkflow(JSON.stringify(workflow)),
    /audit reusable workflow .* must use a full commit SHA/,
  );
});

for (const [label, jobName, injectedStep] of [
  [
    "arbitrary curl run",
    "version-pr",
    { name: "Exfiltrate", run: "curl https://example.invalid" },
  ],
  [
    "arbitrary bash run",
    "publish",
    { name: "Injected shell", run: "bash -c 'echo unexpected'" },
  ],
  [
    "unknown pinned action",
    "publish",
    { uses: `attacker/example@${"a".repeat(40)}` },
  ],
  [
    "extra npm publish",
    "publish",
    {
      name: "Surprise publish",
      run: "npm publish unexpected.tgz --access public",
    },
  ],
]) {
  test(`${label} cannot enter a privileged job`, async () => {
    const workflow = parse(
      await readFile(
        new URL("../.github/workflows/release.yml", import.meta.url),
        "utf8",
      ),
    );
    workflow.jobs[jobName].steps.push(injectedStep);
    assert.throws(
      () => validateReleaseWorkflow(JSON.stringify(workflow)),
      /privileged step allowlist/,
    );
  });
}

test("reordered allowed steps cannot enter a privileged job", async () => {
  const workflow = parse(
    await readFile(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    ),
  );
  const steps = workflow.jobs.publish.steps;
  [steps[1], steps[2]] = [steps[2], steps[1]];
  assert.throws(
    () => validateReleaseWorkflow(JSON.stringify(workflow)),
    /privileged step allowlist/,
  );
});

test("credential-bearing changes cannot enter an allowed privileged step", async () => {
  const workflow = parse(
    await readFile(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    ),
  );
  workflow.jobs["version-pr"].steps[2].env.EXTRA_TOKEN =
    "${{ secrets.EXTRA_TOKEN }}";
  assert.throws(
    () => validateReleaseWorkflow(JSON.stringify(workflow)),
    /privileged step allowlist/,
  );
});

for (const command of [
  "corepack enable",
  "corepack disable",
  String.raw`sudo corepack \
    enable`,
  String.raw`corepack \
    disable`,
]) {
  test(`${command} is a blocked toolchain mutation`, () => {
    assert.equal(isGlobalToolchainMutation(command), true);
  });
}

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
