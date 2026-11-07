---
"@arcanada/access-contracts": minor
---

Knowledge observation: one shared, additive graph presentation projection for site mounts. `projectKnowledgeObservationGraph` returns qualified typed ordinary edges, graph identity and revision, the source authority revisions, node, edge and crosslink evidence associations, and source acceptance kept apart from independent acceptance (a source PASS is never an independent PASS). `knowledgeObservationGraphDigestInput` is its order-stable comparison input, so an edge-only, revision-only or evidence-only difference changes it. The existing projection, `knowledgeObservationStableDigestInput`, wire and state types, limits and the accepted repairs are unchanged; revocation, epoch reset and denied contexts clear the new fields because they are derived from the same retained view.
