# Pod Assessment Platform

OpenMind clinical assessment workspace on the `chandrika` branch. It combines patient history, clinician review and Gemini-assisted recommendations with multilingual chat, voice and on-screen questionnaires, saved responses, reports and patient analytics.

## Run

Use Node.js 24 or later, install dependencies with `npm ci`, then copy `.env.example` to `.env` **only for a new checkout**. Keep an existing configured `.env`.

```bash
npm run dev
```

Open <http://localhost:4174>. Configure `DATABASE_URL` for the separate Neon database `pod_assessment_platform`, and `DATABASE_SCHEMA=assessments`. Configure `GEMINI_API_KEY` for recommendations, translations and live conversation. The on-screen English questionnaire can run without Gemini. Database failures stop startup; there is no silent SQLite fallback.

## Project layout

```text
public/
  workspace/       Patient selection, recommendations, library and analytics UI
  session/         Assessment session, answer controls and audio/media clients
  shared/          Shared styles, response rules, language labels and helpers
  assets/          OpenMind brand asset
  legacy/          Original standard-assessment and draft-review pages
src/
  server.js        HTTP/WebSocket entry point
  http/            Explicit public asset routing and compatibility URLs
  workspace/       Current assessment API, Gemini services and domain logic
  clinical/        Structured clinician-guidance rules and metadata retrieval
  storage/
    index.js       Selects PostgreSQL, or explicit offline SQLite
    postgres/      Neon connection, current workspace and compatibility stores
    sqlite/        Offline stores used by tests and migration tooling
  legacy/          Original standard-assessment/report compatibility logic
scripts/
  assessments/     Current catalogue import
  database/        PostgreSQL copy and SQLite migration tools
  docs/            Rebuilds the editable workflow diagram and SVG preview
  legacy/          Original import/audit and live-review utilities
data/
  assessments/     Active source export and normalized catalogue
  clinical/        Metadata used by structured doctor guidance
  fixtures/        Synthetic sample patients
  legacy/          Original definitions required by compatibility routes
test/             Unit and integration tests
docs/             Architecture, answer types, workflow and editable diagram
local-data/       Private patient import and recovery backups (Git-ignored)
```

The legacy folders preserve the original PHQ-9/GAD-7/PCL-5 and draft-review routes and saved-report compatibility. They are separate from the active 186-assessment workspace. Shared validation modules live in `public/shared/` because they run in both browser and server. No React framework or frontend build step is required.

## Assessment source

- `data/assessments/novopsych-source.json`: exact November 16 supplied source export.
- `data/assessments/catalogue.json`: normalized runtime definitions, metadata and source hashes.
- Current import: **186 assessments, 4,927 questions, 181 runnable questionnaires**. SDQ lacks captured questions; four WHODAS variants require work/school context the app does not collect.
- The source currently disables scoring. New sessions show responses and completion analytics rather than invented scores. Historical scored definitions retain their original scoring behavior.

Regenerate the active catalogue explicitly:

```bash
npm run import:assessments -- data/assessments/novopsych-source.json data/assessments/catalogue.json
```

The importer preserves question IDs, answer types, input limits, option IDs, conditional rules and source-review flags. Each session freezes the definition and language used when it starts. See [answer types](docs/ANSWER_TYPES.md).

## Patient records and database

Private NeuroTwin data is read from `local-data/neurotwin-patient.json`, or the path in `NEUROTWIN_PATIENT_FILE`. It is not committed. The imported patient appears first, followed by four sample patients. Added patients and completed assessments are shared between team instances using the same database and schema.

The app uses **`pod_assessment_platform.assessments`**. See [architecture and table ownership](docs/ARCHITECTURE.md). `sagar prototype` is a separate database; the app does not need it. Keep credentials in the ignored `.env` and backups under ignored `local-data/backups/`.

Doctor conversations and their resulting suggestions are temporary. History-based suggestions and validated translations are cached only in server memory and regenerated after a restart. Sessions retain typed answers, brief response summaries, corrections, definition snapshots and final results. Full chat transcripts, audio and video are not stored. Known identifiers are removed before recommendation requests, but the remaining clinical information is still sensitive.

Normal PostgreSQL startup uses `patients`, `patient_records`, `assessment_prescriptions` and `assessment_sessions`. Older assessment pages/APIs are retired in PostgreSQL mode (HTTP 410); SQLite keeps compatibility for offline tests. Legacy copy/migration tools explicitly create compatibility tables and should not be run against the cleaned application database.

Before importing an old SQLite installation, stop its app server and run `npm run db:migrate`. The migration tool creates a backup, preserves IDs and verifies conflicts before committing. For isolated offline tests, unset `DATABASE_URL` and set an explicit `DB_PATH`; normal app use remains PostgreSQL.

## Adding patient information

Use **Add patient** for manual demographics and initial history, or **Import patient JSON** for a Digital Twin report. The import preview lists extracted demographics, report sections and a patient-ID match. Choose a new patient or an existing patient and confirm. Existing external IDs cannot create a duplicate patient. An unchanged report imported again is a no-op.

On a patient, **Add clinical history** creates a dated entry. **Record history** shows earlier summaries, the demographics recorded at each version, and complete saved JSON with a download action. Imports preserve the entire input object, including root metadata and every clinical section. `patients.data.historySummary` is a current excerpt limited to 24,000 characters; full reports and previous notes remain in `patient_records`. Importing a new report updates current demographics and summary, with earlier values preserved. Existing assessments and their answers are unchanged.

Existing patients receive one baseline history entry on startup; this captures the previously stored profile, not missing original data. History writes are transactional and require the version shown in the preview. The app does not infer an authenticated author: records explicitly say they were recorded by the local app. Login and access controls remain separate work.

Run `npm run db:backup` before bulk changes. It writes and verifies a consistent JSON snapshot of all four core tables in ignored `local-data/backups/` with owner-only permissions. An optional destination can be passed after `--`. This is an on-demand backup, not a scheduled or off-site backup. Keep it private. To recover, restore the schema from the matching application version into a separate database, load patients before patient records/prescriptions and prescriptions before sessions, then verify row counts and full JSON before switching the application connection.

## Workflow diagrams

- [Editable Excalidraw workflow](docs/diagrams/assessment-workflow.excalidraw)
- [Scalable SVG preview](docs/diagrams/assessment-workflow.svg)
- [Workflow explanation](docs/WORKFLOW.md)

Open the `.excalidraw` file in Excalidraw to edit its individual shapes, labels and connectors. To regenerate both diagram files from the maintained source:

```bash
python3 scripts/docs/generate-workflow.py
```

## Verification

```bash
npm test
```

PostgreSQL-specific tests also run when `TEST_DATABASE_URL` points to a disposable test database. They create and remove their own test schemas. Tests cover typed responses, conditional questions, translations, Gemini tools, report escaping, revisions, migration and rollback. Model responses are mocked; tests do not measure live Gemini quality, latency or quota.

The browser flow supports English, Spanish, Hindi, Marathi, Tamil, Telugu, Kannada, Malayalam and Bengali. Questions, full option labels and session controls use the selected language. Local language checks reject common drift but are not clinical translation validation. Clinicians review recommendations and questionnaire suitability; this prototype does not establish diagnoses and does not yet provide production authentication or patient authorization.

See [cleanup notes](docs/CLEANUP.md) for moved files, removed obsolete assets, preserved routes and private recovery data.

## Local JSON reports

Patient analytics now includes a selected-visit report preview and a downloadable PDF, generated from saved JSON definitions and patient answers. See [report setup, use and limitations](docs/JSON_REPORTING.md) and [the 44 explicit source-coverage gaps](docs/REPORTING_COVERAGE.md). All 186 definitions remain clinically unvalidated; normal reports keep draft scoring disabled.
