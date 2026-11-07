import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
export {
  compare,
  normaliseOther,
  related,
  schemaKey,
  type Comparison,
} from "../src/compare.js";

const here = dirname(fileURLToPath(import.meta.url));
export const VENDOR = join(here, "..", "vendor", "knowledge-contract-e351df0c");
export const FIXTURES = join(VENDOR, "schemas", "fixtures", "book-package");

export interface Verdicts {
  pins: { commit: string; schema_blob: string; checker_blob: string };
  valid_packages: Record<string, { problems: string[] }>;
  valid_records: Record<string, { errors: string[] }>;
  invalid_records: Record<string, { errors: string[] }>;
  mutants: Record<
    string,
    {
      base: string;
      overlay: Record<string, string | null>;
      note: string;
      problems: string[];
    }
  >;
}
export const verdicts = JSON.parse(
  readFileSync(join(here, "fixtures", "checker-verdicts.json"), "utf8"),
) as Verdicts;

export function loadDir(root: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (dir: string, prefix: string): void => {
    for (const e of readdirSync(dir).sort()) {
      const full = join(dir, e);
      const rel = prefix ? `${prefix}/${e}` : e;
      if (statSync(full).isDirectory()) walk(full, rel);
      else out.set(rel, new Uint8Array(readFileSync(full)));
    }
  };
  walk(root, "");
  return out;
}

export const validPackage = (name: string): Map<string, Uint8Array> =>
  loadDir(join(FIXTURES, "valid", name));

export function applyOverlay(
  base: Map<string, Uint8Array>,
  overlay: Record<string, string | null>,
): Map<string, Uint8Array> {
  const out = new Map(base);
  for (const [rel, b64] of Object.entries(overlay)) {
    if (b64 === null) out.delete(rel);
    else out.set(rel, new Uint8Array(Buffer.from(b64, "base64")));
  }
  return out;
}
