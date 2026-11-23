# Deploy the separated applications

The React frontend and Node.js backend are now independent applications.

## Frontend

Use `frontend` as the project root, install with `npm ci`, build with `npm run build`, and publish `dist`. `frontend/vercel.json` configures Vite and the React route fallback. Set `VITE_API_BASE_URL` to the public backend origin before building. This value is public; do not put database or Gemini credentials here.

## Backend

Run `npm ci` and `npm start` from `backend` on a Node.js 24+ host. Configure `DATABASE_URL`, `GEMINI_API_KEY` if needed, and `FRONTEND_ORIGINS` with the exact frontend origin. Set `HOST=0.0.0.0` and the host's required `PORT` when deploying in a container.

Use a host and reverse proxy that support persistent WebSocket connections for `/ws`, `/draft-ws`, and `/definition-ws`. The optional `backend/api/server.js` adapter and `backend/vercel.json` preserve a serverless HTTP deployment entry point. Verify WebSocket support on the chosen platform before using it for interactive assessments.

PostgreSQL requires `sslmode=verify-full`. The backend initializes the existing `pod_assessment_prototype` schema. Local environment files and SQLite files must remain excluded from deployment uploads.

## Local checks

Inside `frontend/`, run `npm run build` and `npm test`. Inside `backend/`, run `npm run check`, `npm test`, and `npm run db:check` to verify the configured PostgreSQL connection. A successful local build does not verify a remote deployment.

The application remains a demonstration using synthetic patients and has no production authentication or Casebook integration.
