# Sagar functionality in chandrika

Compared with `origin/sagar` at `beffbd13eab40ad889d9ac863379b656dc480c12` on 14 November 2026. The integration adapts features to the patient-first workspace and the current repaired 186-assessment JSON.

| Sagar feature | Chandrika implementation |
| --- | --- |
| Patient history and expandable details | NeuroTwin first patient, four sample patients, add-patient form, expandable history entries and full imported record. |
| Initial assessment recommendation and re-evaluation | Existing automatic Gemini suggestion from the complete catalogue; Refresh suggestions re-evaluates. Uses the verified configurable text model. |
| Doctor consultation and updated suggested assessment | Existing temporary doctor conversation and suggestion cards. The selected suggestion populates the dropdown; manual selection is retained. Structured doctor guidance remains available separately. |
| Searchable assessment catalogue and categories | Category and purpose/name filtering in the prescription dropdown and library. Library previews the exact current questions/options through the workspace API. Select a previewed assessment for the current patient. |
| Voice, direct form and typed responses | Existing Voice, Chat and On-screen modes inside the assessment. Added opt-in browser speech input and read-aloud for On-screen mode. Only a complete unambiguous response label maps automatically; partial/ambiguous input is not saved. |
| Microphone compatibility and resampling | Sagar's continuous 16 kHz resampling correction and a ScriptProcessor fallback when AudioWorklet cannot load. Microphone tracks stop on disconnect. |
| Camera preview and Gemini context | Local preview plus explicit sharing control, enabled only during a connected Voice session. Bounded JPEG frames are streamed only while opted in. Sharing stops on disconnect, pause, review and completion. No image-derived answers or scores. |
| Grouped chat transcription | Streaming chunks share one bubble per speaker/turn. Patient speech is correctly attributed to the patient. |
| English, Hindi, Marathi and Spanish | Spanish added alongside the existing Indian languages. Prepared translations retain question IDs, response values and complete answer labels. |
| Automatic saving and end-of-session review | Existing autosave/review, plus brief Gemini response summaries and an audit of changed answers. Manual corrections replace obsolete summaries. Completed sessions remain locked. |
| Recent results sidebar | Patient context shows the five latest saved sessions with report or resume links. |
| Saved reports and printing | Patient metadata, actual elapsed time, recorded score/descriptors when enabled, response-distribution bars, translated/original questions, full responses, summaries, correction history, HTML download and Print / Save as PDF. |
| Patient analytics and repeat visits | Existing assessment/version/language grouping, visit selection, prior-versus-latest comparison, score trends, date filter, automatic refresh, report links. Added response-distribution charts, summaries and corrections to visit details. |

## Preserved application contracts

- Doctor conversations remain temporary and are not written to the database. Assessment answers, brief response summaries and answer corrections are saved; full transcripts, audio and video are not.
- The active repaired JSON remains the questionnaire source. Missing questionnaire content is not replaced with invented default options. The catalogue lists all 186 records and retains its existing availability restrictions.
- Sagar's generic percentage-based severity bands, estimated population percentiles, fabricated default durations and zero-filled missing answers are not imported. The current JSON disables scoring; its sessions show response analytics. Existing saved, scored definitions retain their recorded results and bands. Specialized subscales/normative charts require reviewed structured scoring data before enabling them here.
- Storage remains the workspace's existing SQLite database and saved definitions remain snapshots. This feature integration does not migrate data into Sagar's PostgreSQL schema or import its additional patient datasets. John plus the four samples remain the initial patient set, as requested earlier.
- Sagar's fallback that defaults to PHQ-9 on insufficient information is not presented as Gemini output. Gemini errors remain explicit; manual selection and separate structured doctor guidance remain available.
- Main and Sagar branches are not modified by this integration. No automatic migration, shared-database write or deployment occurs.

## Verification

Unit/integration coverage checks resampling at 16/44.1/48 kHz, exact translated speech matching, catalogue identity, saved summaries/corrections, locked completed sessions, report escaping, scoring-disabled reports and camera transport guards. Browser checks use synthetic patients, cached test translations, mocked Gemini/WebSocket responses and fake media devices; they exercise the entire selection-to-report flow on desktop/mobile. These checks do not validate clinical suitability or real browser/vendor speech recognition accuracy.
