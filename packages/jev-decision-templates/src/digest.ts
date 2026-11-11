import { createHash } from "node:crypto";
import type { DecisionTemplate } from "./types.js";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      out[key] = sortKeys(input[key]);
    }
    return out;
  }
  return value;
}

/** Stable sha256 digest over the canonical JSON form of a template. */
export function digestTemplate(template: DecisionTemplate): string {
  const canonical = JSON.stringify(sortKeys(template));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
