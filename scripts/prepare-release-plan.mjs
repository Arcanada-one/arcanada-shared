#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { RELEASE_PACKAGES, runReleasePreflight } from "./release-preflight.mjs";
import { findInternalTaskId } from "./release-policy.mjs";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOTS = new Set(
  RELEASE_PACKAGES.map(({ directory }) => directory),
);
const VERSION_FILE_PATTERN =
  /^packages\/[^/]+\/(?:CHANGELOG\.md|package\.json)$/;
const CHANGESET_FILE_PATTERN = /^\.changeset\/[^/]+\.md$/;

const run = async (file, args, options = {}) =>
  execFileAsync(file, args, {
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });

const writeOutput = async (name, value, outputPath) => {
  if (outputPath) {
    await appendFile(outputPath, `${name}=${value}\n`, "utf8");
  }
};

const assertTaskIdFree = (label, content) => {
  const taskId = findInternalTaskId(content);
  if (taskId) {
    throw new Error(
      `PUBLIC_PACKAGE_TASK_ID: ${label} contains internal identifier ${taskId}.`,
    );
  }
};

const validateVersionPath = (path) => {
  if (CHANGESET_FILE_PATTERN.test(path)) {
    return;
  }
  if (!VERSION_FILE_PATTERN.test(path)) {
    throw new Error(
      `VERSION_PLAN_SCOPE_VIOLATION: Changesets modified unexpected path ${path}.`,
    );
  }

  const packageRoot = path.split("/").slice(0, 2).join("/");
  if (!PACKAGE_ROOTS.has(packageRoot)) {
    throw new Error(
      `VERSION_PLAN_SCOPE_VIOLATION: Changesets modified non-allowlisted package ${packageRoot}.`,
    );
  }
};

const parseNameStatus = (output) => {
  const fields = output.split("\0").filter(Boolean);
  const changes = [];

  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    if (/^[RC]/.test(status)) {
      const from = fields[index++];
      const to = fields[index++];
      changes.push({ status, paths: [from, to] });
    } else {
      changes.push({ status, paths: [fields[index++]] });
    }
  }
  return changes;
};

const buildVersionPlan = async ({ rootDir, planDir }) => {
  await run("pnpm", ["exec", "changeset", "version"], { cwd: rootDir });
  const { stdout: nameStatus } = await run(
    "git",
    ["diff", "--name-status", "-z", "HEAD"],
    { cwd: rootDir },
  );
  const changes = parseNameStatus(nameStatus);
  const { stdout: untracked } = await run(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { cwd: rootDir },
  );
  const changedPaths = [
    ...changes.flatMap(({ paths }) => paths),
    ...untracked.split("\0").filter(Boolean),
  ];
  if (changedPaths.length === 0) {
    throw new Error(
      "VERSION_PLAN_EMPTY: Changesets produced no version update.",
    );
  }

  for (const path of changedPaths) {
    validateVersionPath(path);
  }

  const changedPackageRoots = new Set(
    changedPaths
      .filter((path) => VERSION_FILE_PATTERN.test(path))
      .map((path) => path.split("/").slice(0, 2).join("/")),
  );
  for (const packageRoot of changedPackageRoots) {
    for (const file of ["package.json", "CHANGELOG.md"]) {
      const path = join(rootDir, packageRoot, file);
      try {
        assertTaskIdFree(relative(rootDir, path), await readFile(path, "utf8"));
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    }
  }

  await run("git", ["add", "--all", "--", ...changedPaths], {
    cwd: rootDir,
  });
  const { stdout: patch } = await run(
    "git",
    ["diff", "--cached", "--binary", "--full-index", "HEAD"],
    { cwd: rootDir },
  );
  assertTaskIdFree("version.patch", patch);
  await writeFile(join(planDir, "version.patch"), patch, "utf8");
  await writeFile(
    join(planDir, "pr-body.md"),
    [
      "## Version updates",
      "",
      "This pull request was generated from reviewed Changesets in a read-only",
      "preparation job. Merging it publishes only checksum-verified, allowlisted",
      "package tarballs through npm OIDC Trusted Publishing.",
      "",
      "It supersedes earlier open Version Packages pull requests for the same",
      "base branch.",
      "",
    ].join("\n"),
    "utf8",
  );
};

export const inspectPackedTarball = async ({
  tarball,
  expectedName,
  expectedVersion,
}) => {
  const { stdout: listing } = await run("tar", ["-tzf", tarball]);
  const entries = listing.split("\n").filter(Boolean);
  if (
    entries.length === 0 ||
    entries.some(
      (entry) =>
        !entry.startsWith("package/") ||
        entry.startsWith("/") ||
        entry.split("/").includes(".."),
    )
  ) {
    throw new Error(
      `PACKAGE_TARBALL_INVALID: ${tarball} contains an unsafe archive path.`,
    );
  }

  for (const entry of entries.filter((path) => !path.endsWith("/"))) {
    const { stdout: content } = await run("tar", ["-xOf", tarball, entry], {
      encoding: "buffer",
    });
    assertTaskIdFree(`${expectedName}:${entry}`, content.toString("utf8"));
  }

  const { stdout: manifestSource } = await run("tar", [
    "-xOf",
    tarball,
    "package/package.json",
  ]);
  const manifest = JSON.parse(manifestSource);
  if (
    manifest.name !== expectedName ||
    manifest.version !== expectedVersion ||
    manifest.publishConfig?.access !== "public"
  ) {
    throw new Error(
      `PACKAGE_TARBALL_INVALID: expected ${expectedName}@${expectedVersion} with public access, found ${manifest.name}@${manifest.version}.`,
    );
  }
};

const extractReleaseNotes = async ({ rootDir, directory, version }) => {
  try {
    const changelog = await readFile(
      join(rootDir, directory, "CHANGELOG.md"),
      "utf8",
    );
    const marker = `## ${version}`;
    const start = changelog.indexOf(marker);
    if (start !== -1) {
      const next = changelog.indexOf("\n## ", start + marker.length);
      return changelog.slice(start, next === -1 ? undefined : next).trim();
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  return `Published ${version}.`;
};

const buildPublishPlan = async ({ rootDir, planDir, candidates }) => {
  const packageDirectory = join(planDir, "packages");
  const notesDirectory = join(planDir, "notes");
  await mkdir(packageDirectory, { recursive: true });
  await mkdir(notesDirectory, { recursive: true });
  const manifest = { packages: [] };

  for (const candidate of candidates) {
    const allowlisted = RELEASE_PACKAGES.find(
      ({ name }) => name === candidate.name,
    );
    if (!allowlisted) {
      throw new Error(
        `RELEASE_ALLOWLIST_MISMATCH: unexpected candidate ${candidate.name}.`,
      );
    }

    const { stdout } = await run(
      "npm",
      [
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        packageDirectory,
      ],
      { cwd: join(rootDir, allowlisted.directory) },
    );
    const result = JSON.parse(stdout);
    if (!Array.isArray(result) || result.length !== 1 || !result[0]?.filename) {
      throw new Error(
        `PACKAGE_TARBALL_INVALID: npm pack returned an unexpected result for ${candidate.name}.`,
      );
    }

    const filename = result[0].filename;
    if (filename.includes("/") || filename.includes(sep)) {
      throw new Error(
        `PACKAGE_TARBALL_INVALID: npm pack returned unsafe filename ${filename}.`,
      );
    }
    const tarball = join(packageDirectory, filename);
    await inspectPackedTarball({
      tarball,
      expectedName: candidate.name,
      expectedVersion: candidate.version,
    });
    const sha256 = createHash("sha256")
      .update(await readFile(tarball))
      .digest("hex");
    const notesFile = `${filename}.md`;
    const notes = await extractReleaseNotes({
      rootDir,
      directory: allowlisted.directory,
      version: candidate.version,
    });
    assertTaskIdFree(`${candidate.name}:release-notes`, notes);
    await writeFile(join(notesDirectory, notesFile), `${notes}\n`, "utf8");
    manifest.packages.push({
      name: candidate.name,
      version: candidate.version,
      file: `packages/${filename}`,
      notesFile: `notes/${notesFile}`,
      sha256,
    });
  }

  await writeFile(
    join(planDir, "publish-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
};

export const prepareReleasePlan = async ({
  rootDir = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  planDir = process.env.RELEASE_PLAN_DIR,
  outputPath = process.env.GITHUB_OUTPUT,
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) => {
  if (!planDir) {
    throw new Error("RELEASE_PLAN_DIR is required.");
  }
  await mkdir(planDir, { recursive: true });
  const preflight = await runReleasePreflight({
    rootDir,
    fetchImpl,
    logger,
  });
  const mode =
    preflight.mode === "publish" && preflight.candidates.length === 0
      ? "noop"
      : preflight.mode;
  await writeFile(join(planDir, "mode"), `${mode}\n`, "utf8");

  if (mode === "version") {
    await buildVersionPlan({ rootDir, planDir });
  } else if (mode === "publish") {
    await buildPublishPlan({
      rootDir,
      planDir,
      candidates: preflight.candidates,
    });
  }

  await writeOutput("mode", mode, outputPath);
  logger.log(`RELEASE_PLAN: prepared ${mode} plan.`);
  return { mode, planDir };
};

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1]))
  : null;
if (invokedPath?.href === import.meta.url) {
  prepareReleasePlan().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
