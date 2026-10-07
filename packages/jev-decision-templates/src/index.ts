import { createHash } from "node:crypto";
import { TextEncoder } from "node:util";
import { z } from "zod";
import { manifest } from "./manifest.js";
import { observation, report, type InspectionReport } from "./report.js";
import {
  boundedJson,
  inspectState,
  schemaDefinition,
  stateSchemas,
  type SupportedSchema,
} from "./state.js";
import { slug, validateTemplate } from "./template.js";
import { parseTemplateYaml } from "./yaml-template.js";

export type { InspectionReport, Observation, Verdict } from "./report.js";

export function inspectTemplateYaml(raw: Uint8Array): InspectionReport {
  try {
    return report({
      template_structure: validateTemplate(parseTemplateYaml(raw))
        ? observation("verified", "TEMPLATE_STRUCTURE_ONLY")
        : observation("failed", "TEMPLATE_CLOSED_SCHEMA_MISMATCH"),
    });
  } catch {
    return report({
      template_structure: observation(
        "failed",
        "TEMPLATE_YAML_PROFILE_MISMATCH",
      ),
    });
  }
}

const referenceSchema = z
  .object({
    id: z.string(),
    version: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

/** Immutable references are returned as fresh frozen records, never a registry. */
export function packagedReferences(): readonly Readonly<{
  id: string;
  version: number;
  sha256: string;
  state_schema_sha256: string | null;
  held: boolean;
}>[] {
  return Object.freeze(
    manifest.map((entry) =>
      Object.freeze({
        id: entry.id,
        version: entry.version,
        sha256: digest(entry.yaml),
        state_schema_sha256: entry.schemaSha256,
        held: entry.hold !== null,
      }),
    ),
  );
}

/** Serialized inputs avoid caller getters. No transport or executable request. */
export function validatePackagedState(
  referenceBytes: Uint8Array,
  stateBytes: Uint8Array,
  parameterBytes: Uint8Array,
): InspectionReport {
  let ref: z.infer<typeof referenceSchema>;
  try {
    const parsed = referenceSchema.safeParse(boundedJson(referenceBytes));
    if (!parsed.success)
      return report({
        reference: observation("failed", "REFERENCE_CLOSED_SCHEMA_MISMATCH"),
      });
    ref = parsed.data;
  } catch {
    return report({
      reference: observation("failed", "REFERENCE_JSON_PROFILE_MISMATCH"),
    });
  }
  const entry = manifest.find(
    (item) =>
      item.id === ref.id &&
      item.version === ref.version &&
      digest(item.yaml) === ref.sha256,
  );
  if (!entry)
    return report({
      reference: observation("failed", "REFERENCE_NOT_PACKAGED"),
    });
  const resolved = observation("verified", "EXACT_PACKAGED_REFERENCE");
  let template;
  try {
    template = validateTemplate(
      parseTemplateYaml(new TextEncoder().encode(entry.yaml)),
    );
  } catch {
    return report({
      reference: resolved,
      template_structure: observation(
        "failed",
        "PACKAGED_TEMPLATE_BINDING_MISMATCH",
      ),
    });
  }
  if (
    !template ||
    template.id !== entry.id ||
    template.version !== entry.version ||
    template.state_schema_ref !== entry.schema
  ) {
    return report({
      reference: resolved,
      template_structure: observation(
        "failed",
        "PACKAGED_TEMPLATE_BINDING_MISMATCH",
      ),
    });
  }
  const structure = observation("verified", "TEMPLATE_STRUCTURE_ONLY");
  if (entry.hold !== null)
    return report({
      reference: resolved,
      template_structure: structure,
      state_structure: observation("not_measured", entry.hold),
    });
  if (!(entry.schema in stateSchemas))
    return report({
      reference: resolved,
      template_structure: structure,
      state_structure: observation(
        "not_measured",
        "STATE_SCHEMA_NOT_IMPLEMENTED",
      ),
    });
  if (
    digest(schemaDefinition(entry.schema as SupportedSchema)) !==
    entry.schemaSha256
  ) {
    return report({
      reference: resolved,
      template_structure: structure,
      state_structure: observation(
        "failed",
        "PACKAGED_STATE_SCHEMA_BINDING_MISMATCH",
      ),
    });
  }
  let state: unknown;
  try {
    state = boundedJson(stateBytes);
  } catch {
    return report({
      reference: resolved,
      template_structure: structure,
      state_structure: observation("failed", "STATE_JSON_PROFILE_MISMATCH"),
    });
  }
  const inspected = inspectState(
    entry.schema as SupportedSchema,
    state,
    entry.id,
  );
  const observations = {
    reference: resolved,
    template_structure: structure,
    state_structure: inspected.observation,
  };
  if (inspected.observation.verdict !== "verified") return report(observations);
  let params: unknown;
  try {
    params = boundedJson(parameterBytes);
  } catch {
    return report({
      ...observations,
      parameters: observation("failed", "PARAMETERS_JSON_PROFILE_MISMATCH"),
    });
  }
  const shape = Object.fromEntries(
    Object.keys(template.params_schema).map((key) => [key, slug]),
  );
  const parsed = z.object(shape).strict().safeParse(params);
  if (!parsed.success)
    return report({
      ...observations,
      parameters: observation("failed", "PARAMETERS_CLOSED_SCHEMA_MISMATCH"),
    });
  for (const [key, kind] of Object.entries(template.params_schema)) {
    const target = parsed.data[key];
    if (
      kind === "candidate_id"
        ? !inspected.candidates.includes(target!)
        : inspected.role !== target
    ) {
      return report({
        ...observations,
        parameters: observation("failed", "PARAMETER_TARGET_ABSENT"),
      });
    }
  }
  return report({
    ...observations,
    parameters: observation("verified", "PARAMETER_REFERENCES_ONLY"),
  });
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
