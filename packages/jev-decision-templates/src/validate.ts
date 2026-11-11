import type {
  DecisionState,
  DecisionTemplate,
  ValidationResult,
} from "./types.js";
import { validateState } from "./validate-state.js";
import { validateTemplate } from "./validate-template.js";

/**
 * Static gate used by package tests / CI: template rules (AC-08/AC-24) plus
 * state whitelist and deny-list checks.
 */
export function validate(
  template: DecisionTemplate,
  state: DecisionState,
): ValidationResult {
  const templateResult = validateTemplate(template);
  if (!templateResult.ok) {
    return templateResult;
  }
  return validateState(template, state);
}
