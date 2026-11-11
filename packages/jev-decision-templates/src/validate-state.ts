import { findDeniedFieldToken } from "./deny-list.js";
import { resolveStateSchema } from "./state-schemas.js";
import type {
  DecisionState,
  DecisionTemplate,
  ObjectState,
  ValidationIssue,
  ValidationResult,
} from "./types.js";

function issue(
  code: ValidationIssue["code"],
  path: string,
  message: string,
): ValidationIssue {
  return { code, path, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function walkKeys(
  value: unknown,
  path: string,
  onKey: (key: string, path: string) => void,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkKeys(item, `${path}[${index}]`, onKey));
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    onKey(key, childPath);
    walkKeys(child, childPath, onKey);
  }
}

export function validateState(
  template: DecisionTemplate,
  state: DecisionState,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const schema = resolveStateSchema(template.state_schema_ref);
  if (!schema) {
    return {
      ok: false,
      issues: [
        issue(
          "unknown_state_schema_ref",
          "state_schema_ref",
          `unknown state_schema_ref ${template.state_schema_ref}`,
        ),
      ],
    };
  }

  if (schema.kind === "string") {
    if (typeof state !== "string") {
      issues.push(
        issue(
          "state_shape_invalid",
          "state",
          "health state must be a string (catalog §0.1)",
        ),
      );
    }
    return { ok: issues.length === 0, issues };
  }

  if (!isPlainObject(state) || Array.isArray(state)) {
    return {
      ok: false,
      issues: [
        issue(
          "state_shape_invalid",
          "state",
          "state must be an object {trusted, untrusted}",
        ),
      ],
    };
  }

  const objectState = state as ObjectState;
  if (
    !isPlainObject(objectState.trusted) ||
    !isPlainObject(objectState.untrusted)
  ) {
    issues.push(
      issue(
        "state_shape_invalid",
        "state",
        "state.trusted and state.untrusted must both be objects",
      ),
    );
    return { ok: false, issues };
  }

  const trustedAllow = new Set(schema.trusted);
  const untrustedAllow = new Set(schema.untrusted);

  for (const key of Object.keys(objectState.trusted)) {
    if (!trustedAllow.has(key)) {
      issues.push(
        issue(
          "state_field_not_whitelisted",
          `trusted.${key}`,
          `field ${key} is not in the trusted whitelist for ${schema.ref}`,
        ),
      );
    }
  }
  for (const key of Object.keys(objectState.untrusted)) {
    if (!untrustedAllow.has(key)) {
      issues.push(
        issue(
          "state_field_not_whitelisted",
          `untrusted.${key}`,
          `field ${key} is not in the untrusted whitelist for ${schema.ref}`,
        ),
      );
    }
  }

  walkKeys(objectState, "state", (key, path) => {
    if (key === "trusted" || key === "untrusted") {
      return;
    }
    const denied = findDeniedFieldToken(key);
    if (denied) {
      issues.push(
        issue(
          "state_field_denied",
          path,
          `field name contains deny-listed token "${denied}"`,
        ),
      );
    }
  });

  return { ok: issues.length === 0, issues };
}
