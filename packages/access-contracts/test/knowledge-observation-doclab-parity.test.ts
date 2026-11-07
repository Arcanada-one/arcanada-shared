/**
 * KCLIVE-01 Doclab producer alignment and decoder parity (first adapter slice).
 *
 * The fixtures are the exact bytes emitted by the REAL Doclab observation adapter (doclab-arcana 065072b0,
 * observation_adapter.py blob f849c995, ADAPTER_REVISION kclive-06-v2) against a fresh test database built through
 * Doclab's own insert path. See fixtures/doclab-adapter-kclive-06-v2/SOURCE.json. No production data.
 *
 * Three layers, kept apart on purpose:
 *   1. RAW  - the captured bytes go through the package decoder/reducer UNCHANGED. The adapter's envelope is not a
 *             `knowledge-collective-observation/v1` record, so every one is refused; the refusal is explicit and the
 *             field-level mismatch table is machine-checked here.
 *   2. NATIVE - what the Doclab bytes themselves preserve (lossless decimal strings, scope, contiguity, absent build).
 *   3. PREVIEW - a TEST-ONLY wrapper that supplies, from a named table, every field Doclab does not emit and maps the
 *             three values that fail the profile. It is NOT Doclab output and NOT production code; it shows that the
 *             real Doclab values (ids, sequences, digests) are carried unchanged once the listed Doclab-side
 *             changes exist, and it exercises the reducer's refusal controls on those values.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";
import { parseBoundedJson } from "../src/index.js";
import {
  canonicalJson,
  createReducerState,
  nextDecimal,
  observeProducerBuild,
  parseKnowledgeObservationJson,
  projectView,
  reduce,
  stableViewDigestInput,
  type ReducerInput,
  type ReducerState,
  type ViewContext,
} from "./knowledge-observation.api.js";
import { caseMeta, records } from "./knowledge-observation.harness.js";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const HERE = dirname(fileURLToPath(import.meta.url));
const FX = join(HERE, "fixtures", "doclab-adapter-kclive-06-v2");
const CTX = caseMeta.default_view_context as ViewContext;
const sha = (b: Uint8Array | string): string =>
  createHash("sha256").update(b).digest("hex");
const bytesOf = (rel: string): Buffer => readFileSync(join(FX, rel));

const LOCK = {
  repository: "Arcanada-one/doclab-arcana",
  commit: "065072b05a259c5d68da6f7c86b69990324c47ef",
  adapterBlob: "f849c9953941a5a8eabfdc14ff77162e82ce7748",
  adapterRevision: "kclive-06-v2",
};
const B2_FILES = ["3", "5", "7"].map((n) => `events/b2-run-event-${n}.json`);
const ALL_FILES = [1, 2, 3, 4, 5, 6, 7].map(
  (n) => `events/all-runs-event-${n}.json`,
);
/** Every retained Doclab snapshot file; the raw-refusal loop must cover all of them (guarded by a directory check). */
const RAW_SNAPSHOT_FILES = ["snapshot-b2-run.json", "snapshot-all-runs.json"];
const native = (rel: string): Json =>
  parseBoundedJson(new Uint8Array(bytesOf(rel))) as Json;

/* -- 0. the fixtures are the frozen, locked capture ------------------------------------------------------------------- */

describe("fixtures: exact bytes, frozen, tied to the source lock", () => {
  const sums = readFileSync(join(FX, "SHA256SUMS"), "utf8")
    .trim()
    .split("\n")
    .map((l) => {
      const [digest, path] = l.split(/\s+/) as [string, string];
      return { digest, path: path.replace(/^\.\//, "") };
    });

  it("every captured file equals its recorded sha256 and no file is unlisted", () => {
    for (const s of sums) expect(sha(bytesOf(s.path))).toBe(s.digest);
    const listed = new Set(sums.map((s) => s.path));
    const onDisk = [
      ...readdirSync(FX).filter((f) => f !== "SHA256SUMS"),
      ...readdirSync(join(FX, "events")).map((f) => `events/${f}`),
    ].filter((f) => f !== "events");
    expect([...listed].sort()).toEqual(onDisk.sort());
  });

  it("SOURCE.json records the Doclab commit, adapter blob and adapter revision of the source lock", () => {
    const src = JSON.parse(bytesOf("SOURCE.json").toString("utf8")) as Json;
    expect(src.source_lock.repository).toBe(LOCK.repository);
    expect(src.source_lock.commit).toBe(LOCK.commit);
    expect(src.source_lock.adapter_blob).toBe(LOCK.adapterBlob);
    expect(src.source_lock.adapter_revision).toBe(LOCK.adapterRevision);
  });

  it("every captured event names the locked adapter revision; each file is one UTF-8 line ending in a newline", () => {
    for (const f of [...B2_FILES, ...ALL_FILES]) {
      const b = bytesOf(f);
      expect(b[b.length - 1]).toBe(0x0a);
      expect(native(f).producer.adapter_revision).toBe(LOCK.adapterRevision);
    }
  });
});

/* -- 1/2. NATIVE: what Doclab's own bytes preserve ---------------------------------------------------------------------- */

describe("native: what the Doclab adapter output itself preserves", () => {
  it("producer_event_id and source_sequence.value are lossless decimal strings, never JSON numbers", () => {
    for (const f of [...B2_FILES, ...ALL_FILES]) {
      const e = native(f);
      expect(typeof e.producer_event_id).toBe("string");
      expect(e.producer_event_id).toMatch(/^(0|[1-9][0-9]*)$/);
      expect(typeof e.source_sequence.value).toBe("string");
      expect(e.source_sequence.value).toBe(e.producer_event_id);
      expect(typeof e.projection_cursor).toBe("string");
      expect(typeof e.body_digest.byte_size).toBe("string");
    }
  });

  it("scope is `database` and contiguity is the literal `database_wide_not_per_run`", () => {
    for (const f of [...B2_FILES, ...ALL_FILES]) {
      const q = native(f).source_sequence;
      expect(q.scope).toBe("database");
      expect(q.contiguity).toBe("database_wide_not_per_run");
    }
  });

  it("a per-run view carries legitimate numeric gaps (3,5,7); the projection cursor is contiguous 1,2,3", () => {
    const e = B2_FILES.map(native);
    expect(e.map((x) => x.producer_event_id)).toEqual(["3", "5", "7"]);
    expect(e.map((x) => x.projection_cursor)).toEqual(["1", "2", "3"]);
    expect(e.every((x) => x.run_id === "b2-run")).toBe(true);
    // the same database seen without a run filter has no gap: the gap is the filter, not a loss
    expect(ALL_FILES.map((f) => native(f).producer_event_id)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
    ]);
    const snap = JSON.parse(
      bytesOf("snapshot-b2-run.json").toString("utf8"),
    ) as Json;
    expect(snap.source_partitioning.event_id_scope).toBe("database_wide");
    expect(snap.runtime_authorized).toBe(false);
    expect(snap.knowledge_admitted).toBe(false);
  });

  it("the adapter declares no producer build: producerBuild would be NOT_MEASURED, never derived", () => {
    for (const f of [...B2_FILES, ...ALL_FILES]) {
      const p = native(f).producer;
      expect(Object.keys(p).sort()).toEqual([
        "adapter_revision",
        "instance_id",
        "service",
      ]);
      expect(p.build).toBeUndefined();
      expect(observeProducerBuild(p.build)).toEqual({
        ok: true,
        build: { status: "NOT_MEASURED" },
      });
    }
  });

  it("body-digest: each body_digest is the sha256 of the exact body bytes Doclab serialized (recomputed here; this is not a receipt-chain check)", () => {
    for (const f of [...B2_FILES, ...ALL_FILES]) {
      const e = native(f);
      const body = pyDumps(e.body) + "\n";
      expect(e.body_digest.value).toBe(sha(body));
      expect(e.body_digest.byte_size).toBe(String(Buffer.byteLength(body)));
    }
  });
});

/** json.dumps(obj, ensure_ascii=False, sort_keys=True) for the plain-ASCII shapes Doclab emits. */
function pyDumps(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(pyDumps).join(", ")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}: ${pyDumps(o[k])}`)
    .join(", ")}}`;
}

/* -- 1. RAW: unchanged bytes through the package decoder and reducer --------------------------------------------------- */

describe("raw: captured Doclab bytes through the package decoder, unchanged", () => {
  it("the raw-refusal loop covers every retained snapshot file on disk, so none is skipped", () => {
    const onDisk = readdirSync(FX)
      .filter((f) => /^snapshot-.*\.json$/.test(f))
      .sort();
    expect([...RAW_SNAPSHOT_FILES].sort()).toEqual(onDisk);
  });

  it.each([...B2_FILES, ...ALL_FILES, ...RAW_SNAPSHOT_FILES])(
    "%s is refused by the decoder with an explicit code (the envelope is not a profile record)",
    (f) => {
      const r = parseKnowledgeObservationJson(new Uint8Array(bytesOf(f)));
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe("SCHEMA_INVALID");
      expect(r.detail).toBe("profile is missing or not a string");
    },
  );

  it("the reducer rejects each raw record, appends nothing, never becomes current and emits no command", () => {
    let state = createReducerState({ mode: "fixture" });
    state = reduce(state, {
      kind: "bind_trusted_projection",
      viewContext: CTX,
    }).state;
    for (const f of B2_FILES) {
      const r = reduce(state, { kind: "receive", record: native(f) });
      expect(r.outcome).toEqual({
        disposition: "rejected",
        code: "SCHEMA_INVALID",
      });
      expect(r.commands).toEqual([]);
      state = r.state;
    }
    const v = projectView(state);
    expect(v.eventLedger).toEqual([]);
    expect(v.uniqueSourceEventsApplied).toBe(0);
    expect(v.projection).toBe("awaiting_snapshot");
    expect(v.projection).not.toBe("current");
    expect(v.rejected).toHaveLength(3);
    expect(v.rejected.every((x) => x.code === "SCHEMA_INVALID")).toBe(true);
    expect(v.emittedCommands).toEqual([]);
  });

  it("no missing field is filled in: a raw record does not become decodable by any package default", () => {
    // sanity: a record decodes only once the profile fields exist; the raw envelope never gains them
    const raw = native(B2_FILES[0]!);
    expect(raw.profile).toBeUndefined();
    expect(raw.record_type).toBeUndefined();
    expect(raw.data).toBeUndefined();
  });
});

/* -- 1b. field-level mismatch table, machine-checked against the schema -------------------------------------------------- */

describe("mismatch table: each Doclab field against the package schema", () => {
  const ajv = new Ajv2020({ strict: false, allErrors: false });
  const addFormats = ((
    addFormatsModule as unknown as { default?: (a: Ajv2020) => Ajv2020 }
  ).default ?? (addFormatsModule as unknown as (a: Ajv2020) => Ajv2020)) as (
    a: Ajv2020,
  ) => Ajv2020;
  addFormats(ajv);
  const schema = JSON.parse(
    readFileSync(
      new URL(
        "../src/knowledge-observation-v1.amendment-1.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { $id: string; $defs: Record<string, Json> };
  ajv.addSchema(schema);
  const valid = (def: string, v: unknown): boolean => {
    const f = ajv.getSchema(`${schema.$id}#/$defs/${def}`);
    if (f === undefined) throw new Error(`no def ${def}`);
    return f(v) === true;
  };
  const ev = native(B2_FILES[1]!);

  it("fields that FIT the profile unchanged", () => {
    expect(valid("opaque", ev.producer_event_id)).toBe(true);
    expect(valid("decimal", ev.source_sequence.value)).toBe(true);
    expect(valid("decimal", ev.projection_cursor)).toBe(true); // fits `cursor` as a type
    expect(valid("date", ev.occurred_at)).toBe(true);
    expect(valid("opaque", ev.producer.instance_id)).toBe(true);
    expect(valid("exactDigest", ev.body_digest)).toBe(true);
    expect(ev.evidence_refs.every((r: string) => valid("opaque", r))).toBe(
      true,
    );
    expect(valid("opaque", ev.source_sequence.partition_id)).toBe(true);
    expect(ev.source_sequence.scope).toBe("database"); // member of the scope enum
    expect(
      (
        schema.$defs["sourceSequence"]!["properties"].scope.enum as string[]
      ).includes("database"),
    ).toBe(true);
  });

  it("fields that DO NOT fit: Doclab value vs package expectation", () => {
    const pkg = schema.$defs["sourceSequence"]!["properties"];
    // contiguity
    expect(ev.source_sequence.contiguity).toBe("database_wide_not_per_run");
    expect(pkg.contiguity.enum).toEqual([
      "declared_contiguous",
      "not_contiguous",
      "unknown",
    ]);
    // scope_id: absolute filesystem path (leading '/') vs opaque id
    expect(ev.source_sequence.scope_id.startsWith("/")).toBe(true);
    expect(valid("opaque", ev.source_sequence.scope_id)).toBe(false);
    // declaration_ref: free text with spaces vs opaque id
    expect(ev.source_sequence.declaration_ref).toBe(
      "doclab:events.event_id AUTOINCREMENT database-wide",
    );
    expect(valid("opaque", ev.source_sequence.declaration_ref)).toBe(false);
    // producer.build: required by the profile, absent in Doclab output
    expect(schema.$defs["producer"]!["required"]).toContain("build");
    expect(ev.producer.build).toBeUndefined();
    // adapter_revision sits at producer level in Doclab; the profile carries it inside producer.build
    expect(ev.producer.adapter_revision).toBe(LOCK.adapterRevision);
    expect(
      Object.keys(schema.$defs["producer"]!["properties"]).includes(
        "adapter_revision",
      ),
    ).toBe(false);
    // body: inline object in Doclab; the profile wants a bodyRef {evidence_ref, digest}
    expect(typeof ev.body).toBe("object");
    expect(valid("bodyRef", ev.body)).toBe(false);
    // event_type: free-form string in Doclab; the profile wants a closed `kind` enum
    const kinds = schema.$defs["event"]!["properties"].kind.enum as string[];
    expect(kinds.includes(ev.event_type)).toBe(false);
  });

  it("profile fields Doclab does not emit at all (the envelope is flat, not a record with `data`)", () => {
    const recordRequired = schema.$defs["eventRecord"]!["required"] as string[];
    const dataRequired = schema.$defs["event"]!["required"] as string[];
    const missing = [...recordRequired, ...dataRequired.map((k) => `data.${k}`)]
      .filter((k) => {
        const [a, b] = k.startsWith("data.")
          ? ["data", k.slice(5)]
          : [k, undefined];
        if (a === "data" && b !== undefined) return !(b in ev);
        return !(a in ev);
      })
      .sort();
    // `producer` and `occurred_at`-like names exist in Doclab but at a different nesting; only same-path matches count
    expect(missing).toEqual(
      [
        "profile",
        "record_type",
        "record_id",
        "mode",
        "view_context",
        "observed_at",
        "recorded_at",
        "evidence_basis",
        "required_extensions",
        "data",
        "data.event_id",
        "data.cursor",
        "data.kind",
        "data.plan_revision",
        "data.subject_refs",
        "data.causation_ref",
        "data.correlation_ref",
        "data.native_state",
        "data.native_versions",
        "data.related_record_ids",
      ].sort(),
    );
    // present in Doclab at the same name (their placement differs, the table above covers the shape)
    for (const k of [
      "producer",
      "data.producer_event_id",
      "data.source_sequence",
      "data.occurred_at",
      "data.evidence_refs",
      "data.body",
    ]) {
      expect(missing).not.toContain(k);
    }
  });
});

/* -- 3. PREVIEW: real Doclab values carried unchanged through the real reducer ---------------------------------------- */

/**
 * TEST-ONLY. Besides `SUPPLIED`, the preview also supplies synthetic `CTX` (the trusted view context), the baseline
 * snapshot and its watermark (`snapshot-doclab`), generated record ids and the kind/state mappings. A successful
 * reduction therefore proves behaviour under that supplied context, not a current native Doclab view.
 * `SUPPLIED` is every value Doclab does not emit or emits outside the profile; each is named here and none
 * is derived from Doclab data. The real Doclab values (producer_event_id, source_sequence.value/scope/partition_id,
 * occurred_at, evidence_refs, body_digest) are copied byte-for-value from the captured events.
 */
const SUPPLIED = {
  recordedAt: "2026-11-07T17:10:00Z",
  observedAt: "2026-11-07T17:10:00Z",
  scopeId: "doclab-test-db",
  declarationRef: "doclab:events.event_id.database-wide",
  build: {
    repository: LOCK.repository,
    commit: LOCK.commit,
    adapter_revision: LOCK.adapterRevision,
  },
};
const BASE = (records["snapshot-doclab"]!["data"] as Json)[
  "watermark"
] as string;

function preview(
  rel: string,
  over: { contiguity?: string; cursorOffset?: number } = {},
): Json {
  const n = native(rel);
  let cursor = BASE;
  for (let i = 0; i < Number(n.projection_cursor); i += 1)
    cursor = nextDecimal(cursor);
  for (let i = 0; i < (over.cursorOffset ?? 0); i += 1)
    cursor = nextDecimal(cursor);
  return {
    profile: "knowledge-collective-observation/v1",
    record_type: "event",
    record_id: `doclab-preview-${n.producer_event_id}`,
    mode: "fixture",
    view_context: CTX,
    producer: {
      service: n.producer.service,
      instance_id: n.producer.instance_id,
      build: { ...SUPPLIED.build },
    },
    observed_at: SUPPLIED.observedAt,
    recorded_at: SUPPLIED.recordedAt,
    evidence_basis: "native_observation",
    data: {
      event_id: `doclab-preview-evt-${n.producer_event_id}`,
      cursor,
      producer_event_id: n.producer_event_id,
      source_sequence: {
        value: n.source_sequence.value,
        scope: n.source_sequence.scope,
        scope_id: SUPPLIED.scopeId,
        partition_id: n.source_sequence.partition_id,
        contiguity: over.contiguity ?? "not_contiguous",
        declaration_ref: SUPPLIED.declarationRef,
      },
      kind: "native_state_observed",
      plan_revision: null,
      subject_refs: [],
      occurred_at: n.occurred_at,
      causation_ref: null,
      correlation_ref: null,
      native_state: null,
      native_versions: {},
      evidence_refs: n.evidence_refs,
      body: { evidence_ref: n.evidence_refs[0], digest: n.body_digest },
      related_record_ids: [],
    },
    required_extensions: ["lossless-decimal-counters/v1"],
  };
}

const bind: ReducerInput = {
  kind: "bind_trusted_projection",
  viewContext: CTX,
};
const recv = (record: Json): ReducerInput => ({ kind: "receive", record });
function play(inputs: ReducerInput[]): ReducerState {
  let state = createReducerState({ mode: "fixture" });
  for (const input of [bind, ...inputs]) state = reduce(state, input).state;
  return state;
}
const snap = (): ReducerInput =>
  recv(structuredClone(records["snapshot-doclab"]) as Json);

describe("preview: real Doclab values through the real reducer (supplied fields are named in SUPPLIED)", () => {
  it("the previewed records are valid profile records", () => {
    for (const f of B2_FILES)
      expect(
        parseKnowledgeObservationJson(
          new TextEncoder().encode(JSON.stringify(preview(f))),
        ).ok,
      ).toBe(true);
  });

  it("reduces to the expected view: Doclab identities, lossless sequences and scope preserved, no loss from per-run gaps", () => {
    const state = play([snap(), ...B2_FILES.map((f) => recv(preview(f)))]);
    const v = projectView(state);
    expect(v.projection).toBe("current");
    expect(v.holds).toEqual([]);
    expect(v.fullSnapshotRequired).toBe(false);
    expect(v.uniqueSourceEventsApplied).toBe(3);
    expect(v.emittedCommands).toEqual([]);
    expect(v.eventLedger.map((e) => e.producer.producerEventId)).toEqual([
      "3",
      "5",
      "7",
    ]);
    expect(v.eventLedger.map((e) => e.sourceSequence.value)).toEqual([
      "3",
      "5",
      "7",
    ]);
    for (const e of v.eventLedger) {
      expect(typeof e.sourceSequence.value).toBe("string");
      expect(e.sourceSequence.scope).toBe("database");
      expect(e.sourceSequence.scopeId).toBe(SUPPLIED.scopeId);
      expect(e.sourceSequence.partitionId).toBe("b2-run");
      expect(e.producer.service).toBe("doclab");
      expect(e.producerBuild).toEqual({
        status: "OBSERVED",
        repository: LOCK.repository,
        commit: LOCK.commit,
        adapterRevision: LOCK.adapterRevision,
      });
    }
    // the gaps 3->5->7 are not reported as a loss, and nothing is presented as success or acceptance
    expect(v.sourceReconcile.some((m) => m.includes(":gap"))).toBe(false);
    expect(v.dimensions.independentAcceptance).toBe("NOT_MEASURED");
    expect(v.dimensions.independentlyVerified).toBe(false);
  });

  it("the digest of the view is deterministic across two independent runs", () => {
    const run = (): string =>
      sha(
        stableViewDigestInput(
          play([snap(), ...B2_FILES.map((f) => recv(preview(f)))]),
        ),
      );
    const a = run();
    expect(run()).toBe(a);
    const viewA = canonicalJson(
      projectView(play([snap(), ...B2_FILES.map((f) => recv(preview(f)))])),
    );
    const viewB = canonicalJson(
      projectView(play([snap(), ...B2_FILES.map((f) => recv(preview(f)))])),
    );
    expect(viewA).toBe(viewB);
  });

  it("the all-runs view (ids 1..7, no gap) reduces too", () => {
    const state = play([snap(), ...ALL_FILES.map((f) => recv(preview(f)))]);
    const v = projectView(state);
    expect(v.projection).toBe("current");
    expect(v.eventLedger.map((e) => e.producer.producerEventId)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
    ]);
  });
});

describe("controls: contradiction and refusal on real Doclab values", () => {
  it("declaring the per-run view `declared_contiguous` WOULD turn the numeric gap into a reported loss (why the adapter must not)", () => {
    const state = play([
      snap(),
      ...B2_FILES.map((f) =>
        recv(preview(f, { contiguity: "declared_contiguous" })),
      ),
    ]);
    expect(
      projectView(state).sourceReconcile.some((m) => m.includes(":gap")),
    ).toBe(true);
  });

  it("duplicate producer event id with different bytes is a conflict; the first retained event is not rewritten", () => {
    const first = preview(B2_FILES[1]!);
    const altered = structuredClone(first);
    altered.data.body.digest = {
      ...altered.data.body.digest,
      value: sha("different body bytes"),
    };
    const s0 = play([snap(), recv(preview(B2_FILES[0]!)), recv(first)]);
    const r = reduce(s0, recv(altered));
    expect(r.outcome.disposition).toBe("quarantined");
    expect(r.outcome.code).toBe("IDENTITY_BODY_CONFLICT");
    const v = projectView(r.state);
    expect(v.projection).toBe("reconciling");
    expect(v.holds).toContain("IDENTITY_BODY_CONFLICT");
    expect(v.eventLedger).toHaveLength(2);
    expect(v.eventLedger[1]!.producer.producerEventId).toBe("5");
    // an exact redelivery stays a harmless duplicate
    const again = reduce(s0, recv(first));
    expect(again.outcome.disposition).toBe("ignored");
    expect(projectView(again.state).holds).toEqual([]);
  });

  it("a missing cursor is a gap: later events are buffered, the view is not current, nothing is called complete", () => {
    const v = projectView(
      play([
        snap(),
        recv(preview(B2_FILES[0]!)),
        // projection cursor 2 never arrives; cursor 3 does
        recv(preview(B2_FILES[2]!)),
      ]),
    );
    expect(v.projection).toBe("reconciling");
    expect(v.holds).toContain("GAP");
    expect(v.uniqueSourceEventsApplied).toBe(1);
    expect(v.buffered.length).toBeGreaterThan(0);
    expect(v.fullSnapshotRequired || v.holds.includes("GAP")).toBe(true);
  });

  it("body-digest: a malformed body digest value is rejected as SCHEMA_INVALID and advances nothing (schema shape only; no receipt-chain validation)", () => {
    const broken = preview(B2_FILES[1]!);
    broken.data.body.digest.value = "not-a-sha256";
    const s0 = play([snap(), recv(preview(B2_FILES[0]!))]);
    const r = reduce(s0, recv(broken));
    expect(r.outcome).toEqual({
      disposition: "rejected",
      code: "SCHEMA_INVALID",
    });
    const v = projectView(r.state);
    expect(v.eventLedger).toHaveLength(1);
    expect(v.uniqueSourceEventsApplied).toBe(1);
    expect(v.dimensions.independentAcceptance).toBe("NOT_MEASURED");
  });

  it("body-digest: a well-formed but wrong digest is detectable only against the retained body bytes: the recomputation fails closed (no receipt-chain validation)", () => {
    // The reducer does not hold body bytes (a record carries a reference), so it cannot recompute. The caller that holds
    // the Doclab body bytes can, and a tampered body no longer matches the digest Doclab declared.
    const e = native(B2_FILES[1]!);
    const tampered = { ...e.body, payload: { n: 999 } };
    expect(sha(pyDumps(tampered) + "\n")).not.toBe(e.body_digest.value);
    expect(sha(pyDumps(e.body) + "\n")).toBe(e.body_digest.value);
  });

  it("an unknown schema version is refused with an explicit code and appends nothing", () => {
    const v2 = preview(B2_FILES[0]!);
    v2.profile = "knowledge-collective-observation/v2";
    const r = reduce(play([snap()]), recv(v2));
    expect(r.outcome).toEqual({
      disposition: "rejected",
      code: "UNSUPPORTED_PROFILE",
    });
    const unknownExt = preview(B2_FILES[0]!);
    unknownExt.required_extensions = ["lossless-decimal-counters/v2"];
    expect(reduce(play([snap()]), recv(unknownExt)).outcome).toEqual({
      disposition: "rejected",
      code: "UNSUPPORTED_REQUIRED_EXTENSION",
    });
    expect(projectView(r.state).eventLedger).toEqual([]);
  });

  it("a JSON-number counter is refused: counters stay lossless decimal strings", () => {
    const num = preview(B2_FILES[0]!);
    num.data.source_sequence.value = 3;
    expect(reduce(play([snap()]), recv(num)).outcome).toEqual({
      disposition: "rejected",
      code: "SCHEMA_INVALID",
    });
  });
});
