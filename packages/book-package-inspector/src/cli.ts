#!/usr/bin/env node
/**
 * book-package-inspect <package-dir> [--checker-repo <knowledge-contract checkout>]
 *
 * Reads one book-package/2 directory (read-only), prints the InspectionResult as JSON on stdout and exits 0 (pass) / 1 (refused) /
 * 2 (usage or read error). With --checker-repo it also runs the PINNED checker (`python3 -I tools/check_book_package.py <dir>`) on a
 * private snapshot of the very bytes it judged (hashes re-verified before and after) and prints an `agreement` record; the checkout must be at the pinned commit and its schema/checker blobs must match,
 * otherwise the agreement is reported NOT_MEASURED rather than guessed.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { checkOnSnapshot } from "./agree.js";
import { compare } from "./compare.js";
import { inspectBookPackage } from "./inspect.js";
import {
  ReadRefusal,
  readPackageDirectoryReport,
  type ReadReport,
} from "./node.js";
import { PINS } from "./schema.js";

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
  }).trim();
}

function runChecker(repo: string, dir: string): { agreement: unknown } {
  try {
    const commit = git(repo, "rev-parse", "HEAD");
    const schema = git(repo, "hash-object", PINS.schema_path);
    const checker = git(repo, "hash-object", PINS.checker_path);
    if (
      commit !== PINS.knowledge_contract_commit ||
      schema !== PINS.schema_blob ||
      checker !== PINS.checker_blob
    ) {
      return {
        agreement: {
          verdict: "NOT_MEASURED",
          reason: "checker checkout is not at the pinned commit/blobs",
          commit,
          schema,
          checker,
        },
      };
    }
    const run = spawnSync(
      "python3",
      ["-I", `${repo}/${PINS.checker_path}`, dir],
      {
        encoding: "utf8",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    const lines = run.stdout
      .split("\n")
      .filter((l) => l.startsWith("BOOK_PACKAGE_FAIL "));
    const problems = lines.map((l) => l.slice("BOOK_PACKAGE_FAIL ".length));
    const passed = run.status === 0 && run.stdout.includes("BOOK_PACKAGE_PASS");
    if (run.status !== 0 && run.status !== 1) {
      return {
        agreement: {
          verdict: "NOT_MEASURED",
          reason: `checker exited ${String(run.status)}`,
          stderr: run.stderr.slice(0, 500),
        },
      };
    }
    return {
      agreement: {
        checker_exit: run.status,
        checker_passed: passed,
        checker_problems: problems,
      },
    };
  } catch (e) {
    return {
      agreement: {
        verdict: "NOT_MEASURED",
        reason: (e as Error).message.slice(0, 300),
      },
    };
  }
}

function main(argv: string[]): number {
  const args = argv.slice(2);
  const checkerAt = args.indexOf("--checker-repo");
  const repo = checkerAt >= 0 ? args[checkerAt + 1] : undefined;
  const rest = args.filter(
    (_, i) => (i !== checkerAt && i !== checkerAt + 1) || checkerAt < 0,
  );
  const dir = rest[0];
  if (!dir || rest.length !== 1 || (checkerAt >= 0 && !repo)) {
    process.stderr.write(
      "usage: book-package-inspect <package-dir> [--checker-repo <knowledge-contract checkout>]\n",
    );
    return 2;
  }
  let result;
  let read: ReadReport;
  try {
    read = readPackageDirectoryReport(dir);
    result = inspectBookPackage(read.files);
  } catch (e) {
    const code = e instanceof ReadRefusal ? e.code : "read_error";
    process.stderr.write(
      `cannot read package directory [${code}]: ${(e as Error).message}\n`,
    );
    return 2;
  }
  const out: Record<string, unknown> = {
    ...result,
    read_limits: { used: read.limits_used, observed: read.observed },
  };
  if (repo) {
    // The checker never sees the mutable directory: it runs on a private snapshot of the bytes judged above.
    const { agreement } = checkOnSnapshot(read.files, dir, (snap) =>
      runChecker(repo, snap),
    );
    if (!("verdict" in agreement)) {
      const problems = agreement["checker_problems"] as string[];
      const c = compare(problems, result.refusals);
      Object.assign(agreement, {
        verdict: c.agree ? "AGREE" : "DISAGREE",
        inspector_verdict: result.verdict,
        reasons: c.reasons,
        exact_schema_locations: c.exactLocations,
      });
    }
    out["agreement"] = agreement;
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  return result.verdict === "pass" ? 0 : 1;
}

process.exitCode = main(process.argv);
