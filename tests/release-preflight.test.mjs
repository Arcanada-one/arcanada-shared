import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  RELEASE_PACKAGES,
  runReleasePreflight,
} from "../scripts/release-preflight.mjs";

const createFixture = async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "arcanada-release-preflight-"));
  await mkdir(join(rootDir, ".changeset"), { recursive: true });

  for (const entry of RELEASE_PACKAGES) {
    const packageDir = join(rootDir, entry.directory);
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      `${JSON.stringify(
        {
          name: entry.name,
          version: entry.name === "@arcanada/logger" ? "0.1.0" : "0.2.0",
          private: false,
          publishConfig: { access: "public" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  return rootDir;
};

const response = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test("pending changesets select Version-PR mode without querying npm", async (t) => {
  const rootDir = await createFixture();
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await writeFile(
    join(rootDir, ".changeset", "pending.md"),
    '---\n"@arcanada/logger": minor\n---\n\nPublic release note.\n',
    "utf8",
  );

  const result = await runReleasePreflight({
    rootDir,
    fetchImpl: async () => {
      throw new Error("registry must not be called in Version-PR mode");
    },
    logger: { log() {} },
  });

  assert.deepEqual(result, {
    mode: "version",
    pendingChangesets: ["pending.md"],
  });
});

test("publish mode fails closed when any allowlisted package is absent", async (t) => {
  const rootDir = await createFixture();
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  await assert.rejects(
    runReleasePreflight({
      rootDir,
      fetchImpl: async () => response(404),
      logger: { log() {} },
    }),
    (error) => {
      assert.match(error.message, /BOOTSTRAP_REQUIRED/);
      for (const { name } of RELEASE_PACKAGES) {
        assert.match(error.message, new RegExp(name.replace("/", "\\/")));
      }
      assert.match(error.message, /No publish was attempted/);
      return true;
    },
  );
});

test("publish mode reports only allowlisted unpublished versions", async (t) => {
  const rootDir = await createFixture();
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  const result = await runReleasePreflight({
    rootDir,
    fetchImpl: async (url) => {
      const packageName = decodeURIComponent(new URL(url).pathname.slice(1));
      const entry = RELEASE_PACKAGES.find(({ name }) => name === packageName);
      assert.ok(entry, `unexpected registry lookup: ${packageName}`);
      const versions =
        packageName === "@arcanada/logger" ? { "0.0.1": {} } : { "0.2.0": {} };
      return response(200, { versions });
    },
    logger: { log() {} },
  });

  assert.deepEqual(result, {
    mode: "publish",
    candidates: [{ name: "@arcanada/logger", version: "0.1.0" }],
  });
});

test("allowlist manifest mismatch fails before registry access", async (t) => {
  const rootDir = await createFixture();
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const first = RELEASE_PACKAGES[0];
  await writeFile(
    join(rootDir, first.directory, "package.json"),
    `${JSON.stringify({
      name: "@arcanada/unreviewed",
      version: "1.0.0",
      publishConfig: { access: "public" },
    })}\n`,
    "utf8",
  );

  await assert.rejects(
    runReleasePreflight({
      rootDir,
      fetchImpl: async () => {
        throw new Error("registry must not be called for an invalid allowlist");
      },
      logger: { log() {} },
    }),
    /RELEASE_ALLOWLIST_MISMATCH/,
  );
});

test("registry errors fail closed instead of being treated as absence", async (t) => {
  const rootDir = await createFixture();
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  await assert.rejects(
    runReleasePreflight({
      rootDir,
      fetchImpl: async () => response(503),
      logger: { log() {} },
    }),
    /REGISTRY_CHECK_FAILED.*503/,
  );
});

test("registry transport failures use a fail-closed diagnostic", async (t) => {
  const rootDir = await createFixture();
  t.after(() => rm(rootDir, { recursive: true, force: true }));

  await assert.rejects(
    runReleasePreflight({
      rootDir,
      fetchImpl: async () => {
        throw new Error("socket unavailable");
      },
      logger: { log() {} },
    }),
    /REGISTRY_CHECK_FAILED.*socket unavailable.*No publish was attempted/,
  );
});

test("operator bootstrap boundary is documented without a stored token", async () => {
  const documentation = await readFile(
    new URL("../.changeset/README.md", import.meta.url),
    "utf8",
  );

  assert.match(documentation, /BOOTSTRAP_REQUIRED/);
  assert.match(documentation, /OPERATOR/);
  assert.match(
    documentation,
    /never stored in GitHub Actions or this\s+repository/,
  );
});
