import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Read one package directory into relative-path → bytes. Read-only. Regular files only: a symlink or special file anywhere
 * below the root is not read (it is simply absent from the result, so the inspector reports it as missing, as the checker's
 * safe_file does). Stops at `maxFiles` / `maxBytes` rather than reading an unbounded directory.
 */
export function readPackageDirectory(
  root: string,
  limits: { maxFiles?: number; maxBytes?: number } = {},
): Map<string, Uint8Array> {
  const maxFiles = limits.maxFiles ?? 2000;
  const maxBytes = limits.maxBytes ?? 512 * 1024 * 1024;
  const out = new Map<string, Uint8Array>();
  let total = 0;
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const rel = prefix === "" ? entry : `${prefix}/${entry}`;
      const st = lstatSync(full);
      if (st.isDirectory()) walk(full, rel);
      else if (st.isFile()) {
        total += st.size;
        if (out.size + 1 > maxFiles || total > maxBytes)
          throw new RangeError("package directory exceeds the read limits");
        out.set(rel, new Uint8Array(readFileSync(full)));
      }
    }
  };
  walk(root, "");
  return out;
}
