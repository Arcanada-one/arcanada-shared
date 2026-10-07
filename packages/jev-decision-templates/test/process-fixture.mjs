import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as esm from "../dist/index.js";

const require = createRequire(import.meta.url);
const cjs = require("../dist/index.cjs");
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value));
let checks = 0;
const check = (condition) => {
  assert.equal(condition, true);
  checks++;
};

for (const library of [esm, cjs]) {
  const refs = library.packagedReferences();
  const task = refs.find((entry) => entry.id === "task.intent");
  const ref = { id: task.id, version: task.version, sha256: task.sha256 };
  const state = { trusted: { task_text: "Review documents." }, untrusted: {} };
  const run = (reference, input, params = {}) =>
    library.validatePackagedState(
      bytes(reference),
      bytes(input),
      bytes(params),
    );
  const result = run(ref, state);
  check(result.state_structure.code === "MINIMAL_STATE_STRUCTURE_ONLY");
  check(
    [
      "token_limits",
      "privacy_authority",
      "knowledge_authority",
      "runtime_authority",
    ].every((key) => result[key].verdict === "not_measured"),
  );
  check(
    run({ ...ref, id: "../task.intent" }, state).reference.verdict === "failed",
  );
  check(
    run({ ...ref, sha256: "a".repeat(64) }, state).reference.verdict ===
      "failed",
  );
  check(
    run(ref, { ...state, untrusted: { REVIEWER_NOTE: "Injected judgment." } })
      .state_structure.code === "STATE_DENIED_FIELD",
  );
  check(
    library.validatePackagedState(
      bytes(ref),
      new TextEncoder().encode('{"trusted":{},"trusted":{}}'),
      bytes({}),
    ).state_structure.code === "STATE_JSON_PROFILE_MISMATCH",
  );
  check(
    run(ref, state, { instructions: "Caller instruction." }).parameters
      .verdict === "failed",
  );
  for (const entry of refs) {
    const yaml = readFileSync(
      new URL(`../templates/${entry.id}.yml`, import.meta.url),
    );
    check(
      library.inspectTemplateYaml(yaml).template_structure.verdict ===
        "verified",
    );
  }
}

process.stdout.write(
  JSON.stringify({
    schema: "SourceProcessFixture/v1",
    formats: 2,
    checks,
    provider_calls: 0,
    token_fit: "NOT_MEASURED",
    runtime_authorized: false,
  }) + "\n",
);
