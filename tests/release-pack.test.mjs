import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  inspectPackedTarball,
  packReleaseTarball,
} from "../scripts/prepare-release-plan.mjs";
const exec = promisify(execFile);

test("catalog packing uses artifact metadata despite noisy lifecycle output", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "release-pack-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pkg = join(root, "packages", "eslint-config");
  const out = join(root, "out");
  await mkdir(pkg, { recursive: true });
  await mkdir(out);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ private: true, packageManager: "pnpm@11.17.0" }),
  );
  await writeFile(
    join(root, "pnpm-workspace.yaml"),
    "packages:\n  - packages/*\ncatalog:\n  dep: 1.2.3\ncatalogs:\n  named:\n    peer: ^2.0.0\n",
  );
  const manifest = {
    name: "@arcanada/eslint-config",
    version: "0.0.1",
    publishConfig: { access: "public" },
    dependencies: { dep: "catalog:" },
    peerDependencies: { peer: "catalog:named" },
    exports: "./index.js",
    scripts: {
      prepare:
        "node -e \"console.log('CLI Building... {not JSON} [noise]'); require('fs').writeFileSync('index.js', 'module.exports = 42;')\"",
    },
  };
  const original = JSON.stringify(manifest);
  await writeFile(join(pkg, "package.json"), original);
  const filename = await packReleaseTarball({
    packageDir: pkg,
    outputDir: out,
    name: manifest.name,
    version: manifest.version,
  });
  const tarball = join(out, filename);
  const { stdout } = await exec("tar", [
    "-xOf",
    tarball,
    "package/package.json",
  ]);
  const packed = JSON.parse(stdout);
  assert.equal(packed.dependencies.dep, "1.2.3");
  assert.equal(packed.peerDependencies.peer, "^2.0.0");
  assert.equal(await readFile(join(pkg, "package.json"), "utf8"), original);
  const first = await readFile(tarball);
  await packReleaseTarball({
    packageDir: pkg,
    outputDir: out,
    name: manifest.name,
    version: manifest.version,
  });
  assert.deepEqual(
    await readFile(tarball),
    first,
    "repeated packing is byte deterministic",
  );
});

for (const [
  label,
  extra,
  pattern,
] of /** @type {[string, Record<string, unknown>, RegExp][]} */ ([
  [
    "retained catalog",
    { dependencies: { dep: "catalog:" } },
    /unresolved dependency/,
  ],
  [
    "retained named peer catalog",
    { peerDependencies: { dep: "catalog:named" } },
    /unresolved dependency/,
  ],
  [
    "missing export",
    { exports: { ".": { import: "./missing.js" } } },
    /missing or unsafe export/,
  ],
])) {
  test(`archive inspection rejects ${label}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "invalid-release-pack-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, "package"));
    await writeFile(
      join(root, "package/package.json"),
      JSON.stringify({
        name: "@arcanada/logger",
        version: "0.1.0",
        publishConfig: { access: "public" },
        ...extra,
      }),
    );
    const tarball = join(root, "bad.tgz");
    await exec("tar", ["-czf", tarball, "-C", root, "package"]);
    await assert.rejects(
      inspectPackedTarball({
        tarball,
        expectedName: "@arcanada/logger",
        expectedVersion: "0.1.0",
      }),
      pattern,
    );
  });
}

for (const [label, exports] of /** @type {[string, unknown][]} */ ([
  ["root string", "index.js"],
  ["nested condition", { ".": { import: "./index.js", default: "index.js" } }],
  ["array fallback", { ".": ["./index.js", "index.js"] }],
])) {
  test(`packing rejects bare exports ${label} before artifact replacement and removes staging`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "bare-export-pack-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const pkg = join(root, "pkg");
    const out = join(root, "out");
    await mkdir(pkg);
    await mkdir(out);
    await writeFile(
      join(pkg, "package.json"),
      JSON.stringify({
        name: "@arcanada/logger",
        version: "0.1.0",
        publishConfig: { access: "public" },
        exports,
      }),
    );
    await writeFile(join(pkg, "index.js"), "module.exports = 42;\n");
    const artifact = join(out, "logger.tgz");
    const previous = Buffer.from("previous artifact must survive");
    await writeFile(artifact, previous);
    // Collect the outcome so preservation and cleanup are checked even on the unfixed code.
    let failure;
    try {
      await packReleaseTarball({
        packageDir: pkg,
        outputDir: out,
        name: "@arcanada/logger",
        version: "0.1.0",
      });
    } catch (error) {
      failure = error;
    }
    assert.deepEqual(await readdir(out), ["logger.tgz"], "staging removed");
    assert.deepEqual(
      await readFile(artifact),
      previous,
      "old artifact preserved",
    );
    assert.ok(failure instanceof Error, "invalid bare export rejected");
    assert.match(failure.message, /export target must start with \.\//);
  });
}

test("packing accepts bare main module and types paths", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bare-main-pack-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pkg = join(root, "pkg");
  const out = join(root, "out");
  await mkdir(pkg);
  await mkdir(out);
  await writeFile(
    join(pkg, "package.json"),
    JSON.stringify({
      name: "@arcanada/logger",
      version: "0.1.0",
      publishConfig: { access: "public" },
      main: "index.js",
      module: "index.mjs",
      types: "index.d.ts",
    }),
  );
  await writeFile(join(pkg, "index.js"), "module.exports = 42;\n");
  await writeFile(join(pkg, "index.mjs"), "export default 42;\n");
  await writeFile(
    join(pkg, "index.d.ts"),
    "declare const value: number; export default value;\n",
  );
  const filename = await packReleaseTarball({
    packageDir: pkg,
    outputDir: out,
    name: "@arcanada/logger",
    version: "0.1.0",
  });
  assert.equal(filename, "logger.tgz");
  assert.deepEqual(await readdir(out), [filename], "staging removed");
  const { stdout } = await exec("tar", [
    "-xOf",
    join(out, filename),
    "package/package.json",
  ]);
  const manifest = JSON.parse(stdout);
  assert.equal(manifest.main, "index.js");
  assert.equal(manifest.module, "index.mjs");
  assert.equal(manifest.types, "index.d.ts");
});
