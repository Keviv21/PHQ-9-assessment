# Chandrika assessment workspace

The `chandrika` branch keeps the main application's SQLite backend and adds the patient workspace at `/`. Main and sagar are unchanged. This workspace adapts the platform's assessment layout, complete-option translation validation and live-answer handling, and sagar's history recommendation, doctor consultation, right-side session controls and per-patient analytics flow.

- The first patient is imported from `local-data/neurotwin-patient.json` (or `NEUROTWIN_PATIENT_FILE`), followed by four sample patients. The clinical JSON is ignored by Git; keep it local. Added patients and their summaries are saved in SQLite.
- `data/workspace-assessments.json` contains 186 normalized entries from the supplied final export. All appear in the prescription dropdown; 133 single-choice questionnaires can run, and 53 remain blocked for missing or unsupported response content. Definitions retain their source hashes and review status.
- Clicking Next requests Gemini suggestions from the patient summary and catalogue. The leading runnable recommendation is selected automatically. Doctor follow-up conversations can refine suggestions, and manual selection remains available. Doctor conversations are not saved. Cached history suggestions are invalidated when the summary, demographics, catalogue or model changes.
- **Doctor-suggested assessments** reuses main’s structured recommendation rules alongside Gemini. Sample summaries pre-fill the review context and supporting observations; imported and added patients require clinician-entered concerns and review details. Multiple concerns offer a priority selector. Suggestions link to the full catalogue and clinical references. These temporary reviews do not call Gemini or write to the database. Main’s age, safety and trauma review checks are retained for these suggestions.
- Confirm & Prescribe creates a patient-linked prescription. The next page offers language, Chat, Voice and On-screen choices. Translations include every option label; sessions freeze the complete definition and keep the chosen mode/language when resumed. Clear answers save automatically, with a final editable review.
- Patient reports and analytics are accessible from the patient sidebar and completed session. Reports can be downloaded as HTML or printed to PDF. Analytics separates instruments, versions and languages. The supplied final catalogue disables scoring, so its results have response history and completion counts, not clinical scores, norms or severity estimates. Legacy scored assessments remain accessible through their original endpoints.
- The right-side camera is a local preview only. Voice audio and typed live responses are sent to Gemini; this app does not retain audio, video or live transcripts. Known direct identifiers are removed from recommendation inputs; this is not full de-identification.

Run `npm run dev`, then open `http://localhost:4174`. Stop any other process on that port first. The main branch's `DB_PATH` (default `data/prototype.sqlite`) is used; this workspace does not switch to sagar's PostgreSQL database. New `workspace_*` tables keep patient sessions separate from existing legacy demo and library-review tables.

`GEMINI_API_KEY` enables recommendations and live sessions. Optional `GEMINI_RECOMMENDATION_MODEL`, `GEMINI_TRANSLATION_MODEL` and `GEMINI_LIVE_MODEL` override their defaults. Without Gemini, English on-screen questionnaires remain available. Provider availability/quota still governs AI features.

```bash
cd /home/chandrikak/Pod_Dev/PHQ-9-assessment
npm run dev
```

Validation: `npm test`. The workspace tests cover patient imports, catalogue choices, recommendation grounding and caching, temporary doctor messages, translation integrity, saved session revisions, reports and analytics. Provider responses are mocked in tests.

## Legacy prototype reference

The notes below describe the original main-branch routes and separate library previews; the patient workspace above supersedes their prescription screen.

### PHQ-9, GAD-7 and PCL-5 Gemini Live prototype

Standalone Casebook-style conversational prototype for **PHQ-9**, **GAD-7**, and **PCL-5**. It uses its own code and SQLite file, separate from the earlier DASS-21 prototype.

## What it does

- Uses the nine English PHQ-9 items and the **past two weeks** reference period from the [NovoPsych PHQ-9 form](https://novopsych.com/wp-content/uploads/2023/02/phq-9_assessment.pdf). A Hindi option uses fixed item wording from a [published Hindi PHQ-9 appendix](https://www.leprosy-information.org/media/1391/download). Its score-zero response label is drawn from the [Multicultural Mental Health Resource Centre Hindi form](https://multiculturalmentalhealth.ca/wp-content/uploads/2019/07/PHQ-9-HINDI.pdf), because the appendix's extracted zero label is ambiguous. Gemini does not create new question translations during a session.
- In Live mode, Gemini asks each item, accepts a natural spoken or typed response, may clarify the response anchor, proposes a value, and waits for confirmation. The application saves only confirmed answers. PHQ-9 and GAD-7 use 0–3; PCL-5 uses 0–4.
- In form-test mode, the person selects an option directly. This works without Gemini.
- Before scoring, the person reviews every answer and can make final corrections. Corrections are recorded in an `answer_revisions` audit table.
- Scoring is deterministic on the server: PHQ-9 totals 0–27 with its severity band and item-9 follow-up flag; GAD-7 totals 0–21 with four bands; PCL-5 totals 0–80 without a severity band or diagnosis.
- A positive response to item 9 sets `requiresHumanFollowUp` regardless of total score. The result UI calls out the follow-up need.
- Shows a printable report after final review with the score and every confirmed response. Saved results reopen the report.
- Opens with a clinician-facing NovoPsych Assessment screen based on the current Casebook navigation. **Prescribe Test** selects one of five synthetic patients, reviews their summary and an explained shortlist, asks an optional priority question when the summary has multiple current concerns, and shows a ranked dropdown of PHQ-9, GAD-7, and PCL-5 for the doctor's final selection. **View Test Reports** filters prescriptions and completed reports by patient. Suggestions use deterministic retrieval and checks, not Gemini.

## Run locally

Requires Node.js 24 or later.

```powershell
cd D:\phq9-gemini-live-prototype
npm ci
Copy-Item .env.example .env
```

If using Live mode, put a **new, active** Gemini API key in `.env`. Do not reuse any compromised key. Do not paste keys into chat or commit `.env`.

```powershell
npm run dev
```

On the prescription screen, review the shortlist, answer the optional clarification if shown, then **select a test in the dropdown** before clicking **Confirm & Prescribe**. The dropdown is ordered by relevance; the clinician makes the final choice. Click the OpenMind sidebar header to collapse or pin it open; when collapsed, hover over the icon rail to expand it temporarily.

Open <http://127.0.0.1:4174>. Select **NovoPsych Assessment → Prescribe Test**, choose a sample patient, and click **Next**. Sample A suggests PHQ-9, B suggests GAD-7, and C suggests PCL-5. Review the evidence, click **Confirm & Prescribe**, then open the patient assessment link. The patient can use **Complete on screen** without Gemini or **Start voice conversation** with a configured Gemini key. Hindi is currently available for PHQ-9 only. After completion, return to **View Test Reports** and open the patient's report. Run `npm test` for automated checks.

Select **Analytics** in the sidebar for prescribed, completed, in-progress, and awaiting-start counts, completion rate, median prescription-to-completion time, and completed prescriptions by month. Choose a sample patient to see PHQ-9, GAD-7, or PCL-5 score timelines; filter to all time, 90 days, or 30 days. Results are grouped by assessment, version, and language, and each point links to its saved report. A single result appears as one point rather than an implied trend. The charts use saved assessment records, so an empty database displays an empty state. Imported Assessment Library reviews remain unscored and do not appear in score timelines. The overview counts only prescribed tests; patient timelines include all scored tests linked to that sample patient. These sample analytics have no production patient authentication or aggregate privacy controls.

### Imported assessment library

The **Assessment Library** sidebar item lists all 186 records from the supplied repaired JSON (13 November 2026). Search and filter the list, then open a record. The 162 records with complete question and answer-option structures have an interactive preview and a **Start live review** link. This includes 53 forms made available by the repaired export. For 16 of those, the source prints numbered response scales with words only at their endpoints; the importer displays those printed numbers as answer labels. Live review uses Gemini voice and optional camera context when a key is configured; **Complete on screen** provides a local test path. Each response is confirmed, final answers can be edited, and the completed answers are saved in SQLite. Open them again from **Saved assessment reviews**. No score or clinical report is generated. The remaining 24 records show why a complete preview is unavailable: 23 have missing answer sets and one has no extracted questions. The imported definitions still need clinical review and cannot be prescribed through the patient workflow. The repaired JSON does not provide verified scoring or complete content for every assessment.

See [assessment import status](docs/ASSESSMENT_IMPORT_STATUS.md) for the remaining source gaps.

To try a live review, restart the server, open **Assessment Library**, search for **Brief Resilience Scale**, and select **Start live review**. Choose **Start voice conversation**, allow the microphone, answer each question naturally, and confirm each interpretation. After the last item, edit any response and select **Save reviewed answers**. Use **Saved assessment reviews** to reopen the unscored answer summary. The optional `npm run smoke:live -- 4174` command connects to Gemini briefly and uses the configured API key; it does not check spoken-answer quality.

To regenerate `data/draft-assessments.json` from an approved source bundle, run `npm run import:assessments -- <source-json-path> <output-json-path> data/draft-assessments.json`, using a temporary output path and replacing the catalogue only after reviewing the import. The importer keeps existing runnable forms and their IDs unchanged so previously saved answer indexes retain their meaning. It uses repaired content for records that were previously unavailable. It does not import scoring rules or source assets. Confirm the scope of the client's content rights before distributing the imported catalogue or using any draft assessment with patients.

Demo patient D suggests DASS-21, which remains a separate prototype and cannot be prescribed here. Demo patient E is patterned after the _structure and themes_ of the supplied Digital Twin report, without copying its patient data: historical low mood, seizure-related fear, and sleep disruption do not automatically become current psychiatric concerns. Because its immediate safety status is not reviewed, the engine pauses recommendations. The earlier patient suggestion page remains at <http://127.0.0.1:4174/patient-suggest.html>; the manual context screen remains at <http://127.0.0.1:4174/recommend.html>.

After the last answer (9 for PHQ-9, 7 for GAD-7, or 20 for PCL-5), review every selected option. Change any response, then click **Confirm answers and generate report**. The report appears on the assessment page; **Open printable report** supports browser **Print / Save as PDF**. Reports do not reproduce NovoPsych percentile calculations or comparison charts.

## Data and limits

For patient B, the optional clarification asks which documented current concern should be prioritized. It changes the order of suggestions but does not add clinical facts or override eligibility. The final dropdown contains only the three runnable tests. PHQ-9 and GAD-7 can be explicit clinician choices without a matching summary observation. PCL-5 stays disabled unless current trauma-related symptoms and clinician-confirmed qualifying exposure are documented. DASS-21 may appear in the shortlist but is not in the prescription dropdown. The doctor must actively choose a test. The server rechecks eligibility when prescribing and when the patient starts a session.

The database is `data/prototype.sqlite`. The `prescriptions` table links a synthetic patient and form ID to an assessment session. `GET /api/demo-patients/{id}/prescriptions` lists assignments; `GET /api/demo-patients/{id}/reports` lists completed results. `GET /api/results/{id}` includes individual answers. A new assessment session requires a valid prescription ID. This local prototype has no authentication, real patient delivery, or clinician notification. Do not expose the server beyond localhost or use real patient data.

Synthetic summaries live in `data/demo-patients.json`. `GET /api/demo-patients` lists aliases; `GET /api/demo-patients/{id}/recommendations` returns the selected summary, normalized concerns, supporting observations, ignored observations, and a ranked shortlist. `src/demo-patients.js` maps only explicitly current structured observations; historical low mood, seizure-related fear, and sleep disruption are not automatically equated with depression or generalized anxiety. Each suggestion lists its matching observations and any missing prerequisite. The four-entry, prototype-curated metadata catalogue is in `data/assessment-catalog.json`; it is **not** a clinical approval. `src/assessment-catalog.js` retrieves matching entries by structured concern. `src/recommendation.js` applies safety, age, trauma, and availability checks before the UI allows prescription. The server repeats the eligibility check when a prescription is submitted. This is structured retrieval, **not an AI or vector RAG system**. The supplied real Digital Twin report and full 24 MB draft assessment export are not copied into the repository or loaded at runtime. `scripts/import_assessment_forms.py` extracts the 7 GAD-7 and 20 PCL-5 items and response options into small local JSON files. Scoring is implemented separately from primary instrument guidance; unverified catalogue entries are not made runnable automatically. A real Casebook integration still needs authenticated per-patient summary access, clinician-verified concern mapping, and patient ownership checks.

The routing rules prioritize PHQ-9 for depression concerns, GAD-7 for anxiety concerns, PCL-5 for trauma-related symptoms **after qualifying trauma exposure is confirmed**, and DASS-21 for stress or overlapping depression/anxiety concerns. With no selected concerns, adult preventive screening suggests PHQ-9 and, for ages 19–64, GAD-7. Age under 19 or unknown pauses suggestions. Age 65+ adds an anxiety evidence caveat. Safety status must be explicitly reviewed; any immediate concern pauses all suggestions and calls for clinician safety review. These rules are a workflow aid, not a diagnosis or automatic assignment. Clinical sources: [USPSTF depression screening](https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/screening-depression-suicide-risk-adults), [USPSTF anxiety screening](https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/anxiety-adults-screening), [VA PCL-5](https://www.ptsd.va.gov/Professional/Assessment/Adult-Sr/Ptsd-Checklist.Asp), [UNSW DASS FAQ](https://dass.psy.unsw.edu.au/DASSFAQ.htm).

The PHQ-9 source form linked above has nine scored items. A functional difficulty question appears in some PHQ-9 formats but is not included in that form; it is outside this prototype's scoring flow. The Hindi wording is sourced, but this particular combined form and conversational administration have not been validated for the intended patient population. GAD-7 and PCL-5 are English only. The [Pfizer statement](https://www.pfizer.com/news/press-release/press-release-detail/pfizer_to_offer_free_public_access_to_mental_health_assessment_tools_to_improve_diagnosis_and_patient_care) describes PHQ and GAD-7 use without copyright restriction; the [VA PCL-5 page](https://www.ptsd.va.gov/professional/assessment/adult-sr/ptsd-checklist.asp) identifies PCL-5 as public domain. The supplied NovoPsych export itself remains a draft and requires wording and use review before production.

**Clinical review is required before patient use.** These are screening or symptom measures, not diagnoses. Conversational AI mapping changes the standard self-report administration and has not been validated here. PCL-5 has no established severity bands; its total requires clinician interpretation. PHQ-9 item 9 is not a complete suicide risk assessment. A positive item 9 answer needs prompt human follow-up under a clinician-approved protocol; this prototype only records and displays a flag. Current danger or intent needs immediate local emergency help. The client must define the actual escalation owner, notification route, and response time before integration.

## Implementation

- `data/phq9.json`, `data/gad7.json`, `data/pcl5.json`: fixed wording, response anchors, and source references.
- `scripts/import_assessment_forms.py`: reproduces the GAD-7 and PCL-5 extraction from the supplied draft export.
- `src/assessment.js` and `src/forms.js`: form validation and deterministic scoring.
- `src/gemini-bridge.js`: Gemini Live session and propose/confirm/cancel tool flow.
- `src/store.js`: local SQLite schema and persistence.
- `src/server.js`: HTTP and WebSocket server.
- `src/recommendation.js`: validated, deterministic recommendation rules.
- `data/assessment-catalog.json` and `src/assessment-catalog.js`: small curated assessment metadata set and structured retrieval.
- `public/clinic.html`, `public/clinic.js`, `public/clinic.css`, `public/clinic-recommend.css`: clinician prescription and report screens.
- `public/recommend.html` and `public/recommend.js`: clinician-facing recommendation screen.
- `public/`: Casebook-style browser UI, audio and optional camera capture.
- `docs/WORKFLOW_AND_PERFORMANCE.md`: end-to-end workflow diagram, data rates, latency points, and token/cost illustration.
