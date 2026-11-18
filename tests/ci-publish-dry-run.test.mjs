import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

test("CI runs npm publish --dry-run without secrets.NPM_TOKEN", async () => {
  const source = await readFile(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const workflow = parse(source);
  const steps = workflow.jobs?.["build-test"]?.steps ?? [];
  const dryRun = steps.find(
    (step) => step?.name === "npm publish dry-run (no secret)",
  );
  assert.ok(dryRun, "CI must include an npm publish dry-run step");
  assert.match(String(dryRun.run), /npm publish --dry-run --ignore-scripts/);
  assert.doesNotMatch(String(dryRun.run), /(?:^|[^-\w])--provenance\b/);
  assert.equal(dryRun.env?.NODE_AUTH_TOKEN, undefined);
  assert.doesNotMatch(String(dryRun.run), /\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
  assert.deepEqual(workflow.jobs["build-test"]["runs-on"], [
    "self-hosted",
    "Linux",
    "X64",
    "ci-general",
  ]);
});
