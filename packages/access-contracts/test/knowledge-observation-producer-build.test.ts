/**
 * KCLIVE-01 G1 (Agent-Brain decision, mail 7ca32ce8): an optional, validated `producerBuild` on the event ledger.
 * Additive only. The `compat` block is the named check that existing bytes, identities and digests did not move: its
 * golden values were captured from head 46ab74e BEFORE the change (see the golden file). Fixture values are synthetic.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  createReducerState,
  decodeObservationRecord,
  graphPresentationDigestInput,
  observeProducerBuild,
  PRODUCER_BUILD_NOT_MEASURED,
  projectView,
  reduce,
  stableViewDigestInput,
  type ReducerInput,
  type ReducerState,
  type ViewContext,
} from "./knowledge-observation.api.js";
import { caseMeta, records } from "./knowledge-observation.harness.js";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const CTX = caseMeta.default_view_context as ViewContext;
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const rec = (id: string): Json => structuredClone(records[id]) as Json;
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

const BUILD_A = {
  repository: "Arcanada-one/muneral",
  commit: "6d786dca224c4dfcf13ca14693a032c9ab53343f",
  adapter_revision: "PROPOSED-v1-FIXTURE",
};
const BUILD_B = {
  repository: "Arcanada-one/muneral",
  commit: "0123456789abcdef0123456789abcdef01234567",
  adapter_revision: "adapter-rev-2",
};
const withBuild = (id: string, build: unknown): Json => {
  const r = rec(id);
  r["producer"] = { ...r["producer"], build };
  return r;
};

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(
  readFileSync(
    join(here, "knowledge-observation-producer-build.golden.json"),
    "utf8",
  ),
) as {
  records: Record<
    string,
    { bytes: string; stable: string; graph: string; ledger: string }
  >;
};

describe("compat: existing bytes, identities and digests are unchanged by producerBuild", () => {
  it("the golden table covers every fixture record", () => {
    expect(Object.keys(golden.records).sort()).toEqual(
      Object.keys(records).sort(),
    );
  });

  it.each(Object.keys(records))(
    "%s: record bytes, stable view digest input, graph digest input and ledger-without-producerBuild equal head 46ab74e",
    (id) => {
      const g = golden.records[id]!;
      expect(sha(canonicalJson(records[id]))).toBe(g.bytes);
      const inputs = [recv(rec("snapshot-A"))];
      if (id !== "snapshot-A") inputs.push(recv(rec(id)));
      const state = play(inputs);
      expect(sha(stableViewDigestInput(state))).toBe(g.stable);
      expect(sha(graphPresentationDigestInput(state))).toBe(g.graph);
      const stripped = projectView(state).eventLedger.map((e) => {
        const { producerBuild, ...rest } = e as Json;
        void producerBuild;
        return rest;
      });
      expect(sha(canonicalJson(stripped))).toBe(g.ledger);
    },
  );

  it("event identity ignores the build: the retained identity key is service, instance and producer event id only", () => {
    const a = play([
      recv(rec("snapshot-A")),
      recv(withBuild("event-1", BUILD_A)),
    ]);
    const b = play([
      recv(rec("snapshot-A")),
      recv(withBuild("event-1", BUILD_B)),
    ]);
    expect(Object.keys(a.eventIdentities)).toEqual(
      Object.keys(b.eventIdentities),
    );
    expect(stableViewDigestInput(a)).toBe(stableViewDigestInput(b));
    expect(graphPresentationDigestInput(a)).toBe(
      graphPresentationDigestInput(b),
    );
  });
});

describe("producerBuild on the ledger", () => {
  it("carries the declared build verbatim, as an observed value with exactly the three fields", () => {
    const e = projectView(play([recv(rec("snapshot-A")), recv(rec("event-1"))]))
      .eventLedger[0]!;
    expect(e.producerBuild).toEqual({
      status: "OBSERVED",
      repository: BUILD_A.repository,
      commit: BUILD_A.commit,
      adapterRevision: BUILD_A.adapter_revision,
    });
    // no native build id and no deployed version is invented in this field
    expect(Object.keys(e.producerBuild).sort()).toEqual([
      "adapterRevision",
      "commit",
      "repository",
      "status",
    ]);
  });

  it("the same event with two different builds stays distinguishable, and the first retained build is not overwritten", () => {
    const a = projectView(
      play([recv(rec("snapshot-A")), recv(withBuild("event-1", BUILD_A))]),
    ).eventLedger[0]!;
    const b = projectView(
      play([recv(rec("snapshot-A")), recv(withBuild("event-1", BUILD_B))]),
    ).eventLedger[0]!;
    expect(a.eventId).toBe(b.eventId);
    expect(a.producer.producerEventId).toBe(b.producer.producerEventId);
    expect(a.producerBuild).not.toEqual(b.producerBuild);
    expect(canonicalJson(a)).not.toBe(canonicalJson(b));
    // delivered into one state, the second is a conflicting duplicate and never rewrites the first
    const both = projectView(
      play([
        recv(rec("snapshot-A")),
        recv(withBuild("event-1", BUILD_A)),
        recv(withBuild("event-1", BUILD_B)),
      ]),
    );
    expect(both.eventLedger).toHaveLength(1);
    expect(both.eventLedger[0]!.producerBuild).toEqual(a.producerBuild);
  });

  it("distinct native observations keep their own builds", () => {
    const v = projectView(
      play([
        recv(rec("snapshot-A")),
        recv(withBuild("event-1", BUILD_A)),
        recv(withBuild("event-2", BUILD_B)),
      ]),
    );
    const byEvent = Object.fromEntries(
      v.eventLedger.map((e) => [e.producer.producerEventId, e.producerBuild]),
    );
    expect(byEvent["101"]).toMatchObject({
      status: "OBSERVED",
      commit: BUILD_A.commit,
    });
    expect(byEvent["102"]).toMatchObject({
      status: "OBSERVED",
      commit: BUILD_B.commit,
    });
  });

  it("retained state without the field (older state) is presented as NOT_MEASURED, never inferred", () => {
    const state = play([recv(rec("snapshot-A")), recv(rec("event-1"))]);
    const legacy = structuredClone(state) as Json;
    for (const e of legacy["eventLedger"]) delete e["producerBuild"];
    const e = projectView(legacy as ReducerState).eventLedger[0]!;
    expect(e.producerBuild).toEqual({ status: "NOT_MEASURED" });
    expect(e.producerBuild).toBe(PRODUCER_BUILD_NOT_MEASURED);
    // the rest of the entry and the digests are unchanged
    expect(stableViewDigestInput(legacy as ReducerState)).toBe(
      stableViewDigestInput(state),
    );
  });

  it("a deployment observation stays a separate notion and is not copied into the producer build", () => {
    const v = projectView(
      play([recv(rec("snapshot-A")), recv(rec("event-1"))]),
    );
    expect(v.deployments).toEqual([]);
    expect(JSON.stringify(v.eventLedger)).not.toContain("observedBuild");
  });
});

describe("observeProducerBuild validation", () => {
  it("absent (undefined or null) is NOT_MEASURED", () => {
    expect(observeProducerBuild(undefined)).toEqual({
      ok: true,
      build: { status: "NOT_MEASURED" },
    });
    expect(observeProducerBuild(null)).toEqual({
      ok: true,
      build: { status: "NOT_MEASURED" },
    });
  });

  it("a complete build is observed", () => {
    expect(observeProducerBuild(BUILD_B)).toEqual({
      ok: true,
      build: {
        status: "OBSERVED",
        repository: BUILD_B.repository,
        commit: BUILD_B.commit,
        adapterRevision: "adapter-rev-2",
      },
    });
  });

  it.each<[string, unknown]>([
    ["a string", "abc"],
    ["an array", []],
    ["an empty object", {}],
    ["a missing commit", { repository: "r", adapter_revision: "a" }],
    ["a missing repository", { commit: BUILD_A.commit, adapter_revision: "a" }],
    ["a missing adapter_revision", { repository: "r", commit: BUILD_A.commit }],
    ["a short commit", { ...BUILD_A, commit: "6d786dc" }],
    [
      "an uppercase commit",
      { ...BUILD_A, commit: BUILD_A.commit.toUpperCase() },
    ],
    ["an empty repository", { ...BUILD_A, repository: "" }],
    ["an empty adapter_revision", { ...BUILD_A, adapter_revision: "" }],
    ["a numeric adapter_revision", { ...BUILD_A, adapter_revision: 7 }],
    [
      "an extra field (a native build id is not accepted here)",
      { ...BUILD_A, native_build_id: "x" },
    ],
    [
      "a camelCase field name",
      { repository: "r", commit: BUILD_A.commit, adapterRevision: "a" },
    ],
  ])("rejects %s with PRODUCER_BUILD_MALFORMED", (_name, value) => {
    const r = observeProducerBuild(value);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("PRODUCER_BUILD_MALFORMED");
      expect(r.detail.length).toBeGreaterThan(0);
    }
  });

  it("the record decoder keeps refusing a record whose producer build is malformed or missing, so no such event reaches the ledger", () => {
    for (const bad of [
      { ...BUILD_A, commit: "nope" },
      { ...BUILD_A, extra: 1 },
      undefined,
    ]) {
      const r = withBuild("event-1", bad);
      if (bad === undefined) delete r["producer"]["build"];
      expect(decodeObservationRecord(r)).toMatchObject({
        ok: false,
        code: "SCHEMA_INVALID",
      });
      const state = play([recv(rec("snapshot-A")), recv(r)]);
      expect(projectView(state).eventLedger).toEqual([]);
    }
  });
});
