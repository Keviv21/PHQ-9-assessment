# Deploy the dev branch to Vercel

This is a plain JavaScript frontend and a Node.js HTTP/WebSocket backend. It is
not a Vite or Next.js app. `npm run build` checks JavaScript, assessment bundles,
and local asset references, then copies the frontend to `dist/`. Vercel bundles
`api/server.js` separately using the Node.js runtime.

## Project settings

- Import this repository and select the `dev` branch. To serve `dev` as the
  production deployment, set **Production Branch** to `dev` in Vercel's Git settings.
- Root directory: repository root.
- Framework preset: **Other**.
- Node.js: **24.x**, pinned in `package.json`.
- Build command: `npm run build`.
- Output directory: `dist`.
- Install command: `npm ci`.
- Enable **Fluid compute** for WebSockets.

`vercel.json` configures the frontend routes, the HTTP API, all three WebSocket
paths, the questionnaire JSON files required at runtime, and a 300-second function
duration. Keep this file in the repository. Do not deploy only the `dist` folder:
the backend must be built from the repository too.

## Environment variables

Set these in **both Preview and Production** before building:

| Name | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Persistent PostgreSQL connection string with `sslmode=verify-full`. Prefer the database provider's pooled endpoint. |
| `GEMINI_API_KEY` | For voice and Doctor conversation | Your server-side Gemini key. |
| `GEMINI_LIVE_MODEL` | Optional | An available live model; the tested default is `gemini-3.8-live`. |
| `GEMINI_TEXT_MODEL` | Optional | An available text model; the tested default is `gemini-3.5-flash-lite`. |

Never prefix the Gemini key with a frontend/public environment variable prefix.
Local `.env` files are excluded from deployment uploads. Do not set `DB_PATH` or
`PORT` on Vercel. Missing PostgreSQL configuration fails the build and startup
instead of saving answers in a temporary SQLite file. The database role must be
able to create and use tables in `pod_assessment_prototype`. Simultaneous cold
starts serialize schema initialization with a PostgreSQL advisory lock.

Use a separate database for Preview if preview submissions must not appear in
Production. Local SQLite records are not automatically copied to PostgreSQL.

## Validate before promoting

```bash
npm ci
npm run build
npm test
```

For the local PostgreSQL configuration, the available smoke checks are:

```bash
npm run db:check
npm run db:smoke
npm run db:smoke:definitions
npm run smoke:doctor
npm run smoke:definition-live
```

The database smoke checks create temporary synthetic records and remove them
afterwards. The Gemini smoke checks call the configured paid API.

Create a protected Preview deployment and verify the deployed runtime:

1. Open `/`; confirm the clinic loads. `/assessment.html` must open the assessment
   screen, and JavaScript and CSS requests must return 200.
2. Open `/api/health`; expect `ok: true` and `database: "postgresql"`.
3. Prescribe PHQ-9, answer on screen, disconnect and resume, review, and save.
   Confirm the completed report and analytics entry remain after a reload.
4. Assign an imported catalogue form; complete it on screen and open its report.
5. Test Doctor conversation and voice over HTTPS with microphone permission.
   Check that `/ws`, `/draft-ws`, and `/definition-ws` can upgrade on the deployed
   hostname. The local tests do not exercise Vercel's proxy or account settings.
6. Leave a session open beyond five minutes, then use the resume controls or
   continue on screen. Vercel closes WebSockets at the function duration limit;
   confirmed answers persist in PostgreSQL, while an unconfirmed proposal must
   be answered again. Voice conversation history is not restored across sessions.
7. Check Vercel function logs for startup, database, or Gemini errors before
   promoting the deployment.

## Access and production scope

This application still has no clinician login, authorization checks, or clinical
escalation integration. Keep the deployment protected and use synthetic patient
data. Vercel hosting does not make the prototype suitable for real patient use.
Its in-memory connection sets prevent duplicate sessions only within one running
instance; they are not distributed session locks across scaled instances.

## Vercel CLI

```bash
npx vercel login
npx vercel link
npx vercel pull --environment=preview
npx vercel build
npx vercel deploy --prebuilt
```

The cloud build and Preview checks require a valid Vercel login and project link.
A successful local `npm run build` does not verify those account settings or the
deployed runtime. Promote only after the Preview checks above pass.

References: [WebSockets and duration limits](https://vercel.com/docs/functions/websockets),
[Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions),
[Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json).
