export type Verdict = "verified" | "failed" | "not_measured";
export interface Observation {
  readonly verdict: Verdict;
  readonly code: string;
}
export interface InspectionReport {
  readonly reference: Observation;
  readonly template_structure: Observation;
  readonly state_structure: Observation;
  readonly parameters: Observation;
  readonly token_limits: Observation;
  readonly privacy_authority: Observation;
  readonly knowledge_authority: Observation;
  readonly runtime_authority: Observation;
}

export function observation(verdict: Verdict, code: string): Observation {
  return Object.freeze({ verdict, code });
}

export function report(
  observations: Partial<
    Pick<
      InspectionReport,
      "reference" | "template_structure" | "state_structure" | "parameters"
    >
  >,
): InspectionReport {
  return Object.freeze({
    reference: observation("not_measured", "REFERENCE_NOT_INSPECTED"),
    template_structure: observation("not_measured", "TEMPLATE_NOT_INSPECTED"),
    state_structure: observation("not_measured", "STATE_NOT_INSPECTED"),
    parameters: observation("not_measured", "PARAMETERS_NOT_INSPECTED"),
    ...observations,
    token_limits: observation("not_measured", "EXACT_TOKENIZER_NOT_QUALIFIED"),
    privacy_authority: observation(
      "not_measured",
      "PRIVACY_AUTHORITY_NOT_SUPPLIED",
    ),
    knowledge_authority: observation(
      "not_measured",
      "KNOWLEDGE_AUTHORITY_NOT_SUPPLIED",
    ),
    runtime_authority: observation(
      "not_measured",
      "RUNTIME_AUTHORITY_NOT_SUPPLIED",
    ),
  });
}
