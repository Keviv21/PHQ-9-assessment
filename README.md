# PHQ-9, GAD-7 and PCL-5 Gemini Live prototype

Standalone Casebook-style conversational prototype for **PHQ-9**, **GAD-7**, and **PCL-5**. It uses its own code and SQLite file, separate from the earlier DASS-21 prototype.

## What it does

- Uses the nine English PHQ-9 items and the **past two weeks** reference period from the [NovoPsych PHQ-9 form](https://novopsych.com/wp-content/uploads/2023/02/phq-9_assessment.pdf). A Hindi option uses fixed item wording from a [published Hindi PHQ-9 appendix](https://www.leprosy-information.org/media/1391/download). Its score-zero response label is drawn from the [Multicultural Mental Health Resource Centre Hindi form](https://multiculturalmentalhealth.ca/wp-content/uploads/2019/07/PHQ-9-HINDI.pdf), because the appendix's extracted zero label is ambiguous. Gemini does not create new question translations during a session.
- In Live mode, Gemini asks each item, accepts a natural spoken or typed response, may clarify the response anchor, proposes a value, and waits for confirmation. The application saves only confirmed answers. PHQ-9 and GAD-7 use 0–3; PCL-5 uses 0–4.
- In form-test mode, the person selects an option directly. This works without Gemini.
- Before scoring, the person reviews every answer and can make final corrections. Corrections are recorded in an `answer_revisions` audit table.
- Scoring is deterministic on the server: PHQ-9 totals 0–27 with its severity band and item-9 follow-up flag; GAD-7 totals 0–21 with four bands; PCL-5 totals 0–80 without a severity band or diagnosis. The imported DASS-21 now calculates a raw total, three raw and doubled subscales, and raw severity bands.
- A positive response to item 9 sets `requiresHumanFollowUp` regardless of total score. The result UI calls out the follow-up need.
- Shows a printable report after final review with the score and every confirmed response. Saved results reopen the report.
- Opens with a clinician-facing NovoPsych Assessment screen based on the current Casebook navigation. **Prescribe Test** selects one of five synthetic patients, reviews their summary and an explained shortlist, and shows all 186 catalogue assessments in one searchable dropdown. The summary's primary suggestion is selected by default. The doctor may discuss current concerns with Gemini and select another suggested form. **View Test Reports** filters assignments, scored reports, and unscored answer reviews by patient. The initial shortlist uses deterministic rules; doctor conversation uses Gemini with catalogue checks.

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

On the prescription screen, review the shortlist, answer the optional clarification if shown, then review the test already selected in the dropdown or search for another before clicking **Confirm & Assign**. The clinician makes the final choice. Click the OpenMind sidebar header to collapse or pin it open; when collapsed, hover over the icon rail to expand it temporarily.

Open <http://127.0.0.1:4174>. Select **NovoPsych Assessment → Prescribe Test**, choose a sample patient, and click **Next**. Sample A suggests PHQ-9, B suggests GAD-7, and C suggests PCL-5. Review the evidence, click **Confirm & Prescribe**, then open the patient assessment link. The patient can use **Complete on screen** without Gemini or **Start voice conversation** with a configured Gemini key. Hindi is currently available for PHQ-9 only. After completion, return to **View Test Reports** and open the patient's report. Run `npm test` for automated checks.

Select **Analytics** in the sidebar for assignment counts, completion rate, median prescription-to-completion time, monthly completion bars, and completion by assessment. These include imported forms as well as PHQ-9, GAD-7, and PCL-5. Choose a sample patient to see every completed assessment in a time-series activity chart and dated table; filter to all time, 90 days, or 30 days. Available score charts stay separate by assessment, version, language, and metric. DASS-21 has total and depression, anxiety, and stress subscale charts. The other imported forms appear in activity with their saved answers and no invented score. A single scored result appears as one point rather than an implied trend. Each result links to its report or answer review. These sample analytics have no production patient authentication or aggregate privacy controls.

For a populated demo, create a **separate synthetic database** once and launch the app against it:

```powershell
npm run seed:analytics
npm run demo:analytics
```

Open <http://127.0.0.1:4175>, select **Analytics** and sample patient **B**, then try the time filters. The fixture contains eight completed assessments across PHQ-9, GAD-7, DASS-21, and an answer-only form, dated over roughly three months. The seed command refuses to overwrite an existing file. The demo runs on port 4175, so it can run beside the normal app on 4174. Stop the demo server when finished; `npm run dev` continues to use the normal database.

### Imported assessments in Prescribe Test

The Prescribe Test dropdown lists all 186 records from the supplied repaired JSON (13 November 2026), with PHQ-9, GAD-7, and PCL-5 represented by their dedicated scored flows. Assessment names appear without scoring-status suffixes. Of the 162 records with complete question and answer-option structures, DASS-21 also has a score; the other 158 can be assigned to a sample patient as answer reviews without a score. The 24 incomplete records remain visible but disabled: 23 have missing answer sets and one has no extracted questions. The collapsible question browser remains in Prescribe Test for preview and source review. Assigned reviews support Gemini voice when configured or **Complete on screen** without Gemini. Final answers can be edited and saved in SQLite, then reopened under **View Test Reports**. The repaired JSON does not provide enabled, complete scoring rules for every assessment.

See [assessment import status](docs/ASSESSMENT_IMPORT_STATUS.md) for the remaining source gaps.

To try an imported form, select a sample patient in **Prescribe Test**, search for **Brief Resilience Scale** in the dropdown, assign it, and open the patient link. Choose **Start voice conversation** or **Complete on screen**. After the last item, edit any response and select **Save reviewed answers**. Use **View Test Reports** to reopen the unscored answer summary. The optional `npm run smoke:live -- 4174` command checks the voice connection; `npm run smoke:doctor` checks a synthetic doctor conversation with Gemini. Both use the configured API key.

The optional **Doctor conversation** sends the selected sample patient's current structured observations and de-identified doctor messages to Gemini 3.5 Flash-Lite using the Interactions API. It retrieves likely complete catalogue entries first, asks Gemini for up to three IDs, and rejects IDs outside that set. The doctor must select and confirm an assignment. If Gemini times out, the screen clearly labels simple local catalogue matches; these are keyword matches, not an AI interpretation. Conversation messages are held in browser memory for this demo and are not added to the SQLite patient record. Do not enter real patient information.

To regenerate `data/draft-assessments.json` from an approved source bundle, run `npm run import:assessments -- <source-json-path> <output-json-path> data/draft-assessments.json`, using a temporary output path and replacing the catalogue only after reviewing the import. The importer keeps existing runnable forms and their IDs unchanged so previously saved answer indexes retain their meaning. It uses repaired content for records that were previously unavailable. It does not import scoring rules or source assets. Confirm the scope of the client's content rights before distributing the imported catalogue or using any draft assessment with patients.

Demo patient D suggests DASS-21, which now calculates raw scores and severity bands in this app. Percentiles and reliable-change calculations are not included. Demo patient E is patterned after the *structure and themes* of the supplied Digital Twin report, without copying its patient data: historical low mood, seizure-related fear, and sleep disruption do not automatically become current psychiatric concerns. Because its immediate safety status is not reviewed, the engine pauses recommendations. The earlier patient suggestion page remains at <http://127.0.0.1:4174/patient-suggest.html>; the manual context screen remains at <http://127.0.0.1:4174/recommend.html>.

After the last answer (9 for PHQ-9, 7 for GAD-7, or 20 for PCL-5), review every selected option. Change any response, then click **Confirm answers and generate report**. The report appears on the assessment page; **Open printable report** supports browser **Print / Save as PDF**. Reports do not reproduce NovoPsych percentile calculations or comparison charts.

## Data and limits

For patient B, the optional clarification asks which documented current concern should be prioritized. It changes the order of suggestions but does not add clinical facts or override eligibility. PHQ-9 and GAD-7 can be explicit clinician choices without a matching summary observation. The scored PCL-5 flow stays disabled unless current trauma-related symptoms and clinician-confirmed qualifying exposure are documented. DASS-21 has an implemented score; the remaining complete imported forms save answers without a score until their rules are verified. The doctor reviews the default selection or chooses another. The server rechecks form availability and patient routing when assigning, and the patient link resolves to the assigned form.

The database is `data/prototype.sqlite`. The `prescriptions` and `draft_prescriptions` tables link a synthetic patient and form ID to a scored or unscored session. `GET /api/demo-patients/{id}/prescriptions` lists both kinds of assignments; `GET /api/demo-patients/{id}/reports` lists scored results. Unscored final answers are saved in `draft_sessions`. A new patient assessment session requires a valid prescription ID. This local prototype has no authentication, real patient delivery, or clinician notification. Do not expose the server beyond localhost or use real patient data.

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
