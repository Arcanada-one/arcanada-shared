/**
 * KCLIVE-01 round 3: every remaining condition of the page-set path (validManifest, receivePageSetManifest,
 * receivePage, completePageSet) and of the same-watermark projection canon is pinned by a case in which ONLY that
 * condition differs. Each case was found as a surviving mutant of the round-2 head and is killed here.
 * Fixture values are synthetic.
 */
import { describe, expect, it } from "vitest";
import {
  createReducerState,
  decodeObservationRecord,
  projectView,
  reduce,
  type PageSetManifest,
  type ReduceOutcome,
  type ReducerInput,
  type ReducerState,
  type ViewContext,
} from "./knowledge-observation.api.js";
import {
  caseMeta,
  records,
  sealManifest,
  splitPages,
} from "./knowledge-observation.harness.js";

const CTX = caseMeta.default_view_context as ViewContext;
const recv = (record: unknown): ReducerInput => ({ kind: "receive", record });
const manifestIn = (manifest: PageSetManifest): ReducerInput => ({
  kind: "trusted_page_set_manifest",
  manifest,
});
const bootstrap = recv(structuredClone(records["snapshot-A"]));

function play(
  inputs: ReducerInput[],
  options: Parameters<typeof createReducerState>[0] = { mode: "fixture" },
): { state: ReducerState; outcomes: ReduceOutcome[] } {
  let state = createReducerState(options);
  const outcomes: ReduceOutcome[] = [];
  for (const input of [
    { kind: "bind_trusted_projection", viewContext: CTX } as ReducerInput,
    ...inputs,
  ]) {
    const r = reduce(state, input);
    state = r.state;
    outcomes.push(r.outcome);
  }
  return { state, outcomes: outcomes.slice(1) };
}
const lastOf = (r: { outcomes: ReduceOutcome[] }): ReduceOutcome =>
  r.outcomes[r.outcomes.length - 1] as ReduceOutcome;
const PAGES = (): any[] => splitPages("snapshot-colliding-ids", 2);

/* ---------------------------------------------------------------------------------------------------------- */
describe("validManifest — each malformed manifest is refused on its own", () => {
  const mutate = (fn: (m: any) => void): PageSetManifest => {
    const m = structuredClone(sealManifest(PAGES())) as any;
    fn(m);
    return m as PageSetManifest;
  };
  const sizes = (m: any): number[] => m.pages.map((p: any) => p.byteSize);
  const bad: Record<string, PageSetManifest> = {
    "page set ref shape": mutate((m) => (m.pageSetRef = "-bad")),
    "trusted snapshot ref shape": mutate(
      (m) => (m.trustedSnapshotRef = "-bad"),
    ),
    "adapter ref shape": mutate((m) => (m.adapterRef = "-bad")),
    "non-canonical watermark": mutate((m) => (m.watermark = "007")),
    "zero page count (empty, zero total)": mutate((m) => {
      m.pageCount = 0;
      m.pages = [];
      m.totalBytes = 0;
    }),
    "page count above the bound": mutate((m) => {
      m.pageCount = 65;
      m.pages = Array.from({ length: 65 }, (_, i) => ({
        pageIndex: i,
        sha256: "a".repeat(64),
        byteSize: 1,
      }));
      m.totalBytes = 65;
    }),
    "pages is not an array": mutate((m) => (m.pages = { length: 2 })),
    "entry count differs from page count": mutate((m) => (m.pageCount = 3)),
    "fractional page index": mutate((m) => (m.pages[1].pageIndex = 0.5)),
    "negative page index": mutate((m) => (m.pages[0].pageIndex = -1)),
    "page index outside the count": mutate((m) => (m.pages[1].pageIndex = 2)),
    "duplicate page index": mutate((m) => (m.pages[1].pageIndex = 0)),
    "non-hex digest": mutate((m) => (m.pages[0].sha256 = "z".repeat(64))),
    "digest is not a string (array coerces to a valid hex text)": mutate(
      (m) => (m.pages[0].sha256 = [m.pages[0].sha256]),
    ),
    "short digest": mutate((m) => (m.pages[0].sha256 = "ab")),
    "fractional byte size (sum kept)": mutate((m) => {
      const [a, b] = sizes(m) as [number, number];
      m.pages[0].byteSize = a + 0.5;
      m.pages[1].byteSize = b - 0.5;
    }),
    "zero byte size (sum kept)": mutate((m) => {
      const [a, b] = sizes(m) as [number, number];
      m.pages[0].byteSize = 0;
      m.pages[1].byteSize = a + b;
    }),
    "entry sizes do not sum to the total": mutate((m) => (m.totalBytes += 1)),
  };
  for (const [name, manifest] of Object.entries(bad)) {
    it(`refuses: ${name}`, () => {
      const r = play([manifestIn(manifest)]);
      expect(lastOf(r)).toMatchObject({
        disposition: "rejected",
        code: "INVALID_PAGE_SET_MANIFEST",
      });
    });
  }
  it("control: the unmodified manifest is accepted", () => {
    expect(lastOf(play([manifestIn(sealManifest(PAGES()))]))).toMatchObject({
      disposition: "state_changed",
    });
  });
  it("refuses a manifest before any trusted view binding exists", () => {
    const r = reduce(
      createReducerState({ mode: "fixture" }),
      manifestIn(sealManifest(PAGES())),
    );
    expect(r.outcome).toMatchObject({
      disposition: "rejected",
      code: "INVALID_PAGE_SET_MANIFEST",
    });
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe("receivePageSetManifest — sealed sets are immutable and bounded", () => {
  it("a different manifest for a sealed set is a conflict that holds the stream", () => {
    const pages = PAGES();
    const m = sealManifest(pages);
    const other = sealManifest(pages, { adapterRef: "adapter:other" });
    const r = play([bootstrap, manifestIn(m), manifestIn(other)]);
    expect(lastOf(r)).toMatchObject({
      disposition: "quarantined",
      code: "PAGE_SET_MANIFEST_CONFLICT",
    });
    expect(r.state.holds).toContain("PAGE_SET_MISMATCH");
  });

  it("only the newest eight manifests are kept: the oldest sealed set is forgotten", () => {
    const pages = PAGES();
    const first = sealManifest(pages);
    const fillers = Array.from({ length: 8 }, (_, i) =>
      manifestIn(sealManifest(pages, { pageSetRef: `filler-set-${i}` })),
    );
    const r = play([
      bootstrap,
      manifestIn(first),
      ...fillers,
      recv(pages[0]),
      recv(pages[1]),
    ]);
    expect(lastOf(r)).toMatchObject({ code: "PAGE_SET_MANIFEST_PENDING" });
    expect(r.state.pages).not.toBeNull();
  });

  it("a manifest for ANOTHER set never completes the pending set", () => {
    const pages = PAGES();
    const r = play([
      bootstrap,
      recv(pages[0]),
      recv(pages[1]),
      manifestIn(sealManifest(pages, { pageSetRef: "unrelated-set" })),
    ]);
    expect(lastOf(r)).toMatchObject({ disposition: "state_changed" });
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe("receivePage — assembly coherence and bounds, one condition at a time", () => {
  const edit = (page: any, fn: (p: any) => void): any => {
    const c = structuredClone(page);
    fn(c);
    return c;
  };

  it("refuses an unsafe-integer page ordinal as invalid (not as a size overflow)", () => {
    const p = edit(PAGES()[0], (c) => {
      c.data.coverage.page_set.page_index = "9007199254740992";
      c.data.coverage.page_set.page_count = "9007199254740998";
    });
    expect(decodeObservationRecord(p).ok).toBe(true);
    expect(lastOf(play([bootstrap, recv(p)]))).toMatchObject({
      code: "PAGE_ASSEMBLY_INVALID",
    });
  });

  it("refuses an unsafe-integer page count as invalid (not as a size overflow)", () => {
    const p = edit(PAGES()[0], (c) => {
      c.data.coverage.page_set.page_index = "5";
      c.data.coverage.page_set.page_count = "9007199254740993";
    });
    expect(decodeObservationRecord(p).ok).toBe(true);
    expect(lastOf(play([bootstrap, recv(p)]))).toMatchObject({
      code: "PAGE_ASSEMBLY_INVALID",
    });
  });

  it("refuses a non-final page that claims completeness", () => {
    const p = edit(PAGES()[0], (c) => (c.data.coverage.complete = true));
    expect(decodeObservationRecord(p).ok).toBe(true);
    expect(lastOf(play([bootstrap, recv(p)]))).toMatchObject({
      code: "PAGE_ASSEMBLY_INVALID",
    });
  });

  it("refuses a final page that does not claim completeness", () => {
    const p = edit(PAGES()[1], (c) => (c.data.coverage.complete = false));
    expect(decodeObservationRecord(p).ok).toBe(true);
    // an incomplete flag sends the record down the page path; it must still be refused as incoherent
    expect(lastOf(play([bootstrap, recv(p)]))).toMatchObject({
      code: "PAGE_ASSEMBLY_INVALID",
    });
  });

  it("a set larger than the page bound is refused at its first page", () => {
    const r = play([bootstrap, recv(PAGES()[0])], {
      mode: "fixture",
      limits: { maxPages: 1 },
    });
    expect(lastOf(r)).toMatchObject({
      code: "PAGE_ASSEMBLY_LIMIT_EXCEEDED",
    });
  });

  it("a single page above the byte bound is refused", () => {
    const size = sealManifest(PAGES()).pages[0]!.byteSize;
    const r = play([bootstrap, recv(PAGES()[0])], {
      mode: "fixture",
      limits: { maxSerializedBytes: size - 1 },
    });
    expect(lastOf(r)).toMatchObject({
      code: "PAGE_ASSEMBLY_LIMIT_EXCEEDED",
    });
  });

  it("the byte bound accumulates across pages", () => {
    const m = sealManifest(PAGES());
    const [a, b] = m.pages as unknown as [
      { byteSize: number },
      { byteSize: number },
    ];
    const limit = Math.max(a.byteSize, b.byteSize) + 1;
    expect(limit).toBeLessThan(a.byteSize + b.byteSize);
    const r = play([bootstrap, recv(PAGES()[0]), recv(PAGES()[1])], {
      mode: "fixture",
      limits: { maxSerializedBytes: limit },
    });
    expect(lastOf(r)).toMatchObject({
      code: "PAGE_ASSEMBLY_LIMIT_EXCEEDED",
    });
  });

  const second: Record<string, (p: any) => void> = {
    "other watermark": (p) => (p.data.watermark = "9007199254740993"),
    "other trusted snapshot ref": (p) =>
      (p.data.trusted_snapshot_ref = "fixture:other-snapshot"),
    "other plan revision": (p) => (p.data.plan_revision = "plan-OTHER"),
    "other declared graph kinds": (p) =>
      (p.data.coverage.declared_graph_kinds = [
        ...p.data.coverage.declared_graph_kinds,
      ].reverse()),
    "other page count (coherent final ordinal of a 3-set)": (p) => {
      p.data.coverage.page_set.page_index = "2";
      p.data.coverage.page_set.page_count = "3";
    },
  };
  for (const [name, fn] of Object.entries(second)) {
    it(`pending set, then a page with ${name}: refused as one inconsistent set`, () => {
      const pages = PAGES();
      const forged = edit(pages[1], fn);
      expect(decodeObservationRecord(forged).ok, name).toBe(true);
      const r = play([bootstrap, recv(pages[0]), recv(forged)]);
      expect(lastOf(r), name).toMatchObject({
        disposition: "rejected",
        code: "PAGE_ASSEMBLY_INVALID",
      });
      expect(r.state.pages).toBeNull();
    });
  }

  it("with a manifest present, a foreign FIRST page is refused before it is stored", () => {
    const pages = PAGES();
    const m = sealManifest(pages);
    const forged = edit(pages[0], (c) => {
      c.data.coverage.next_page_token = "page-2-forged";
    });
    const r = play([bootstrap, manifestIn(m), recv(forged)]);
    expect(lastOf(r)).toMatchObject({
      disposition: "rejected",
      code: "PAGE_SET_MISMATCH",
    });
    expect(r.state.pages).toBeNull();
  });

  it("a page whose count differs from the sealed count is refused at once, even when its digest and size are sealed", () => {
    const pages = PAGES();
    const three = splitPages("snapshot-colliding-ids", 3);
    // seal a 2-entry manifest over [3-page-set page 0, page 1 of the 2-set]: digest and size of page 0 match
    const m = sealManifest([three[0]!, pages[1]], {
      pageSetRef: "snapshot-colliding-ids-set",
    });
    const r = play([bootstrap, manifestIn(m), recv(three[0])]);
    expect(lastOf(r)).toMatchObject({
      disposition: "rejected",
      code: "PAGE_SET_MISMATCH",
    });
    expect(r.state.pages).toBeNull();
  });

  it("a gap-free pending page does not demand a full snapshot, but a non-interval hold does", () => {
    const base = records["snapshot-A"] as any;
    const contradictory = structuredClone(base) as any;
    contradictory.record_id = "contradiction";
    contradictory.data.acceptance.reason = "changed";
    const held = play([bootstrap, recv(contradictory)]);
    expect(held.state.holds).toContain("SNAPSHOT_CONTRADICTION");
    expect(held.state.fullSnapshotRequired).toBe(false);
    const after = play([bootstrap, recv(contradictory), recv(PAGES()[0])]);
    expect(after.state.fullSnapshotRequired).toBe(true);
  });

  it("an authorization revocation clears the view; a same-watermark replay is not judged against a view that is gone", () => {
    const r = play([
      bootstrap,
      { kind: "trusted_authorization_revoked", viewContext: CTX },
      recv(structuredClone(records["snapshot-A"])),
    ]);
    expect(projectView(r.state).projection).toBe("cleared");
    expect(r.state.holds).not.toContain("SNAPSHOT_CONTRADICTION");
  });

  it("pages may arrive out of order: the proven set still installs the same view", () => {
    const pages = PAGES();
    const m = sealManifest(pages);
    const inOrder = play([manifestIn(m), recv(pages[0]), recv(pages[1])]);
    const reversed = play([manifestIn(m), recv(pages[1]), recv(pages[0])]);
    expect(projectView(reversed.state).projection).toBe("current");
    expect(JSON.stringify(projectView(reversed.state))).toBe(
      JSON.stringify(projectView(inOrder.state)),
    );
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe("same-watermark canon — every projection component and order-independence", () => {
  const rec = (): any => structuredClone(records["snapshot-colliding-ids"]);
  const withExtras = (): any => {
    const s = rec();
    const g = s.data.graphs.find((x: any) => x.graph_kind === "work");
    const n2 = structuredClone(g.nodes[0]);
    n2.ref.local_id = "node-2";
    g.nodes.push(n2);
    const edge = (id: string): any => ({
      edge_id: id,
      kind: "uses",
      from: g.nodes[0].ref,
      to: g.nodes[0].ref,
      evidence_refs: ["fixture:edge"],
    });
    g.edges.push(edge("edge-1"), edge("edge-2"));
    const l2 = structuredClone(s.data.crosslinks[0]);
    l2.link_id = "fixture-link-2";
    s.data.crosslinks.push(l2);
    const v2 = structuredClone(s.data.source_revisions[0]);
    v2.scope_ref = "fixture-project-2";
    s.data.source_revisions.push(v2);
    s.data.allowed_actions_observation.push(
      {
        operation: "op-a",
        status: "allowed",
        evaluated_at: "2000-01-01T00:00:00Z",
        authorization_observation_ref: "fixture:auth",
      },
      {
        operation: "op-b",
        status: "denied",
        evaluated_at: "2000-01-01T00:00:00Z",
        authorization_observation_ref: "fixture:auth",
      },
    );
    return s;
  };
  const reordered = (): any => {
    const s = withExtras();
    s.record_id = "reordered";
    const d = s.data;
    d.coverage.declared_graph_kinds.reverse();
    d.graphs.reverse();
    for (const g of d.graphs) {
      g.nodes.reverse();
      g.edges.reverse();
    }
    d.crosslinks.reverse();
    d.source_revisions.reverse();
    d.allowed_actions_observation.reverse();
    return s;
  };

  it("the same projection in any array order is consistent (not a contradiction)", () => {
    const a = withExtras();
    const b = reordered();
    expect(decodeObservationRecord(a).ok).toBe(true);
    expect(decodeObservationRecord(b).ok).toBe(true);
    const r = play([recv(a), recv(b)]);
    expect(lastOf(r)).toMatchObject({ code: "SAME_WATERMARK_CONSISTENT" });
  });

  const mutants: Record<string, (s: any) => void> = {
    "native state": (s) => (s.data.native_state.value = "doing"),
    "source atomicity only (evidence ref kept)": (s) => {
      s.data.source_atomicity = "source_asserted_with_evidence";
    },
    "atomicity evidence ref only": (s) => {
      s.data.atomicity_evidence_ref = "fixture:some-ref";
    },
    "declared graph kinds only": (s) => {
      s.data.coverage.declared_graph_kinds =
        s.data.coverage.declared_graph_kinds.slice(1);
    },
    "allowed action observation": (s) =>
      s.data.allowed_actions_observation.push({
        operation: "op-c",
        status: "unknown",
        evaluated_at: "2000-01-01T00:00:00Z",
        authorization_observation_ref: "fixture:auth",
      }),
    "graph authority only": (s) => (s.data.graphs[0].authority = "other-auth"),
    "graph kind only": (s) => {
      const [x, y] = s.data.graphs as any[];
      const kx = x.graph_kind;
      x.graph_kind = y.graph_kind;
      y.graph_kind = kx;
    },
  };
  for (const [name, mutate] of Object.entries(mutants)) {
    it(`quarantines a same-watermark snapshot differing only in ${name}`, () => {
      const variant = rec();
      variant.record_id = "mutant";
      mutate(variant);
      const baseRec = rec();
      if (name.startsWith("source atomicity only"))
        baseRec.data.atomicity_evidence_ref =
          variant.data.atomicity_evidence_ref = "fixture:atomic";
      const decoded = decodeObservationRecord(variant).ok;
      const r = play([recv(baseRec), recv(variant)]);
      if (!decoded) {
        // the decoder already refuses it: the canon component is unreachable from a valid record
        expect(lastOf(r).disposition).toBe("rejected");
        return;
      }
      expect(lastOf(r), name).toMatchObject({
        code: "SNAPSHOT_CONTRADICTION",
      });
    });
  }
});
