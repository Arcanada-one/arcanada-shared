/**
 * Global evaluative field-name deny-list (JEV-DECISION-CATALOG §0.1 / TЗ §7.4).
 * Matching is case-insensitive. A name is denied when:
 * - the full name equals a deny token, or
 * - any underscore-separated segment equals a deny token
 *   (e.g. `security_review_status` is denied via `review` and `status`).
 *
 * Whole-segment matching (not raw substring) keeps catalog whitelist names such
 * as `context_labels` valid: its segment `labels` is not the token `label`.
 */
export const STATE_FIELD_DENYLIST: readonly string[] = Object.freeze([
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
]);

const DENY_SET = new Set(
  STATE_FIELD_DENYLIST.map((token) => token.toLowerCase()),
);

export function findDeniedFieldToken(fieldName: string): string | null {
  const lower = fieldName.toLowerCase();
  if (DENY_SET.has(lower)) {
    return lower;
  }
  for (const segment of lower.split("_")) {
    if (segment && DENY_SET.has(segment)) {
      return segment;
    }
  }
  return null;
}
