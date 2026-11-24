# Backend API

The Node.js server listens on port 4174 by default. The React frontend uses
`frontend/src/api/client.js` and its Vite proxy to call these endpoints. Database
connections and Gemini credentials are configured only in `backend/.env`.
POST/PUT bodies are JSON with `Content-Type: application/json`. Errors return
an HTTP error status and `{ "error": "message" }`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Database connectivity and storage type |
| GET | `/api/config` | Public voice availability and supported languages |
| GET | `/api/demo-patients` | Synthetic patient choices |
| GET | `/api/demo-patients/:id/recommendations` | Patient summary and suggestions |
| POST | `/api/recommendations` | Suggestions from structured context |
| POST | `/api/demo-patients/:id/doctor-chat` | Doctor conversation (`message`, `history`) |
| GET, POST | `/api/demo-patients/:id/prescriptions` | List assignments or assign a `formId` |
| GET | `/api/prescriptions/:id` | Assignment details and patient context |
| GET | `/api/form?formId=phq9&language=en` | Core questionnaire |
| GET | `/api/results` | Completed core assessments |
| GET | `/api/results/:id` | Saved core assessment and report |
| GET | `/api/demo-patients/:id/reports` | Patient's core assessment results |
| GET | `/api/analytics/overview` | Aggregate assessment activity |
| GET | `/api/demo-patients/:id/analytics` | Patient activity and score trends |
| GET | `/api/assessment-library` | Imported questionnaire catalogue |
| GET | `/api/assessment-library/:id` | Imported questionnaire, optional `language` query |
| GET, POST | `/api/draft-sessions` | List sessions or create with `draftId`, `mode`, optional `prescriptionId` |
| GET | `/api/draft-sessions/:id` | Saved imported session and report |
| GET | `/api/assessment-details/:id` | Assessment overview, scoring narrative, references, and preview |
| GET | `/api/definitions` | Full definition catalogue |
| GET | `/api/definitions/:id` | Definition, optional `language` query |
| GET, POST | `/api/definition-patients/:id/prescriptions` | Definition assignments; POST accepts `formId` |
| GET | `/api/definition-prescriptions/:id` | Definition assignment details |
| POST | `/api/definition-prescriptions/:id/start` | Start or resume a definition session |
| GET | `/api/definition-sessions/:id/questionnaire` | Session questionnaire, optional `language` query |
| GET, PUT | `/api/definition-sessions/:id` | Load or save answers (`answers`, optional `context`) |
| POST | `/api/definition-sessions/:id/finish` | Review, finalize, and score answers |

The existing `/ws`, `/draft-ws`, and `/definition-ws` WebSocket APIs support
interactive assessments and voice. Core and draft on-screen flows also use
these endpoints to record answers and finalize reports. The frontend forwards
all three through the same backend proxy. Existing validation, review,
confirmation, scoring, and persistence behavior is preserved.

`DATABASE_URL` selects PostgreSQL; without it the backend uses local SQLite.
Assessment definitions and synthetic patient profiles are server-owned JSON.
Assignments, answers, results, and analytics records persist in the database.
