import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import schema from "../vendor/knowledge-contract-e351df0c/schemas/book-package.schema.json";

/** Pins this inspector was written against. Verified by tests (git blob ids recomputed from the vendored bytes). */
export const PINS = {
  knowledge_contract_repo: "Arcanada-one/knowledge-contract",
  knowledge_contract_commit: "e351df0c28f0b9965a580f45b48a297d1872c3ce",
  schema_path: "schemas/book-package.schema.json",
  schema_blob: "fd721e6f610547ab5ac3748dcbde76f14c3b0899",
  checker_path: "tools/check_book_package.py",
  checker_blob: "0221e4ad301ecccf0868019c4c2575120a71b16c",
} as const;

export const SCHEMA_TAGS: Record<string, string> = {
  "KCBookPackageManifest/v2": "Manifest",
  "KCBookObject/v2": "Object",
  "KCBookRelation/v2": "Relation",
  "KCBookEdit/v2": "Edit",
  "KCBookQuality/v2": "Quality",
};

const ajv = new Ajv2020({
  allErrors: true,
  strictSchema: true,
  strictTypes: false,
  strictTuples: false,
  strictRequired: false,
  validateFormats: true,
});
// Same rule as the checker's date-time format: exactly YYYY-MM-DDTHH:MM:SSZ, and a real calendar date and time.
ajv.addFormat("date-time", {
  type: "string",
  validate: (value: string): boolean => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(value);
    if (!m) return false;
    const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
    return (
      y >= 1 &&
      t.getUTCFullYear() === y &&
      t.getUTCMonth() === mo - 1 &&
      t.getUTCDate() === d &&
      h <= 23 &&
      mi <= 59 &&
      s <= 59
    );
  },
});
ajv.addSchema(schema);

const validators = new Map<string, ValidateFunction>();
for (const [tag, def] of Object.entries(SCHEMA_TAGS)) {
  const v = ajv.getSchema(`${(schema as { $id: string }).$id}#/$defs/${def}`);
  if (!v)
    throw new Error(`book-package schema definition ${def} did not compile`);
  validators.set(tag, v);
}

/** Errors of one record. The record's `schema` field selects its definition; an unknown value is itself an error. */
export function recordErrors(record: unknown): string[] {
  const tag =
    record !== null && typeof record === "object" && !Array.isArray(record)
      ? (record as Record<string, unknown>)["schema"]
      : undefined;
  const validate = typeof tag === "string" ? validators.get(tag) : undefined;
  if (!validate)
    return [
      `<root>: unknown or missing schema field ${JSON.stringify(tag ?? null)}`,
    ];
  if (validate(record)) return [];
  const out = (validate.errors ?? []).map((e) => {
    const where = e.instancePath === "" ? "<root>" : e.instancePath.slice(1);
    const extra =
      e.params && "additionalProperty" in e.params
        ? ` '${String(e.params["additionalProperty"])}'`
        : "";
    return `${where}: ${e.message ?? "invalid"}${extra}`;
  });
  return out.sort();
}
