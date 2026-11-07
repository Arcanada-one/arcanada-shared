import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { readPackageDirectoryReport } from "./node.js";

const sha256 = (b: Uint8Array): string =>
  createHash("sha256").update(b).digest("hex");

export interface Snapshot {
  /** The private directory the checker must be pointed at. Its leaf name equals the package directory's. */
  dir: string;
  /** relative path → sha256 of the bytes the inspector judged. */
  sha256: Record<string, string>;
  cleanup: () => void;
}

/**
 * Evidence boundary for AGREE (R-BPI-AGREE): the inspector's bytes are copied into a fresh private snapshot (mode 0700 directory,
 * 0600 files, created exclusively) and the pinned checker is run on THAT copy, never on the mutable original. Both judges
 * therefore see the same bytes. The snapshot is hashed against the inspector's bytes before and after the checker runs; any
 * difference (a file changed, added or removed) makes the agreement NOT_MEASURED rather than AGREE.
 */
export function makeSnapshot(
  files: Map<string, Uint8Array>,
  packageDir: string,
  parent: string = tmpdir(),
): Snapshot {
  const base = mkdtempSync(join(parent, "bpi-snap-"));
  chmodSync(base, 0o700);
  const leaf = basename(packageDir.replace(/\/+$/, "")) || "package";
  const dir = join(base, leaf);
  mkdirSync(dir, { mode: 0o700 });
  const hashes: Record<string, string> = {};
  for (const [rel, bytes] of files) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
    hashes[rel] = sha256(bytes);
  }
  return {
    dir,
    sha256: hashes,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

/** Re-read the snapshot through the same anchored reader and compare to the recorded hashes. Returns a reason on difference. */
export function verifySnapshot(s: Snapshot): string | null {
  let now: Map<string, Uint8Array>;
  try {
    now = readPackageDirectoryReport(s.dir).files;
  } catch (e) {
    return `snapshot unreadable: ${(e as Error).message.slice(0, 200)}`;
  }
  const want = Object.keys(s.sha256).sort();
  const have = [...now.keys()].sort();
  if (want.join("\0") !== have.join("\0")) return "snapshot file set changed";
  for (const rel of want) {
    if (sha256(now.get(rel) as Uint8Array) !== s.sha256[rel])
      return `snapshot bytes changed: ${rel}`;
  }
  return null;
}

export interface AgreeHooks {
  /** After the snapshot was written, before it is verified and the checker starts. */
  beforeChecker?: (snapshotDir: string) => void;
  /** After the checker returned, before the snapshot is verified again. */
  afterChecker?: (snapshotDir: string) => void;
}

/**
 * Run `runChecker(dir)` on a private snapshot of `files`. `runChecker` receives the snapshot directory and returns the agreement
 * record fragment. Result: the fragment plus `snapshot` evidence, or NOT_MEASURED when the snapshot did not stay identical to the
 * inspector's bytes. The original directory is never handed to the checker.
 */
export function checkOnSnapshot(
  files: Map<string, Uint8Array>,
  packageDir: string,
  runChecker: (dir: string) => { agreement: unknown },
  hooks: AgreeHooks = {},
  parent?: string,
): { agreement: Record<string, unknown> } {
  const snap = makeSnapshot(files, packageDir, parent);
  const evidence = (verified_before: boolean, verified_after: boolean) => ({
    kind: "private_copy",
    note: "checker ran on a private copy of the exact bytes the inspector judged; hashes re-verified before and after",
    files: Object.keys(snap.sha256).length,
    verified_before,
    verified_after,
    file_sha256: snap.sha256,
  });
  try {
    hooks.beforeChecker?.(snap.dir);
    const before = verifySnapshot(snap);
    if (before !== null)
      return {
        agreement: {
          verdict: "NOT_MEASURED",
          reason: `snapshot_changed_before_checker: ${before}`,
          snapshot: evidence(false, false),
        },
      };
    const { agreement } = runChecker(snap.dir) as {
      agreement: Record<string, unknown>;
    };
    hooks.afterChecker?.(snap.dir);
    const after = verifySnapshot(snap);
    if (after !== null)
      return {
        agreement: {
          verdict: "NOT_MEASURED",
          reason: `snapshot_changed_during_checker: ${after}`,
          snapshot: evidence(true, false),
        },
      };
    return { agreement: { ...agreement, snapshot: evidence(true, true) } };
  } finally {
    snap.cleanup();
  }
}
