export type DoclabNativeShape =
  | "b2_finished_converted_text"
  | "ordinary"
  | "unrecognized";

export interface DoclabNativeClassification {
  readonly shape: DoclabNativeShape;
  readonly workerStageNodes: number;
  readonly workerExecutionObserved: boolean;
}

interface NativeRead {
  readonly run?: { readonly profile?: unknown; readonly status?: unknown };
  readonly events?: readonly { readonly event_type?: unknown }[];
  readonly stage_tasks?: readonly unknown[];
  readonly stage_attempts?: readonly unknown[];
}

/**
 * Classify a Doclab native read taken from ONE database snapshot. The B2 finished shape needs all four conditions; the
 * profile name alone is insufficient. Absence of stage rows is scoped to this read and says nothing about other upstream
 * converters.
 */
export function classifyDoclabNativeShape(
  read: unknown,
): DoclabNativeClassification {
  if (typeof read !== "object" || read === null)
    return {
      shape: "unrecognized",
      workerStageNodes: 0,
      workerExecutionObserved: false,
    };
  const r = read as NativeRead;
  const stages = Array.isArray(r.stage_tasks) ? r.stage_tasks.length : 0;
  const attempts = Array.isArray(r.stage_attempts)
    ? r.stage_attempts.length
    : 0;
  if (r.run === undefined || !Array.isArray(r.stage_tasks))
    return {
      shape: "unrecognized",
      workerStageNodes: stages,
      workerExecutionObserved: false,
    };
  const finishedEvent = (r.events ?? []).some(
    (e) => e.event_type === "run_inserted_finished",
  );
  const b2 =
    r.run.profile === "converted-text" &&
    r.run.status === "SUCCEEDED" &&
    finishedEvent &&
    stages === 0;
  return {
    shape: b2 ? "b2_finished_converted_text" : "ordinary",
    workerStageNodes: stages,
    workerExecutionObserved: !b2 && (stages > 0 || attempts > 0),
  };
}
