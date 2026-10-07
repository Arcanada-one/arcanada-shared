import { z } from "zod";
// reuse: @arcanada/access-contracts public bounded UTF-8 JSON parser.
import { parseBoundedJson } from "@arcanada/access-contracts";
import { observation, type Observation } from "./report.js";
import { slug } from "./template.js";

const rawText = z.string();
const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const position = slug;
const history = z
  .object({ k: position, turn_hash: hash, text: rawText })
  .strict();
const selected = z
  .object({ k: position, content_hash: hash, text: rawText })
  .strict();
const candidate = z
  .object({
    k: position,
    namespace: identifier,
    revision_id: identifier,
    content_hash: hash,
    source_path: rawText,
    text: rawText,
  })
  .strict();
const kcCandidate = z
  .object({
    id: slug,
    description_en: z.string().regex(/^[\x20-\x7E\t\r\n]+$/),
  })
  .strict();
const empty = z.object({}).strict();
const taskContext = z
  .object({
    project_prefix: identifier,
    caller_kind: z.enum(["operator", "client", "agent"]),
    has_attachments: z.boolean(),
  })
  .strict();
const retrievalContext = z
  .object({
    namespace_group: identifier,
    coverage_pass: z.union([z.literal(1), z.literal(2)]),
    budget_class: z.enum(["low", "normal", "broad"]),
  })
  .strict();

export const stateSchemas = {
  task_dialogue: z
    .object({
      trusted: z
        .object({ task_text: rawText, context_labels: taskContext.optional() })
        .strict(),
      untrusted: z
        .object({ history_digests: z.array(history).max(5).optional() })
        .strict(),
    })
    .strict(),
  kc_role: z
    .object({
      trusted: z
        .object({
          task_text: rawText,
          candidates: z.array(kcCandidate).max(20),
        })
        .strict(),
      untrusted: empty,
    })
    .strict(),
  kc_skill: z
    .object({
      trusted: z
        .object({
          task_text: rawText,
          role_id: slug,
          candidates: z.array(kcCandidate).max(30),
        })
        .strict(),
      untrusted: empty,
    })
    .strict(),
  retrieval_prompt: z
    .object({
      trusted: z
        .object({
          question: rawText,
          context_labels: retrievalContext.optional(),
          selected: z.array(selected).max(40).optional(),
        })
        .strict(),
      untrusted: z.object({ candidates: z.array(candidate).max(40) }).strict(),
    })
    .strict(),
};
export type SupportedSchema = keyof typeof stateSchemas;

const denied = [
  "approved",
  "approval",
  "approved_by",
  "reviewer_note",
  "review",
  "reviewed",
  "risk",
  "risk_assessment",
  "risk_level",
  "security_review",
  "verdict",
  "decision",
  "safe",
  "safety",
  "severity",
  "priority",
  "recommendation",
  "assessment",
  "evaluation",
  "rating",
  "score",
  "confidence",
  "status",
  "label",
  "verified",
  "validated",
  "passed",
  "ok",
  "note",
  "comment",
];
const conflicted = new Set([
  "trusted.context_labels",
  "trusted.target_labels",
  "trusted.context_labels.risk_class",
]);

export function boundedJson(raw: Uint8Array): unknown {
  return parseBoundedJson(raw);
}

function scanNames(
  value: unknown,
  path: string[] = [],
): { failure: boolean; conflict: boolean } {
  let failure = false;
  let conflict = false;
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = scanNames(item, [...path, "*"]);
      failure ||= result.failure;
      conflict ||= result.conflict;
    }
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const nested = [...path, key];
      if (denied.some((part) => key.toLowerCase().includes(part))) {
        if (conflicted.has(nested.join("."))) conflict = true;
        else failure = true;
      }
      const result = scanNames(item, nested);
      failure ||= result.failure;
      conflict ||= result.conflict;
    }
  }
  return { failure, conflict };
}

export interface StateInspection {
  readonly observation: Observation;
  readonly candidates: readonly string[];
  readonly role: string | null;
}

export function inspectState(
  schema: SupportedSchema,
  value: unknown,
  decisionId: string,
): StateInspection {
  const names = scanNames(value);
  const refused = (
    verdict: "failed" | "not_measured",
    code: string,
  ): StateInspection => ({
    observation: observation(verdict, code),
    candidates: [],
    role: null,
  });
  if (names.failure) return refused("failed", "STATE_DENIED_FIELD");
  const result = stateSchemas[schema].safeParse(value);
  if (!result.success) return refused("failed", "STATE_CLOSED_SCHEMA_MISMATCH");
  // Even a typed container remains a refusal, never a lexical exception/pass.
  if (names.conflict)
    return refused(
      "not_measured",
      "STATE_REQUIRED_CONTAINER_CONTRACT_CONFLICT",
    );
  const state = result.data;
  if (
    (decisionId === "retrieval.redundancy" ||
      decisionId === "retrieval.coverage") &&
    (!("selected" in state.trusted) || state.trusted.selected === undefined)
  ) {
    return refused("failed", "STATE_SELECTED_SET_REQUIRED");
  }
  let candidates: string[] = [];
  let role: string | null = null;
  if ("candidates" in state.trusted)
    candidates = state.trusted.candidates.map((entry) => entry.id);
  if ("role_id" in state.trusted && typeof state.trusted.role_id === "string")
    role = state.trusted.role_id;
  if ("candidates" in state.untrusted)
    candidates = state.untrusted.candidates.map((entry) => entry.k);
  const histories =
    "history_digests" in state.untrusted
      ? (state.untrusted.history_digests?.map((entry) => entry.k) ?? [])
      : [];
  const selections =
    "selected" in state.trusted
      ? (state.trusted.selected?.map((entry) => entry.k) ?? [])
      : [];
  if (
    [candidates, histories, selections].some(
      (ids) => new Set(ids).size !== ids.length,
    )
  )
    return refused("failed", "STATE_DUPLICATE_IDENTIFIER");
  return {
    observation: observation("verified", "MINIMAL_STATE_STRUCTURE_ONLY"),
    candidates,
    role,
  };
}

/** Exact generated JSON schema is bound separately from template bytes. */
export function schemaDefinition(schema: SupportedSchema): string {
  return JSON.stringify(z.toJSONSchema(stateSchemas[schema]));
}
