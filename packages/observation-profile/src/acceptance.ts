import type { Acceptance } from "./types.js";

export type AcceptanceIssueCode =
  | "EMPTY_CHECKER_PASS"
  | "ACCEPTANCE_DECISION_MISSING"
  | "ACCEPTANCE_POLICY_CONFLICT"
  | "FAIL_WITHOUT_FAILING_CHECK";

export interface AcceptancePolicy {
  /** Check ids the policy declares mandatory, or "all-listed" when every listed check is mandatory. */
  readonly mandatoryChecks: readonly string[] | "all-listed";
}

export interface AcceptanceEvaluation {
  readonly sourceVerdict: Acceptance["verdict"];
  /**
   * What the consumer may show as current independent acceptance. This reducer never promotes a source PASS: that needs
   * a separately verified, authentic acceptance decision (KCLIVE-22), which a pure projection cannot supply.
   */
  readonly effectiveVerdict: "NOT_MEASURED" | "FAIL";
  readonly issues: readonly AcceptanceIssueCode[];
  /** Executed checkers whose own verdict is UNKNOWN or NOT_APPLICABLE; they differ from checks=[] (no observation). */
  readonly executedUndecided: readonly string[];
  readonly checkersObserved: boolean;
}

export function evaluateAcceptance(
  acceptance: Acceptance,
  policy?: AcceptancePolicy,
): AcceptanceEvaluation {
  const issues: AcceptanceIssueCode[] = [];
  const checks = acceptance.checks;
  const executedUndecided = checks
    .filter((c) => c.verdict === "UNKNOWN" || c.verdict === "NOT_APPLICABLE")
    .map((c) => c.checker_id);
  if (acceptance.verdict === "PASS") {
    if (checks.length === 0) issues.push("EMPTY_CHECKER_PASS");
    if (
      acceptance.decision_evidence_ref === null ||
      acceptance.decision_policy_ref === null
    ) {
      issues.push("ACCEPTANCE_DECISION_MISSING");
    }
    if (policy !== undefined) {
      const mandatory =
        policy.mandatoryChecks === "all-listed"
          ? checks
          : checks.filter((c) => policy.mandatoryChecks.includes(c.checker_id));
      if (mandatory.some((c) => c.verdict !== "PASS"))
        issues.push("ACCEPTANCE_POLICY_CONFLICT");
    }
  }
  let effective: "NOT_MEASURED" | "FAIL" = "NOT_MEASURED";
  if (acceptance.verdict === "FAIL") {
    if (checks.some((c) => c.verdict === "FAIL")) effective = "FAIL";
    else issues.push("FAIL_WITHOUT_FAILING_CHECK");
  }
  return {
    sourceVerdict: acceptance.verdict,
    effectiveVerdict: effective,
    issues,
    executedUndecided,
    checkersObserved: checks.length > 0,
  };
}
