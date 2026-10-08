/** Fixed wire limits; root value is depth 0, each member/element adds one. */
const MAX_BYTES = 65532;
const MAX_DEPTH = 16;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
)!.get!;

function invalid(): never {
  throw new SyntaxError("Invalid bounded JSON");
}

/** Strict UTF-8 without DOM types, Node globals, or replacement decoding. */
function decodeUtf8(raw: Uint8Array): string {
  const chars: string[] = [];
  for (let i = 0; i < raw.length; ) {
    const first = raw[i++]!;
    if (first < 0x80) {
      chars.push(String.fromCharCode(first));
      continue;
    }
    let remaining: number;
    let point: number;
    let minimum: number;
    if (first >= 0xc2 && first <= 0xdf) {
      remaining = 1;
      point = first & 0x1f;
      minimum = 0x80;
    } else if (first >= 0xe0 && first <= 0xef) {
      remaining = 2;
      point = first & 0x0f;
      minimum = 0x800;
    } else if (first >= 0xf0 && first <= 0xf4) {
      remaining = 3;
      point = first & 0x07;
      minimum = 0x10000;
    } else {
      return invalid();
    }
    if (i + remaining > raw.length) invalid();
    while (remaining-- > 0) {
      const next = raw[i++]!;
      if ((next & 0xc0) !== 0x80) invalid();
      point = (point << 6) | (next & 0x3f);
    }
    if (
      point < minimum ||
      point > 0x10ffff ||
      (point >= 0xd800 && point <= 0xdfff)
    ) {
      invalid();
    }
    chars.push(String.fromCodePoint(point));
  }
  return chars.join("");
}

/**
 * Parse one JSON value from 1..65532 UTF-8 bytes, with value depth at most 16.
 * Reject BOM, decoded duplicate keys, lone surrogates and non-finite numbers.
 * Finite numbers retain JSON.parse's IEEE-754 rounding and negative zero.
 * Throws only a fixed, data-free SyntaxError on invalid input. This performs
 * syntax validation only; it does not authenticate or authorize the result.
 */
export function parseBoundedJson(raw: Uint8Array): unknown {
  try {
    if (!(raw instanceof Uint8Array)) invalid();
    const length = typedArrayByteLength.call(raw) as number;
    if (length === 0 || length > MAX_BYTES) invalid();
    // Copy only the supplied view, after bounding allocation.
    const text = decodeUtf8(new Uint8Array(raw));
    if (text.charCodeAt(0) === 0xfeff) invalid();
    validateGrammar(text);
    return JSON.parse(text) as unknown;
  } catch {
    // Native JSON.parse diagnostics can quote data; never propagate them.
    return invalid();
  }
}

function validateGrammar(text: string): void {
  let i = 0;
  const atom =
    /(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/y;
  function whitespace(): void {
    while (
      text[i] === " " ||
      text[i] === "\t" ||
      text[i] === "\r" ||
      text[i] === "\n"
    ) {
      i++;
    }
  }
  function string(): string {
    const start = i;
    if (text[i++] !== '"') return invalid();
    while (i < text.length) {
      const char = text[i++];
      if (char === "\\") {
        i++;
      } else if (char === '"') {
        // Validates escapes and unescaped control characters before key use.
        const decoded = JSON.parse(text.slice(start, i)) as string;
        for (let j = 0; j < decoded.length; j++) {
          const code = decoded.charCodeAt(j);
          if (code >= 0xd800 && code <= 0xdbff) {
            const low = decoded.charCodeAt(++j);
            if (!(low >= 0xdc00 && low <= 0xdfff)) invalid();
          } else if (code >= 0xdc00 && code <= 0xdfff) {
            invalid();
          }
        }
        return decoded;
      }
    }
    return invalid();
  }
  function value(depth: number): void {
    if (depth > MAX_DEPTH) invalid();
    whitespace();
    if (text[i] === "{") {
      i++;
      whitespace();
      const keys = new Set<string>();
      if (text[i] === "}") {
        i++;
        return;
      }
      for (;;) {
        whitespace();
        const key = string();
        if (keys.has(key)) invalid();
        keys.add(key);
        whitespace();
        if (text[i++] !== ":") invalid();
        value(depth + 1);
        whitespace();
        if (text[i] === "}") {
          i++;
          return;
        }
        if (text[i++] !== ",") invalid();
      }
    }
    if (text[i] === "[") {
      i++;
      whitespace();
      if (text[i] === "]") {
        i++;
        return;
      }
      for (;;) {
        value(depth + 1);
        whitespace();
        if (text[i] === "]") {
          i++;
          return;
        }
        if (text[i++] !== ",") invalid();
      }
    }
    if (text[i] === '"') {
      string();
      return;
    }
    atom.lastIndex = i;
    const match = atom.exec(text);
    if (match === null) return invalid();
    const token = match[0];
    if (
      token !== "true" &&
      token !== "false" &&
      token !== "null" &&
      !Number.isFinite(Number(token))
    ) {
      invalid();
    }
    i = atom.lastIndex;
  }
  value(0);
  whitespace();
  if (i !== text.length) invalid();
}
