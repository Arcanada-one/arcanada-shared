import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it, afterAll } from "vitest";
import {
  classifyDoclabNativeShape,
  compareDigests,
  decodeObservationRecord,
  isExactContentAddress,
  type Digest,
  type ProjectedView,
} from "./knowledge-observation.api.js";
import {
  asserted,
  bodies,
  caseMeta,
  cases,
  mark,
  records,
  runCase,
  type Case,
  type Run,
} from "./knowledge-observation.harness.js";

const amendments = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/knowledge-observation-v1/amended-oracles.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  supersedes: {
    case_id: string;
    key: string;
    pinned_value: unknown;
    amended_value: unknown;
  }[];
};
/**
 * KCLIVE-01 round 5 (R2): OBS-08's "no unbounded browser history retained" is checked against the reducer's real lifetime
 * retention policy (identities, cursor bindings, ancillary catalogs, byte budget, every history list and the pending
 * buffer), not only against whether the pending buffer happens to be empty. The pinned expected value stays `false`.
 */
const HISTORY_CAP = 512;
function retentionExceedsPolicy(state: Run["state"]): boolean {
  const l = state.limits;
  const bytes = [
    ...Object.values(state.eventIdentities).map((e) => e.canon),
    ...Object.values(state.ancillary.seen),
  ].reduce((n, c) => n + new TextEncoder().encode(c).length, 0);
  return (
    state.buffer.length > l.maxRecords ||
    Object.keys(state.eventIdentities).length > l.maxRetainedIdentities ||
    Object.keys(state.cursorBindings).length > l.maxRetainedIdentities ||
    Object.keys(state.ancillary.seen).length > l.maxAncillaryRecords ||
    bytes > l.maxRetainedBytes ||
    [
      state.eventLog,
      state.eventLedger,
      state.sourceSequences,
      state.history,
      state.snapshotHistory,
      state.planHistory,
      state.historicalOnly,
      state.refusals,
      state.sourceReconcile,
      state.unassociatedSubjects,
      state.ancillary.joined,
    ].some((list) => list.length > HISTORY_CAP)
  );
}

const amendedOracle = (caseId: string, key: string) => {
  const hit = amendments.supersedes.find(
    (a) => a.case_id === caseId && a.key === key,
  );
  if (hit === undefined) throw new Error(`no amendment for ${caseId}.${key}`);
  return hit;
};

const taskState = (v: ProjectedView): string | null =>
  v.nodes.find((n) => n.graphKind === "work" && n.localId === "task-1")
    ?.nativeState ?? null;
const rejectedIds = (r: Run): string[] =>
  r.trace.flatMap((t) =>
    t.outcomes
      .filter((o) => o.outcome.disposition === "rejected" && o.key !== "bind")
      .map((o) => o.key),
  );
const outcomeOf = (r: Run, key: string) =>
  r.trace
    .flatMap((t) => t.outcomes)
    .filter((o) => o.key === key)
    .map((o) => o.outcome);
const nativeBody = (id: string): unknown =>
  JSON.parse((bodies[id] as { bytes_utf8: string }).bytes_utf8);

type Check = (
  c: Case,
  r: Run,
  ex: Record<string, unknown>,
  eq: (key: string, actual: unknown) => void,
  m: (key: string) => void,
) => void;

const checks: Record<string, Check> = {
  "OBS-01": (_c, r, _ex, eq) => {
    eq("projection", r.view.projection);
    eq("applied_cursor", r.view.appliedCursor);
    eq("current_plan", r.view.currentPlan);
    eq("declared_graph_kinds", r.view.declaredGraphKinds);
    eq("task_native_state", taskState(r.view));
    eq("acceptance", r.view.dimensions.independentAcceptance);
    eq("global_completeness_asserted", r.view.globalCompletenessAsserted);
    eq("cross_source_atomicity_asserted", r.view.crossSourceAtomicityAsserted);
  },
  "OBS-02": (_c, r, _ex, eq) => {
    eq("projection", r.view.projection);
    eq("applied_cursor", r.view.appliedCursor);
    eq("buffered", r.view.buffered);
    eq(
      "native_execution_inferred",
      r.view.nodes.length > 0 || r.view.attempts.length > 0,
    );
    eq("acceptance", r.view.dimensions.independentAcceptance);
  },
  "OBS-03": (_c, r, _ex, eq) => {
    const task = r.view.nodes.find((n) => n.localId === "task-1");
    eq("applied_cursor", r.view.appliedCursor);
    eq("native_aggregateVersion", task?.nativeVersions["aggregateVersion"]);
    eq("native_revision", task?.nativeVersions["revision"]);
    eq("current_plan", r.view.currentPlan);
    eq(
      "plan_inferred_from_native_versions",
      Object.values(task?.nativeVersions ?? {}).includes(
        r.view.currentPlan ?? "\u0000",
      ),
    );
    eq("invalid_records_rejected", rejectedIds(r));
    eq("projection", r.view.projection);
    eq("reason", [...new Set(r.view.rejected.map((x) => x.code))].join(","));
  },
  "OBS-04": (_c, r, _ex, eq) => {
    eq("projection", r.view.projection);
    eq("applied_cursor", r.view.appliedCursor);
    eq("unique_source_events_applied", r.view.uniqueSourceEventsApplied);
    const dup = outcomeOf(r, "event-1-duplicate")[0];
    eq("ignored", dup?.disposition === "ignored" ? ["event-1-duplicate"] : []);
    eq("reason", dup?.code);
  },
  "OBS-05": (_c, r, _ex, eq) => {
    eq("projection", r.view.projection);
    eq("applied_cursor", r.view.appliedCursor);
    eq("task_native_state", taskState(r.view));
    const o = outcomeOf(r, "event-1-conflict")[0];
    eq(
      "quarantined",
      o?.disposition === "quarantined" ? ["event-1-conflict"] : [],
    );
    eq("reason", o?.code);
    // last-writer-wins would have produced "cancelled" and cursor ...994.
    eq("automatic_last_writer_wins", taskState(r.view) === "cancelled");
  },
  "OBS-06": (_c, r, ex, eq) => {
    const [, e2, e1, fin] = r.trace;
    expect(e2 && e1 && fin).toBeTruthy();
    const after2 = ex["after_event_2"] as Record<string, unknown>;
    const after1 = ex["after_event_1"] as Record<string, unknown>;
    const final = ex["final"] as Record<string, unknown>;
    expect({
      projection: e2?.view.projection,
      applied_cursor: e2?.view.appliedCursor,
      buffered: e2?.view.buffered,
    }).toEqual(after2);
    expect({
      projection: e1?.view.projection,
      applied_cursor: e1?.view.appliedCursor,
      buffered: e1?.view.buffered,
    }).toEqual(after1);
    expect({
      projection: fin?.view.projection,
      applied_cursor: fin?.view.appliedCursor,
      task_native_state: fin ? taskState(fin.view) : null,
    }).toEqual(final);
    mark("OBS-06", "after_event_2");
    mark("OBS-06", "after_event_1");
    mark("OBS-06", "final");
    eq(
      "replay_order",
      r.state.eventLog.join(",") === "event-1,event-2"
        ? "numeric decimal cursor within exact trusted view and epoch"
        : r.state.eventLog.join(","),
    );
  },
  "OBS-07": (_c, r, _ex, eq) => {
    eq("projection", r.view.projection);
    eq("applied_cursor", r.view.appliedCursor);
    eq("task_native_state", taskState(r.view));
    eq("buffered", r.view.buffered);
    eq(
      "missing_projection_cursor",
      r.state.appliedCursor === null
        ? null
        : String(BigInt(r.state.appliedCursor) + 1n),
    );
    eq(
      "producer_or_hidden_event_loss_inferred",
      r.view.holds.some((h) => h !== "GAP") ||
        r.view.sourceReconcile.length > 0,
    );
  },
  "OBS-08": (_c, r, _ex, eq) => {
    eq("projection", r.view.projection);
    eq("applied_cursor", r.view.appliedCursor);
    eq("buffered", r.view.buffered);
    eq(
      "reason",
      r.view.holds.includes("BUFFER_LIMIT_EXCEEDED")
        ? "BUFFER_LIMIT_EXCEEDED"
        : r.view.holds.join(","),
    );
    eq("full_snapshot_required", r.view.fullSnapshotRequired);
    eq("last_trusted_state_preserved", taskState(r.view) === "todo");
    eq("unbounded_browser_history_retained", retentionExceedsPolicy(r.state));
  },
  "OBS-09": (_c, r, _ex, eq) => {
    eq("projection", r.view.projection);
    eq("applied_cursor", r.view.appliedCursor);
    eq("task_native_state", taskState(r.view));
    const o = outcomeOf(r, "snapshot-old")[0];
    eq(
      "ignored_for_current_state",
      o?.disposition === "historical" ? ["snapshot-old"] : [],
    );
    eq(
      "historical_reference_retained",
      r.state.snapshotHistory.some((h) => h.recordId === "snapshot-old"),
    );
  },
  "OBS-10": (_c, r, _ex, eq) => {
    eq("projection", r.view.projection);
    eq("applied_cursor", r.view.appliedCursor);
    eq("task_native_state", taskState(r.view));
    eq("buffered", r.view.buffered);
    const before = r.trace[2]?.view;
    const after = r.trace[3]?.view;
    // One reduce step swaps cursor, state and buffer together; there is no observable intermediate.
    eq(
      "snapshot_swap_atomic_for_local_view",
      before?.projection === "reconciling" &&
        after?.projection === "current" &&
        after.appliedCursor === "9007199254740996" &&
        after.buffered.length === 0,
    );
    eq(
      "source_transaction_atomicity_asserted",
      r.view.crossSourceAtomicityAsserted ||
        r.view.snapshotAtomicity !== "not_established",
    );
    eq(
      "event_3_done_not_inferred_as_accepted_output",
      taskState(r.view) !== "done" &&
        r.view.dimensions.independentAcceptance === "NOT_MEASURED",
    );
  },
  "OBS-11": (_c, r, ex, eq, m) => {
    eq("first_snapshot", r.trace[0]?.view.projection);
    eq("final_projection", r.view.projection);
    eq("applied_cursor", r.view.appliedCursor);
    eq("buffered", r.view.buffered);
    // Amendment 1 supersedes exactly this pinned expectation (amended-oracles.json); the pinned file is untouched.
    m("full_snapshot_required");
    expect(amendedOracle("OBS-11", "full_snapshot_required").pinned_value).toBe(
      ex["full_snapshot_required"],
    );
    expect(r.view.fullSnapshotRequired).toBe(
      amendedOracle("OBS-11", "full_snapshot_required").amended_value,
    );
    eq(
      "partial_pages_may_replace_current_state",
      r.state.partialPages > 0 && r.view.appliedCursor !== "9007199254740992",
    );
  },
  "OBS-12": (_c, r, ex, eq) => {
    const before = r.trace[2];
    const after = r.trace[4];
    const exBefore = ex["before_trusted_reset"] as Record<string, unknown>;
    const exAfter = ex["after_trusted_reset"] as Record<string, unknown>;
    expect({
      stream_epoch: before?.state.binding?.stream_epoch,
      applied_cursor: before?.view.appliedCursor,
      projection: before?.view.projection,
      rejected: before?.outcomes[0]?.outcome.code,
    }).toEqual(exBefore);
    expect({
      stream_epoch: after?.state.binding?.stream_epoch,
      applied_cursor: after?.view.appliedCursor,
      projection: after?.view.projection,
      buffered: after?.view.buffered,
    }).toEqual(exAfter);
    mark("OBS-12", "before_trusted_reset");
    mark("OBS-12", "after_trusted_reset");
    eq(
      "payload_reset_field_alone_authorizes",
      before?.outcomes[0]?.outcome.disposition !== "rejected",
    );
  },
  "OBS-13": (_c, r, _ex, eq) => {
    const mid = r.trace[3];
    eq("mismatched_records_applied", mid?.state.eventLog.length);
    eq(
      "denial",
      [
        ...new Set(
          r.trace
            .slice(1, 4)
            .flatMap((t) => t.outcomes.map((o) => o.outcome.code)),
        ),
      ].join(","),
    );
    eq(
      "cross_scope_payload_or_existence_disclosed",
      /event-wrong|fixture-other-project|opaque-view-B/.test(
        JSON.stringify(mid?.state),
      ),
    );
    eq("after_revocation", r.view.projection);
    eq(
      "private_buffer_and_preview_caches_retained",
      r.state.buffer.length > 0 ||
        r.state.view !== null ||
        Object.keys(r.state.ancillary.seen).length > 0,
    );
    eq("new_authorized_snapshot_required", r.view.fullSnapshotRequired);
  },
  "OBS-14": (_c, r, _ex, eq) => {
    eq("projection", r.view.projection);
    eq("applied_cursor", r.view.appliedCursor);
    eq("current_plan", r.view.currentPlan);
    eq("task_native_state", taskState(r.view));
    eq(
      "historical_only",
      r.state.historicalOnly.length === 1 &&
        outcomeOf(r, "event-late-plan-A")[0]?.disposition === "applied"
        ? ["event-late-plan-A"]
        : r.state.historicalOnly,
    );
    eq(
      "accepted_join_or_success_inferred",
      taskState(r.view) === "done" ||
        r.view.dimensions.independentAcceptance !== "NOT_MEASURED",
    );
  },
  "OBS-15": (_c, r, _ex, eq) => {
    eq(
      "qualified_nodes_named_node_1",
      r.view.nodes.filter((n) => n.localId === "node-1").length,
    );
    eq("explicit_crosslinks", r.view.crosslinks.length);
    eq("implicit_joins", r.view.implicitJoins);
    eq("invalid_records_rejected", rejectedIds(r));
    eq(
      "work_dependencies_require_muneral_authority",
      r.state.view?.graphs
        .filter((g) => g.graph_kind === "work")
        .every(
          (g) =>
            g.authority === "muneral" &&
            g.edges.every((e) => e.evidence_refs.length >= 0),
        ) ?? false,
    );
  },
  "OBS-16": (_c, r, _ex, eq) => {
    eq("projection", r.view.projection);
    eq("applied_cursor", r.view.appliedCursor);
    eq(
      "native_state",
      r.view.nodes.find((n) => n.localId === "fixture-db-run")?.nativeState,
    );
    eq(
      "native_source_sequence_values",
      r.view.sourceSequences.map((x) => x.value),
    );
    eq("source_scope", r.view.sourceSequences[0]?.scope);
    eq("source_contiguity", r.view.sourceSequences[0]?.contiguity);
    eq(
      "lost_events_inferred",
      r.view.holds.length > 0 || r.view.sourceReconcile.length > 0,
    );
    eq(
      "hidden_event_count_or_identity_inferred",
      r.view.unassociatedSubjects.length > 0 ||
        r.view.history.some((h) => h.kind === "node_absent"),
    );
    eq("acceptance", r.view.dimensions.independentAcceptance);
  },
  "OBS-17": (_c, r, _ex, eq) => {
    const att = (id: string) => r.view.attempts.find((a) => a.recordId === id);
    eq("applied_cursor", r.view.appliedCursor);
    eq("task_native_state", taskState(r.view));
    eq("attempt_native_state", att("attempt-succeeded")?.nativeState);
    eq("acceptance", r.view.dimensions.independentAcceptance);
    eq(
      "accepted_join_inferred",
      r.view.attempts.some((a) => a.acceptance !== "NOT_MEASURED"),
    );
    eq("invalid_records_rejected", rejectedIds(r));
    eq(
      "aggregate_claim_semantic_rejection",
      outcomeOf(r, "conflicting-checker-aggregate").find(
        (o) => o.disposition === "quarantined",
      )?.code,
    );
    eq(
      "conflicting_aggregate_is_current_PASS",
      att("conflicting-checker-aggregate")?.acceptance === ("PASS" as string),
    );
    eq(
      "authoritative_acceptance_decision_required",
      r.view.attempts.every((a) => a.acceptance !== ("PASS" as string)) &&
        att("conflicting-checker-aggregate")?.sourceAcceptance === "PASS",
    );
    eq(
      "executed_unknown_preserved",
      att("attempt-checker-unknown")?.executedUndecided.includes(
        "fixture-checker",
      ) === true,
    );
    eq(
      "absent_checker_equated_with_executed_unknown",
      att("attempt-succeeded")?.checkersObserved ===
        att("attempt-checker-unknown")?.checkersObserved,
    );
    eq(
      "mandatory_unknown_satisfied_by_other_positive",
      att("attempt-checker-unknown")?.acceptance !== "NOT_MEASURED",
    );
  },
  "OBS-18": (_c, r, _ex, eq) => {
    const unassoc = r.trace[0]?.view;
    const assoc = r.trace[1]?.view;
    const db = assoc?.nodes.find((n) => n.graphKind === "processing_execution");
    const chain = assoc?.nodes.find(
      (n) => n.graphKind === "contract_receipt_chain",
    );
    const b2 = classifyDoclabNativeShape(nativeBody("b2-native-shape"));
    const ordinary = classifyDoclabNativeShape(
      nativeBody("converted-ordinary-native-shape"),
    );
    eq("database_run_id", db?.attributes["database_run_id"]);
    eq("receipt_run_id", chain?.attributes["receipt_run_id"]);
    eq("association_requires", assoc?.crosslinks[0]?.associationRef);
    eq("string_equality_or_prefix_join", (unassoc?.crosslinks.length ?? 0) > 0);
    eq("worker_stage_nodes", assoc?.workerStageNodes);
    eq("worker_attempt_records", assoc?.attempts.length);
    eq("OCR_execution_observed", b2.workerExecutionObserved);
    eq("text_source", db?.attributes["text_source"]);
    eq("native_state", db?.nativeState);
    eq("acceptance", assoc?.dimensions.independentAcceptance);
    eq(
      "finished_shape_requires",
      b2.shape === "b2_finished_converted_text"
        ? [
            "profile=converted-text",
            "status=SUCCEEDED",
            "event run_inserted_finished",
            "zero stage_tasks in same snapshot",
          ]
        : [],
    );
    // The profile name alone must not prove B2: drop the finished event, or add a stage row, and the shape changes.
    const noEvent = {
      ...(nativeBody("b2-native-shape") as object),
      events: [],
    };
    const withStage = {
      ...(nativeBody("b2-native-shape") as object),
      stage_tasks: [{ task_id: "x" }],
    };
    eq(
      "profile_string_alone_proves_B2",
      classifyDoclabNativeShape(noEvent).shape ===
        "b2_finished_converted_text" ||
        classifyDoclabNativeShape(withStage).shape ===
          "b2_finished_converted_text",
    );
    const ordinaryRun = runCase({
      ...(_c as Case),
      steps: [{ action: "receive", record_id: "snapshot-converted-ordinary" }],
    });
    eq("ordinary_same_profile_variant", {
      worker_stage_nodes: ordinaryRun.view.workerStageNodes,
      inferred_no_worker_execution: !ordinary.workerExecutionObserved,
      attempt_absence_remains_not_measured:
        ordinaryRun.view.attempts.length === 0 &&
        ordinaryRun.view.dimensions.independentAcceptance === "NOT_MEASURED",
    });
  },
  "OBS-19": (_c, r, _ex, eq) => {
    const dbKey = JSON.stringify([
      "processing_execution",
      "doclab",
      "fixture-doclab-db",
      "fixture-db-b2",
      null,
    ]);
    const chain = r.view.nodes.find(
      (n) => n.graphKind === "contract_receipt_chain",
    );
    const lastObs = [...r.view.history]
      .reverse()
      .find((h) => h.nodeKey === dbKey && h.value !== null);
    eq("applied_cursor", r.view.appliedCursor);
    eq(
      "current_finished_row_exists",
      r.view.nodes.some((n) => n.key === dbKey),
    );
    eq(
      "prior_observation_retained_as_history",
      r.view.history.some(
        (h) => h.nodeKey === dbKey && h.value === "SUCCEEDED",
      ),
    );
    eq(
      "irreversible_production_success",
      r.view.nodes.some(
        (n) => n.key === dbKey && n.nativeState === "SUCCEEDED",
      ) || r.view.dimensions.independentAcceptance !== "NOT_MEASURED",
    );
    eq(
      "cross_database_filesystem_atomicity",
      r.view.crossSourceAtomicityAsserted,
    );
    eq("acceptance", r.view.dimensions.independentAcceptance);
    eq("last_native_observation", `${lastObs?.value} (historical only)`);
    eq(
      "adapter_observation",
      r.view.history.some(
        (h) => h.kind === "record_withdrawn" && h.nodeKey === dbKey,
      )
        ? "source_row_absent"
        : "none",
    );
    eq(
      "current_native_state",
      r.view.nodes.find((n) => n.key === dbKey)?.nativeState ?? null,
    );
    const w = records["b2-row-withdrawn"] as {
      data: { native_state: unknown; source_sequence: { value: unknown } };
    };
    eq(
      "native_withdrawn_event_invented",
      w.data.native_state !== null || w.data.source_sequence.value !== null,
    );
    eq(
      "partial_receipt_chain_retained",
      chain !== undefined && chain.attributes["availability"] === "retained",
    );
    eq(
      "remaining_canonical_prefix",
      (
        nativeBody("b2-final-reconciliation") as {
          remaining_canonical_prefix: string[];
        }
      ).remaining_canonical_prefix,
    );
    eq("unobserved_chain_deletion_inferred", chain === undefined);
  },
  "OBS-20": (_c, r, _ex, eq) => {
    eq("applied_cursor", r.view.appliedCursor);
    eq("command_journal_status", r.view.commands[0]?.journalStatus);
    eq("reason", r.view.commands[0]?.reason);
    eq("canonical_native_run_id", r.view.commands[0]?.canonicalRunId);
    eq("attempts_created", r.view.attempts.length);
    eq("tools_invoked", r.commands.length);
    eq(
      "deployment_inferred_from_source_pin",
      r.view.deployments.some((d) => d.observedBuild !== null),
    );
    eq("acceptance", r.view.dimensions.independentAcceptance);
  },
  "OBS-21": (_c, r, _ex, eq) => {
    const mutable = r.view.artifacts.find(
      (a) => a.recordId === "receipt-mutable",
    );
    const a = r.view.attempts.find(
      (x) => x.recordId === "attempt-unbounded-audit",
    );
    const c1 = r.view.artifacts.find(
      (x) => x.recordId === "receipt-captured-1",
    );
    const c2 = r.view.artifacts.find(
      (x) => x.recordId === "receipt-captured-2",
    );
    eq(
      "mutable_pointer_is_historical_proof",
      mutable?.storageIdentity === "immutable",
    );
    eq("immutable_captures", r.view.immutableCaptureRevisions);
    eq(
      "different_receipt_bytes_kept_distinct",
      JSON.stringify(c1?.digests) !== JSON.stringify(c2?.digests) &&
        c1 !== undefined &&
        c2 !== undefined,
    );
    eq(
      "unbounded_audit_is_exact_attempt_proof",
      a?.exactEvidenceCoverage === true,
    );
    eq(
      "attempt_to_capture_binding_still_required",
      a?.exactEvidenceCoverage === false && a.joinedByEvent === false,
    );
    eq("acceptance", r.view.dimensions.independentAcceptance);
  },
  "OBS-22": (_c, r, _ex, eq) => {
    const fp =
      r.state.ancillary.artifacts["artifact-fingerprint-only"]?.data.digests[0];
    const raw = bodies["same-json-raw"]?.digest as unknown as Digest;
    const dom = bodies["canonical-domain-example"]?.digest as unknown as Digest;
    eq("fingerprint_role", fp?.role);
    eq(
      "fingerprint_is_content_address",
      fp !== undefined && isExactContentAddress(fp),
    );
    eq("invalid_records_rejected", rejectedIds(r));
    eq("raw_vs_domain_digest_comparison", compareDigests(raw, dom));
    eq(
      "canonical_example_is_valid_native_snapshot",
      !(bodies["canonical-domain-example"]?.note ?? "").includes("not a valid"),
    );
    eq("acceptance", r.view.dimensions.independentAcceptance);
  },
  "OBS-23": (_c, r, _ex, eq) => {
    const pick = (id: string) =>
      r.view.artifacts.find((a) => a.recordId === id);
    const d = pick("artifact-denied");
    const col = pick("artifact-collected");
    const mis = pick("artifact-missing");
    eq("denied", {
      availability: d?.availability,
      access: d?.access,
      locator: d?.locator,
      digests: d?.digests,
    });
    eq("collected", {
      availability: col?.availability,
      access: col?.access,
      open_enabled: col?.open.enabled,
    });
    eq("missing", {
      availability: mis?.availability,
      access: mis?.access,
      open_enabled: mis?.open.enabled,
    });
    eq(
      "old_metadata_certifies_current_bytes",
      r.view.artifacts.some((a) => a.open.enabled),
    );
    eq(
      "unauthorized_existence_disclosed",
      d?.locator !== null || (d?.digests.length ?? 0) > 0,
    );
  },
  "OBS-24": (_c, r, _ex, eq) => {
    eq("projection", r.view.projection);
    eq("applied_cursor", r.view.appliedCursor);
    eq("invalid_records_rejected", rejectedIds(r));
    eq(
      "reasons",
      r.trace.flatMap((t) =>
        t.outcomes
          .filter((o) => o.key.startsWith("invalid-"))
          .map((o) => o.outcome.code),
      ),
    );
    eq(
      "unknown_record_skipped_as_success",
      r.view.appliedCursor !== "9007199254740992" ||
        r.view.projection === "current",
    );
    eq("acceptance", r.view.dimensions.independentAcceptance);
  },
};

describe("prepared reducer cases OBS-01..OBS-24 executed in the real reducer", () => {
  it("covers exactly the 24 prepared cases", () => {
    expect(cases.map((c) => c.case_id)).toEqual(
      Array.from(
        { length: 24 },
        (_, i) => `OBS-${String(i + 1).padStart(2, "0")}`,
      ),
    );
    expect(Object.keys(checks).sort()).toEqual(
      cases.map((c) => c.case_id).sort(),
    );
  });

  for (const c of cases) {
    describe(`${c.case_id} ${c.title}`, () => {
      for (const mode of caseMeta.mode_matrix) {
        it(`reduces to the oracle and emits zero commands in ${mode} mode`, () => {
          const run = runCase(c, mode);
          const ex = c.expected_observations;
          const eq = (key: string, actual: unknown): void => {
            expect(ex, `oracle lacks key ${key}`).toHaveProperty(key);
            expect(actual, `${c.case_id}.${key}`).toEqual(ex[key]);
            if (mode === "fixture") mark(c.case_id, key);
          };
          const check = checks[c.case_id];
          expect(check).toBeDefined();
          check?.(c, run, ex, eq, (k) => mark(c.case_id, k));
          // Zero-command invariant: no reduce() call returned a command and the state carries none.
          expect(run.commands).toEqual([]);
          expect(c.expected_emitted_commands).toEqual([]);
          expect(run.state.commands).toEqual([]);
          expect(run.view.emittedCommands).toEqual([]);
          for (const t of run.trace) expect(t.state.commands).toEqual([]);
        });
      }
    });
  }

  afterAll(() => {
    const missing: Record<string, string[]> = {};
    for (const c of cases) {
      const have = asserted.get(c.case_id) ?? new Set<string>();
      const gap = Object.keys(c.expected_observations).filter(
        (k) => !have.has(k),
      );
      if (gap.length > 0) missing[c.case_id] = gap;
    }
    const out = process.env["OBS_COVERAGE_OUT"];
    if (out !== undefined) {
      const executed: Record<string, string[]> = {};
      for (const [k, v] of asserted) executed[k] = [...v].sort();
      writeFileSync(
        out,
        JSON.stringify(
          {
            executed_expectation_keys: executed,
            unasserted_expectation_keys: missing,
          },
          null,
          2,
        ),
      );
    }
    // Every top-level oracle key of every case must have been asserted; a silently skipped expectation is a failure.
    expect(missing).toEqual({});
  });
});

describe("all 50 package records through the strict decoder", () => {
  const expectations = new Map<string, boolean>();
  for (const c of cases)
    for (const e of c.schema_examples)
      expectations.set(e.record_id, e.expected_valid);
  const invalidReason: Record<string, string> = {
    "invalid-numeric-cursor": "SCHEMA_INVALID",
    "invalid-numeric-aggregate-version": "SCHEMA_INVALID",
    "invalid-bare-node": "SCHEMA_INVALID",
    "invalid-empty-checker-pass": "SCHEMA_INVALID",
    "invalid-fingerprint-content-address": "SCHEMA_INVALID",
    "invalid-unknown-profile": "UNSUPPORTED_PROFILE",
    "invalid-missing-producer": "SCHEMA_INVALID",
    "invalid-unknown-extension": "UNSUPPORTED_REQUIRED_EXTENSION",
  };

  it("has 50 records, 42 expected valid and 8 deliberately invalid", () => {
    expect(Object.keys(records)).toHaveLength(50);
    const invalid = Object.keys(records).filter(
      (k) => expectations.get(k) === false,
    );
    expect(invalid.sort()).toEqual(Object.keys(invalidReason).sort());
    expect(Object.keys(records).length - invalid.length).toBe(42);
  });

  for (const key of Object.keys(records)) {
    const wantInvalid = expectations.get(key) === false;
    it(`${key} is ${wantInvalid ? "rejected" : "accepted"}`, () => {
      const result = decodeObservationRecord(records[key]);
      if (wantInvalid) {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe(invalidReason[key]);
      } else {
        expect(
          result.ok,
          result.ok ? "" : `${result.code}: ${result.detail}`,
        ).toBe(true);
      }
    });
  }

  it("preserves fixture body digests (raw sha256 and the Muneral domain preimage)", () => {
    for (const [key, body] of Object.entries(bodies)) {
      if (key === "complete_event_records") continue;
      const b = body as {
        bytes_utf8: string;
        digest: { role: string; value: string; byte_size: string };
        preimage_prefix_ascii?: string;
      };
      const bytes = Buffer.from(b.bytes_utf8, "utf8");
      const preimage =
        b.digest.role === "domain_identity"
          ? Buffer.concat([
              Buffer.from(b.preimage_prefix_ascii ?? "", "ascii"),
              Buffer.from([0]),
              bytes,
            ])
          : bytes;
      expect(String(preimage.length), key).toBe(b.digest.byte_size);
      expect(createSha(preimage), key).toBe(b.digest.value);
    }
    for (const [key, body] of Object.entries(
      bodies["complete_event_records"] ?? {},
    )) {
      const b = body as {
        bytes_utf8: string;
        digest: { value: string; byte_size: string };
      };
      expect(createSha(Buffer.from(b.bytes_utf8, "utf8")), key).toBe(
        b.digest.value,
      );
    }
  });

  it("pins the package manifest to the handed-over sha256 sums", () => {
    const sums = readFileSync(
      new URL(
        "./fixtures/knowledge-observation-v1/SHA256SUMS",
        import.meta.url,
      ),
      "utf8",
    );
    for (const name of [
      "fixture-records.json",
      "fixture-bodies.json",
      "reducer-cases.json",
    ]) {
      const line = sums.split("\n").find((l) => l.endsWith(`  ${name}`));
      expect(line, name).toBeDefined();
      expect(
        createSha(
          readFileSync(
            new URL(
              `./fixtures/knowledge-observation-v1/${name}`,
              import.meta.url,
            ),
          ),
        ),
        name,
      ).toBe(line?.split(" ")[0]);
    }
  });
});

import { createHash } from "node:crypto";
function createSha(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
