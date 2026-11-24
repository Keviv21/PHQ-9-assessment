# Conversational assessment application

This repository contains a React/Vite frontend and a Node.js backend for a standalone assessment demonstration. It is not connected to the Casebook backend. Sample patients are synthetic.

## Applications

- [Frontend](frontend/README.md): clinician and participant screens, assessment library, voice controls, reports, and analytics.
- [Backend](backend/README.md): APIs, Gemini integration, scoring, PostgreSQL/SQLite storage, and content import.
- [Architecture](backend/docs/PROTOTYPE_ARCHITECTURE.md) and [API reference](backend/docs/API.md).

## Start locally

Use Node.js 24 or newer. Open two terminals in this repository:

```powershell
cd backend
npm ci
# On a fresh clone, copy .env.example to .env and configure it.
npm run db:import-content
npm start
```

```powershell
cd frontend
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The frontend proxies API and WebSocket traffic to the backend at http://127.0.0.1:4174. If environment files exist in the old repository root, copy them into backend/ first; never commit them.

The one-time import reads backend/data/all-assessments.json and backend/data/demo-patients.json into the content database. At runtime the backend loads 186 assessment definitions and five sample patients from the database, while prescriptions, answers, and results are stored separately. Set DATABASE_URL in backend/.env for PostgreSQL with sslmode=verify-full; otherwise local SQLite is used. Restart the backend after publishing new content.

Run npm test from each application folder. See the [deployment guide](backend/docs/VERCEL_DEPLOYMENT.md) for separate frontend and backend hosting.

This demonstration has no production authentication, Casebook patient API, or clinical escalation integration. Use synthetic or de-identified data.
