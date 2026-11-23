# Conversational assessment prototype

A standalone OpenMind/Casebook-style demonstration of clinician-selected assessments, optional Gemini voice conversations, answer review, reporting, and patient-level analytics. It is **not connected to the Casebook backend**. The five selectable patients and their summaries are synthetic records imported into the content database.

## Current scope

1. A clinician selects a sample patient. Current summary observations produce an explained, rule-based shortlist. The doctor can also send de-identified notes to Gemini for catalogue-checked suggestions, then makes the final selection.
2. The Assessment Library below Doctor Conversation shows 186 imported assessment definitions from the database. Clinicians can search, filter by category or patient suggestion, open a dedicated details page, and select one for final review. Questions, choices, rules, descriptions, references, categories, and recommendation metadata are loaded from the database at server startup and served through the API. The 185 entries with questionnaires can be assigned; SDQ has no recovered form and is unavailable.
3. The patient completes the assessment on screen or in a Gemini Live voice conversation. A clear spoken answer is validated and saved immediately; the assistant asks a follow-up only when it cannot map the response. Questions and applicable options stay visible. A final review permits corrections before the report is created.
4. PHQ-9, GAD-7, PCL-5, and DASS-21 have dedicated scoring flows. Other imported forms show source-draft raw calculations when their rules apply; LEC-5 and asQ save answers without a numeric composite. The prototype does not claim that imported calculations reproduce NovoPsych's clinical reports.
5. Assessment definitions, sample patient profiles, assignments, answers, results, and analytics persist in SQLite or PostgreSQL. `data/all-assessments.json` and `data/demo-patients.json` are import files only; the running app reads neither file. The legacy draft definitions are imported as metadata for existing sessions. General assessment sessions also store an exact form snapshot, so later catalogue updates do not change an in-progress form.
6. Multi-language support: 43 languages are available in the assessment screens, defaulting to English (`en`). Core clinical instruments (PHQ-9, GAD-7, DASS-21) feature translations for English (`en`), Hindi (`hi`), Marathi (`mr`), and Spanish (`es`). The patient can change languages on the fly while an assessment is actively underway, immediately re-rendering the current item and options in real time.

## Start locally

Use Node.js **24.x**, matching the Vercel deployment runtime.

**macOS / Linux:**
```bash
git checkout dev
npm ci
cp .env.example .env    # configure GEMINI_API_KEY if testing voice
npm run db:import-content
npm run dev
```

**Windows (PowerShell):**
```powershell
npm ci
Copy-Item .env.example .env.local  # fresh clone only; do not overwrite an existing file
npm run db:import-content
npm run dev
```

Open the address printed by the server, normally `http://127.0.0.1:4174`. The on-screen flow works without a Gemini key. To enable voice and Doctor conversation, set `GEMINI_API_KEY` in the ignored `.env.local` file. Never commit or share the key.

| Setting | Use | Default |
| --- | --- | --- |
| `PORT` | Local HTTP/WebSocket port | `4174` |
| `GEMINI_API_KEY` | Enables Gemini Live and Doctor conversation | Unset |
| `GEMINI_LIVE_MODEL` | Voice model | `gemini-3.8-live` |
| `GEMINI_TEXT_MODEL` | Doctor conversation model | `gemini-3.5-flash-lite` |
| `DATABASE_URL` | PostgreSQL connection; must use `sslmode=verify-full` | Unset; SQLite |
| `DB_PATH` | SQLite file path when PostgreSQL is unset | `data/prototype.sqlite` |
| `CONTENT_DB_PATH` | Local SQLite file for definitions and sample patients | `data/content.sqlite` |

Run `npm run db:import-content` once for each new database before starting the server. With `DATABASE_URL`, it imports into the isolated `pod_assessment_content` PostgreSQL schema; sessions remain in `pod_assessment_prototype`. Without `DATABASE_URL`, it creates `data/content.sqlite` beside the local session database. `npm run db:check` verifies PostgreSQL counts, and `GET /api/health` shows the session storage backend. The local and cloud databases do not synchronize automatically. After publishing a new assessment version or editing a sample patient in the database, restart the server to refresh its startup cache.

## Try the full workflow

1. In **NovoPsych Assessment → Prescribe Test**, choose a sample patient and review the summary and suggested tests.
2. Optionally use **Doctor conversation** for another suggestion. Search the full picker and confirm the assessment yourself.
   Open **View full details** on a library card to review its overview, score components, psychometric narrative, references, and questionnaire preview. **Select for final review** returns to the same patient and fills the final picker; it does not prescribe automatically.
3. Open the assigned patient link and choose **Complete on screen** or **Start voice conversation**. For voice, allow the microphone and answer naturally. The assistant advances after each clear answer.
4. Review and edit answers, generate the report, then open **View Test Reports**. The report can be printed or saved as PDF through the browser.
5. Open **Analytics** to inspect completion activity and same-form score trends for the selected patient.

Run `npm test` for the automated suite. For PostgreSQL, `npm run db:inspect` examines the core and legacy draft sessions; `npm run db:inspect:definition -- <assignment-id>` inspects an imported assessment assignment. See the architecture guide for the other storage paths and endpoints.

To import a revised assessment export, run `npm run sync:assessments -- "C:\path\to\all-assessments.json"`, then `npm run db:import-content` and restart the server. The sync command preserves the app's category and recommendation metadata in the import file. The database importer keeps older assessment versions and refuses changed content under the same `definition_version`; increase that version when changing questions or rules. Existing patient profiles are not overwritten by another import. `GET /api/demo-patients/{id}` returns the stored sample profile; `/api/definitions` and `/api/definitions/{id}` serve the stored assessment catalogue.

## Documentation

- [Vercel deployment](docs/VERCEL_DEPLOYMENT.md): project settings, required PostgreSQL configuration, build checks, and Preview validation.
- [Architecture and workflow diagrams](docs/PROTOTYPE_ARCHITECTURE.md): components, recommendation, prescription, voice, scoring, persistence, and analytics.
- [Workflow performance and token accounting](docs/WORKFLOW_AND_PERFORMANCE.md): code-derived media rates and measurements still needed.
- [Cleaned bundle implementation](docs/CLEANED_BUNDLE_20261116.md): what the November 16 import supports.
- [Assessment gap audit](docs/NOVOPSYCH_20261116_GAP_AUDIT.md): source flags and a per-assessment matrix for all 186 entries.
- [Assessment import history](docs/ASSESSMENT_IMPORT_STATUS.md): November 13 versus November 16 status.

## Limits

This is a local demonstration with synthetic patients. It has no Casebook patient API, production authentication, patient notification, or automatic clinical escalation. Voice interpretation is reviewed by the respondent at the end but has not been clinically validated as an alternative administration method. The imported bundle marks every form's scoring as disabled for clinical use; its raw draft calculations and printable reports are for workflow testing. Use only de-identified information in Doctor conversation.
