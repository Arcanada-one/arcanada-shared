import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  canonicalKnowledgeObservationJson,
  isKnowledgeObservationDateTime,
  KNOWLEDGE_OBSERVATION_PROFILE_ID,
} from "../src/index.js";
import { isStructurallyValidKnowledgeObservation } from "../src/knowledge-observation-v1.js";
import {
  createReducerState,
  decodeObservationRecord,
  parseKnowledgeObservationJson,
  projectView,
  reduce,
  type ReducerInput,
  type ReducerState,
  type ViewContext,
} from "./knowledge-observation.api.js";
import { bodies, caseMeta, records } from "./knowledge-observation.harness.js";

const CTX = caseMeta.default_view_context as ViewContext;
const enc = (v: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(v));
const rec = (id: string): Record<string, unknown> =>
  structuredClone(records[id]) as Record<string, unknown>;
const recv = (id: string): ReducerInput => ({
  kind: "receive",
  record: rec(id),
});
const sha = (s: string): string =>
  createHash("sha256").update(s, "utf8").digest("hex");

function run(
  inputs: ReducerInput[],
  limits?: Partial<
    Parameters<typeof createReducerState>[0] extends infer O
      ? O extends { limits?: infer L }
        ? NonNullable<L>
        : never
      : never
  >,
): ReducerState {
  let state = createReducerState(
    limits === undefined ? { mode: "fixture" } : { mode: "fixture", limits },
  );
  for (const input of [
    { kind: "bind_trusted_projection", viewContext: CTX } as ReducerInput,
    ...inputs,
  ]) {
    state = reduce(state, input).state;
  }
  return state;
}

describe("dependency-free runtime and root export", () => {
  it("the vendored schema is the unmodified, sha256-pinned Agent-Brain file", () => {
    const sums = readFileSync(
      new URL(
        "./fixtures/knowledge-observation-v1/SHA256SUMS",
        import.meta.url,
      ),
      "utf8",
    );
    const line = sums
      .split("\n")
      .find((l) => l.endsWith("  observation.schema.json"));
    expect(line).toBeDefined();
    const bytes = readFileSync(
      new URL("../src/knowledge-observation-v1.schema.json", import.meta.url),
    );
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      line?.split(" ")[0],
    );
  });

  it("the package still declares no runtime dependencies (ajv is test-only)", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: object; devDependencies: Record<string, string> };
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.devDependencies["ajv"]).toBeDefined();
  });

  it("exposes the profile id and helpers through the package root", () => {
    expect(KNOWLEDGE_OBSERVATION_PROFILE_ID).toBe(
      "knowledge-collective-observation/v1",
    );
    expect(
      canonicalKnowledgeObservationJson({ b: 1, a: [2, { d: 1, c: 2 }] }),
    ).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });
});

describe("the in-package schema interpreter agrees with Ajv 2020 (test-only oracle)", () => {
  const ajv = new Ajv2020({ strict: false, allErrors: false });
  const addFormats = ((
    addFormatsModule as unknown as { default?: (a: Ajv2020) => Ajv2020 }
  ).default ?? (addFormatsModule as unknown as (a: Ajv2020) => Ajv2020)) as (
    a: Ajv2020,
  ) => Ajv2020;
  addFormats(ajv);
  const schema = JSON.parse(
    readFileSync(
      new URL("../src/knowledge-observation-v1.schema.json", import.meta.url),
      "utf8",
    ),
  ) as object;
  const oracle = ajv.compile(schema);

  function* paths(
    v: unknown,
    prefix: (string | number)[] = [],
  ): Generator<(string | number)[]> {
    yield prefix;
    if (Array.isArray(v))
      for (let i = 0; i < v.length; i += 1) yield* paths(v[i], [...prefix, i]);
    else if (typeof v === "object" && v !== null)
      for (const k of Object.keys(v))
        yield* paths((v as Record<string, unknown>)[k], [...prefix, k]);
  }
  function mutate(
    root: unknown,
    path: (string | number)[],
    how: string,
  ): unknown {
    const copy = structuredClone(root) as Record<string | number, unknown>;
    if (path.length === 0) return how === "null" ? null : copy;
    let cur = copy as Record<string | number, unknown>;
    for (const key of path.slice(0, -1))
      cur = cur[key] as Record<string | number, unknown>;
    const last = path[path.length - 1] as string | number;
    if (how === "delete") {
      if (Array.isArray(cur)) cur.splice(last as number, 1);
      else delete cur[last];
    } else if (how === "null") cur[last] = null;
    else if (how === "number") cur[last] = 1;
    else if (how === "empty") cur[last] = "";
    else if (how === "text") cur[last] = "x y";
    else if (how === "array") cur[last] = [];
    else if (how === "extra")
      (cur[last] as Record<string, unknown> | undefined) &&
        typeof cur[last] === "object" &&
        !Array.isArray(cur[last]) &&
        ((cur[last] as Record<string, unknown>)["__extra"] = 1);
    return copy;
  }

  it("classifies all 50 package records identically", () => {
    for (const [key, record] of Object.entries(records)) {
      expect(isStructurallyValidKnowledgeObservation(record), key).toBe(
        oracle(record),
      );
    }
  });

  // CI-sized subset: one lightweight record per record kind and per tricky schema branch. The exhaustive run over all 50
  // records (about 37,600 mutations, ~25 s) is author-side: OBS_FULL_DIFFERENTIAL=1.
  const SUBSET = [
    "run",
    "event-1",
    "doclab-event-100",
    "b2-row-withdrawn",
    "authority-refusal",
    "attempt-succeeded",
    "conflicting-checker-aggregate",
    "attempt-checker-unknown",
    "command-refused",
    "deployment-unmeasured",
    "receipt-captured-2",
    "artifact-fingerprint-only",
    "artifact-denied",
    "invalid-empty-checker-pass",
    "invalid-fingerprint-content-address",
  ];
  const mutationScope = (): [string, unknown][] =>
    process.env["OBS_FULL_DIFFERENTIAL"] === "1"
      ? Object.entries(records)
      : SUBSET.map((k) => [k, records[k]] as [string, unknown]);
  it("classifies every single-point mutation of the selected records identically", () => {
    let compared = 0;
    for (const [key, record] of mutationScope()) {
      for (const path of paths(record)) {
        for (const how of [
          "delete",
          "null",
          "number",
          "empty",
          "text",
          "array",
          "extra",
        ]) {
          const mutated = mutate(record, path, how);
          const a = isStructurallyValidKnowledgeObservation(mutated);
          const b = oracle(mutated) as boolean;
          if (a !== b)
            throw new Error(
              `disagreement at ${key} ${JSON.stringify(path)} ${how}: interpreter=${a} ajv=${b}`,
            );
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(
      process.env["OBS_FULL_DIFFERENTIAL"] === "1" ? 30_000 : 5_000,
    );
  }, 120_000);

  it("agrees with Ajv's date-time format on calendar and offset edge cases", () => {
    const probe = ajv.compile({ type: "string", format: "date-time" });
    const cases = [
      "2000-01-01T00:00:00Z",
      "2000-02-29T00:00:00Z",
      "2001-02-29T00:00:00Z",
      "2000-13-01T00:00:00Z",
      "2000-04-31T00:00:00Z",
      "2000-01-01T24:00:00Z",
      "2000-01-01T23:59:60Z",
      "2000-01-01T22:59:60Z",
      "2000-01-01T23:59:60+01:00",
      "2000-01-01T00:59:60+01:00",
      "2000-01-01t00:00:00z",
      "2000-01-01T00:00:00.123456789+05:30",
      "2000-01-01T00:00:00+24:00",
      "2000-01-01T00:00:00+00:60",

      "2000-01-01T00:00:00",
      "2000-01-01",
      "x",
      "2000-01-01T00:00:00.Z",
    ];
    for (const c of cases)
      expect(isKnowledgeObservationDateTime(c), c).toBe(probe(c));
    // Deliberate divergence: ajv-formats tolerates a space separator; RFC 3339 interchange requires T/t.
    expect(probe("2000-01-01 00:00:00Z")).toBe(true);
    expect(isKnowledgeObservationDateTime("2000-01-01 00:00:00Z")).toBe(false);
  });
});

describe("wire frames keep the 65,532-byte / depth-16 bound (parseBoundedJson reused, no second parser)", () => {
  it("every package record fits one frame and decodes (or fails) exactly as expected", () => {
    const invalid = new Set([
      "invalid-numeric-cursor",
      "invalid-numeric-aggregate-version",
      "invalid-bare-node",
      "invalid-empty-checker-pass",
      "invalid-fingerprint-content-address",
      "invalid-unknown-profile",
      "invalid-missing-producer",
      "invalid-unknown-extension",
    ]);
    let largest = 0;
    for (const [key, record] of Object.entries(records)) {
      const bytes = enc(record);
      largest = Math.max(largest, bytes.length);
      const r = parseKnowledgeObservationJson(bytes);
      expect(r.ok, key).toBe(!invalid.has(key));
      if (r.ok) expect(Array.from(r.bytes)).toEqual(Array.from(bytes));
    }
    expect(largest).toBeLessThanOrEqual(65532);
  });

  it("the whole fixture catalogue is not a frame; an oversize or too-deep frame is refused before decoding", () => {
    expect(parseKnowledgeObservationJson(enc(records))).toMatchObject({
      ok: false,
      code: "INVALID_FRAME",
    });
    const big = rec("event-1");
    (big["data"] as Record<string, unknown>)["padding"] = "x".repeat(70_000);
    expect(parseKnowledgeObservationJson(enc(big))).toMatchObject({
      ok: false,
      code: "INVALID_FRAME",
    });
    let deep: unknown = 1;
    for (let i = 0; i < 20; i += 1) deep = { a: deep };
    expect(parseKnowledgeObservationJson(enc(deep))).toMatchObject({
      ok: false,
      code: "INVALID_FRAME",
    });
    expect(parseKnowledgeObservationJson(new Uint8Array(0))).toMatchObject({
      ok: false,
      code: "INVALID_FRAME",
    });
  });

  it("decoded duplicate keys, BOM and lone surrogates are refused as frames; counters stay strings", () => {
    const base = JSON.stringify(records["event-1"]);
    const dup = base.replace(
      '"record_type":"event"',
      '"record_type":"event","record_type":"event"',
    );
    expect(dup).not.toBe(base);
    expect(
      parseKnowledgeObservationJson(new TextEncoder().encode(dup)),
    ).toMatchObject({ ok: false, code: "INVALID_FRAME" });
    expect(
      parseKnowledgeObservationJson(
        new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(base)]),
      ),
    ).toMatchObject({ ok: false, code: "INVALID_FRAME" });
    expect(
      parseKnowledgeObservationJson(
        new TextEncoder().encode(
          base.replace("fixture-correlation", "\\ud800"),
        ),
      ),
    ).toMatchObject({ ok: false, code: "INVALID_FRAME" });
  });

  it("the reducer accepts a wire frame (Uint8Array) and refuses a bad one without advancing", () => {
    let state = createReducerState({ mode: "fixture" });
    for (const input of [
      { kind: "bind_trusted_projection", viewContext: CTX },
      { kind: "receive", record: enc(records["snapshot-A"]) },
      { kind: "receive", record: enc(records["event-1"]) },
    ] as ReducerInput[])
      state = reduce(state, input).state;
    expect(state.appliedCursor).toBe("9007199254740993");
    const bad = reduce(state, {
      kind: "receive",
      record: new TextEncoder().encode('{"profile":"x"'),
    });
    expect(bad.outcome).toMatchObject({
      disposition: "rejected",
      code: "INVALID_FRAME",
    });
    expect(bad.state.appliedCursor).toBe("9007199254740993");
    expect(projectView(bad.state).projection).toBe("reconciling");
    expect(bad.commands).toEqual([]);
  });

  it("an own-data copy is validated and returned: getters, accessors and prototypes cannot change the checked value", () => {
    const hostile = rec("event-1");
    let reads = 0;
    Object.defineProperty(hostile, "record_id", {
      enumerable: true,
      get: () => (reads += 1) && "event-1",
    });
    expect(decodeObservationRecord(hostile)).toMatchObject({
      ok: false,
      code: "NOT_AN_OBJECT",
    });
    expect(
      decodeObservationRecord(
        Object.create({ profile: "knowledge-collective-observation/v1" }),
      ),
    ).toMatchObject({ ok: false, code: "NOT_AN_OBJECT" });
    expect(decodeObservationRecord(new Proxy({}, {}))).toMatchObject({
      ok: false,
    });
    const ok = decodeObservationRecord(rec("event-1"));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const input = rec("event-1");
      const out = decodeObservationRecord(input);
      (input["data"] as Record<string, unknown>)["cursor"] = "1";
      expect(out.ok && (out.record.data as { cursor: string }).cursor).toBe(
        "9007199254740993",
      );
    }
  });
});

describe("page assembly is bounded and verified under one watermark", () => {
  const split = (
    id: string,
    tokens: (string | null)[],
  ): Record<string, unknown>[] => {
    const full = rec(id);
    const data = full["data"] as {
      graphs: unknown[];
      coverage: Record<string, unknown>;
      snapshot_kind: string;
    };
    const graphs = data.graphs;
    const half = Math.ceil(graphs.length / tokens.length);
    return tokens.map((token, i) => {
      const page = structuredClone(full) as Record<string, unknown>;
      page["record_id"] = `${id}-page-${i + 1}`;
      const d = page["data"] as typeof data;
      d.snapshot_kind = "partial";
      d.graphs = graphs.slice(i * half, (i + 1) * half);
      d.coverage = {
        ...data.coverage,
        complete: token === null,
        next_page_token: token,
      };
      return page;
    });
  };
  const send = (page: Record<string, unknown>): ReducerInput => ({
    kind: "receive",
    record: page,
    at: 0,
  });

  it("pages are pending, move nothing, and assemble into the same view as the full snapshot once the final page arrives", () => {
    const [p1, p2] = split("snapshot-colliding-ids", ["page-2", null]) as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(
      decodeObservationRecord(p1).ok && decodeObservationRecord(p2).ok,
    ).toBe(true);
    const mid = run([send(p1)]);
    expect(projectView(mid).projection).toBe("awaiting_snapshot");
    expect(mid.appliedCursor).toBeNull();
    expect(projectView(mid).nodes).toEqual([]);
    const done = run([send(p1), send(p2)]);
    const whole = run([recv("snapshot-colliding-ids")]);
    expect(projectView(done).nodes).toEqual(projectView(whole).nodes);
    expect(projectView(done).crosslinks).toEqual(projectView(whole).crosslinks);
    expect(done.appliedCursor).toBe(whole.appliedCursor);
    expect(projectView(done).projection).toBe("current");
  });

  it("a page set never discharges a gap until it is final and consistent", () => {
    const [p1] = split("snapshot-ahead", ["page-2", null]) as [
      Record<string, unknown>,
    ];
    const s = run([
      recv("snapshot-A"),
      recv("event-1"),
      recv("event-3"),
      send(p1),
    ]);
    expect(projectView(s).projection).toBe("reconciling");
    expect(s.appliedCursor).toBe("9007199254740993");
  });

  it("pages for different watermarks, a missing declared graph kind or a contradicted node discard the assembly and require a full snapshot", () => {
    const [a1] = split("snapshot-ahead", ["page-2", null]) as [
      Record<string, unknown>,
    ];
    const other = split("snapshot-A", ["page-2", null]) as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    const mixed = run([recv("snapshot-A"), send(a1), send(other[1])]);
    expect(mixed.holds).toContain("PAGE_ASSEMBLY_INVALID");
    expect(projectView(mixed).fullSnapshotRequired).toBe(true);
    // final page arrives but a declared graph kind was never delivered
    const onlyLast = split("snapshot-A", ["page-2", null]);
    const missing = run([
      recv("snapshot-A"),
      send(onlyLast[1] as Record<string, unknown>),
    ]);
    expect(missing.holds).toContain("PAGE_ASSEMBLY_INVALID");
    expect(missing.appliedCursor).toBe("9007199254740992");
  });

  it("page count and age are bounded while pending", () => {
    const [p1] = split("snapshot-ahead", ["page-2", null]) as [
      Record<string, unknown>,
    ];
    const limited = run([recv("snapshot-A"), send(p1), send(p1)], {
      maxPages: 1,
    });
    expect(limited.holds).toContain("PAGE_ASSEMBLY_LIMIT_EXCEEDED");
    let state = createReducerState({
      mode: "fixture",
      limits: { maxAgeMs: 100 },
    });
    for (const input of [
      { kind: "bind_trusted_projection", viewContext: CTX },
      recv("snapshot-A"),
      { kind: "receive", record: p1, at: 0 },
      { kind: "receive", record: p1, at: 1000 },
    ] as ReducerInput[])
      state = reduce(state, input).state;
    expect(state.holds).toContain("PAGE_ASSEMBLY_LIMIT_EXCEEDED");
  });
});

describe("gate 2 — complete immutable event identity", () => {
  const apply = (changed: Record<string, unknown>): ReducerState =>
    run([
      recv("snapshot-A"),
      recv("event-1"),
      { kind: "receive", record: changed },
    ]);

  it("an identical complete event is a no-op", () => {
    const s = apply(rec("event-1"));
    expect(projectView(s).ignored.map((x) => x.code)).toEqual([
      "DUPLICATE_SAME_IDENTITY_AND_BODY",
    ]);
    expect(projectView(s).projection).toBe("current");
  });

  it.each([
    [
      "time",
      (e: Record<string, unknown>) =>
        ((e["data"] as Record<string, unknown>)["occurred_at"] =
          "2000-01-01T00:00:01Z"),
    ],
    [
      "observed time",
      (e: Record<string, unknown>) =>
        (e["observed_at"] = "2000-01-01T00:00:01Z"),
    ],
    [
      "recorded time",
      (e: Record<string, unknown>) =>
        (e["recorded_at"] = "2000-01-01T00:00:01Z"),
    ],
    [
      "offset spelling",
      (e: Record<string, unknown>) =>
        ((e["data"] as Record<string, unknown>)["occurred_at"] =
          "2000-01-01T01:00:00+01:00"),
    ],
    [
      "cursor",
      (e: Record<string, unknown>) =>
        ((e["data"] as Record<string, unknown>)["cursor"] = "9007199254740999"),
    ],
    [
      "correlation",
      (e: Record<string, unknown>) =>
        ((e["data"] as Record<string, unknown>)["correlation_ref"] =
          "other-correlation"),
    ],
    [
      "causation",
      (e: Record<string, unknown>) =>
        ((e["data"] as Record<string, unknown>)["causation_ref"] = "cause-1"),
    ],
    [
      "record id",
      (e: Record<string, unknown>) => (e["record_id"] = "event-1-renamed"),
    ],
    [
      "source sequence",
      (e: Record<string, unknown>) =>
        ((
          (e["data"] as Record<string, unknown>)["source_sequence"] as Record<
            string,
            unknown
          >
        )["contiguity"] = "declared_contiguous"),
    ],
    [
      "digest representation with identical body bytes",
      (e: Record<string, unknown>) => {
        const body = (
          e["data"] as { body: { digest: Record<string, unknown> } }
        ).body;
        body.digest = {
          ...body.digest,
          representation: "application/json;canonicalization=JCS",
        };
      },
    ],
  ])(
    "same scoped identity with a changed %s conflicts (never last-writer-wins)",
    (_name, change) => {
      const changed = rec("event-1");
      change(changed);
      expect(decodeObservationRecord(changed).ok).toBe(true);
      const s = apply(changed);
      const v = projectView(s);
      expect(v.quarantined.length).toBe(1);
      expect(v.projection).toBe("reconciling");
      expect(s.appliedCursor).toBe("9007199254740993");
      expect(v.nodes.find((n) => n.localId === "task-1")?.nativeState).toBe(
        "in_progress",
      );
    },
  );

  it("the canonical comparison form is the package's own complete-event byte form (sha256 matches all 20 retained events)", () => {
    const complete = bodies["complete_event_records"] as Record<
      string,
      { bytes_utf8: string; digest: { value: string } }
    >;
    let checked = 0;
    for (const [key, item] of Object.entries(complete)) {
      const record = records[key];
      if (record === undefined || key.startsWith("invalid-")) continue; // JSON.parse rounds the deliberately numeric counters of the invalid records
      const bytes = `${canonicalKnowledgeObservationJson(record)}\n`;
      expect(bytes, key).toBe(item.bytes_utf8);
      expect(sha(bytes), key).toBe(item.digest.value);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
    expect(Object.keys(complete).length).toBeGreaterThanOrEqual(checked);
  });
});

describe("gate 4 — current scope, revocation and no restored access", () => {
  it("after revocation nothing is accepted until a fresh trusted binding AND a new authorized full snapshot", () => {
    let state = run([recv("snapshot-A"), recv("event-1")]);
    state = reduce(state, {
      kind: "trusted_authorization_revoked",
      viewContext: CTX,
    }).state;
    expect(projectView(state).projection).toBe("cleared");
    for (const id of ["snapshot-A", "event-2", "receipt-captured-1"]) {
      const r = reduce(state, recv(id));
      expect(r.outcome).toMatchObject({
        disposition: "rejected",
        code: "NO_TRUSTED_VIEW_BINDING",
      });
      state = r.state;
    }
    expect(Object.keys(state.ancillary.artifacts)).toEqual([]);
    state = reduce(state, {
      kind: "bind_trusted_projection",
      viewContext: CTX,
    }).state;
    expect(projectView(state).nodes).toEqual([]);
    expect(projectView(state).projection).toBe("awaiting_snapshot");
    state = reduce(state, recv("snapshot-A")).state;
    expect(projectView(state).projection).toBe("current");
  });

  it("a payload reset field and a client-supplied epoch change restore nothing without the trusted reset input", () => {
    const state = run([recv("snapshot-A"), recv("snapshot-epoch-B")]);
    expect(state.binding?.stream_epoch).toBe("epoch-A");
    expect(state.appliedCursor).toBe("9007199254740992");
  });
});
