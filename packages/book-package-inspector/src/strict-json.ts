/**
 * Strict JSON reader with the same interpretation as `strict_json` in the pinned checker (tools/check_book_package.py):
 * duplicate object members, non-finite constants, isolated surrogates and numbers that overflow the finite range are
 * refused. Two deliberate, documented differences are conservative refusals the Python checker does not make:
 * an integer literal outside the IEEE-754 safe range (`unsupported_number`), and nesting deeper than MAX_DEPTH.
 */

export class StrictJsonError extends Error {
  constructor(
    readonly kind:
      | "syntax"
      | "duplicate_member"
      | "non_finite"
      | "surrogate"
      | "overflow"
      | "unsupported_number"
      | "too_deep",
    message: string,
  ) {
    super(message);
    this.name = "StrictJsonError";
  }
}

const MAX_DEPTH = 256;
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const LONE_SURROGATE =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function fail(kind: StrictJsonError["kind"], text: string): never {
  throw new StrictJsonError(kind, text);
}

export function parseStrictJson(text: string): unknown {
  let i = 0;

  const ws = (): void => {
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i += 1;
      else break;
    }
  };

  const string = (): string => {
    // opening quote already checked
    i += 1;
    let out = "";
    for (;;) {
      if (i >= text.length) fail("syntax", "unterminated string");
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        i += 1;
        break;
      }
      if (c < 0x20) fail("syntax", "control character in string");
      if (c === 0x5c) {
        const e = text[i + 1];
        i += 2;
        switch (e) {
          case '"':
            out += '"';
            break;
          case "\\":
            out += "\\";
            break;
          case "/":
            out += "/";
            break;
          case "b":
            out += "\b";
            break;
          case "f":
            out += "\f";
            break;
          case "n":
            out += "\n";
            break;
          case "r":
            out += "\r";
            break;
          case "t":
            out += "\t";
            break;
          case "u": {
            const hex = text.slice(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex))
              fail("syntax", "bad unicode escape");
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            fail("syntax", "bad escape");
        }
        continue;
      }
      out += text[i];
      i += 1;
    }
    if (LONE_SURROGATE.test(out))
      fail("surrogate", "isolated surrogate in JSON string");
    return out;
  };

  const value = (depth: number): unknown => {
    if (depth > MAX_DEPTH) fail("too_deep", "nesting too deep");
    ws();
    const c = text[i];
    if (c === "{") {
      i += 1;
      const obj: Record<string, unknown> = Object.create(null) as Record<
        string,
        unknown
      >;
      ws();
      if (text[i] === "}") {
        i += 1;
        return obj;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') fail("syntax", "expected member name");
        const key = string();
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          fail(
            "duplicate_member",
            `duplicate JSON member ${JSON.stringify(key)}`,
          );
        }
        ws();
        if (text[i] !== ":") fail("syntax", "expected ':'");
        i += 1;
        obj[key] = value(depth + 1);
        ws();
        if (text[i] === ",") {
          i += 1;
          continue;
        }
        if (text[i] === "}") {
          i += 1;
          return obj;
        }
        fail("syntax", "expected ',' or '}'");
      }
    }
    if (c === "[") {
      i += 1;
      const arr: unknown[] = [];
      ws();
      if (text[i] === "]") {
        i += 1;
        return arr;
      }
      for (;;) {
        arr.push(value(depth + 1));
        ws();
        if (text[i] === ",") {
          i += 1;
          continue;
        }
        if (text[i] === "]") {
          i += 1;
          return arr;
        }
        fail("syntax", "expected ',' or ']'");
      }
    }
    if (c === '"') return string();
    if (text.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (text.startsWith("false", i)) {
      i += 5;
      return false;
    }
    if (text.startsWith("null", i)) {
      i += 4;
      return null;
    }
    for (const constant of ["NaN", "Infinity", "-Infinity"]) {
      if (text.startsWith(constant, i))
        fail("non_finite", `non-finite JSON number ${constant}`);
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (!m) fail("syntax", "unexpected token");
    i += m[0].length;
    const n = Number(m[0]);
    if (!Number.isFinite(n))
      fail("overflow", "numeric value overflows the finite parser range");
    if (/^-?[0-9]+$/.test(m[0]) && !Number.isSafeInteger(n)) {
      fail("unsupported_number", "integer outside the IEEE-754 safe range");
    }
    return n;
  };

  const result = value(0);
  ws();
  if (i !== text.length) fail("syntax", "extra data after the JSON value");
  return result;
}
