# Proposed personal Auth wire: initial operation slice

Status: PROPOSED_FOR_REVIEW. Wire `auth-personal/1-proposed`, profile `organize-me.synthetic/1`. These are structural parsers and comparisons. They do not authenticate users/services, grant authority, execute effects, or freeze the complete Auth wire. Program source: `Arcanada-one/arcanada-universal-program` at `c4ff220`, `integrations/arganize-me/personal-owner/auth-contract/reference/auth-wire-proposal.md` and `auth-failure-matrix.md`.

## Implemented boundary

`parsePersonalAuthOperationJson` rejects duplicate JSON keys, alternate integer spellings, unsafe integers, unpaired surrogates, oversized input and excessive depth before parsing the closed request. Use it at the raw body boundary: an already parsed object cannot reveal duplicate keys that a previous parser discarded. `parsePersonalAuthOperation` snapshots structural records and rejects unknown fields; it is also useful for trusted decoded inputs. Request validation composes existing capture/v1 parsers and compares every intent/part/allocation field with the unchanged shared descriptor.

Only person `intent.create` with prospective null status and `capture.stage` with an allocated awaiting-bytes status are accepted. Both use the intent resource containing exact ordered note/attachment parts. This does not authorize Disk staging; narrowing and owner bindings remain unimplemented. The schema distinguishes access-token and PASETO proof variants and rejects ID-token variants. Actual credential semantics/signature/current authority must still be validated by Auth; calling an ID-token string an access token cannot make it acceptable at runtime.

`PersonalAuthBindingContext` is a **local comparison projection**, not an endpoint or full provisioning schema. Its `provisioning` contains only the realm/runtime client/participant/generation fields needed by this slice. Recovery/maintenance clients, storage identities, key domains, workload evidence and full provisioning admission remain separate. Auth must construct this projection from current authenticated durable reads. A caller can construct a structurally consistent fake context, so `personalAuthOperationMatchesBinding` must never be used as an authorization decision.

Auth `issuer + subject`, typed OIDC UID/client SID/grant versus PASETO session, authority reference/version, actor/consumer, realm and all compared generations remain explicit. No issuer alias, email or admin fallback exists. Request proof tokens stay in backend memory and are omitted from semantic fingerprint input, along with transport request IDs. The fingerprint input contains private descriptors and must not be logged. The caller hashes its UTF-8 bytes with SHA-256. It uses sorted-key JSON serialization over this restricted safe-integer/string profile, preserving array order.

The mutation identity is the canonical tuple `(issuer, authenticated client, resolved realm, operations route, idempotency key)`. Structural retry comparison includes authority/session/version and immutable allocation. Same semantics does not authorize a historical result or resurrect an expired lease; durable current-auth recheck, uniqueness/CAS, audit and unknown-outcome recovery remain required. Product's existing `(realmId,idempotencyKey)` and fixed-tuple fingerprint remain unchanged.

## Capacity reconciliation

The proposal explicitly chooses **one active data flow, zero waiting flows and at most three simultaneous ordinary leases**. The two-upload/four-read/eight-total-lease values remain upper ceilings, not simultaneous throughput promised by this profile. Existing unresolved obligations can consume the eight-slot ceiling; they must not be discarded or bypassed to regain availability. The constants document this distinction and implement no scheduler. F10/F27/F35 runtime progress/deadlock/recovery checks remain NOT_MEASURED.

## Complete remaining operation matrix

| Operation                       | This slice                      | Remaining obligation                                                                                                                    |
| ------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `intent.create`                 | Initial structural request only | Auth current-authority admission, durable idempotency, owner binding, lease/fence and applicable consumer execution remain NOT_MEASURED |
| `intent.inspect`                | Rejected / not implemented      | Auth current-authority admission, durable idempotency, owner binding, lease/fence and applicable consumer execution remain NOT_MEASURED |
| `record.read`                   | Rejected / not implemented      | Auth current-authority admission, durable idempotency, owner binding, lease/fence and applicable consumer execution remain NOT_MEASURED |
| `intent.cancel`                 | Rejected / not implemented      | Auth current-authority admission, durable idempotency, owner binding, lease/fence and applicable consumer execution remain NOT_MEASURED |
| `capture.stage`                 | Initial structural request only | Auth current-authority admission, durable idempotency, owner binding, lease/fence and applicable consumer execution remain NOT_MEASURED |
| `object.stage`                  | Rejected / not implemented      | Auth current-authority admission, durable idempotency, owner binding, lease/fence and applicable consumer execution remain NOT_MEASURED |
| `capture.verify`                | Rejected / not implemented      | Auth current-authority admission, durable idempotency, owner binding, lease/fence and applicable consumer execution remain NOT_MEASURED |
| `object.verify`                 | Rejected / not implemented      | Auth current-authority admission, durable idempotency, owner binding, lease/fence and applicable consumer execution remain NOT_MEASURED |
| `capture.publish`               | Rejected / not implemented      | Auth current-authority admission, durable idempotency, owner binding, lease/fence and applicable consumer execution remain NOT_MEASURED |
| `object.read`                   | Rejected / not implemented      | Auth current-authority admission, durable idempotency, owner binding, lease/fence and applicable consumer execution remain NOT_MEASURED |
| `maintenance.status`            | Rejected / not implemented      | Auth current-authority admission, durable idempotency, owner binding, lease/fence and applicable consumer execution remain NOT_MEASURED |
| `maintenance.verify`            | Rejected / not implemented      | Auth current-authority admission, durable idempotency, owner binding, lease/fence and applicable consumer execution remain NOT_MEASURED |
| `maintenance.repair_link`       | Rejected / not implemented      | Auth current-authority admission, durable idempotency, owner binding, lease/fence and applicable consumer execution remain NOT_MEASURED |
| `maintenance.cleanup_cancelled` | Rejected / not implemented      | Auth current-authority admission, durable idempotency, owner binding, lease/fence and applicable consumer execution remain NOT_MEASURED |
| `maintenance.cancel_intent`     | Rejected / not implemented      | Auth current-authority admission, durable idempotency, owner binding, lease/fence and applicable consumer execution remain NOT_MEASURED |

All other resource forms (standalone part/object/publication/selectors/pages/owner records/representations/cancellation), grants, narrowing, owner/delivery binding, outcomes, flows, leases, settlement, release-spend, invalidation, barrier acknowledgement, recovery permits, lifecycle fencing and mounted problem responses remain unimplemented. `PersonalAuthPart` is only the intent's exact descriptor projection, not a standalone object-stage permit. Full proposal status and deployment claims are unchanged.

## Full acceptance matrix

Unit controls supplement these integration controls; no unit test completes an F control. All F01–F40 remain runtime NOT_MEASURED until exact real Auth/Product/Disk boundaries and the specified failure schedule run.

| Control | Structural contribution                                         | Runtime verdict |
| ------- | --------------------------------------------------------------- | --------------- |
| F01     | Realm/participant/resource comparison; no authority proof       | NOT_MEASURED    |
| F02     | Actor role/provisioning consistency; no narrowing               | NOT_MEASURED    |
| F03     | Typed session identity only; no durable link proof              | NOT_MEASURED    |
| F04     | Maintenance operation rejected                                  | NOT_MEASURED    |
| F05     | Strict raw/object parsing, mapping, counters and retry controls | NOT_MEASURED    |
| F06     | None in this structural slice                                   | NOT_MEASURED    |
| F07     | Semantic retry comparison only; no DB uniqueness                | NOT_MEASURED    |
| F08     | None in this structural slice                                   | NOT_MEASURED    |
| F09     | None in this structural slice                                   | NOT_MEASURED    |
| F10     | Explicit selected capacity constants only                       | NOT_MEASURED    |
| F11     | None in this structural slice                                   | NOT_MEASURED    |
| F12     | None in this structural slice                                   | NOT_MEASURED    |
| F13     | None in this structural slice                                   | NOT_MEASURED    |
| F14     | None in this structural slice                                   | NOT_MEASURED    |
| F15     | None in this structural slice                                   | NOT_MEASURED    |
| F16     | None in this structural slice                                   | NOT_MEASURED    |
| F17     | None in this structural slice                                   | NOT_MEASURED    |
| F18     | None in this structural slice                                   | NOT_MEASURED    |
| F19     | None in this structural slice                                   | NOT_MEASURED    |
| F20     | None in this structural slice                                   | NOT_MEASURED    |
| F21     | None in this structural slice                                   | NOT_MEASURED    |
| F22     | None in this structural slice                                   | NOT_MEASURED    |
| F23     | None in this structural slice                                   | NOT_MEASURED    |
| F24     | None in this structural slice                                   | NOT_MEASURED    |
| F25     | None in this structural slice                                   | NOT_MEASURED    |
| F26     | None in this structural slice                                   | NOT_MEASURED    |
| F27     | Explicit selected capacity constants only                       | NOT_MEASURED    |
| F28     | None in this structural slice                                   | NOT_MEASURED    |
| F29     | None in this structural slice                                   | NOT_MEASURED    |
| F30     | None in this structural slice                                   | NOT_MEASURED    |
| F31     | None in this structural slice                                   | NOT_MEASURED    |
| F32     | None in this structural slice                                   | NOT_MEASURED    |
| F33     | None in this structural slice                                   | NOT_MEASURED    |
| F34     | uint64 overflow rejection only; no lifecycle proof              | NOT_MEASURED    |
| F35     | None in this structural slice                                   | NOT_MEASURED    |
| F36     | None in this structural slice                                   | NOT_MEASURED    |
| F37     | None in this structural slice                                   | NOT_MEASURED    |
| F38     | None in this structural slice                                   | NOT_MEASURED    |
| F39     | Unimplemented operations rejected                               | NOT_MEASURED    |
| F40     | Generic input-free parser errors; no mounted filter/audit proof | NOT_MEASURED    |
