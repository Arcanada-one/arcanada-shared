# `@arcanada/access-contracts`

The shared access and capability contract for Arcanada product surfaces: the
closed capability vocabulary, the request and response validators, and the
fail-closed decision resolver.

## Why it lives here

Two independent systems have to agree on it — the authorization service that
evaluates capabilities, and the backend-for-frontend that enforces the answer.
A contract duplicated in both is a contract that will eventually disagree, and
the disagreement surfaces as an authorization bug rather than a type error.

It sits in the public shared repository rather than alongside the design system
because it is a clean-room utility: no dependencies, and no content derived from
any licensed template. That is the class this repository is for.

## The part that matters

`resolveDecisions` iterates the **requested** checks, never the returned
decisions. A responder that omits a check, returns a decision nobody asked for,
or answers the same check twice with conflicting effects cannot produce an
`allow` for something unanswered.

An implementation that walked the response instead would pass every test that
only feeds it well-formed responses, and fail in production exactly when the
authorization service is degraded — which is when it matters.

`unavailable` is deliberately distinct from `deny`. Both refuse, and a gate must
treat them identically, but only one of them means the system actually answered.
Collapsing them loses the difference between "you may not" and "we do not know",
which is what an operator needs when a surface goes dark.

## Deliberately dependency-free

A shared contract package is imported by everything, so every dependency it
takes is taken by every consumer. A schema library in this position is a
supply-chain decision wearing the clothes of a convenience; the validators here
are hand-written and total.

## Personal capture wire profile

The additive `personal-capture/v1` profile is exported from the package root.
It does not change `Capability` or `ResourceKind`. It is a contract candidate
for personal text capture; importing it enables no endpoint or runtime feature.

| Export                              | Meaning                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `parsePersonalCaptureDescriptor`    | Immutable intent, conversation/message and object allocations, request fingerprint and declared byte identity |
| `parsePersonalObjectReceipt`        | Provider assertion of an exact realm/capture/part/object revision and byte identity                           |
| `personalObjectReceiptMatches`      | Structural equality of every receipt binding against its descriptor                                           |
| `parsePersonalCaptureStatus`        | Strict discriminated status with complete matching receipts when staged or committed                          |
| `parsePersonalCaptureCancellation`  | Terminal unpublished-capture cancellation record to authenticate before maintenance cleanup                   |
| `personalCaptureFingerprintInput`   | Canonical request string for trusted SHA-256 fingerprint computation                                          |
| `comparePersonalCaptureRetry`       | Exact allocated intent comparison within a realm/idempotency-key scope                                        |
| `evaluatePersonalCaptureTransition` | Pure transition and expected-revision check; `eligible` is only a CAS precondition                            |

Identifiers use canonical lowercase UUID strings. Object revisions are opaque
UUIDs, independent of numeric intent/conversation revisions. Digests and request
fingerprints are lowercase, 64-character SHA-256 hex strings. The wire schema
requires one note followed by zero or one attachment, with distinct part and
object IDs, and only `text/plain;charset=utf-8`. The limits are 64 KiB for the
note and 1 MiB for the attachment, including zero-length bodies. These are
profile limits, not measured storage capacity. Numeric counters are nonnegative
safe integers; intent revisions start at one. Incrementable descriptor counters
cannot equal the maximum safe integer.

Parsers accept decoded JSON-like records, reject missing/unknown fields,
accessors, sparse arrays, duplicate identities, unsupported versions and
out-of-bound values, and return detached copies. They capture each own data
property once into an ordinary snapshot, including nested records and array
elements; validation and returned values use that same capture, with no direct
property reads from the input. This establishes structural consistency, not
authentication or an atomic snapshot of external state. Errors never echo input values.
Consumers must also bound transport body size before JSON decoding. The profile
carries no private body, display filename, path, token, signed URL, or claim that
the data is already knowledge. It is not a browser status projection: full
descriptors and receipts contain private identifiers and hashes.

### Request identity

The trusted request boundary computes SHA-256 over the UTF-8 bytes returned by
`personalCaptureFingerprintInput` and verifies actual byte digests/sizes at
ingest. The input is JSON serialization of this ordered tuple, without whitespace:

```text
[schemaVersion, realmId, operation, conversationId, expectedConversationRevision,
 [[role, sha256, sizeBytes, mediaType], ...]]
```

This fixed tuple avoids object-key ordering differences. It excludes the claimed
fingerprint, idempotency key and server-allocated capture/message/part/object IDs.
The realm and operation are authenticated/resolved before constructing it. The
only operation in this profile is `append_message`; revision zero denotes a new
allocated conversation. Conversation allocation and the transaction that makes
its first message visible remain the product owner's responsibility.

The durable idempotency uniqueness key is `(realmId, idempotencyKey)`. Look up
and reauthorize that scope before retrying. Existing allocations must be reused.
`comparePersonalCaptureRetry` compares every immutable descriptor field as well
as the fingerprint, so changed bytes or identities with an unchanged claimed
fingerprint still conflict. `different_scope` means no retry comparison applies;
it grants no permission to create or inspect another scope. Concurrent uniqueness
enforcement remains a database responsibility. Parsing only checks fingerprint
shape; it neither computes the hash nor authenticates the supplied claim.

### State and maintenance invariants

| State            | Required additional fields                                 | Meaning                                                          |
| ---------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| `awaiting_bytes` | None                                                       | Durable intent exists; missing bytes require resubmission        |
| `staged`         | Exactly one matching receipt per declared part             | Bytes are claimed staged; publication has not occurred           |
| `committed`      | Complete receipts, manifest ID, next conversation revision | Product asserts its manifest/message transaction committed       |
| `cancelled`      | Matching cancellation record                               | Terminal intent cancellation; never a committed-content deletion |

Receipts may arrive in either order, but must cover each part exactly once. Each
binds realm, capture, part, object/revision, digest, size, media type, request
fingerprint and the descriptor's cancellation generation.

Allowed transitions are `awaiting_bytes -> staged -> committed` and either
pending state to `cancelled`. The descriptor is immutable across transitions;
each transition increments the durable intent revision exactly once. Cancellation
records use purpose `cancel_unpublished_capture`, bind the same realm, capture
and request fingerprint, and carry the terminal intent revision and descriptor
generation plus one. Both terminal states reject all further transitions.

The transition helper parses both snapshots and requires an exact expected
revision. The product must atomically compare that same revision and persist the
winning transition in its database, including manifest/message/idempotency/outbox
effects for publication. Two candidates can both be `eligible` against one old
snapshot; only the database CAS may choose the winner. Resolve lost responses by
authenticated current-owner readback, not by reapplying a terminal transition.

No parser or helper authenticates a receipt, proves bytes/inventory durable,
verifies a readback body, authorizes maintenance, holds a release lease, or fences
revocation. A caller-supplied `verified: true` field is rejected. Before cleanup,
maintenance must authenticate current authority and reconcile the terminal
cancellation record against the durable owner outcome. Unknown outcomes retain
or quarantine staging bytes; delayed link notifications cannot justify deleting
committed objects. There is no committed-content DELETE, purge, restore, or
maintenance publication operation in this profile.

The separate Auth grant/audience, person/session binding, bounded release-unit,
lease/fence and restart-recovery protocols remain unfinished. Product and Disk
integration, cross-language conformance, durable transactions and real restart,
race, isolation and revocation evidence are required before runtime admission.
