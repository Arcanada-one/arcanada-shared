import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every advisory id that `pnpm audit` is told to ignore must be backed by a register
 * entry whose `re_review` date is still in the future. An ignore without an entry, or
 * with an entry that has lapsed, would otherwise outlive its review silently.
 * @param {{ ignored: readonly string[], entries: readonly { id?: unknown, re_review?: unknown }[], today: string }} input
 * @returns {string[]} one message per problem; empty when the ignore list is covered
 */
export const checkAcceptedRisk = ({ ignored, entries, today }) => {
  if (!ISO_DATE.test(today)) {
    throw new Error(`today must be YYYY-MM-DD, got ${JSON.stringify(today)}`);
  }
  /** @type {string[]} */
  const problems = [];
  for (const id of ignored) {
    const matching = entries.filter((entry) => entry.id === id);
    if (matching.length === 0) {
      problems.push(
        `${id}: ignored by pnpm audit but absent from accepted-risk.yml`,
      );
      continue;
    }
    for (const entry of matching) {
      const reReview = String(entry.re_review ?? "").slice(0, 10);
      if (!ISO_DATE.test(reReview)) {
        problems.push(
          `${id}: re_review is not an ISO date (${JSON.stringify(entry.re_review)})`,
        );
      } else if (reReview <= today) {
        problems.push(
          `${id}: re_review ${reReview} is not in the future (today ${today})`,
        );
      }
    }
  }
  return problems;
};

/** @param {URL} rootUrl */
export const readRegister = async (rootUrl) => {
  const workspace = parse(
    await readFile(new URL("pnpm-workspace.yaml", rootUrl), "utf8"),
  );
  const register = parse(
    await readFile(new URL("accepted-risk.yml", rootUrl), "utf8"),
  );
  const ignored = workspace?.auditConfig?.ignoreGhsas ?? [];
  const entries = register?.entries ?? [];
  if (!Array.isArray(ignored) || !Array.isArray(entries)) {
    throw new Error("auditConfig.ignoreGhsas and entries must be lists");
  }
  return { ignored, entries };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const today = new Date().toISOString().slice(0, 10);
  const { ignored, entries } = await readRegister(
    new URL("../", import.meta.url),
  );
  const problems = checkAcceptedRisk({ ignored, entries, today });
  for (const problem of problems) {
    console.error(`ACCEPTED_RISK_REGISTER: ${problem}`);
  }
  if (problems.length > 0) {
    process.exit(1);
  }
  console.log(
    `accepted-risk register covers ${ignored.length} ignored advisories as of ${today}`,
  );
}
