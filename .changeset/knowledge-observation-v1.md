---
"@arcanada/access-contracts": minor
---

Add the Knowledge Collective Live Lab observation profile v1, additively and dependency-free: `parseKnowledgeObservationJson` (bounded frames through `parseBoundedJson`, strict versioned decoding with string decimal counters and RFC3339 times) and a pure `reduceKnowledgeObservation` / `projectKnowledgeObservation` that emits zero commands in live, replay and fixture modes. Reviewer corrections (amendment 1): a source FAIL no longer needs aggregate PASS decision refs and is labelled an unverified source observation; paged snapshots become current only with an adapter-sealed page-set manifest (`trusted_page_set_manifest`, `knowledgeObservationPageDigest`); same-watermark equality compares the complete normalised projection; a verified replay interval can still recover a gap.
