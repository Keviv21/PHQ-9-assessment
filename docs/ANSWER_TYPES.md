# Workspace answer contract

The patient workspace uses schema version 3 for newly imported definitions. Existing sessions keep their frozen definitions and answers; versions 1 and 2 continue to load. No database schema migration is needed: the existing session JSON stores the typed values.

| Source type | Input | Stored answer |
| --- | --- | --- |
| `choice`, `single_choice` | Radio buttons | One option value |
| `multiple_choice` | Checkboxes, then Save response | Array of distinct option values |
| `text` | Text area, then Save response | Original written feedback string |
| `integer` | Whole-number input | Integer |
| `number` | Decimal input | Finite number |

Every option retains its source ID. Existing unique printed integer values remain API values; options without unique integer values use their IDs. Source enum validation and conditional rules map these API values back to source option IDs. Numeric validation uses the source minimum/maximum; no clinical bounds are invented. Explicit exclusive checkbox options cannot be combined with other selections.

`public/shared/answers.js` is shared by the server and browser. The importer keeps `response_type`, `selection_mode`, `input_spec`, `display_if`, option IDs, printed values, and context prompts. It reports question-specific availability failures for unknown types, unsupported constraints, missing choices, invalid dependencies, or context that is not collected. Supported rules are `equals`, `gt`, `contains_any`, and `any`/`all` groups referencing earlier questions. Unknown conditions are not treated as false.

`null` means unanswered (or a hidden conditional field), never zero. An explicit source-permitted skip is `{ "skipped": true, "reason": "not_applicable" }`. CSS Q7's printed “skip if not applicable” wording enables this action. Conditional fields are evaluated from the saved answers. Changing a parent invalidates newly hidden answers and records the change in the audit trail; making those questions applicable again requires new answers.

CSS Q1–Q8 retain their five source choices. Q9 and Q10 require written feedback and do not require options. Written responses are marked as feedback in saved answer details, reports and analytics, excluded from option-distribution charts and numeric scoring. All imported draft scoring remains disabled. The existing explicit sum-score contract can exclude text feedback, but this change does not implement or enable the source's disabled draft scoring rules.

Chat/voice sends the current response type, limits, choices and skip permission to Gemini. The answer tool validates the same typed payload as the on-screen API. Text must preserve the participant's own words. Gemini tests use a mock provider; an actual Gemini Live session still depends on model access and quota. Browser speech matching is available for single-choice labels only; other types use their on-screen controls or Gemini conversation.

Verification covers CSS completion, skip and feedback persistence, report escaping, numeric bounds, checkbox exclusivity, conditional edits, source-valid completion of every runnable form, translation integrity, and typed Gemini tool responses. Browser checks use synthetic patient data to exercise CSS, mixed types, review/reload, conditional changes, reporting and a mobile layout.
