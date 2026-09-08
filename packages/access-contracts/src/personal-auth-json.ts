import type { ValidationResult } from "./index.js";

/** Reject ambiguity before JSON.parse can discard duplicate keys/number spelling. */
export function parsePersonalAuthJson(
  text: unknown,
): ValidationResult<unknown> {
  try {
    if (
      typeof text !== "string" ||
      text.length > 65_536 ||
      [...text].reduce((n, c) => {
        const p = c.codePointAt(0)!;
        return n + (p < 128 ? 1 : p < 2048 ? 2 : p < 65536 ? 3 : 4);
      }, 0) > 65_536
    )
      throw new Error();
    let position = 0;
    const space = () => {
      while (/[\x20\t\r\n]/u.test(text[position] ?? "x")) position++;
    };
    const string = (): string => {
      const start = position++;
      while (position < text.length) {
        const character = text[position++];
        if (character === "\\") position++;
        else if (character === '"') {
          const value: unknown = JSON.parse(text.slice(start, position));
          if (typeof value !== "string") throw new Error();
          for (const scalar of value) {
            const point = scalar.codePointAt(0)!;
            if (point >= 0xd800 && point <= 0xdfff) throw new Error();
          }
          return value;
        }
      }
      throw new Error();
    };
    const value = (depth: number): void => {
      if (depth > 24) throw new Error();
      space();
      const start = text[position];
      if (start === '"') {
        string();
        return;
      }
      if (start === "{" || start === "[") {
        const object = start === "{";
        const end = object ? "}" : "]";
        const keys = new Set<string>();
        position++;
        space();
        if (text[position] === end) {
          position++;
          return;
        }
        for (;;) {
          space();
          if (object) {
            if (text[position] !== '"') throw new Error();
            const key = string();
            if (keys.has(key)) throw new Error();
            keys.add(key);
            space();
            if (text[position++] !== ":") throw new Error();
          }
          value(depth + 1);
          space();
          if (text[position] === end) {
            position++;
            return;
          }
          if (text[position++] !== ",") throw new Error();
        }
      }
      for (const literal of ["true", "false", "null"]) {
        if (text.startsWith(literal, position)) {
          position += literal.length;
          return;
        }
      }
      const number = /^(?:0|[1-9][0-9]*)/u.exec(text.slice(position))?.[0];
      if (!number || !Number.isSafeInteger(Number(number))) throw new Error();
      position += number.length;
    };
    value(0);
    space();
    if (position !== text.length) throw new Error();
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: "malformed personal wire JSON" };
  }
}
