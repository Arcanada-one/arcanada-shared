# `@arcanada/jev-decision-templates`

Versioned English JEV decision templates, catalog state-field whitelists, the global
evaluative-name deny-list (JEV §7.4), and `validate(template, state)` for the static
parts of AC-08 and AC-24.

## First-queue templates

- `retrieval.relevance`, `retrieval.redundancy`, `retrieval.coverage`
- `task.domain`, `task.intent`
- `kc.role_relevance`, `kc.skill_relevance`
- `health` (string `state`, per catalog note on `jev_client.diagnose`)

## Usage

```ts
// reuse: @arcanada/jev-decision-templates
import {
  loadFirstQueueTemplates,
  validate,
  STATE_FIELD_DENYLIST,
} from "@arcanada/jev-decision-templates";

const templates = loadFirstQueueTemplates();
const result = validate(templates["task.intent"], {
  trusted: {
    task_text: "Ship the decision template package",
    context_labels: {
      project_prefix: "ARCA",
      caller_kind: "agent",
      has_attachments: false,
    },
  },
  untrusted: {},
});
```

Negative fixtures under `fixtures/negative/` prove the validator turns red on
missing `other`, missing noul `criteria`, non-ASCII option text, non-slug option
ids, and deny-listed state field names.
