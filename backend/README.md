# Conversational assessment prototype

A standalone OpenMind/Casebook-style demonstration of clinician-selected assessments, optional Gemini voice conversations, answer review, reporting, and patient-level analytics. It is **not connected to the Casebook backend**. The five selectable patients and their summaries are synthetic records imported into the content database.

## Current scope

1. A clinician selects a sample patient. Current summary observations produce an explained, rule-based shortlist. The doctor can also send de-identified notes to Gemini for catalogue-checked suggestions, then makes the final selection.
2. The Assessment Library below Doctor Conversation shows 186 entries loaded from the database. Clinicians can search, filter by category or patient suggestion, open a dedicated details page, and select one for final review. Questions, response choices, scoring rules, descriptions, references, question previews, category mappings, and recommendation metadata come from published database content. Entries without a mapped source category appear under Other. The searchable Prescribe Test picker reflects the selection. The 185 entries with questionnaires can be assigned; SDQ has no recovered form and is unavailable.
3. The patient completes the assessment on screen or in a Gemini Live voice conversation. A clear spoken answer is validated and saved immediately; the assistant asks a follow-up only when it cannot map the response. Questions and applicable options stay visible. A final review permits corrections before the report is created.
4. PHQ-9, GAD-7, PCL-5, and DASS-21 have dedicated scoring flows. Other imported forms show source-draft raw calculations when their rules apply; LEC-5 and asQ save answers without a numeric composite. The prototype does not claim that imported calculations reproduce NovoPsych's clinical reports.
5. Assessment definitions, sample patient profiles, assignments, answers, results, and analytics persist in SQLite or PostgreSQL. `backend/data/all-assessments.json` and `backend/data/demo-patients.json` are import files only; the running backend reads neither file. General assessment sessions store an exact form snapshot, so later catalogue updates do not change an in-progress form.
6. Multi-language support: 43 languages are available in the assessment screens, defaulting to English (`en`). Core clinical instruments (PHQ-9, GAD-7, DASS-21) feature translations for English (`en`), Hindi (`hi`), Marathi (`mr`), and Spanish (`es`). The patient can change languages on the fly while an assessment is actively underway, immediately re-rendering the current item and options in real time.

## Frontend and backend

```text
frontend/
  src/pages/          React JSX screens
  src/controllers/    Assessment, report, analytics, and voice behavior
  src/api/client.js   Shared HTTP and WebSocket client
  src/styles/         Page styles bundled by Vite
  public/             Logo and audio worklet
  assets/             Existing screenshots
  test/               Frontend checks
  vite.config.js      Development and preview API proxy
backend/
  src/server.js       Node.js HTTP APIs and WebSocket endpoints
  src/                Scoring, validation, database stores, and Gemini integration
  data/               Assessment definitions and synthetic patients
  scripts/            Database checks, imports, and maintenance scripts
  docs/               Project and API documentation
  test/               Backend and persistence tests
  .env                Local database/provider credentials (ignored by Git)
backend/api/server.js Optional serverless adapter
```

The frontend is React with Vite. React renders the page structures; the existing tested browser controllers manage their question, report, and media regions. Navigation preserves the existing `.html` URLs and uses full page loads. Controller edits trigger a development reload to avoid duplicate listeners or microphone sessions.

All patient, questionnaire, assignment, report, and analytics requests use backend APIs. Voice and the original on-screen assessment flows use backend WebSockets. Database connections, scoring, and provider credentials remain in the backend. See [API reference](docs/API.md) for endpoints and payloads.

## Start locally

Use Node.js **24 or newer**. Install dependencies separately in each application folder:

```bash
cd backend
npm install
cd ../frontend
npm install
```

On a fresh clone, copy `backend/.env.example` to `backend/.env` and configure it. If you already have environment files in the repository root from the previous layout, copy them into `backend/` without committing them.

Start the backend in one terminal:

```bash
cd backend
npm run db:import-content
npm start
```

Start the frontend in another terminal:

```bash
cd frontend
npm run dev
```

Open **http://127.0.0.1:5173**. The backend defaults to **http://127.0.0.1:4174**. The frontend proxies `/api`, `/ws`, `/draft-ws`, and `/definition-ws` to the backend. Both processes must be running. Run npm commands inside the relevant application folder; there is no root package.

| Backend setting | Use | Default |
| --- | --- | --- |
| `PORT` / `HOST` | Backend listener | `4174` / `127.0.0.1` |
| `GEMINI_API_KEY` | Enables voice and Doctor conversation | Unset |
| `GEMINI_LIVE_MODEL` | Voice model | `gemini-3.8-live` |
| `GEMINI_TEXT_MODEL` | Doctor conversation model | `gemini-3.5-flash-lite` |
| `DATABASE_URL` | PostgreSQL connection; requires `sslmode=verify-full` | Unset; SQLite |
| `DB_PATH` | SQLite path if PostgreSQL is unset | `backend/data/prototype.sqlite` |
| `CONTENT_DB_PATH` | SQLite file for definitions and sample patients | `backend/data/content.sqlite` |
| `FRONTEND_ORIGINS` | Comma-separated allowed frontend origins | Localhost and 127.0.0.1 on port 5173 |

Run `npm run db:import-content` once for each new database before starting the backend. With `DATABASE_URL`, it imports 186 assessment versions and five synthetic patients into `pod_assessment_content`; sessions use `pod_assessment_prototype`. Without `DATABASE_URL`, the importer creates `backend/data/content.sqlite`. `npm run db:check` verifies PostgreSQL counts. The local and cloud databases do not synchronize automatically. Restart the backend after publishing new content because it reads the active catalogue at startup.

Optional frontend settings go in `frontend/.env.local` (see `frontend/.env.example`): `BACKEND_URL` changes the development/preview proxy target; `VITE_API_BASE_URL` sets a public API origin for separately hosted production apps. Keep it blank for same-origin hosting. Never put database URLs or provider keys in frontend environment variables. If using a separate API origin, add the frontend's exact origin to backend `FRONTEND_ORIGINS`.

## Build and verify

```bash
cd backend
npm run check
npm test
cd ../frontend
npm run build
npm test
```

To check the built frontend locally, keep the backend running and run `npm run preview` inside `frontend/`.

## Try the full workflow

1. In **NovoPsych Assessment → Prescribe Test**, choose a sample patient and review the summary and suggested tests.
2. Optionally use **Doctor conversation** for another suggestion. Search the full picker and confirm the assessment yourself.
3. Open the assigned patient link and choose **Complete on screen** or **Start voice conversation**. For voice, allow the microphone and answer naturally. The agent follows up when it cannot map an answer.
4. Review and edit answers, generate the report, then open **View Test Reports**. The report can be printed or saved as PDF through the browser.
5. Open **Analytics** to inspect completion activity and same-form score trends for the selected patient.

Run `npm test` inside each application folder for its automated suite. From `backend/`, `npm run db:inspect` examines the core and legacy draft sessions; `npm run db:inspect:definition -- <assignment-id>` inspects an imported assessment assignment. See the architecture guide for the other storage paths and endpoints.

To update the consolidated assessment source, run `npm run sync:assessments -- /path/to/all-assessments.json` inside `backend/`, then `npm run db:import-content` and restart the backend. This preserves category, recommendation, and legacy-session metadata. Changed questions or rules require a new `definition_version`; repeated imports preserve existing patient profiles.

## Documentation

- [Vercel deployment](docs/VERCEL_DEPLOYMENT.md): project settings, required PostgreSQL configuration, build checks, and Preview validation.
- [Architecture and workflow diagrams](docs/PROTOTYPE_ARCHITECTURE.md): components, recommendation, prescription, voice, scoring, persistence, and analytics.
- [Workflow performance and token accounting](docs/WORKFLOW_AND_PERFORMANCE.md): code-derived media rates and measurements still needed.
- [Cleaned bundle implementation](docs/CLEANED_BUNDLE_20261116.md): what the November 16 import supports.
- [Assessment gap audit](docs/NOVOPSYCH_20261116_GAP_AUDIT.md): source flags and a per-assessment matrix for all 186 entries.
- [Assessment import history](docs/ASSESSMENT_IMPORT_STATUS.md): November 13 versus November 16 status.

## Limits

This is a local demonstration with synthetic patients. It has no Casebook patient API, production authentication, patient notification, or automatic clinical escalation. Voice interpretation is reviewed by the respondent at the end but has not been clinically validated as an alternative administration method. The imported bundle marks every form's scoring as disabled for clinical use; its raw draft calculations and printable reports are for workflow testing. Use only de-identified information in Doctor conversation.
