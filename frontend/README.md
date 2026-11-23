# OpenMind React frontend

Use Node.js 24 or newer. Run these commands inside `frontend/`:

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173. In a separate terminal, run `npm install` and `npm start` inside `backend/`. Both services must be running.

The existing UI layout, styles, and behavior are preserved. React renders the pages and the shared API client calls the Node.js backend. Vite proxies HTTP APIs and voice WebSockets to http://127.0.0.1:4174.

Optional proxy configuration belongs in `.env.local`; see `.env.example`. Database and provider credentials belong only in the backend.

```bash
npm run build
npm run preview
npm test
```

See the [project guide](../backend/README.md) and [API reference](../backend/docs/API.md).
