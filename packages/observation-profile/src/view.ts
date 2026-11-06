import { evaluateAcceptance } from "./acceptance.js";
import { canonicalJson } from "./canonical.js";
import { nodeKey, type ReducerState } from "./reducer.js";
import type { GraphKind, GraphNode } from "./types.js";

export type ViewKind = "unconnected" | "fixture" | "replay" | "live";

export interface ProjectedNode {
  readonly key: string;
  readonly graphKind: GraphKind;
  readonly authority: string;
  readonly namespace: string;
  readonly localId: string;
  readonly revision: string | null;
  readonly nodeType: string;
  readonly nativeState: string | null;
  readonly nativeVersions: Readonly<Record<string, string>>;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface ProjectedView {
  readonly viewKind: ViewKind;
  readonly projection: ReducerState["projection"];
  readonly stale: boolean;
  readonly appliedCursor: string | null;
  readonly holds: readonly string[];
  readonly fullSnapshotRequired: boolean;
  readonly currentPlan: string | null;
  /** Connection, freshness, native state and independent acceptance are four separate dimensions. */
  readonly dimensions: {
    readonly connection: string;
    readonly freshness: ReducerState["projection"];
    readonly nativeState: string | null;
    readonly independentAcceptance: "NOT_MEASURED" | "FAIL";
  };
  readonly declaredGraphKinds: readonly GraphKind[];
  readonly nodes: readonly ProjectedNode[];
  readonly crosslinks: readonly {
    readonly linkId: string;
    readonly kind: string;
    readonly from: string;
    readonly to: string;
    readonly associationRef: string;
  }[];
  readonly implicitJoins: 0;
  readonly workerStageNodes: number;
  readonly buffered: readonly string[];
  readonly rejected: readonly {
    readonly recordId: string | null;
    readonly code: string;
  }[];
  readonly quarantined: readonly {
    readonly recordId: string | null;
    readonly code: string;
  }[];
  readonly ignored: readonly {
    readonly recordId: string | null;
    readonly code: string;
  }[];
  readonly historicalOnly: readonly string[];
  readonly uniqueSourceEventsApplied: number;
  readonly history: ReducerState["history"];
  readonly unassociatedSubjects: readonly string[];
  readonly refusals: ReducerState["refusals"];
  readonly attempts: readonly {
    readonly recordId: string;
    readonly attemptKey: string;
    readonly nativeState: string | null;
    readonly acceptance: "NOT_MEASURED" | "FAIL";
    readonly sourceAcceptance: string;
    readonly issues: readonly string[];
    readonly semanticConflict: boolean;
    readonly executedUndecided: readonly string[];
    readonly checkersObserved: boolean;
    readonly exactEvidenceCoverage: boolean;
    readonly joinedByEvent: boolean;
  }[];
  readonly artifacts: readonly {
    readonly recordId: string;
    readonly artifactKey: string;
    readonly availability: string;
    readonly access: string;
    readonly storageIdentity: string;
    readonly locator: unknown;
    readonly digests: readonly unknown[];
    readonly open: {
      readonly enabled: false;
      readonly requires: "CURRENT_AUTHORIZATION_AND_BYTE_CHECK";
    };
    readonly acceptance: "NOT_MEASURED" | "FAIL";
  }[];
  readonly immutableCaptureRevisions: readonly string[];
  readonly commands: readonly {
    readonly commandId: string;
    readonly journalStatus: string;
    readonly reason: string | null;
    readonly canonicalRunId: string | null;
    readonly canonicalAttemptRef: unknown;
  }[];
  readonly deployments: readonly {
    readonly recordId: string;
    readonly observedBuild: unknown;
    readonly capabilities: readonly {
      readonly name: string;
      readonly status: string;
    }[];
  }[];
  readonly eventLedger: ReducerState["eventLedger"];
  readonly sourceSequences: ReducerState["sourceSequences"];
  readonly sourceReconcile: readonly string[];
  readonly snapshotAtomicity: string;
  readonly globalCompletenessAsserted: false;
  readonly crossSourceAtomicityAsserted: false;
  readonly emittedCommands: readonly never[];
}

const journalRank: Record<string, number> = {
  unknown: 0,
  intent_observed: 1,
  accepted_observed: 2,
  rejected_observed: 2,
};

function projectNode(n: GraphNode): ProjectedNode {
  return {
    key: nodeKey(n.ref),
    graphKind: n.ref.graph_kind,
    authority: n.ref.authority,
    namespace: n.ref.namespace,
    localId: n.ref.local_id,
    revision: n.ref.revision,
    nodeType: n.node_type,
    nativeState: n.native_state?.value ?? null,
    nativeVersions: n.native_versions,
    attributes: n.attributes,
  };
}

/** Deterministic, ordering-stable projection of reducer state for the shared inspector. Pure. */
export function projectView(state: ReducerState): ProjectedView {
  const v = state.view;
  const nodes =
    v === null
      ? []
      : v.graphs
          .flatMap((g) => g.nodes.map(projectNode))
          .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const attempts = Object.values(state.ancillary.attempts)
    .map((e) => ({
      recordId: e.record.record_id,
      attemptKey: nodeKey(e.record.data.attempt_ref),
      nativeState: e.record.data.native_state?.value ?? null,
      acceptance: e.evaluation.effectiveVerdict,
      sourceAcceptance: e.record.data.acceptance.verdict,
      issues: e.evaluation.issues,
      semanticConflict: e.semanticConflict,
      executedUndecided: e.evaluation.executedUndecided,
      checkersObserved: e.evaluation.checkersObserved,
      exactEvidenceCoverage:
        e.record.data.evidence_coverage === "exact_attempt",
      joinedByEvent: state.ancillary.joined.includes(e.record.record_id),
    }))
    .sort((a, b) => (a.recordId < b.recordId ? -1 : 1));
  const artifacts = Object.values(state.ancillary.artifacts)
    .map((a) => {
      const denied = a.data.access === "denied";
      return {
        recordId: a.record_id,
        artifactKey: JSON.stringify([
          a.data.artifact.authority,
          a.data.artifact.namespace,
          a.data.artifact.artifact_id,
          a.data.artifact.revision,
        ]),
        // On denial nothing locating or fingerprinting the content is exposed.
        availability: denied ? "unknown" : a.data.availability,
        access: a.data.access,
        storageIdentity: a.data.storage_identity,
        locator: denied ? null : a.data.locator,
        digests: denied ? [] : a.data.digests,
        open: {
          enabled: false as const,
          requires: "CURRENT_AUTHORIZATION_AND_BYTE_CHECK" as const,
        },
        acceptance: evaluateAcceptance(a.data.acceptance).effectiveVerdict,
      };
    })
    .sort((a, b) => (a.recordId < b.recordId ? -1 : 1));
  const commandById = new Map<
    string,
    ReducerState["ancillary"]["commands"][string]
  >();
  for (const c of Object.values(state.ancillary.commands)) {
    const prior = commandById.get(c.data.command_id);
    if (
      prior === undefined ||
      (journalRank[c.data.journal_status] ?? 0) >=
        (journalRank[prior.data.journal_status] ?? 0)
    ) {
      commandById.set(c.data.command_id, c);
    }
  }
  const nativeTop = v?.nativeState?.value ?? null;
  return {
    viewKind:
      v === null ? "unconnected" : state.sawFixture ? "fixture" : state.mode,
    projection: state.projection,
    stale:
      state.projection !== "current" || state.connection === "disconnected",
    appliedCursor: state.appliedCursor,
    holds: state.holds,
    fullSnapshotRequired: state.fullSnapshotRequired,
    currentPlan: state.currentPlan,
    dimensions: {
      connection: state.connection,
      freshness: state.projection,
      nativeState: nativeTop,
      independentAcceptance: v?.acceptance.effectiveVerdict ?? "NOT_MEASURED",
    },
    declaredGraphKinds: v?.declaredGraphKinds ?? [],
    nodes,
    crosslinks: (v?.crosslinks ?? []).map((c) => ({
      linkId: c.link_id,
      kind: c.kind,
      from: nodeKey(c.from),
      to: nodeKey(c.to),
      associationRef: c.association_ref,
    })),
    implicitJoins: 0,
    workerStageNodes: nodes.filter(
      (n) =>
        n.graphKind === "processing_execution" && n.nodeType === "stage_task",
    ).length,
    buffered: state.buffer.map((b) => b.recordId),
    rejected: state.rejected,
    quarantined: state.quarantined,
    ignored: state.ignored,
    historicalOnly: state.historicalOnly,
    uniqueSourceEventsApplied: Object.values(state.eventIdentities).filter(
      (e) => e.status === "applied",
    ).length,
    history: state.history,
    unassociatedSubjects: state.unassociatedSubjects,
    refusals: state.refusals,
    attempts,
    artifacts,
    immutableCaptureRevisions: Object.values(state.ancillary.artifacts)
      .filter((a) => a.data.storage_identity === "immutable")
      .map((a) => a.data.artifact.revision)
      .sort(),
    commands: [...commandById.values()]
      .map((c) => ({
        commandId: c.data.command_id,
        journalStatus: c.data.journal_status,
        reason: c.data.reason,
        canonicalRunId: c.data.canonical_run_id,
        canonicalAttemptRef: c.data.canonical_attempt_ref,
      }))
      .sort((a, b) => (a.commandId < b.commandId ? -1 : 1)),
    deployments: Object.values(state.ancillary.deployments)
      .map((d) => ({
        recordId: d.record_id,
        observedBuild: d.data.actual_build,
        capabilities: d.data.capabilities,
      }))
      .sort((a, b) => (a.recordId < b.recordId ? -1 : 1)),
    eventLedger: state.eventLedger,
    sourceSequences: state.sourceSequences,
    sourceReconcile: state.sourceReconcile,
    snapshotAtomicity: v?.sourceAtomicity ?? "not_established",
    globalCompletenessAsserted: false,
    crossSourceAtomicityAsserted: false,
    emittedCommands: [],
  };
}

/** The part of the view that must be identical when the same recorded events are reduced in any admissible order. */
export function stableViewDigestInput(state: ReducerState): string {
  const view = projectView(state);
  return canonicalJson({
    projection: view.projection,
    appliedCursor: view.appliedCursor,
    currentPlan: view.currentPlan,
    nodes: view.nodes,
    crosslinks: view.crosslinks,
    attempts: view.attempts,
    artifacts: view.artifacts,
    commands: view.commands,
  });
}
