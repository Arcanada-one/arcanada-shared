import type { AllowNonAsciiEntry } from "./types.js";

const NON_ASCII = /[^\x00-\x7F]/;

export function containsDisallowedNonAscii(
  text: string,
  allow: readonly AllowNonAsciiEntry[],
): boolean {
  if (!NON_ASCII.test(text)) {
    return false;
  }
  let remainder = text;
  for (const entry of allow) {
    if (!entry.string || !entry.reason) {
      continue;
    }
    remainder = remainder.split(entry.string).join("");
  }
  return NON_ASCII.test(remainder);
}

export const OPTION_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
