import type { Digest } from "./types.js";

export type DigestComparison = "EQUAL" | "DIFFERENT" | "INCOMPARABLE_DOMAINS";

/** Digests are comparable only inside one algorithm, role, domain, preimage and representation. */
export function compareDigests(a: Digest, b: Digest): DigestComparison {
  if (
    a.algorithm !== b.algorithm ||
    a.role !== b.role ||
    a.domain !== b.domain ||
    a.preimage !== b.preimage ||
    a.representation !== b.representation
  ) {
    return "INCOMPARABLE_DOMAINS";
  }
  return a.value === b.value ? "EQUAL" : "DIFFERENT";
}

/** Only an exact_content digest names content. A fingerprint or domain identity never does. */
export function isExactContentAddress(d: Digest): boolean {
  return d.role === "exact_content" && d.domain === "raw-bytes";
}
