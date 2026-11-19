# OpenMind Clinical Assessment Suite — Node.js Backend

Node.js, Express & WebSocket streaming backend for the OpenMind Clinical Assessment Suite.

## Features
- **API Endpoints**: Assessment definitions, patient records, prescription lifecycle, and results.
- **WebSocket Streaming**: Gemini Live audio & text streaming for conversational assessment with 42-language support.
- **Database Persistence**: Dual-mode persistence supporting local SQLite (`data/prototype.sqlite`) or PostgreSQL (`DATABASE_URL`).
- **Scoring Engine**: Clinically validated scoring engines for PHQ-9, GAD-7, PCL-5, DASS-21, and 186 library questionnaires.
- **AI Doctor Chat**: Gemini-powered clinical consult for test selection and patient history review.

## Getting Started

### 1. Environment Configuration
Copy `.env.example` to `.env` or `.env.local`:
```bash
cp .env.example .env
```
Provide your `GEMINI_API_KEY` for live voice and AI doctor consultations.

### 2. Start Backend Server
```bash
npm run dev
```
Listens at `http://127.0.0.1:4174`.

### 3. Run Automated Tests
```bash
npm test
```
Runs the complete test suite.
