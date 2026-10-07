import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, compileTokens, STATUS_ROLES } from "../scripts/build.mjs";

const input = JSON.parse(
  await readFile(new URL("../src/tokens.json", import.meta.url), "utf8"),
);
const copy = () => structuredClone(input);

test("CSS JSON and TS preserve the same finite semantic status values", () => {
  const output = compileTokens(input);
  assert.deepEqual(Object.keys(output.values), STATUS_ROLES);
  assert.deepEqual(JSON.parse(output.json).values, output.values);
  for (const [role, value] of Object.entries(output.values)) {
    assert.ok(output.css.includes(`--arc-status-${role}: ${value};`));
    assert.ok(output.ts.includes(`"${role}": "${value}"`));
  }
  assert.equal(output.css.includes("*"), false);
  assert.equal(output.css.includes("@import"), false);
});

test("permuted token order and repeated builds yield identical bytes", async () => {
  const reversed = copy();
  reversed.tokens.reverse();
  assert.deepEqual(compileTokens(reversed), compileTokens(input));
  const directory = await mkdtemp(join(tmpdir(), "semantic-status-"));
  try {
    await build(new URL("../src/tokens.json", import.meta.url), directory);
    const first = await Promise.all(
      ["css", "json", "ts"].map((format) =>
        readFile(join(directory, `tokens.${format}`)),
      ),
    );
    await build(new URL("../src/tokens.json", import.meta.url), directory);
    const second = await Promise.all(
      ["css", "json", "ts"].map((format) =>
        readFile(join(directory, `tokens.${format}`)),
      ),
    );
    assert.deepEqual(second, first);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("aliases resolve before every exported format is generated", () => {
  const aliased = copy();
  aliased.tokens[3].value = { ref: "operational" };
  const output = compileTokens(aliased);
  assert.equal(output.values.unknown, output.values.operational);
  assert.ok(output.css.includes("--arc-status-unknown: #246b35;"));
});

for (const [name, mutate, expected] of [
  [
    "cycle",
    (i) => {
      i.tokens[0].value = { ref: "unknown" };
      i.tokens[3].value = { ref: "operational" };
    },
    "alias_cycle",
  ],
  [
    "unresolved alias",
    (i) => {
      i.tokens[0].value = { ref: "missing" };
    },
    "unresolved_alias",
  ],
  [
    "wrong type",
    (i) => {
      i.tokens[0].type = "dimension";
    },
    "unsupported_type",
  ],
  [
    "non-color value",
    (i) => {
      i.tokens[0].value = 22;
    },
    "unsafe_color",
  ],
  [
    "unknown role",
    (i) => {
      i.tokens[0].role = "unrecognized";
    },
    "unknown_role",
  ],
  [
    "duplicate role",
    (i) => {
      i.tokens[0].role = "unknown";
    },
    "duplicate_role",
  ],
  [
    "CSS injection",
    (i) => {
      i.tokens[0].value = "red; background:url(https://invalid.example/)";
    },
    "unsafe_color",
  ],
  [
    "private provenance",
    (i) => {
      i.provenance.distribution = "private";
    },
    "public_provenance_required",
  ],
  [
    "unknown license",
    (i) => {
      i.provenance.license = "unknown";
    },
    "public_provenance_required",
  ],
  [
    "missing origin",
    (i) => {
      delete i.provenance.origin;
    },
    "origin_required",
  ],
  [
    "unexpected overlay",
    (i) => {
      i.overlay = "private";
    },
    "unknown_field",
  ],
]) {
  test(`rejects ${name} without exposing its input`, () => {
    const invalid = copy();
    mutate(invalid);
    assert.throws(() => compileTokens(invalid), { message: expected });
  });
}

test("oversized input is rejected before output files are changed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "semantic-status-"));
  try {
    const source = join(directory, "input.json");
    const existing = join(directory, "tokens.css");
    await writeFile(source, " ".repeat(16_385));
    await writeFile(existing, "previous valid artifact");
    await assert.rejects(build(source, directory), {
      message: "input_too_large",
    });
    assert.equal(await readFile(existing, "utf8"), "previous valid artifact");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
