/** Hand-written types for the fields the decoder and reducer read. The JSON Schema stays the structural authority. */

export const PROFILE_ID = "knowledge-collective-observation/v1" as const;
export const LOSSLESS_DECIMAL_EXTENSION =
  "lossless-decimal-counters/v1" as const;

export type GraphKind =
  | "processing_execution"
  | "contract_receipt_chain"
  | "knowledge"
  | "work";
export type ObservationMode = "live" | "replay" | "fixture";
export type RecordType =
  | "run"
  | "event"
  | "snapshot"
  | "attempt"
  | "artifact"
  | "command"
  | "deployment";

export interface ViewContext {
  readonly project_id: string;
  readonly run_id: string;
  readonly authorized_view_scope: string;
  readonly stream_epoch: string;
}

export interface QualifiedRef {
  readonly graph_kind: GraphKind;
  readonly authority: string;
  readonly namespace: string;
  readonly local_id: string;
  readonly revision: string | null;
}

export interface NativeState {
  readonly authority: string;
  readonly value: string;
  readonly reason: string | null;
}

export interface Digest {
  readonly algorithm: string;
  readonly role: string;
  readonly domain: string;
  readonly preimage: string;
  readonly representation: string;
  readonly byte_size: string | null;
  readonly value: string;
}

export interface Checker {
  readonly checker_id: string;
  readonly verdict: "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE";
  readonly [key: string]: unknown;
}

export interface Acceptance {
  readonly verdict: "PASS" | "FAIL" | "NOT_MEASURED";
  readonly claim_ids: readonly string[];
  readonly scope_ref: string;
  readonly checks: readonly Checker[];
  readonly reason: string | null;
  readonly decision_evidence_ref: string | null;
  readonly decision_policy_ref: string | null;
  readonly [key: string]: unknown;
}

export interface SourceSequence {
  readonly value: string | null;
  readonly scope: string;
  readonly scope_id: string;
  readonly partition_id: string | null;
  readonly contiguity: "declared_contiguous" | "not_contiguous" | "unknown";
  readonly declaration_ref: string | null;
}

export interface Producer {
  readonly service: string;
  readonly instance_id: string;
  readonly build: {
    readonly repository: string;
    readonly commit: string;
    readonly adapter_revision: string;
  };
}

export interface GraphNode {
  readonly ref: QualifiedRef;
  readonly node_type: string;
  readonly native_state: NativeState | null;
  readonly native_versions: Readonly<Record<string, string>>;
  readonly acceptance: Acceptance;
  readonly evidence_refs: readonly string[];
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface GraphEdge {
  readonly edge_id: string;
  readonly kind: string;
  readonly from: QualifiedRef;
  readonly to: QualifiedRef;
  readonly evidence_refs: readonly string[];
}

export interface Graph {
  readonly graph_kind: GraphKind;
  readonly authority: string;
  readonly graph_revision: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export interface Crosslink {
  readonly link_id: string;
  readonly kind: string;
  readonly from: QualifiedRef;
  readonly to: QualifiedRef;
  readonly association_ref: string;
  readonly evidence_refs: readonly string[];
}

export interface SnapshotData {
  readonly watermark: string;
  readonly snapshot_kind: "full" | "partial";
  readonly trusted_snapshot_ref: string;
  readonly plan_revision: string | null;
  readonly coverage: {
    readonly extent: string;
    readonly declared_graph_kinds: readonly GraphKind[];
    readonly complete: boolean;
    readonly next_page_token: string | null;
  };
  readonly source_atomicity:
    | "not_established"
    | "source_asserted_with_evidence";
  readonly graphs: readonly Graph[];
  readonly crosslinks: readonly Crosslink[];
  readonly reset: {
    readonly previous_epoch: string;
    readonly reason: string;
    readonly authorization_observation_ref: string;
  } | null;
  readonly native_state: NativeState | null;
  readonly acceptance: Acceptance;
}

export interface EventData {
  readonly event_id: string;
  readonly cursor: string;
  readonly producer_event_id: string;
  readonly source_sequence: SourceSequence;
  readonly kind: string;
  readonly plan_revision: string | null;
  readonly subject_refs: readonly QualifiedRef[];
  readonly occurred_at: string;
  readonly causation_ref: string | null;
  readonly correlation_ref: string | null;
  readonly native_state: NativeState | null;
  readonly native_versions: Readonly<Record<string, string>>;
  readonly evidence_refs: readonly string[];
  readonly body: { readonly evidence_ref: string; readonly digest: Digest };
  readonly related_record_ids: readonly string[];
}

export interface RunData {
  readonly kind: "knowledge" | "agent";
  readonly root_task: QualifiedRef | null;
  readonly current_cursor: string | null;
  readonly connection: "connected" | "disconnected" | "unconnected";
  readonly freshness: {
    readonly state: string;
    readonly as_of: string | null;
    readonly reason: string | null;
  };
  readonly native_state: NativeState | null;
  readonly acceptance: Acceptance;
  readonly [key: string]: unknown;
}

export interface AttemptData {
  readonly attempt_ref: QualifiedRef;
  readonly task_or_stage_ref: QualifiedRef;
  readonly ordinal: string;
  readonly plan_revision: string | null;
  readonly native_state: NativeState | null;
  readonly evidence_coverage: "exact_attempt" | "unbounded_slice" | "unknown";
  readonly outputs: readonly unknown[];
  readonly acceptance: Acceptance;
  readonly [key: string]: unknown;
}

export interface ArtifactKey {
  readonly authority: string;
  readonly namespace: string;
  readonly artifact_id: string;
  readonly revision: string;
}

export interface ArtifactData {
  readonly artifact: ArtifactKey;
  readonly profile: string;
  readonly kind: string;
  readonly byte_size: string | null;
  readonly digests: readonly Digest[];
  readonly locator: unknown;
  readonly storage_identity: "immutable" | "versioned" | "mutable" | "unknown";
  readonly availability:
    | "retained"
    | "missing"
    | "collected"
    | "quarantined"
    | "unknown";
  readonly access: "allowed" | "denied" | "unknown";
  readonly supersedes: ArtifactKey | null;
  readonly acceptance: Acceptance;
  readonly [key: string]: unknown;
}

export interface CommandData {
  readonly command_id: string;
  readonly operation: string;
  readonly journal_status:
    | "intent_observed"
    | "accepted_observed"
    | "rejected_observed"
    | "unknown";
  readonly reason: string | null;
  readonly canonical_run_id: string | null;
  readonly canonical_task_ref: QualifiedRef | null;
  readonly canonical_attempt_ref: QualifiedRef | null;
  readonly acceptance: Acceptance;
  readonly [key: string]: unknown;
}

export interface DeploymentData {
  readonly service_alias: string;
  readonly environment: string;
  readonly actual_build: unknown;
  readonly capabilities: readonly {
    readonly name: string;
    readonly status: string;
  }[];
  readonly acceptance: Acceptance;
  readonly [key: string]: unknown;
}

interface Envelope<T extends RecordType, D> {
  readonly profile: typeof PROFILE_ID;
  readonly record_type: T;
  readonly record_id: string;
  readonly mode: ObservationMode;
  readonly view_context: ViewContext;
  readonly producer: Producer;
  readonly observed_at: string;
  readonly recorded_at: string;
  readonly evidence_basis: string;
  readonly data: D;
  readonly required_extensions: readonly string[];
}

export type RunRecord = Envelope<"run", RunData>;
export type EventRecord = Envelope<"event", EventData>;
export type SnapshotRecord = Envelope<"snapshot", SnapshotData>;
export type AttemptRecord = Envelope<"attempt", AttemptData>;
export type ArtifactRecord = Envelope<"artifact", ArtifactData>;
export type CommandRecord = Envelope<"command", CommandData>;
export type DeploymentRecord = Envelope<"deployment", DeploymentData>;

export type ObservationRecord =
  | RunRecord
  | EventRecord
  | SnapshotRecord
  | AttemptRecord
  | ArtifactRecord
  | CommandRecord
  | DeploymentRecord;
