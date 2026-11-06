# PHQ-9 Gemini Live prototype

Standalone Casebook-style conversational prototype for the **Patient Health Questionnaire – Depression (PHQ-9)**. It reuses the architecture of the DASS-21 prototype but has its own code and SQLite file, so it does not modify DASS-21 results.

## What it does

- Uses the nine English PHQ-9 items and the **past two weeks** reference period from the [NovoPsych PHQ-9 form](https://novopsych.com/wp-content/uploads/2023/02/phq-9_assessment.pdf).
- In Live mode, Gemini asks each item, accepts a natural spoken or typed response, may clarify frequency, proposes a 0–3 answer, and waits for confirmation. The application saves only confirmed answers.
- In form-test mode, the person selects 0–3 directly. This works without Gemini.
- Saves nine confirmed answers and brief response summaries in Live mode. Before scoring, it shows all nine selected answers with the four PHQ-9 options so the person can make final corrections.
- When the person clicks **Confirm answers and generate report**, the server saves those corrections together, calculates the total score (0–27) and severity band, and sets a `requiresHumanFollowUp` flag if item 9 is positive. Corrections are recorded in an `answer_revisions` audit table.
- A positive response to item 9 sets `requiresHumanFollowUp` regardless of total score. The result UI calls out the follow-up need.
- Shows a full report only after final review: score, severity band, score scale, and all nine final responses. Saved results reopen the report. The printable view supports **Print / Save as PDF** from the browser.

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

Open <http://127.0.0.1:4174>. The DASS-21 app can continue running on port 4173. To test without a key, click **Try form test**. Run `npm test` for automated checks.

After the ninth answer, review all nine selected options. Change any response, then click **Confirm answers and generate report**. The report then appears on the assessment page. Click **Open printable report**, then **Print / Save as PDF**. You can reopen a past report from **Saved results**. The PDF is a fixed record of the finalized answers. This is an original prototype report inspired by the [NovoPsych sample](https://novopsych.com/wp-content/uploads/2024/10/Patient_Health_Questionnaire_PHQ9_Results_Sample_Report_pdf.pdf); it does not reproduce NovoPsych's percentile calculations or comparison charts.

## Data and limits

The database is `data/prototype.sqlite`. `GET /api/results` lists recent completed assessments; `GET /api/results/{id}` includes individual answers. This local prototype has no authentication or clinician notification. Do not expose the server beyond localhost or use real patient data.

The source form linked above has nine scored items. A functional difficulty question appears in some PHQ-9 formats but is not included in the linked NovoPsych form; it is therefore outside this prototype's scoring flow. Only the verified English version is included. Use approved Hindi or Marathi wording before adding those languages.

**Clinical review is required before patient use.** The PHQ-9 is a screening measure, not a diagnosis. Conversational AI mapping changes the standard self-report administration and has not been validated here. Item 9 is not a complete suicide risk assessment. A positive item 9 answer needs prompt human follow-up under a clinician-approved protocol; this prototype only records and displays a flag. Current danger or intent needs immediate local emergency help. The client must define the actual escalation owner, notification route, and response time before integration.

## Implementation

- `data/phq9.json`: fixed wording, response anchors, provenance.
- `src/assessment.js`: validation and deterministic scoring.
- `src/gemini-bridge.js`: Gemini Live session and propose/confirm/cancel tool flow.
- `src/store.js`: local SQLite schema and persistence.
- `src/server.js`: HTTP and WebSocket server.
- `public/`: Casebook-style browser UI, audio and optional camera capture.
