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

`src/http/static-assets.js` is an explicit allowlist. Canonical assets use `/workspace/`, `/session/`, `/shared/`, `/assets/` or `/legacy/` paths. Existing page URLs such as `/clinic.html`, `/workspace-session.html`, `/assessment.html`, `/report.html` and `/draft-live.html` still resolve, so saved links keep working. `/assessment-library.html` opens the workspace, where the assessment library is available in the navigation. Private files and arbitrary filesystem paths are not served.

## Table ownership

| Table in `assessments` | Data and relationships |
| --- | --- |
| `patients` | Patient ID and JSONB demographics/history summary |
| `assessment_prescriptions` | Patient foreign key, assessment ID and creation time |
| `assessment_sessions` | Unique prescription foreign key; JSONB answers, status, version, frozen definition/language, correction history and result |
| `assessment_recommendations` | Patient foreign key, history/catalogue/model context hash and cached history suggestions |
| `assessment_translations` | Definition hash + language key and validated translation |
| `standard_assessment_sessions` | Original PHQ-9/GAD-7/PCL-5 sessions |
| `standard_assessment_prescriptions` | Original standard-assessment assignments |
| `draft_assessment_sessions` | Original draft-review sessions |
| `data_imports` | Completed SQLite import fingerprints and counts |

The catalogue stays in versioned JSON. Reports are generated from saved sessions rather than duplicated in a reports table. Analytics reads saved records; it does not create synthetic historical visits or unsupported score distributions. JSONB preserves mixed answer types and immutable historical wording.

PostgreSQL answer updates lock the session row and compare revisions. Concurrent stale writes fail rather than overwriting another answer. Completed sessions are protected. Creation locks the prescription so duplicate starts return the existing session where appropriate. Copy/import tools verify conflicts and use transactions.

## Retention and provider boundaries

- Patient records, prescriptions, canonical responses, correction history and completed sessions are persistent.
- History-based recommendations and validated translations are persistent caches.
- Doctor conversation messages and resulting doctor suggestions remain temporary; only a subsequently prescribed assessment is saved.
- Session records may contain brief assessment-response summaries. Full chat transcripts and raw media are not saved.
- Live voice reaches Gemini while connected. Optional camera sharing requires an explicit control; camera preview alone stays local. Frames never determine a score or saved response.
- Recommendation redaction removes known names, external patient IDs and emails; it is not comprehensive de-identification.
- Source availability checks and source-defined rules control whether a questionnaire can run. The active catalogue's scoring is disabled. Legacy scoring is a separate compatibility path.
