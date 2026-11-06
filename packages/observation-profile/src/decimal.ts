const DECIMAL = /^(0|[1-9][0-9]*)$/;

/** True for a canonical nonnegative decimal string (no sign, no leading zeros, no JSON number). */
export function isCanonicalDecimal(value: unknown): value is string {
  return typeof value === "string" && DECIMAL.test(value);
}

/** Arbitrary-precision comparison of canonical decimal strings: length first, then lexical order. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  if (!isCanonicalDecimal(a) || !isCanonicalDecimal(b)) {
    throw new RangeError(
      "compareDecimal requires canonical nonnegative decimal strings",
    );
  }
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Exact successor of a canonical decimal string. */
export function nextDecimal(a: string): string {
  if (!isCanonicalDecimal(a))
    throw new RangeError("nextDecimal requires a canonical decimal string");
  const digits = a.split("");
  let i = digits.length - 1;
  while (i >= 0) {
    if (digits[i] === "9") {
      digits[i] = "0";
      i -= 1;
    } else {
      digits[i] = String(Number(digits[i]) + 1);
      return digits.join("");
    }
  }
  return `1${digits.join("")}`;
}
