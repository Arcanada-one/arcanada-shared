import type { StateSchemaGroup } from "./types.js";

const LIMITS = {
  max_state_tokens: 16_000,
  max_untrusted_tokens: 12_000,
  max_candidates: 40,
  max_fragment_tokens: 400,
} as const;

/**
 * Catalog §0.1 whitelist groups referenced by first-queue templates.
 * `health` is the sole string-state surface (`jev_client.diagnose`).
 */
export const STATE_SCHEMA_GROUPS: Readonly<Record<string, StateSchemaGroup>> =
  Object.freeze({
    task: Object.freeze({
      ref: "task",
      kind: "object",
      trusted: Object.freeze(["task_text", "context_labels"]),
      untrusted: Object.freeze(["history_digests"]),
      ...LIMITS,
    }),
    kc: Object.freeze({
      ref: "kc",
      kind: "object",
      trusted: Object.freeze(["task_text", "role_id", "candidates"]),
      untrusted: Object.freeze([] as string[]),
      ...LIMITS,
    }),
    retrieval: Object.freeze({
      ref: "retrieval",
      kind: "object",
      trusted: Object.freeze(["question", "context_labels", "selected"]),
      untrusted: Object.freeze(["candidates"]),
      ...LIMITS,
    }),
    health: Object.freeze({
      ref: "health",
      kind: "string",
      trusted: Object.freeze([] as string[]),
      untrusted: Object.freeze([] as string[]),
      ...LIMITS,
    }),
  });

export function resolveStateSchema(ref: string): StateSchemaGroup | undefined {
  return STATE_SCHEMA_GROUPS[ref];
}
