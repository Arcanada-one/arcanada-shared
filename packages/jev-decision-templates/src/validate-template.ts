import { OPTION_ID_PATTERN, containsDisallowedNonAscii } from "./ascii.js";
import type {
  DecisionTemplate,
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

export function validateTemplate(template: DecisionTemplate): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!template || typeof template !== "object") {
    return {
      ok: false,
      issues: [
        issue(
          "invalid_template_shape",
          "$",
          "template must be a non-null object",
        ),
      ],
    };
  }

  if (typeof template.id !== "string" || template.id.length === 0) {
    issues.push(issue("invalid_template_shape", "id", "id must be a string"));
  }
  if (
    typeof template.version !== "number" ||
    !Number.isInteger(template.version)
  ) {
    issues.push(
      issue("invalid_template_shape", "version", "version must be an integer"),
    );
  }
  if (
    template.primitive !== "choice" &&
    template.primitive !== "noul" &&
    template.primitive !== "score"
  ) {
    issues.push(
      issue(
        "invalid_template_shape",
        "primitive",
        "primitive must be choice|noul|score",
      ),
    );
  }
  if (typeof template.instructions !== "string") {
    issues.push(
      issue(
        "invalid_template_shape",
        "instructions",
        "instructions must be a string",
      ),
    );
  }
  if (!Array.isArray(template.allow_non_ascii)) {
    issues.push(
      issue(
        "invalid_template_shape",
        "allow_non_ascii",
        "allow_non_ascii must be an array",
      ),
    );
  }

  const allow = Array.isArray(template.allow_non_ascii)
    ? template.allow_non_ascii
    : [];

  if (
    typeof template.instructions === "string" &&
    containsDisallowedNonAscii(template.instructions, allow)
  ) {
    issues.push(
      issue(
        "non_ascii_text",
        "instructions",
        "instructions contain non-ASCII outside allow_non_ascii",
      ),
    );
  }

  if (template.primitive === "choice") {
    if (!Array.isArray(template.options) || template.options.length === 0) {
      issues.push(
        issue(
          "invalid_template_shape",
          "options",
          "choice templates require a non-empty options array",
        ),
      );
    } else {
      const ids = new Set<string>();
      for (const [index, option] of template.options.entries()) {
        const path = `options[${index}]`;
        if (!option || typeof option !== "object") {
          issues.push(
            issue("invalid_template_shape", path, "option must be an object"),
          );
          continue;
        }
        if (
          typeof option.id !== "string" ||
          !OPTION_ID_PATTERN.test(option.id)
        ) {
          issues.push(
            issue(
              "option_id_not_slug",
              `${path}.id`,
              `option id must match ${OPTION_ID_PATTERN}`,
            ),
          );
        } else if (ids.has(option.id)) {
          issues.push(
            issue(
              "invalid_template_shape",
              `${path}.id`,
              `duplicate option id ${option.id}`,
            ),
          );
        } else {
          ids.add(option.id);
        }
        if (typeof option.description !== "string") {
          issues.push(
            issue(
              "invalid_template_shape",
              `${path}.description`,
              "description must be a string",
            ),
          );
        } else if (containsDisallowedNonAscii(option.description, allow)) {
          issues.push(
            issue(
              "non_ascii_text",
              `${path}.description`,
              "option description contains non-ASCII outside allow_non_ascii",
            ),
          );
        }
      }
      if (!ids.has("other")) {
        issues.push(
          issue(
            "choice_missing_other",
            "options",
            "every choice template must include option id `other`",
          ),
        );
      }
    }
  }

  if (template.primitive === "noul") {
    const criteria = template.criteria;
    if (
      !criteria ||
      typeof criteria !== "object" ||
      typeof criteria.true !== "string" ||
      typeof criteria.false !== "string"
    ) {
      issues.push(
        issue(
          "noul_missing_criteria",
          "criteria",
          "every noul template must expose criteria:{true,false}",
        ),
      );
    } else {
      for (const key of ["true", "false"] as const) {
        if (containsDisallowedNonAscii(criteria[key], allow)) {
          issues.push(
            issue(
              "non_ascii_text",
              `criteria.${key}`,
              "criteria text contains non-ASCII outside allow_non_ascii",
            ),
          );
        }
      }
    }
  }

  return { ok: issues.length === 0, issues };
}
