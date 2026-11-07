import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
} from "node:fs";

export interface ReadLimits {
  maxFiles?: number;
  /** Total bytes of all regular files, charged from the bytes actually read. */
  maxBytes?: number;
  /** Bytes of any single file, charged from the bytes actually read. */
  maxFileBytes?: number;
}

export const DEFAULT_READ_LIMITS = {
  maxFiles: 2000,
  maxBytes: 512 * 1024 * 1024,
  maxFileBytes: 64 * 1024 * 1024,
} as const;

/** Typed refusal codes of the directory reader. Every one is an ordinary `RangeError` subclass with a stable `code`. */
export type ReadRefusalCode =
  | "read_too_many_files"
  | "read_file_too_large"
  | "read_total_too_large"
  | "read_file_grew"
  | "read_file_shrunk"
  | "read_file_changed"
  | "read_root_not_directory"
  | "read_anchor_unavailable"
  | "read_io_error";

export class ReadRefusal extends RangeError {
  readonly code: ReadRefusalCode;
  readonly where: string;
  constructor(code: ReadRefusalCode, where: string, detail: string) {
    super(`${code}: ${detail} (${where})`);
    this.name = "ReadRefusal";
    this.code = code;
    this.where = where;
  }
}

/** An entry that was found but deliberately not read (a symlink or a special file). It is absent from `files`. */
export interface SkippedEntry {
  path: string;
  kind: "symlink_or_unopenable" | "special_file";
}

export interface ReadReport {
  files: Map<string, Uint8Array>;
  /** The limits actually applied (defaults filled in). */
  limits_used: { maxFiles: number; maxBytes: number; maxFileBytes: number };
  observed: {
    files: number;
    /** Bytes actually read, summed over every file. */
    bytes: number;
    largest_file: { path: string; bytes: number } | null;
  };
  skipped: SkippedEntry[];
  /** The package root as resolved once at the start; every later open is anchored under it. */
  root_realpath: string;
}

/**
 * Test seams. Production callers pass nothing. Each hook runs at one named point of the read so a test can mutate the
 * directory exactly there, deterministically.
 */
export interface ReadHooks {
  /** Just before an entry (file or directory) is opened under its already-open parent directory. */
  beforeOpen?: (rel: string) => void;
  /** After the opened file was fstat-ed and before its first byte is read. */
  beforeRead?: (rel: string) => void;
  /** After a chunk of a file was read, before the next one. */
  afterChunk?: (rel: string, bytesSoFar: number) => void;
}

const CHUNK = 1024 * 1024;
const O_RDONLY = constants.O_RDONLY;
const O_NOFOLLOW = constants.O_NOFOLLOW;
const O_DIRECTORY = constants.O_DIRECTORY;
const O_NONBLOCK = constants.O_NONBLOCK;

function errno(e: unknown): string {
  return (e as NodeJS.ErrnoException).code ?? "EUNKNOWN";
}

/** A name under an open directory descriptor, expressed through the kernel's descriptor path (Linux). */
const underFd = (fd: number, name: string): string =>
  `/proc/self/fd/${String(fd)}/${name}`;

/**
 * Read one package directory into relative-path → bytes. Read-only.
 *
 * Boundary (R-BPI-READ1). The root is resolved ONCE with realpath and opened with O_DIRECTORY|O_NOFOLLOW. Every child is then
 * opened relative to its already-open parent descriptor (`/proc/self/fd/<dirfd>/<name>`, the descriptor-anchored form Node can
 * express without `openat`) with O_NOFOLLOW, so a parent component swapped for a symlink after it was opened cannot redirect a
 * later open: the walk keeps reading the directory it actually opened. The file type is decided by `fstat` on the OPENED
 * descriptor, never by a separate pathname `lstat`; only regular files are read and directories descended. A symlink, FIFO,
 * socket or device is not read (a FIFO is opened O_NONBLOCK and never blocks) and is listed in `skipped`; it is absent from the
 * result, so the inspector reports the component missing, as the checker's safe_file does. Requires /proc (Linux); otherwise the
 * read refuses with `read_anchor_unavailable` rather than falling back to a pathname race.
 *
 * Budget (R-BPI-READ2). Bytes are read from the descriptor in bounded chunks and charged — per file and in total — against the
 * bytes ACTUALLY read; the read stops at limit+1 before any further allocation. A file whose actual size differs from its
 * `fstat` size (it grew or shrank while being read) or whose size/mtime changed by the end is a typed refusal.
 */
export function readPackageDirectoryReport(
  root: string,
  limits: ReadLimits = {},
  hooks: ReadHooks = {},
): ReadReport {
  const used = {
    maxFiles: limits.maxFiles ?? DEFAULT_READ_LIMITS.maxFiles,
    maxBytes: limits.maxBytes ?? DEFAULT_READ_LIMITS.maxBytes,
    maxFileBytes: limits.maxFileBytes ?? DEFAULT_READ_LIMITS.maxFileBytes,
  };
  try {
    closeSync(openSync("/proc/self/fd", O_RDONLY | O_DIRECTORY));
  } catch {
    throw new ReadRefusal(
      "read_anchor_unavailable",
      root,
      "descriptor-anchored opens need /proc (Linux)",
    );
  }
  const out = new Map<string, Uint8Array>();
  const skipped: SkippedEntry[] = [];
  let total = 0;
  let largest: { path: string; bytes: number } | null = null;

  const rootReal = realpathSync(root);
  const rootFd = openSync(rootReal, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);

  const readFile = (fd: number, rel: string): Uint8Array => {
    const st = fstatSync(fd);
    const allowance = Math.min(used.maxFileBytes, used.maxBytes - total);
    if (st.size > allowance) {
      throw st.size > used.maxFileBytes
        ? new ReadRefusal(
            "read_file_too_large",
            rel,
            `declared size ${String(st.size)} exceeds the per-file limit ${String(used.maxFileBytes)}`,
          )
        : new ReadRefusal(
            "read_total_too_large",
            rel,
            "package exceeds the total byte limit",
          );
    }
    hooks.beforeRead?.(rel);
    const chunks: Buffer[] = [];
    let got = 0;
    for (;;) {
      // Never ask for more than limit+1 bytes in total: the +1 byte is the evidence of an over-limit file, and nothing more is
      // allocated after it.
      const want = Math.min(CHUNK, allowance + 1 - got);
      const buf = Buffer.allocUnsafe(want);
      const n = readSync(fd, buf, 0, want, null);
      if (n === 0) break;
      got += n;
      if (got > allowance) {
        throw got > used.maxFileBytes
          ? new ReadRefusal(
              "read_file_too_large",
              rel,
              `read past the per-file limit ${String(used.maxFileBytes)}`,
            )
          : new ReadRefusal(
              "read_total_too_large",
              rel,
              "read past the total byte limit",
            );
      }
      chunks.push(n === want ? buf : buf.subarray(0, n));
      hooks.afterChunk?.(rel, got);
    }
    if (got !== st.size) {
      throw new ReadRefusal(
        got > st.size ? "read_file_grew" : "read_file_shrunk",
        rel,
        `fstat size ${String(st.size)}, bytes read ${String(got)}`,
      );
    }
    const end = fstatSync(fd);
    if (end.size !== st.size || end.mtimeMs !== st.mtimeMs) {
      throw new ReadRefusal(
        "read_file_changed",
        rel,
        "size or mtime changed while the file was read",
      );
    }
    total += got;
    return new Uint8Array(Buffer.concat(chunks, got));
  };

  const walk = (dirFd: number, prefix: string): void => {
    for (const entry of readdirSync(`/proc/self/fd/${String(dirFd)}`).sort()) {
      const rel = prefix === "" ? entry : `${prefix}/${entry}`;
      hooks.beforeOpen?.(rel);
      let fd: number;
      try {
        fd = openSync(
          underFd(dirFd, entry),
          O_RDONLY | O_NOFOLLOW | O_NONBLOCK,
        );
      } catch (e) {
        const c = errno(e);
        if (
          c === "ELOOP" ||
          c === "ENXIO" ||
          c === "ENOENT" ||
          c === "EACCES"
        ) {
          // ELOOP: a symlink (O_NOFOLLOW). ENXIO: a FIFO/socket/device with nothing to open. ENOENT: removed since listed.
          skipped.push({ path: rel, kind: "symlink_or_unopenable" });
          continue;
        }
        throw new ReadRefusal("read_io_error", rel, c);
      }
      try {
        const st = fstatSync(fd);
        if (st.isDirectory()) walk(fd, rel);
        else if (st.isFile()) {
          if (out.size + 1 > used.maxFiles)
            throw new ReadRefusal(
              "read_too_many_files",
              rel,
              `more than ${String(used.maxFiles)} files`,
            );
          const bytes = readFile(fd, rel);
          if (largest === null || bytes.length > largest.bytes)
            largest = { path: rel, bytes: bytes.length };
          out.set(rel, bytes);
        } else skipped.push({ path: rel, kind: "special_file" });
      } finally {
        closeSync(fd);
      }
    }
  };
  try {
    if (!fstatSync(rootFd).isDirectory())
      throw new ReadRefusal("read_root_not_directory", root, "not a directory");
    walk(rootFd, "");
  } finally {
    closeSync(rootFd);
  }
  return {
    files: out,
    limits_used: used,
    observed: { files: out.size, bytes: total, largest_file: largest },
    skipped,
    root_realpath: rootReal,
  };
}

export function readPackageDirectory(
  root: string,
  limits: ReadLimits = {},
): Map<string, Uint8Array> {
  return readPackageDirectoryReport(root, limits).files;
}
