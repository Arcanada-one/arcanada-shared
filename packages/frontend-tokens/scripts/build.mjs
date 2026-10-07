import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const STATUS_ROLES = Object.freeze([
  "degraded",
  "operational",
  "outage",
  "unknown",
]);
const LICENSES = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
]);
const fail = (code) => {
  throw new Error(code);
};
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function keys(value, expected) {
  if (
    !object(value) ||
    Object.keys(value).some((key) => !expected.includes(key))
  )
    fail("unknown_field");
}

/** Provenance is a required caller declaration, not a license adjudicator.
 * Public outputs contain only the validated finite roles. Private overlays
 * must remain in the owner's authorized contour and cannot enter this API.
 */
export function compileTokens(input) {
  keys(input, ["schema", "provenance", "tokens"]);
  if (input.schema !== "SemanticStatusTokens/v1") fail("unsupported_schema");
  keys(input.provenance, ["distribution", "license", "origin"]);
  const provenance = input.provenance;
  if (provenance.distribution !== "public" || !LICENSES.has(provenance.license))
    fail("public_provenance_required");
  if (
    typeof provenance.origin !== "string" ||
    !provenance.origin.trim() ||
    provenance.origin.length > 512
  )
    fail("origin_required");
  if (
    !Array.isArray(input.tokens) ||
    input.tokens.length !== STATUS_ROLES.length
  )
    fail("finite_roles_required");
  const tokens = new Map();
  for (const token of input.tokens) {
    keys(token, ["role", "type", "value"]);
    if (!STATUS_ROLES.includes(token.role)) fail("unknown_role");
    if (tokens.has(token.role)) fail("duplicate_role");
    if (token.type !== "color") fail("unsupported_type");
    tokens.set(token.role, token);
  }
  const resolved = new Map();
  const visiting = new Set();
  function color(role) {
    if (resolved.has(role)) return resolved.get(role);
    if (visiting.has(role)) fail("alias_cycle");
    const token = tokens.get(role);
    if (!token) fail("unresolved_alias");
    visiting.add(role);
    let value = token.value;
    if (object(value)) {
      keys(value, ["ref"]);
      if (typeof value.ref !== "string" || !tokens.has(value.ref))
        fail("unresolved_alias");
      value = color(value.ref);
    }
    if (typeof value !== "string" || !/^#[a-fA-F0-9]{6}$/.test(value))
      fail("unsafe_color");
    value = value.toLowerCase();
    visiting.delete(role);
    resolved.set(role, value);
    return value;
  }
  const values = Object.fromEntries(
    STATUS_ROLES.map((role) => [role, color(role)]),
  );
  const document = {
    schema: input.schema,
    provenance: {
      distribution: "public",
      license: provenance.license,
      origin: provenance.origin.trim(),
    },
    values,
  };
  return {
    values,
    css: `:root {\n${STATUS_ROLES.map((role) => `  --arc-status-${role}: ${values[role]};`).join("\n")}\n}\n`,
    json: `${JSON.stringify(document, null, 2)}\n`,
    ts: `export const semanticStatusTokens = ${JSON.stringify(values, null, 2)} as const;\nexport type SemanticStatusRole = keyof typeof semanticStatusTokens;\n`,
  };
}

export async function build(inputPath, outputDirectory) {
  const raw = await readFile(inputPath, "utf8");
  if (Buffer.byteLength(raw, "utf8") > 16_384) fail("input_too_large");
  const output = compileTokens(JSON.parse(raw));
  // Validate completely before opening any output file.
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(
    ["css", "json", "ts"].map((format) =>
      writeFile(resolve(outputDirectory, `tokens.${format}`), output[format]),
    ),
  );
  return output;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const input =
    process.argv[2] ??
    fileURLToPath(new URL("../src/tokens.json", import.meta.url));
  const output =
    process.argv[3] ?? fileURLToPath(new URL("../dist", import.meta.url));
  await build(input, output);
}
