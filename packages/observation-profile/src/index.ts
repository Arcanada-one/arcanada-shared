export { PROFILE_ID, LOSSLESS_DECIMAL_EXTENSION } from "./types.js";
export type * from "./types.js";
export { decodeObservationRecord, decodeObservationJson } from "./decoder.js";
export type {
  DecodeResult,
  DecodeFailureCode,
  DecodeOptions,
} from "./decoder.js";
export { compareDecimal, nextDecimal, isCanonicalDecimal } from "./decimal.js";
export { canonicalJson } from "./canonical.js";
export { evaluateAcceptance } from "./acceptance.js";
export type {
  AcceptanceEvaluation,
  AcceptancePolicy,
  AcceptanceIssueCode,
} from "./acceptance.js";
export { compareDigests, isExactContentAddress } from "./digest.js";
export type { DigestComparison } from "./digest.js";
export { classifyDoclabNativeShape } from "./native-shape.js";
export type {
  DoclabNativeClassification,
  DoclabNativeShape,
} from "./native-shape.js";
export {
  createReducerState,
  reduce,
  reduceAll,
  nodeKey,
  DEFAULT_BUFFER_LIMITS,
} from "./reducer.js";
export type {
  ReducerState,
  ReducerInput,
  ReduceResult,
  ReduceOutcome,
  Disposition,
  HoldCode,
  Projection,
  BufferLimits,
  ReducerOptions,
  EventLedgerEntry,
} from "./reducer.js";
export { projectView, stableViewDigestInput } from "./view.js";
export type { ProjectedView, ProjectedNode, ViewKind } from "./view.js";
