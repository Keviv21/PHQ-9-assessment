# Application architecture

The application uses plain HTML/CSS/JavaScript in the browser, Node.js HTTP and WebSocket handlers, the Google GenAI SDK, and PostgreSQL through `pg`. Neon hosts the dedicated `pod_assessment_platform` database; the application schema is `assessments`.

## Runtime boundaries

| Area | Responsibility |
| --- | --- |
| `public/workspace/` | Clinician navigation, patient records, recommendations, doctor conversation, assessment selection, reports and analytics |
| `public/session/` | Language/mode selection, rendered answers, review, live chat and optional audio/video |
| `public/shared/` | Reusable browser/server response and language rules, UI helpers and common styles |
| `src/workspace/api.js` | Current `/api/workspace/` HTTP routes and `/workspace-ws` |
| `src/workspace/recommendations.js` | Patient-history or temporary doctor-conversation suggestions against the full catalogue |
| `src/workspace/translations.js` | Translation cache, complete question/option translation and integrity validation |
| `src/workspace/live-bridge.js` | Gemini Live turns, typed-answer tools and language/output checks |
| `src/workspace/state.js` | Canonical answer validation, revisions, conditional changes and completion |
| `src/clinical/` | Structured doctor review without a Gemini request |
| `src/storage/` | PostgreSQL persistence; explicit SQLite adapters for tests and old-data migration |
| `src/legacy/`, `public/legacy/` | Compatibility for original standard assessments and draft reviews |

`src/http/static-assets.js` is an explicit allowlist. Canonical assets use `/workspace/`, `/session/`, `/shared/`, `/assets/` or `/legacy/` paths. In PostgreSQL mode, older assessment pages and APIs return HTTP 410 and legacy WebSocket endpoints are disabled. Offline SQLite retains compatibility. Existing page URLs such as `/clinic.html`, `/workspace-session.html`, `/assessment.html`, `/report.html` and `/draft-live.html` are mapped, with legacy pages available only in SQLite mode. `/assessment-library.html` opens the workspace, where the assessment library is available in the navigation. Private files and arbitrary filesystem paths are not served.

## Table ownership

| Table in `assessments` | Data and relationships |
| --- | --- |
| `patients` | Current demographics, displayed history excerpt, external identity and current record version |
| `patient_records` | Patient foreign key and unique version; dated baseline/manual/import entry, profile snapshot, summary and complete original JSON. Import hashes prevent duplicate reports per patient. |
| `assessment_prescriptions` | Patient foreign key, assessment ID and creation time |
| `assessment_sessions` | Unique prescription foreign key; JSONB answers, status, version, frozen definition/language, correction history and result |

Legacy copy/migration utilities explicitly opt into compatibility tables; normal application startup uses the four core tables above and never creates those six retired tables.

The catalogue stays in versioned JSON. Reports are generated from saved sessions rather than duplicated in a reports table. Analytics reads saved records; it does not create synthetic historical visits or unsupported score distributions. JSONB preserves mixed answer types and immutable historical wording.

PostgreSQL answer updates lock the session row and compare revisions. Concurrent stale writes fail rather than overwriting another answer. Completed sessions are protected. Creation locks the prescription so duplicate starts return the existing session where appropriate. Copy/import tools verify conflicts and use transactions.

## Patient history writes

`src/workspace/patient-records.js` validates imports and constructs history entries for both storage adapters. Preview requests do not write. Import identity is scoped to the NeuroTwin source and external patient ID; matching by name is never automatic. Existing-patient writes lock the patient row and compare `recordVersion`; importing a new patient uses a source/ID advisory lock to prevent concurrent duplicates. Each change appends a record and updates the current profile in one transaction. There are no history update/delete endpoints. Exact duplicate report content is idempotent even when JSON key order changes.

Original source JSON is preserved as `patient_records.data.document`. The latest report also remains in `patients.data.sourceProfile` for existing UI compatibility. Initial profiles are backfilled once as baseline records. Timestamps reflect capture time; baseline capture does not invent original authorship. `recordedBy` is explicitly an unauthenticated local-app marker until a separate login system exists.

## Retention and provider boundaries

- Patient records, prescriptions, canonical responses, correction history and completed sessions are persistent.
- History-based recommendations and validated translations use bounded, per-process memory caches. They reset on restart; saved sessions still preserve their frozen translated definitions.
- Doctor conversation messages and resulting doctor suggestions remain temporary; only a subsequently prescribed assessment is saved.
- Session records may contain brief assessment-response summaries. Full chat transcripts and raw media are not saved.
- Live voice reaches Gemini while connected. Optional camera sharing requires an explicit control; camera preview alone stays local. Frames never determine a score or saved response.
- Recommendation redaction removes known names, external patient IDs and emails; it is not comprehensive de-identification.
- Source availability checks and source-defined rules control whether a questionnaire can run. The active catalogue's scoring is disabled. Legacy scoring is a separate compatibility path.
