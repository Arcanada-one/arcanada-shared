import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const versionTuple = (version) => version.split(".").map(Number);

const atLeast = (actual, minimum) => {
  const actualParts = versionTuple(actual);
  const minimumParts = versionTuple(minimum);

  for (const [index, part] of minimumParts.entries()) {
    if (actualParts[index] > part) return true;
    if (actualParts[index] < part) return false;
  }

  return true;
};

test("release workflow pins a Node 20 and npm 11 trusted-publishing toolchain", async () => {
  const releaseWorkflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  const npmSpecifier = releaseWorkflow.match(/npm install -g npm@(\S+)/)?.[1];
  assert.match(
    npmSpecifier ?? "",
    /^\d+\.\d+\.\d+$/,
    "release npm must be an exact version, never a moving tag or range",
  );

  const releaseNode = releaseWorkflow.match(/node-version:\s*(\S+)/)?.[1];
  assert.match(
    releaseNode ?? "",
    /^\d+\.\d+\.\d+$/,
    "release Node must be an exact version",
  );

  assert.equal(
    versionTuple(releaseNode)[0],
    20,
    "release must stay on the declared Node 20 line",
  );
  assert.ok(
    atLeast(releaseNode, "20.17.0"),
    "npm 11 requires Node >=20.17 on the Node 20 line",
  );
  assert.equal(
    versionTuple(npmSpecifier)[0],
    11,
    "trusted publishing on Node 20 must use the npm 11 release line",
  );
  assert.ok(
    atLeast(npmSpecifier, "11.5.1"),
    "trusted publishing requires npm >=11.5.1",
  );
});
