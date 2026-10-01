# Proposed personal owner outcome requests

This additive source slice implements the closed `POST owner-outcomes` mutation
request in the proposed auth-wire reference sections 4–6, source SHA-256
`21083f99d790eb8e50937bad26f4284edd346a99e336eb5e835e1fc95faa16b8`.
It reuses the shared raw decoder, participant, outcome and issuance-lease parsers.

`parsePersonalAuthOwnerOutcomeRequest` snapshots exactly wire_version, profile_id,
request_id, idempotency_key, participant, lease_id and outcome. It checks the specified Product/Disk writer role. Generation and ID correspondence
are checked only by the ordinary matcher: a replacement participant reporting an
old outcome is syntactically valid but needs separate recovery authorization.
Either role may structurally report link repair; provisioning must authenticate
which participant owns that relation. `parsePersonalAuthOwnerOutcomeRequestJson`
first rejects duplicate keys and noncanonical integer lexemes with the existing
strict raw decoder. Decoded parsing preserves inherited OwnerCounter semantics.

`personalAuthOwnerOutcomeRequestMatchesSameGenerationLease` compares only the
structural overlap: exact lease ID, effect, realm and full participant reference.
Access/release leases do not match mutating outcomes. Old admitted lease records
remain obligations; this function observes no clock and authorizes no execution.
Replacement-generation recovery intentionally does not match: its separate
recovery admission and authenticated old-owner mapping must be checked by Auth.

**A true match does not bind the operation, intent or resource digest.** These
fields are absent from an issuance lease. Tests explicitly preserve valid altered
operation/intent/digest examples that still match. Auth must resolve the stored
grant/operation, owner bindings, durable journal, storage IDs and prior CAS before
registration or settlement. Possession of a parsed request or lease grants nothing.

No caller authentication, current authority, index/idempotency storage, durability,
reference resolution, cleanup completeness or settlement is implemented. No route
is mounted. Product is the lifecycle writer, Disk the durable byte/inventory owner,
and Auth the admission/outcome-index writer. Consumer adoption, raw mounted Auth
transport, recovery, main integration and full PERSIST-01 remain NOT_MEASURED.
Rollback reverts only these additive exports before adoption; no data migration.
