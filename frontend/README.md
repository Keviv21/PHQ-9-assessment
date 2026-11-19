# OpenMind Clinical Assessment Suite — React Frontend

Modern React application built with Vite for the OpenMind Clinical Assessment Suite.

## Features
- **Clinic Dashboard**: Patient selection, AI doctor consult, and 186-test catalog search.
- **Interactive Live Assessment**: Voice & text assessment modes, real-time 42-language switching, 0–3 scored cards, and final answer review.
- **Clinical Reports**: Automated scoring, severity bands, item audits, and critical safety warnings (suicide risk escalation).
- **Analytics View**: Longitudinal patient progress and cross-test score trends.

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Vite Dev Server
```bash
npm run dev
```
Runs at `http://localhost:3000` with live API and WebSocket proxying to the Node.js backend at port `4174`.

### 3. Production Build
```bash
npm run build
```
Generates production-ready assets in `dist/`.
