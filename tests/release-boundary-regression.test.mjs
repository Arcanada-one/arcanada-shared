import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { parse } from "yaml";
import { inspectPackedTarball } from "../scripts/prepare-release-plan.mjs";
import { isGlobalToolchainMutation } from "../scripts/release-policy.mjs";

const execFileAsync = promisify(execFile);
const TASK_ID_PATTERN =
  /\b(?:INFRA|WEB|DEV|DEVOPS|CONTENT|RESEARCH|AGENT|BENCH|MAINT|FIN|QA|SEC|QCK|TUNE|ROB|DATA|ARCA|CUBR|VERD|AUTH|BILL|CONV|MUN|TRANS|SUP|OVER|CONS|VOICE|LTM|SRCH|CONN|ARGA|EMAIL|ARAS|STATUS|ADSR|LEGAL|PUB|SPACE|SHARED|CTRL|WIKI|DISK)-\d{4}\b/;
const REPO_DEPENDENCY_COMMAND =
  /\bpnpm\b|\bchangesets?\b|\bnpm\s+(?:ci|add|i)\b|\bnpm\s+install(?! --global --ignore-scripts npm@11\.18\.0\b)/;

/** @returns {Promise<import('./workflow-types.js').Workflow>} */
const readWorkflow = async () =>
  parse(
    await readFile(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    ),
  );

test("write-capable release jobs never install or execute repository dependencies", async () => {
  const workflow = await readWorkflow();
  const prepare = workflow.jobs?.prepare;
  const versionPr = workflow.jobs?.["version-pr"];
  const publish = workflow.jobs?.publish;

  assert.deepEqual(prepare?.permissions, { contents: "read" });
  assert.equal(prepare?.outputs?.mode, "${{ steps.plan.outputs.mode }}");
  assert.ok(
    prepare?.steps?.some(
      (step) => step.run === "pnpm install --frozen-lockfile",
    ),
  );
  assert.ok(
    prepare?.steps?.some(
      (step) => step.run === "node scripts/prepare-release-plan.mjs",
    ),
  );

  assert.deepEqual(versionPr?.permissions, {
    contents: "write",
    "pull-requests": "write",
  });
  assert.deepEqual(publish?.permissions, {
    contents: "write",
    "id-token": "write",
  });
  assert.equal(versionPr?.if, "needs.prepare.outputs.mode == 'version'");
  assert.equal(publish?.if, "needs.prepare.outputs.mode == 'publish'");

  for (const [
    jobName,
    job,
  ] of /** @type {[string, import('./workflow-types.js').Job][]} */ ([
    ["version-pr", versionPr],
    ["publish", publish],
  ])) {
    const commands = (job?.steps ?? [])
      .map((step) => String(step.run ?? ""))
      .join("\n");
    assert.doesNotMatch(
      commands,
      REPO_DEPENDENCY_COMMAND,
      `${jobName} must consume prepared data without repository dependencies`,
    );
    assert.equal(
      (job?.steps ?? []).some(
        (step) => step.uses?.split("@", 1)[0] === "changesets/action",
      ),
      false,
      `${jobName} must not execute Changesets in a write-capable job`,
    );
  }

  const publishCommands = publish.steps
    .map((step) => String(step.run ?? ""))
    .join("\n");
  assert.match(
    publishCommands,
    /npm publish "\$package_file" --access public --provenance --ignore-scripts/,
  );
});

test("shell-normalized mutation detection catches multiline global installs", () => {
  for (const command of [
    String.raw`npm install \
      --global npm@latest`,
    String.raw`sudo npm \
      --location global \
      install npm@latest`,
    String.raw`pnpm \
      add npm@latest \
      -g`,
  ]) {
    assert.equal(
      isGlobalToolchainMutation(command),
      true,
      `missed normalized mutation ${JSON.stringify(command)}`,
    );
  }
});

/**
 * `npm pack --json` prints an array of results (npm up to 11) or an object keyed by
 * package name (npm 12). Anything else, or not exactly one result, is refused.
 * @param {string} stdout
 * @returns {string}
 */
const packedFilename = (stdout) => {
  const parsed = JSON.parse(stdout);
  const results = Array.isArray(parsed)
    ? parsed
    : parsed !== null && typeof parsed === "object"
      ? Object.values(parsed)
      : [];
  const filename = results.length === 1 ? results[0]?.filename : undefined;
  if (typeof filename !== "string" || filename === "") {
    throw new Error("unexpected npm pack --json result shape");
  }
  return filename;
};

/**
 * Reads every entry of a tarball and fails when one carries an internal task ID.
 * @param {string} tarball
 */
const assertTarballHasNoTaskIds = async (tarball) => {
  const { stdout: entries } = await execFileAsync("tar", ["-tzf", tarball]);

  for (const entry of entries.trim().split("\n")) {
    const { stdout: content } = await execFileAsync(
      "tar",
      ["-xOf", tarball, entry],
      { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 },
    );
    assert.doesNotMatch(
      content.toString("utf8"),
      TASK_ID_PATTERN,
      `${entry} leaks an internal task ID into the publish tarball`,
    );
  }
};

test("npm pack --json parsing accepts the array and the package-keyed object shapes", () => {
  const result = { filename: "arcanada-logger-0.2.0.tgz" };
  assert.equal(packedFilename(JSON.stringify([result])), result.filename);
  assert.equal(
    packedFilename(JSON.stringify({ "@arcanada/logger": result })),
    result.filename,
  );
  for (const unexpected of [
    "[]",
    "{}",
    "null",
    "[1]",
    JSON.stringify([result, result]),
    JSON.stringify({ a: result, b: result }),
    JSON.stringify({ "@arcanada/logger": { filename: "" } }),
    JSON.stringify({ "@arcanada/logger": {} }),
  ]) {
    assert.throws(
      () => packedFilename(unexpected),
      /unexpected npm pack --json result shape/,
      `accepted ${unexpected}`,
    );
  }
});

test("the actual logger publish tarball contains no internal task IDs", async (t) => {
  const packageDirectory = new URL("../packages/logger/", import.meta.url);
  const packDirectory = await mkdtemp(join(tmpdir(), "arcanada-logger-pack-"));
  t.after(() => rm(packDirectory, { recursive: true, force: true }));

  await execFileAsync("pnpm", ["--dir", packageDirectory.pathname, "build"], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", packDirectory, "--json"],
    { cwd: packageDirectory, maxBuffer: 10 * 1024 * 1024 },
  );
  await assertTarballHasNoTaskIds(join(packDirectory, packedFilename(stdout)));
});

test("the tarball scan still fails when a tarball contains an internal task ID", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "arcanada-taskid-control-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const packageDirectory = join(fixture, "package");
  const tarball = join(fixture, "leaky.tgz");
  await mkdir(packageDirectory);
  await writeFile(
    join(packageDirectory, "README.md"),
    "Internal implementation reference: INFRA-0001.\n",
    "utf8",
  );
  await execFileAsync("tar", ["-czf", tarball, "-C", fixture, "package"]);

  await assert.rejects(
    assertTarballHasNoTaskIds(tarball),
    /leaks an internal task ID into the publish tarball/,
  );
});

test("release-plan preparation rejects a task ID embedded in a tarball", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "arcanada-malicious-pack-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const packageDirectory = join(fixture, "package");
  const tarball = join(fixture, "malicious.tgz");
  await mkdir(packageDirectory);
  await writeFile(
    join(packageDirectory, "package.json"),
    `${JSON.stringify({
      name: "@arcanada/logger",
      version: "0.1.0",
      publishConfig: { access: "public" },
    })}\n`,
    "utf8",
  );
  await writeFile(
    join(packageDirectory, "README.md"),
    "Internal implementation reference: AUTH-9999.\n",
    "utf8",
  );
  await execFileAsync("tar", ["-czf", tarball, "-C", fixture, "package"]);

  await assert.rejects(
    inspectPackedTarball({
      tarball,
      expectedName: "@arcanada/logger",
      expectedVersion: "0.1.0",
    }),
    /PUBLIC_PACKAGE_TASK_ID.*AUTH-9999/,
  );
});
