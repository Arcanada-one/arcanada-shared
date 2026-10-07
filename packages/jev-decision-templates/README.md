# @arcanada/jev-decision-templates

Inspect versioned decision-template structure and closed, minimal state profiles
locally. The package emits observations, never a model request, routing decision,
authorization grant or `policy_action`.

This source-preparation workspace package is private and excluded from the
automatic release inventory while required contracts are held. It is not an
available npm release. Package publication needs a separately qualified change
that closes those bindings and updates the existing release allowlist.

## Use

All inputs are serialized UTF-8 bytes. A proposed template cannot register itself.
Only the exact packaged ID, integer version and SHA-256 can resolve a reference.

```ts
import {
  inspectTemplateYaml,
  packagedReferences,
  validatePackagedState,
} from "@arcanada/jev-decision-templates";

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const source = packagedReferences().find(
  (entry) => entry.id === "task.intent",
)!;
const observations = validatePackagedState(
  encode({ id: source.id, version: source.version, sha256: source.sha256 }),
  encode({
    trusted: { task_text: "Review a specification." },
    untrusted: {},
  }),
  encode({}),
);
// Minimal structure can be verified. Authority and exact token fit remain
// not_measured; this result cannot admit a request.
```

`inspectTemplateYaml(bytes)` returns the same observation record with only
`template_structure` inspected. It neither stores nor registers the proposed
YAML. `packagedReferences()` returns fresh frozen records, including the bound
state-schema digest and unconditional held-reference flag. It exposes no mutable
registry. Runtime validation performs no filesystem or network I/O.

## Template reference

Each YAML file contains `id`, `version`, `primitive`, `instructions`, `criteria`,
`params_schema`, `state_schema_ref` and `allow_non_ascii`. Unknown fields refuse.
The build compiles the exact YAML bytes and generated Zod state-schema digests
into a private manifest. Runtime validation verifies the schema binding again.
Rebuild after changing templates or schemas; tests reject stale manifest bytes.

| Primitive | Structural requirements                                                        |
| --------- | ------------------------------------------------------------------------------ |
| `choice`  | 2..255 descriptions keyed by unique lowercase ASCII slugs; `other` is required |
| `noul`    | Exactly the string keys `true` and `false`, with nonempty descriptions         |
| `score`   | Ordered array of 2..10 nonempty descriptions                                   |

Option identifiers match `^[a-z][a-z0-9_]{0,63}$`. Instructions and descriptions
are ASCII unless an exact, non-ASCII identifier literal is declared with a
nonempty ASCII reason. Exceptions cannot contain whitespace or cover an entire
instruction. Declaring a literal does not establish its semantic authority.
English meaning and instruction/criterion agreement require independent review;
ASCII alone cannot prove either.

The packaged inventory has eight proposed first-wave templates: retrieval
relevance, redundancy and coverage; task domain and intent; KC role and skill
relevance; health. There are two `choice` and six `noul` files. Score inspection
does not add a ninth packaged decision.

## State support and refusals

Objects must have closed `trusted` and `untrusted` branches. Unknown fields are
rejected rather than dropped. Raw state names are scanned recursively against
the case-insensitive substring deny-list before any positive structural result.
Diagnostics contain stable codes, never input field names, values or parser
excerpts. Quoted text is data; this package does not claim to remove prompt
injection or replace a secrets scanner.

| Catalog group           | Current structural scope                                        | Source count bounds / remaining boundary                                         |
| ----------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Task/dialogue           | Minimal task text; optional history                             | History at most 5; required context-container contract held                      |
| KC                      | Task text, candidate ID/English description; role ID for skills | Role shortlist at most 20; skill shortlist at most 30                            |
| Retrieval/prompt        | Question, quoted candidates, selected set                       | Candidates at most 40; required context-container contract held                  |
| Change/validation/retry | Unimplemented; no packaged reference                            | Diff hunks at most 20 is a retained source requirement, not a measured validator |
| Model/orchestration     | Unimplemented; no packaged reference                            | Required label/risk containers and unresolved enums held                         |
| Action                  | Unimplemented; no packaged reference                            | Required target-label container and unresolved enums held                        |
| Canon/research          | Unimplemented; no packaged reference                            | Required context container and unresolved enums held                             |

Minimal task and retrieval fixtures omit context containers and receive only
`MINIMAL_STATE_STRUCTURE_ONLY`. The source requires `context_labels`, while the
same global deny-list forbids names containing `label`. A well-shaped required
container returns `not_measured` with a contract-conflict code; malformed or
unknown contents fail. No lexical exception, renaming or data dropping is
introduced. These fixtures do not prove the complete catalog state contract.

Candidate parameter references and positional `k` identifiers use bounded ASCII
slugs. Other source identifiers are bounded ASCII identifiers; hashes are
64-character lowercase hex. These are local structural profiles, not proof of
compatibility with an existing consumer's identifier vocabulary. Duplicate
candidate, history or selected identifiers fail. The selected set is required
for redundancy and coverage. Its 40-element cap is an implementation resource
bound, not a separately measured catalog limit.

The task-domain file contains a proposed research-area slice rather than the
complete project-prefix vocabulary. Its exact packaged binding is always held
until a disclosure-safe registry mapping is qualified. It must not route tasks.
The health file is structurally inspectable, but its state binding is held: the
source describes both a string diagnostic and an object smoke input without a
qualified binding between them. Neither becomes a service exception here.

Parameters are a closed set of ASCII candidate/role references to identifiers
already present in the validated state. Free instructions, caller criteria,
unknown parameters and missing targets fail. An empty candidate set can pass
minimal structure, but cannot satisfy a required candidate reference.

## Parsing and observation limits

The YAML profile accepts one UTF-8 YAML 1.2 document, at most 65,532 bytes and AST
depth 16. It rejects aliases, anchors, merge keys, tags, directives, duplicate or
non-string keys, non-finite numbers, malformed Unicode and parser errors/warnings
before conversion. Numeric keys retain their scalar type and are rejected; the
parser's string-coercion option is intentionally disabled.

Serialized reference, state and parameters reuse `parseBoundedJson` from
`@arcanada/access-contracts`: 1..65,532 bytes, depth at most 16, strict UTF-8,
decoded duplicate-key refusal, no BOM, lone surrogate or non-finite number.
These are implementation resource bounds. They do not prove token limits.

Every report has eight named observations: `reference`, `template_structure`,
`state_structure`, `parameters`, `token_limits`, `privacy_authority`,
`knowledge_authority` and `runtime_authority`. Verdicts are `verified`, `failed`
or `not_measured`. There is no generic admission boolean. Token limits remain
unmeasured without a qualified exact tokenizer; privacy, knowledge and runtime
authority are always unmeasured and cannot be promoted by caller assertions.
Retained source requirements include 16,000 total tokens, 12,000 untrusted,
400 per fragment and 4,000 task text; byte checks are not substitutes.

Source inspection, complete native task acceptance, consumer adoption,
calibration, package release and runtime admission are separate. Held contracts
prevent a complete acceptance claim even when the structural suite passes.

## Verify source

```sh
pnpm --filter @arcanada/jev-decision-templates build
pnpm --filter @arcanada/jev-decision-templates test
pnpm --filter @arcanada/jev-decision-templates exec tsc --noEmit
```

The suite covers all eight template files, cardinality boundaries, malformed
YAML/JSON, held and unknown references, recursive denied names, closed schemas,
parameter targets, exact byte/schema bindings and data-free diagnostics.
