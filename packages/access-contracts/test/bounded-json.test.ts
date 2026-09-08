import { describe, expect, it } from "vitest";

import { parseBoundedJson } from "../src/index.js";

// Fixtures are ASCII unless bytes are explicitly supplied below.
const bytes = (text: string): Uint8Array =>
  Uint8Array.from([...text].map((char) => char.charCodeAt(0)));
const parse = (text: string): unknown => parseBoundedJson(bytes(text));
const nested = (depth: number, leaf = "0"): string =>
  "[".repeat(depth) + leaf + "]".repeat(depth);

function rejects(raw: Uint8Array): void {
  expect(() => parseBoundedJson(raw)).toThrow(SyntaxError);
  expect(() => parseBoundedJson(raw)).toThrow(/^Invalid bounded JSON$/);
}

describe("parseBoundedJson public export", () => {
  it("rejects array-like impostors before reading their allocation length", () => {
    const impostor = {
      byteLength: 1,
      get length(): never {
        throw new Error("Array-like allocation must not be attempted");
      },
    };
    rejects(impostor as unknown as Uint8Array);
    rejects(new Uint16Array([123]) as unknown as Uint8Array);
  });

  it("uses the intrinsic byte bound even if an instance shadows byteLength", () => {
    const raw = new Uint8Array(65533);
    Object.defineProperty(raw, "byteLength", { value: 1 });
    rejects(raw);
  });
  it.each([
    "null",
    "true",
    "false",
    "0",
    "-0",
    "1.25e+2",
    '""',
    '"escaped \\" \\\\ \\/ \\b \\f \\n \\r \\t"',
    "[]",
    "{}",
    ' \t\r\n {"a":[null,true,false,12.5],"b":{"c":"ok"}} \n',
  ])("preserves valid JSON: %s", (raw) => {
    expect(parse(raw)).toEqual(JSON.parse(raw));
  });

  it.each([
    '{"a":1,"a":1}',
    '{"a":1,"\\u0061":1}',
    '{"outer":{"a":1,"a":1}}',
    '[{"a":1,"a":1}]',
    '{"":null,"":null}',
    '{"__proto__":{},"__proto__":{}}',
    '{"\\ud83d\\ude00":1,"\\uD83D\\uDE00":1}',
  ])("rejects otherwise valid equal-valued duplicates: %s", (raw) => {
    // Mutation control: native parsing succeeds; only duplicate rejection
    // makes this fixture fail. No conflicting values or schema errors.
    expect(() => JSON.parse(raw)).not.toThrow();
    rejects(bytes(raw));
  });

  it("keeps distinct keys and separate object scopes", () => {
    const raw = '{"a":1,"A":1,"b":{"a":1},"c":{"a":1}}';
    expect(parse(raw)).toEqual(JSON.parse(raw));
    expect(parse('{"e\\u0301":1,"\\u00e9":1}')).toEqual({
      "e\u0301": 1,
      "\u00e9": 1,
    });
    const proto = parse('{"__proto__":{"x":1},"constructor":2}') as object;
    expect(Object.getPrototypeOf(proto)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(proto, "__proto__")).toBe(true);
  });

  it("counts root as depth zero, including empty container leaves", () => {
    for (const leaf of ["0", "[]", "{}", '"x"']) {
      expect(parse(nested(16, leaf))).toEqual(JSON.parse(nested(16, leaf)));
      rejects(bytes(nested(17, leaf)));
    }
    const objects = (depth: number): string =>
      '{"a":'.repeat(depth) + "null" + "}".repeat(depth);
    expect(parse(objects(16))).toEqual(JSON.parse(objects(16)));
    rejects(bytes(objects(17)));
    rejects(bytes(nested(10000)));
  });

  it("bounds the supplied byte view before decoding", () => {
    const maximum = '"' + "a".repeat(65530) + '"';
    expect(parse(maximum)).toBe("a".repeat(65530));
    rejects(bytes(maximum + " "));
    rejects(new Uint8Array());
    rejects(bytes(" \t\r\n"));
    const backing = bytes("x" + maximum + "x");
    expect(parseBoundedJson(backing.subarray(1, -1))).toBe("a".repeat(65530));
    // 32767 UTF-16 code units, but 65532 UTF-8 bytes including quotes.
    const unicode = new Uint8Array(65532);
    unicode[0] = 34;
    for (let i = 1; i < 65531; i += 2) unicode.set([0xc3, 0xa9], i);
    unicode[65531] = 34;
    expect(parseBoundedJson(unicode)).toBe("é".repeat(32765));
    const oversized = new Uint8Array(65533);
    oversized.set(unicode);
    oversized[65532] = 32;
    rejects(oversized);
  });

  it.each([
    [0x80],
    [0xc0, 0xaf],
    [0xc2],
    [0xc2, 0x20],
    [0xe0, 0x80, 0xaf],
    [0xed, 0xa0, 0x80],
    [0xf0, 0x80, 0x80, 0xaf],
    [0xf4, 0x90, 0x80, 0x80],
    [0xf5, 0x80, 0x80, 0x80],
    [0xff],
    [0xe2, 0x82],
  ])(
    "rejects malformed UTF-8 within an otherwise quoted string: %j",
    (...bad) => {
      rejects(Uint8Array.from([34, ...bad, 34]));
    },
  );

  it("accepts the scalar boundaries of every UTF-8 sequence width", () => {
    const cases: [number[], string][] = [
      [[0xc2, 0x80], "\u0080"],
      [[0xdf, 0xbf], "\u07ff"],
      [[0xe0, 0xa0, 0x80], "\u0800"],
      [[0xed, 0x9f, 0xbf], "\ud7ff"],
      [[0xee, 0x80, 0x80], "\ue000"],
      [[0xef, 0xbf, 0xbf], "\uffff"],
      [[0xf0, 0x90, 0x80, 0x80], "\ud800\udc00"],
      [[0xf4, 0x8f, 0xbf, 0xbf], "\udbff\udfff"],
    ];
    for (const [encoded, expected] of cases) {
      expect(parseBoundedJson(Uint8Array.from([34, ...encoded, 34]))).toBe(
        expected,
      );
    }
  });

  it("rejects BOM but preserves valid Unicode inside strings", () => {
    rejects(Uint8Array.from([0xef, 0xbb, 0xbf, 110, 117, 108, 108]));
    rejects(Uint8Array.from([32, 0xef, 0xbb, 0xbf, 48]));
    expect(
      parseBoundedJson(
        Uint8Array.from([
          34, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80, 0xef, 0xbb,
          0xbf, 34,
        ]),
      ),
    ).toBe("é€😀\ufeff");
    expect(parse('"\\ud83d\\ude00"')).toBe("😀");
    expect(parse('"\\u0000\\uD7FF\\uE000\\uFFFF"')).toBe(
      "\0\ud7ff\ue000\uffff",
    );
    // Literal and escaped Unicode keys collide after decoding.
    rejects(
      Uint8Array.from([
        ...bytes('{"'),
        0xc3,
        0xa9,
        ...bytes('":1,"\\u00e9":1}'),
      ]),
    );
  });

  it.each([
    '"\\ud800"',
    '"\\udfff"',
    '"\\ud800x"',
    '"\\ud800\\ud800"',
    '"\\udc00\\ud800"',
    '{"\\ud800":0}',
  ])("rejects lone surrogate escapes: %s", (raw) => rejects(bytes(raw)));

  it.each([
    "1e309",
    "-1e309",
    "1.7976931348623159e308",
    "[1e309]",
    '{"n":-1e309}',
  ])("rejects non-finite decoded numbers: %s", (raw) => rejects(bytes(raw)));

  it.each([
    "1.7976931348623157e308",
    "-1.7976931348623157e308",
    "5e-324",
    "1e-400",
    "9007199254740993",
    "-0",
    "-1e-400",
  ])("retains native finite-number semantics: %s", (raw) => {
    expect(Object.is(parse(raw), JSON.parse(raw))).toBe(true);
  });

  it.each([
    "null true",
    "{}[]",
    "0garbage",
    "[1,]",
    '{"a":1,}',
    "[",
    "{",
    '"unfinished',
    '"bad\\x20"',
    '"bad\\u12"',
    '"line\nfeed"',
    '"control\u0000"',
    "[1 2]",
    '{"a" 1}',
    "{a:1}",
    "01",
    "+1",
    ".1",
    "1.",
    "1e",
    "NaN",
    "Infinity",
    "undefined",
    "// comment\n0",
    "\u000b0",
    "\u00a00",
    '{"secret-sentinel":oops}',
  ])("rejects malformed syntax without disclosing data: %s", (raw) => {
    rejects(bytes(raw));
  });
});
