# PHQ-9, GAD-7 and PCL-5 Gemini Live prototype

Standalone Casebook-style conversational prototype for **PHQ-9**, **GAD-7**, and **PCL-5**. It uses its own code and can store assessments in Neon PostgreSQL or a local SQLite file.

## What it does

- Uses the nine English PHQ-9 items and the **past two weeks** reference period from the [NovoPsych PHQ-9 form](https://novopsych.com/wp-content/uploads/2023/02/phq-9_assessment.pdf). A Hindi option uses fixed item wording from a [published Hindi PHQ-9 appendix](https://www.leprosy-information.org/media/1391/download). Its score-zero response label is drawn from the [Multicultural Mental Health Resource Centre Hindi form](https://multiculturalmentalhealth.ca/wp-content/uploads/2019/07/PHQ-9-HINDI.pdf), because the appendix's extracted zero label is ambiguous. Gemini does not create new question translations during a session.
- In Live mode, Gemini asks each item, accepts a natural spoken or typed response, may clarify the response anchor, proposes a value, and waits for confirmation. The application saves only confirmed answers. PHQ-9 and GAD-7 use 0–3; PCL-5 uses 0–4.
- In form-test mode, the person selects an option directly. This works without Gemini.
- Before scoring, the person reviews every answer and can make final corrections. SQLite records corrections in `answer_revisions`; PostgreSQL records them in the session's JSON state.
- Scoring is deterministic on the server: PHQ-9 totals 0–27 with its severity band and item-9 follow-up flag; GAD-7 totals 0–21 with four bands; PCL-5 totals 0–80 without a severity band or diagnosis. The imported DASS-21 now calculates a raw total, three raw and doubled subscales, and raw severity bands.
- A positive response to item 9 sets `requiresHumanFollowUp` regardless of total score. The result UI calls out the follow-up need.
- Shows a printable report after final review with the score and every confirmed response. Saved results reopen the report.
- Opens with a clinician-facing NovoPsych Assessment screen based on the current Casebook navigation. **Prescribe Test** selects one of five synthetic patients, reviews their summary and an explained shortlist, and shows all 186 cleaned-bundle assessments in one searchable dropdown. The summary's primary suggestion is selected by default. The doctor may discuss current concerns with Gemini and select another form. **View Test Reports** filters assignments and reports by patient. The initial shortlist uses deterministic rules; doctor conversation uses Gemini with catalogue checks.

## Run locally

Requires Node.js 24 or later.

```powershell
cd D:\phq9-gemini-live-prototype
npm ci
Copy-Item .env.example .env
```

If using Live mode, put a **new, active** Gemini API key in `.env`. Do not reuse any compromised key. Do not paste keys into chat or commit `.env`.

To use Neon, put the PostgreSQL connection string in an ignored `.env.local` file as `DATABASE_URL=...`, retaining `sslmode=verify-full`. Set `PORT=4175` there if port 4174 is already in use. The server loads `.env` and `.env.local` when started through npm. Check the connection before starting:

```powershell
npm run db:check
npm run dev
```

Open the address printed by the server. `GET /api/health` reports `"database":"postgresql"` when Neon is active. On first startup the server creates tables only in the `pod_assessment_prototype` schema, including the new `definition_sessions` and `definition_prescriptions` tables; it does not modify the other project's tables. Run `npm run db:smoke:definitions` for a disposable check of the new assessment flow. The script deletes its temporary records.

Use `npm run db:inspect` to list the prototype tables, record counts, and up to ten recent sessions without changing data. To see the answer values and score for one session, run `npm run db:inspect -- <session-id>` with an ID from that list. This command does not print the database password or free-text response summaries.

If `DATABASE_URL` is absent, the prototype uses `data/prototype.sqlite`. Existing SQLite results are retained in that local file and are not copied to Neon automatically.

```powershell
npm run dev
```

On the prescription screen, select a patient and review the summary-based suggestion. Optionally describe additional current concerns in the Doctor conversation. The suggested assessment is preselected in the searchable picker; type to filter the full catalogue or choose a conversation suggestion, then click **Confirm & Assign**. The clinician makes the final choice. Click the OpenMind sidebar header to collapse or pin it open; when collapsed, hover over the icon rail to expand it temporarily.

Open the address printed by the server (port 4175 in the supplied local Neon configuration). Select **NovoPsych Assessment → Prescribe Test**, choose a sample patient, and click **Next**. Sample A suggests PHQ-9, B suggests GAD-7, and C suggests PCL-5. Review the evidence, click **Confirm & Prescribe**, then open the patient assessment link. The patient can use **Complete on screen** without Gemini or **Start voice conversation** with a configured Gemini key. Hindi is currently available for PHQ-9 only. After completion, return to **View Test Reports** and open the patient's report. Run `npm test` for automated checks.

Select **Analytics** in the sidebar for assignment counts, completion rate, median prescription-to-completion time, monthly completion bars, and completion by assessment. These include cleaned-bundle forms as well as PHQ-9, GAD-7, PCL-5, and DASS-21. Choose a sample patient to see completed assessments in an activity chart and dated table; filter to all time, 90 days, or 30 days. Score charts stay separate by assessment, version, language, and metric. Cleaned-bundle metrics with a valid nonnegative source range appear as separate draft score series; other completed forms remain visible as activity with a report link. These sample analytics have no production patient authentication or aggregate privacy controls.

For a populated demo, create a **separate synthetic database** once and launch the app against it:

```powershell
npm run seed:analytics
npm run demo:analytics
```

Open <http://127.0.0.1:4175>, select **Analytics** and sample patient **B**, then try the time filters. The fixture contains eight completed assessments across PHQ-9, GAD-7, DASS-21, and an answer-only form, dated over roughly three months. The seed command refuses to overwrite an existing file. Stop the Neon-backed development server before running this separate SQLite demo if both use port 4175.

### Imported assessments in Prescribe Test

The Prescribe Test dropdown uses the cleaned 16 November 2026 bundle. It lists 186 records; 185 have questions and can be completed by voice conversation or on screen. The SDQ entry has no questionnaire and stays disabled. PHQ-9, GAD-7, PCL-5, and DASS-21 keep their existing scored conversational flows. The other available forms use a new Gemini Live conversation with spoken questions, live transcription, answer proposal, explicit confirmation, conditional questions, final answer review, persistent sessions, and a printable report. During voice assessment, the current question and available response options remain visible on screen; numeric and text questions show the expected response format. The forms also retain an on-screen flow. The reports show draft raw calculations where a source formula and numeric values are present. LEC-5 and asQ are answer-only because this file defines no numeric rules for them. All 186 entries are marked unapproved for clinical use in the supplied JSON; these new calculations must not be treated as validated NovoPsych results.

Use `npm run check:definitions` to audit calculation coverage. With representative synthetic answers and source context, 728 of 729 draft rule outputs calculate. One CRAFFT rule correctly does not apply to the chosen answers. Scores are withheld if required context or compatible source values are missing. This is a software coverage check, not clinical validation. See [assessment import status](docs/ASSESSMENT_IMPORT_STATUS.md) for the earlier import history.

To demo the new flow, restart `npm run dev`, open the local address, choose a sample patient in **Prescribe Test**, search for **Adult ADHD Self-Report Scale**, assign it, and open its patient link. Choose **Start voice conversation**, allow microphone access, answer naturally, and confirm each proposed response. You can correct a proposal or switch to the on-screen flow. Review all responses, then generate the report. The report shows raw source-draft metrics, available source bands, a visual score range where bounds exist, and the recorded answers. **Print / Save PDF** uses the browser's print dialog. The report does not reproduce unpublished NovoPsych percentiles, norms, reliable-change calculations, or proprietary report layout.

To regenerate the versioned source file, run `npm run import:new -- <source-json-path>`. The importer records the source SHA-256 and writes `data/assessment-definitions-20261116.json`. Re-import only after reviewing changes to questions, response types, and formulas. Existing saved sessions retain a snapshot of their assigned form.

The previous imported-form sessions remain readable with their original answer indexes. New assignments from the 16 November bundle use the versioned voice or on-screen flow and draft report. The optional `npm run smoke:live -- 4174` command checks the dedicated voice connection; `npm run smoke:doctor` checks a synthetic doctor conversation with Gemini. Both use the configured API key.

The optional **Doctor conversation** sends the selected sample patient's current structured observations and de-identified doctor messages to Gemini 3.5 Flash-Lite using the Interactions API. It retrieves likely available entries from the cleaned catalogue first, asks Gemini for up to three IDs, and rejects IDs outside that set. A selected suggestion updates the same searchable assessment picker; the doctor must confirm the assignment. If Gemini times out, the screen clearly labels simple local catalogue matches; these are keyword matches, not an AI interpretation. Conversation messages are held in browser memory for this demo and are not added to the SQLite patient record. Do not enter real patient information.

To regenerate `data/draft-assessments.json` from an approved source bundle, run `npm run import:assessments -- <source-json-path> <output-json-path> data/draft-assessments.json`, using a temporary output path and replacing the catalogue only after reviewing the import. The importer keeps existing runnable forms and their IDs unchanged so previously saved answer indexes retain their meaning. It uses repaired content for records that were previously unavailable. It does not import scoring rules or source assets. Confirm the scope of the client's content rights before distributing the imported catalogue or using any draft assessment with patients.

Demo patient D suggests DASS-21, which now calculates raw scores and severity bands in this app. Percentiles and reliable-change calculations are not included. Demo patient E is patterned after the *structure and themes* of the supplied Digital Twin report, without copying its patient data: historical low mood, seizure-related fear, and sleep disruption do not automatically become current psychiatric concerns. Because its immediate safety status is not reviewed, the engine pauses recommendations. The earlier patient suggestion page remains at <http://127.0.0.1:4174/patient-suggest.html>; the manual context screen remains at <http://127.0.0.1:4174/recommend.html>.

After the last answer (9 for PHQ-9, 7 for GAD-7, or 20 for PCL-5), review every selected option. Change any response, then click **Confirm answers and generate report**. The report appears on the assessment page; **Open printable report** supports browser **Print / Save as PDF**. Reports do not reproduce NovoPsych percentile calculations or comparison charts.

## Data and limits

PHQ-9 and GAD-7 can be explicit clinician choices without a matching summary observation. The dedicated PCL-5 flow stays disabled unless current trauma-related symptoms and clinician-confirmed qualifying exposure are documented. The doctor reviews the default selection or chooses another. The new cleaned-bundle forms are clinician-selected demonstrations with voice and on-screen administration; the server verifies that a questionnaire exists and that the patient is eligible for assignment. Source-draft calculations are shown only after final answer review.

With `DATABASE_URL`, scored and imported assessments use the isolated `pod_assessment_prototype` PostgreSQL schema. The new cleaned-bundle flow adds `definition_prescriptions` and `definition_sessions` there; without `DATABASE_URL`, it adds tables to `data/prototype.sqlite`. Each new session stores its exact form snapshot, source hash, answers, context, and report calculations so later catalogue imports cannot silently change old results. `GET /api/demo-patients/{id}/prescriptions` lists all assignment types. A new session requires an assignment ID. This local prototype has no authentication, real patient delivery, or clinician notification. Keep it on localhost and use sample data only.

Synthetic summaries live in `data/demo-patients.json`. `GET /api/demo-patients` lists aliases; `GET /api/demo-patients/{id}/recommendations` returns the selected summary, normalized concerns, supporting observations, ignored observations, and a ranked shortlist. `src/demo-patients.js` maps only explicitly current structured observations; historical low mood, seizure-related fear, and sleep disruption are not automatically equated with depression or generalized anxiety. Each suggestion lists its matching observations and any missing prerequisite. The four-entry curated recommendation catalogue is in `data/assessment-catalog.json`; it is **not** a clinical approval. `src/assessment-catalog.js` retrieves matching entries by structured concern. `src/recommendation.js` applies safety, age, trauma, and availability checks before the UI allows prescription. This is structured retrieval, **not an AI or vector RAG system**. The supplied real Digital Twin report is not copied into this repository. The cleaned assessment bundle is copied in compact form to `data/assessment-definitions-20261116.json`; its questionnaire and scoring fields are still source drafts. A real Casebook integration needs authenticated per-patient summary access, clinician review, and patient ownership checks.

The routing rules prioritize PHQ-9 for depression concerns, GAD-7 for anxiety concerns, PCL-5 for trauma-related symptoms **after qualifying trauma exposure is confirmed**, and DASS-21 for stress or overlapping depression/anxiety concerns. With no selected concerns, adult preventive screening suggests PHQ-9 and, for ages 19–64, GAD-7. Age under 19 or unknown pauses suggestions. Age 65+ adds an anxiety evidence caveat. Safety status must be explicitly reviewed; any immediate concern pauses all suggestions and calls for clinician safety review. These rules are a workflow aid, not a diagnosis or automatic assignment. Clinical sources: [USPSTF depression screening](https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/screening-depression-suicide-risk-adults), [USPSTF anxiety screening](https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/anxiety-adults-screening), [VA PCL-5](https://www.ptsd.va.gov/Professional/Assessment/Adult-Sr/Ptsd-Checklist.Asp), [UNSW DASS FAQ](https://dass.psy.unsw.edu.au/DASSFAQ.htm).

The PHQ-9 source form linked above has nine scored items. A functional difficulty question appears in some PHQ-9 formats but is not included in that form; it is outside this prototype's scoring flow. The Hindi wording is sourced, but this particular combined form and conversational administration have not been validated for the intended patient population. GAD-7 and PCL-5 are English only. The [Pfizer statement](https://www.pfizer.com/news/press-release/press-release-detail/pfizer_to_offer_free_public_access_to_mental_health_assessment_tools_to_improve_diagnosis_and_patient_care) describes PHQ and GAD-7 use without copyright restriction; the [VA PCL-5 page](https://www.ptsd.va.gov/professional/assessment/adult-sr/ptsd-checklist.asp) identifies PCL-5 as public domain. The supplied NovoPsych export itself remains a draft and requires wording and use review before production.

**Clinical review is required before patient use.** These are screening or symptom measures, not diagnoses. Conversational AI mapping changes the standard self-report administration and has not been validated here. PCL-5 has no established severity bands; its total requires clinician interpretation. PHQ-9 item 9 is not a complete suicide risk assessment. A positive item 9 answer needs prompt human follow-up under a clinician-approved protocol; this prototype only records and displays a flag. Current danger or intent needs immediate local emergency help. The client must define the actual escalation owner, notification route, and response time before integration.

## Implementation

- `data/phq9.json`, `data/gad7.json`, `data/pcl5.json`: fixed wording, response anchors, and source references.
- `scripts/import_assessment_forms.py`: reproduces the GAD-7 and PCL-5 extraction from the supplied draft export.
- `src/assessment.js` and `src/forms.js`: form validation and deterministic scoring.
- `src/gemini-bridge.js`: Gemini Live session and propose/confirm/cancel tool flow.
- `src/store.js` and `src/draft-store.js`: local SQLite persistence.
- `src/postgres-stores.js`: isolated Neon PostgreSQL persistence for scored and imported assessments.
- `data/assessment-definitions-20261116.json`, `src/definition-library.js`, `src/definition-scoring.js`, and `src/definition-store.js`: versioned cleaned catalogue, source-draft arithmetic, and isolated persistence.
- `public/definition.html`, `public/definition.js`, `public/definition-voice.js`, and `public/definition.css`: voice and on-screen administration, final review, and printable draft report.
- `docs/CLEANED_BUNDLE_20261116.md`: coverage audit and source gaps.
- `src/server.js`: HTTP and WebSocket server.
- `src/recommendation.js`: validated, deterministic recommendation rules.
- `data/assessment-catalog.json` and `src/assessment-catalog.js`: small curated assessment metadata set and structured retrieval.
- `public/clinic.html`, `public/clinic.js`, `public/clinic.css`, `public/clinic-recommend.css`: clinician prescription and report screens.
- `public/recommend.html` and `public/recommend.js`: clinician-facing recommendation screen.
- `public/`: Casebook-style browser UI, audio and optional camera capture.
- `docs/WORKFLOW_AND_PERFORMANCE.md`: end-to-end workflow diagram, data rates, latency points, and token/cost illustration.
