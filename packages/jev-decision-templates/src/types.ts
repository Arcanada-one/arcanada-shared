export type DecisionPrimitive = "choice" | "noul" | "score";

export interface AllowNonAsciiEntry {
  string: string;
  reason: string;
}

export interface ChoiceOption {
  id: string;
  description: string;
}

export interface NoulCriteria {
  true: string;
  false: string;
}

export interface DecisionTemplate {
  id: string;
  version: number;
  primitive: DecisionPrimitive;
  instructions: string;
  /** Present for choice templates — option ids must include `other`. */
  options?: ChoiceOption[];
  /** Present for noul templates — must expose both true and false branches. */
  criteria?: NoulCriteria;
  params_schema: Record<string, unknown>;
  state_schema_ref: string;
  allow_non_ascii: AllowNonAsciiEntry[];
}

export interface ObjectState {
  trusted: Record<string, unknown>;
  untrusted: Record<string, unknown>;
}

export type DecisionState = ObjectState | string;

export type ValidationCode =
  | "ok"
  | "invalid_template_shape"
  | "choice_missing_other"
  | "noul_missing_criteria"
  | "non_ascii_text"
  | "option_id_not_slug"
  | "state_shape_invalid"
  | "state_field_denied"
  | "state_field_not_whitelisted"
  | "unknown_state_schema_ref";

export interface ValidationIssue {
  code: Exclude<ValidationCode, "ok">;
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface StateSchemaGroup {
  ref: string;
  kind: "object" | "string";
  trusted: readonly string[];
  untrusted: readonly string[];
  max_state_tokens: number;
  max_untrusted_tokens: number;
  max_candidates: number;
  max_fragment_tokens: number;
}
