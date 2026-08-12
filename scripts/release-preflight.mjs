#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REGISTRY_URL = "https://registry.npmjs.org";
const PACKAGE_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const RELEASE_PACKAGES = Object.freeze(
  [
    {
      name: "@arcanada/access-contracts",
      directory: "packages/access-contracts",
    },
    {
      name: "@arcanada/eslint-config",
      directory: "packages/eslint-config",
    },
    {
      name: "@arcanada/logger",
      directory: "packages/logger",
    },
    {
      name: "@arcanada/nest-common",
      directory: "packages/nest-common",
    },
    {
      name: "@arcanada/tsconfig",
      directory: "packages/tsconfig",
    },
  ].map(Object.freeze),
);

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const listPendingChangesets = async (rootDir) =>
  (await readdir(join(rootDir, ".changeset")))
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .sort();

const readPublishablePackages = async (rootDir) => {
  const packageRoot = join(rootDir, "packages");
  const entries = await readdir(packageRoot, { withFileTypes: true });
  const discovered = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directory = join("packages", entry.name);
    const manifestPath = join(rootDir, directory, "package.json");
    let manifest;
    try {
      manifest = await readJson(manifestPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    if (manifest.private !== true) {
      discovered.push({
        directory,
        name: manifest.name,
        version: manifest.version,
        access: manifest.publishConfig?.access,
      });
    }
  }

  return discovered.sort((left, right) => left.name.localeCompare(right.name));
};

const validateAllowlist = async (rootDir) => {
  const discovered = await readPublishablePackages(rootDir);
  const expected = [...RELEASE_PACKAGES].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const mismatch =
    discovered.length !== expected.length ||
    expected.some(
      (entry, index) =>
        discovered[index]?.name !== entry.name ||
        discovered[index]?.directory !== entry.directory,
    );

  if (mismatch) {
    const expectedSummary = expected
      .map(({ name, directory }) => `${name}=${directory}`)
      .join(", ");
    const discoveredSummary = discovered
      .map(({ name, directory }) => `${name ?? "<missing-name>"}=${directory}`)
      .join(", ");
    throw new Error(
      `RELEASE_ALLOWLIST_MISMATCH: expected [${expectedSummary}], discovered [${discoveredSummary}].`,
    );
  }

  for (const entry of discovered) {
    if (entry.access !== "public") {
      throw new Error(
        `RELEASE_ALLOWLIST_MISMATCH: ${entry.name} must declare publishConfig.access=public.`,
      );
    }
    if (
      typeof entry.version !== "string" ||
      !PACKAGE_VERSION_PATTERN.test(entry.version)
    ) {
      throw new Error(
        `RELEASE_ALLOWLIST_MISMATCH: ${entry.name} has invalid version ${JSON.stringify(entry.version)}.`,
      );
    }
  }

  return discovered;
};

const fetchPackageMetadata = async ({ fetchImpl, packageInfo }) => {
  const url = `${REGISTRY_URL}/${encodeURIComponent(packageInfo.name)}`;
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(
      `REGISTRY_CHECK_FAILED: ${packageInfo.name}: ${error.message}. No publish was attempted.`,
      { cause: error },
    );
  }

  if (response.status === 404) {
    return { ...packageInfo, state: "absent", versions: [] };
  }
  if (!response.ok) {
    throw new Error(
      `REGISTRY_CHECK_FAILED: npm returned HTTP ${response.status} for ${packageInfo.name}. No publish was attempted.`,
    );
  }

  const metadata = await response.json();
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    metadata.versions === null ||
    typeof metadata.versions !== "object" ||
    Array.isArray(metadata.versions)
  ) {
    throw new Error(
      `REGISTRY_CHECK_FAILED: npm returned malformed metadata for ${packageInfo.name}. No publish was attempted.`,
    );
  }

  return {
    ...packageInfo,
    state: "present",
    versions: Object.keys(metadata.versions),
  };
};

export const runReleasePreflight = async ({
  rootDir = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) => {
  const publishablePackages = await validateAllowlist(rootDir);
  const pendingChangesets = await listPendingChangesets(rootDir);
  if (pendingChangesets.length > 0) {
    logger.log(
      `RELEASE_PREFLIGHT: Version-PR mode; ${pendingChangesets.length} pending changeset file(s), so no npm publish will run.`,
    );
    return { mode: "version", pendingChangesets };
  }

  const registryState = await Promise.all(
    publishablePackages.map((packageInfo) =>
      fetchPackageMetadata({ fetchImpl, packageInfo }),
    ),
  );
  const absentPackages = registryState.filter(
    ({ state }) => state === "absent",
  );

  if (absentPackages.length > 0) {
    const absentSummary = absentPackages
      .map(({ name, version }) => `${name}@${version}`)
      .join(", ");
    throw new Error(
      `BOOTSTRAP_REQUIRED: npm has no package record for ${absentSummary}. Trusted publishing cannot bootstrap a package that does not yet exist. Follow .changeset/README.md under the OPERATOR boundary. No publish was attempted.`,
    );
  }

  const candidates = registryState
    .filter(({ version, versions }) => !versions.includes(version))
    .map(({ name, version }) => ({ name, version }));

  logger.log(
    candidates.length === 0
      ? "RELEASE_PREFLIGHT: publish mode has no unpublished allowlisted versions."
      : `RELEASE_PREFLIGHT: publish mode candidates: ${candidates
          .map(({ name, version }) => `${name}@${version}`)
          .join(", ")}.`,
  );
  return { mode: "publish", candidates };
};

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1]))
  : null;
if (invokedPath?.href === import.meta.url) {
  runReleasePreflight().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
