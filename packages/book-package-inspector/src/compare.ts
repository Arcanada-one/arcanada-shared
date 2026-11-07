import type { Refusal } from "./inspect.js";

/** `label: path` of a schema message — the part both validators word the same way. */
export const schemaKey = (message: string): string =>
  message.split(": ").slice(0, 2).join(": ");

/** Decoder wording differs between Python and this reader; compare the class of failure, not the parser's own words. */
export const normaliseOther = (m: string): string =>
  m
    .replace(/['"]/g, "")
    .replace(/ \(byte \d+\)$/, "")
    .replace(/invalid JSON \(.*\)$/, "invalid JSON (detail)");

const pathOf = (key: string): string => key.split(": ")[1] ?? "";
const labelOf = (key: string): string => key.split(": ")[0] ?? "";
/** Two schema locations are related when they are equal or one is an ancestor of the other (`<root>` is an ancestor of all). */
export function related(x: string, y: string): boolean {
  if (labelOf(x) !== labelOf(y)) return false;
  const a = pathOf(x);
  const b = pathOf(y);
  if (a === b || a === "<root>" || b === "<root>") return true;
  return a.startsWith(b + "/") || b.startsWith(a + "/");
}

export interface Comparison {
  agree: boolean;
  exactLocations: boolean;
  reasons: string[];
}

/**
 * Compare the checker's problem list with the inspector's refusals. Agreement means: the same verdict; the same non-schema problems
 * in the same order (decoder wording normalised); and, for schema problems, every location the checker reports is matched by an
 * inspector error at the same place or a descendant of it, and every inspector location is related (equal, ancestor or descendant)
 * to one the checker reports. ajv and python-jsonschema attribute oneOf / if-then failures at different depths, so exact-text
 * equality of schema messages is neither expected nor claimed; `exactLocations` records when the location sets are identical anyway.
 */
export function compare(checker: string[], mine: Refusal[]): Comparison {
  const reasons: string[] = [];
  if ((checker.length === 0) !== (mine.length === 0)) {
    reasons.push(
      `verdict differs: checker ${checker.length === 0 ? "pass" : "fail"}, inspector ${mine.length === 0 ? "pass" : "refused"}`,
    );
    return { agree: false, exactLocations: false, reasons };
  }
  const mineSchemaKeys = mine
    .filter((r) => r.code === "schema_violation")
    .map((r) => schemaKey(r.message));
  const mineOther = mine
    .filter((r) => r.code !== "schema_violation")
    .map((r) => normaliseOther(r.message));
  const otherSet = new Set(
    mine.filter((r) => r.code !== "schema_violation").map((r) => r.message),
  );
  const checkerSchemaKeys: string[] = [];
  const checkerOther: string[] = [];
  for (const m of checker) {
    if (otherSet.has(m)) checkerOther.push(normaliseOther(m));
    else if (
      /^(manifest\.json|objects:\d+|relations:\d+|edits:\d+|quality|<record>): (<root>|[A-Za-z0-9_./-]+): /.test(
        m,
      ) &&
      !/^[^:]+: (invalid JSON|unreadable)/.test(m)
    ) {
      checkerSchemaKeys.push(schemaKey(m));
    } else checkerOther.push(normaliseOther(m));
  }
  if (JSON.stringify(checkerOther) !== JSON.stringify(mineOther)) {
    reasons.push(
      `non-schema problems differ: checker ${JSON.stringify(checkerOther)} vs inspector ${JSON.stringify(mineOther)}`,
    );
  }
  const uncovered = checkerSchemaKeys.filter(
    (c) =>
      !mineSchemaKeys.some(
        (m) =>
          labelOf(m) === labelOf(c) &&
          (pathOf(m) === pathOf(c) ||
            pathOf(m).startsWith(pathOf(c) + "/") ||
            pathOf(c) === "<root>"),
      ),
  );
  const unrelated = mineSchemaKeys.filter(
    (m) => !checkerSchemaKeys.some((c) => related(m, c)),
  );
  if (uncovered.length)
    reasons.push(
      `checker locations not covered by the inspector: ${JSON.stringify([...new Set(uncovered)])}`,
    );
  if (unrelated.length)
    reasons.push(
      `inspector locations unrelated to any checker location: ${JSON.stringify([...new Set(unrelated)])}`,
    );
  const exact =
    JSON.stringify([...new Set(checkerSchemaKeys)].sort()) ===
    JSON.stringify([...new Set(mineSchemaKeys)].sort());
  return { agree: reasons.length === 0, exactLocations: exact, reasons };
}
