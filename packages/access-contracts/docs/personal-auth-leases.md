# Proposed personal lease issuance structure

Status: PROPOSED_FOR_REVIEW. Wire `auth-personal/1-proposed`, profile
`organize-me.synthetic/1`. These additive parsers validate the inner issuance
record described by the personal operation proposal. They authenticate nothing
and enable no route, lease admission, data access, effect or delivery.

`parsePersonalAuthLeaseAdmission` accepts only the closed issued record with
`state: admitted`, exact UUID references, a typed Product/Disk participant and
canonical uint64 decimal-string epochs/sequences/generations. Its discriminated
TypeScript result separates access, effect and release records. Access has no
effect or release unit; Disk access requires a binding. Effect has a listed
owner-compatible effect and no release unit; only prospective Product intent
creation permits a null resource binding. Release requires an exact binding,
no effect, and its unit destination is Product for Disk or client for Product.
Link repair's actual configured owner still requires Auth validation.

`parsePersonalAuthReleaseUnit` validates exact delivery, object revision or null,
representation/connection binding references, nonnegative safe numeric frame
index/offset/length and closed destination. Negative zero is rejected. A unit
is at most 65536 bytes, within the profile's 1048576-byte representation ceiling.
The owning service must separately resolve the actual representation and check
its exact range, body/metadata bound, recipient connection/generation and frame
sequence/count. A standalone unit has no authority or owner identity.

The issued record's RFC3339 UTC timestamps include milliseconds and represent
real calendar dates. Its execute-before window does not exceed 30 seconds for
access/effect or one second for release. Zero windows are retained as records
with no remaining execution budget. The parser observes no current clock: an
old admitted record remains an unresolved obligation, not a new ticket or a
settlement. A consumer must derive a conservative local monotonic remaining
budget from request start, deny uncertainty/expiry, and never replay an old
generation on restart. Token or lease expiry cannot delete an obligation.

`comparePersonalAuthLeaseAdmission` compares every field and nested binding,
returning `same_admission`, `conflict` or `invalid`; property order is irrelevant.
The expected snapshot must come from a current authenticated Auth lookup, not
a caller-supplied context. Matching synthetic records is not current authority.
No helper queries Auth, resolves issuer/person/session/grant, checks current
realm/authority/policy/key bindings, reserves a flow/lease budget, authenticates
owner outcomes, persists spend-before-write or performs settlement.

This parser does not handle the outer version/profile/request/result envelope,
lease requests, GET state or settlement responses. Bind those separately at the
transport boundary; `parsePersonalAuthJson` supplies strict raw JSON decoding,
not envelope authentication. The request fingerprint binding remains an Auth
durable-row obligation; no unspecified fingerprint field was added to this
inner record.

Portable fixtures in `test/fixtures/personal-auth-lease-v1.json` preserve positive
issuance bounds and independent negative conditions. TypeScript execution alone
claims no Rust or deployed-consumer conformance. Quotas, single-flow/three-lease
scheduling, A/B/C/F/R ordering, current release authorization, at-most-once spend,
terminal publication/cancellation CAS and maintenance-only recovery remain
NOT_MEASURED. No parser accepts a recovery permit as an ordinary lease, and no
ordinary lease grants recovery-mode takeover. There is no deployment or runtime
profile admission.
