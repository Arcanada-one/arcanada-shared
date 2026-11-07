import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ReadLimits {
  maxFiles?: number;
  /** Total bytes of all regular files. */
  maxBytes?: number;
  /** Bytes of any single file. Checked from the file size before the file is read. */
  maxFileBytes?: number;
}

export const DEFAULT_READ_LIMITS = {
  maxFiles: 2000,
  maxBytes: 512 * 1024 * 1024,
  maxFileBytes: 64 * 1024 * 1024,
} as const;

export interface ReadReport {
  files: Map<string, Uint8Array>;
  /** The limits actually applied (defaults filled in). */
  limits_used: { maxFiles: number; maxBytes: number; maxFileBytes: number };
  observed: {
    files: number;
    bytes: number;
    largest_file: { path: string; bytes: number } | null;
  };
}

/**
 * Read one package directory into relative-path → bytes. Read-only. Regular files only: a symlink or special file anywhere
 * below the root is not read (it is simply absent from the result, so the inspector reports it as missing, as the checker's
 * safe_file does). Each limit is checked from the file size (`lstat`) BEFORE the file is read; an over-limit directory throws
 * RangeError rather than being read. The returned report records the limits used and what was observed.
 */
export function readPackageDirectoryReport(
  root: string,
  limits: ReadLimits = {},
): ReadReport {
  const used = {
    maxFiles: limits.maxFiles ?? DEFAULT_READ_LIMITS.maxFiles,
    maxBytes: limits.maxBytes ?? DEFAULT_READ_LIMITS.maxBytes,
    maxFileBytes: limits.maxFileBytes ?? DEFAULT_READ_LIMITS.maxFileBytes,
  };
  const out = new Map<string, Uint8Array>();
  let total = 0;
  let largest: { path: string; bytes: number } | null = null;
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const rel = prefix === "" ? entry : `${prefix}/${entry}`;
      const st = lstatSync(full);
      if (st.isDirectory()) walk(full, rel);
      else if (st.isFile()) {
        if (out.size + 1 > used.maxFiles)
          throw new RangeError(
            "package directory exceeds the file-count limit",
          );
        if (st.size > used.maxFileBytes)
          throw new RangeError(
            `package file exceeds the per-file byte limit: ${rel}`,
          );
        total += st.size;
        if (total > used.maxBytes)
          throw new RangeError(
            "package directory exceeds the total byte limit",
          );
        const bytes = new Uint8Array(readFileSync(full));
        if (bytes.length > used.maxFileBytes)
          throw new RangeError(
            `package file exceeds the per-file byte limit: ${rel}`,
          );
        if (largest === null || bytes.length > largest.bytes)
          largest = { path: rel, bytes: bytes.length };
        out.set(rel, bytes);
      }
    }
  };
  walk(root, "");
  return {
    files: out,
    limits_used: used,
    observed: { files: out.size, bytes: total, largest_file: largest },
  };
}

export function readPackageDirectory(
  root: string,
  limits: ReadLimits = {},
): Map<string, Uint8Array> {
  return readPackageDirectoryReport(root, limits).files;
}
