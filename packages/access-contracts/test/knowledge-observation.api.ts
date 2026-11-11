/**
 * The tests import the observation profile ONLY through the package root, under the short names the case harness uses.
 * This proves the additive root export is complete enough to run all prepared cases.
 */
export {
  KNOWLEDGE_OBSERVATION_LOSSLESS_DECIMAL_EXTENSION as LOSSLESS_DECIMAL_EXTENSION,
  parseKnowledgeObservationJson,
  decodeKnowledgeObservationRecord as decodeObservationRecord,
  compareKnowledgeObservationDecimal as compareDecimal,
  nextKnowledgeObservationDecimal as nextDecimal,
  compareKnowledgeObservationDigests as compareDigests,
  isKnowledgeObservationExactContentAddress as isExactContentAddress,
  classifyKnowledgeObservationDoclabShape as classifyDoclabNativeShape,
  createKnowledgeObservationState as createReducerState,
  reduceKnowledgeObservation as reduce,
  projectKnowledgeObservation as projectView,
  knowledgeObservationStableDigestInput as stableViewDigestInput,
  projectKnowledgeObservationGraph as projectGraphPresentation,
  knowledgeObservationGraphDigestInput as graphPresentationDigestInput,
  knowledgeObservationPageDigest as snapshotPageDigest,
  evaluateKnowledgeObservationAcceptance as evaluateAcceptance,
  type KnowledgeObservationViewContext as ViewContext,
  type KnowledgeObservationDigest as Digest,
  type KnowledgeObservationMode as ObservationMode,
  type KnowledgeObservationState as ReducerState,
  type KnowledgeObservationInput as ReducerInput,
  type KnowledgeObservationOutcome as ReduceOutcome,
  type KnowledgeObservationView as ProjectedView,
  type KnowledgeObservationPageSetManifest as PageSetManifest,
} from "../src/index.js";
