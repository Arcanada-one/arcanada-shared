# Personal owner outcome structure

Reference for the proposed `auth-personal/1-proposed` wire and
`organize-me.synthetic/1` profile. These exports parse protected owner assertions;
they do not activate an endpoint or authenticate a participant. Do not log their
inputs, outputs or nested records.

`parsePersonalAuthOwnerOutcome(unknown)` returns a detached closed discriminated
union or a generic refusal. It composes the existing personal capture status,
object receipt and cancellation parsers without changing those records.
`personalAuthOwnerOutcomeEffect(unknown)` returns the source effect spelling for
a valid structure. It grants no effect execution or settlement authority.

Every outcome has exactly these common fields:

- `owner_receipt_id`, `realm_id`, `participant_id`, `operation_id`, `intent_id`,
  `owner_commit_id`: canonical lowercase UUIDs.
- `kind`: one variant below.
- `deployment_generation`, `process_generation`, `local_seq`: canonical decimal
  strings in the unsigned 64-bit range, including zero.
- `resource_binding_digest`: 64 lowercase SHA-256 hexadecimal characters.

| Kind                | Additional fields                                                                          | Envelope-local checks                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `intent_created`    | `capture_status`                                                                           | Awaiting bytes, revision exactly 1                                                                  |
| `intent_staged`     | `capture_status`, `storage_receipt_ids`                                                    | Staged status and complete matching shared receipts; distinct ID vector with the same length        |
| `disk_stored`       | `object_receipt`, `storage_receipt_id`                                                     | Shared receipt and canonical envelope receipt ID                                                    |
| `product_committed` | `capture_status`, `publication_id`, `manifest_digest`, `storage_receipt_ids`               | Committed status; publication equals its manifest ID; digest syntax and complete distinct ID vector |
| `product_cancelled` | `capture_status`                                                                           | Shared cancelled status and its terminal cancellation invariants                                    |
| `link_repaired`     | `committed_owner_outcome_id`, `storage_receipt_id`, `link_revision`, `link_binding_digest` | Canonical IDs, digest syntax, nonnegative safe numeric owner counter                                |
| `disk_cleaned`      | `cancelled_owner_outcome_id`, `cancellation`, `cleaned_objects`                            | Shared cancellation and one or two closed object triples; unique part and object IDs                |

Shared status descriptors, object receipts and cancellation records must match
the envelope's realm and intent. A cleaned object has exactly `part_id`,
`object_id`, `object_revision`, all canonical UUIDs. Unknown, missing and
cross-variant fields refuse; outer protocol metadata belongs to a separate
endpoint envelope. No nullable shortcuts, caller role or lease fields are added.

`link_revision` retains the existing decoded safe numeric OwnerCounter
semantics, including decoded negative zero. Auth's strict raw JSON transport
separately rejects noncanonical numeric spelling; parsing an already decoded
record never proves that raw transport gate ran. Nested shared records retain
their existing semantics.

## Retry comparison

`comparePersonalAuthOwnerOutcome(expected, received)` parses both inputs once
and compares detached snapshots:

- `invalid`: either structure refuses.
- `different_receipt`: valid assertions have different `owner_receipt_id` values.
- `same_outcome`: the same receipt ID and all common and variant fields match.
- `conflict`: the same receipt ID has different content, kind or generation.

Object key order is immaterial. Array order is retained for conservative exact
retry identity: neither storage IDs nor cleaned objects are silently sorted.
Their order supplies no authenticated positional ID-to-receipt mapping. A
comparison result proves no immutable-index uniqueness or retry admission.

## Context required from owners and Auth

The envelope omits caller role, boot ID, previous status and resolved owner
records. Product owns lifecycle CAS and its journal; Disk owns durable bytes and
inventory; Auth authenticates owner assertions and stores immutable references.
Consumers must resolve and independently verify:

- Current participant/realm/generation, admitted effect and configured link owner.
- Exact allocated descriptor and previous/current status. A staged revision can
  be structurally valid without proving that a CAS advanced it once; the existing
  transition helper checks eligibility when supplied prior state, not DB execution.
- Each Auth storage ID's correspondence to an authenticated Disk receipt and
  durable inventory/readback. ID count alone proves no correspondence.
- Complete cleanup coverage and exact object revisions against the authenticated
  cancelled descriptor/status. One cleaned object is structurally valid but can
  be incomplete for a separately resolved two-part capture.
- Referenced committed/cancelled outcomes and actual manifest/link/resource
  digest provenance; selector possession proves none of these.
- Durable owner commit/journal evidence, settlement and publication/revocation
  fences. Parsing, token expiry or a changed generation does not discharge them.

Portable synthetic vectors cover all seven variants and isolated refusal
conditions. They prove structure only. Auth runtime, Product/Disk integration,
authenticated durability, settlement, CAS and deployment are not measured by
this package.
