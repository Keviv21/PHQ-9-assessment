import http from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { languages } from './assessment.js';
import { assessmentQuestion, getAssessmentForm } from './forms.js';
import { openStore } from './store.js';
import { GeminiBridge } from './gemini-bridge.js';
import { recommendAssessments } from './recommendation.js';
import { getDemoPatient, listDemoPatients, suggestForDemoPatient } from './demo-patients.js';
import { getDraftAssessment, getLiveDraftForm, listDraftAssessments } from './draft-library.js';
import { openDraftStore } from './draft-store.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicRoot = join(root, 'public');
const dbPath = process.env.DB_PATH || fileURLToPath(new URL('../data/prototype.sqlite', import.meta.url));
const store = openStore(dbPath);
const draftStore = openDraftStore(dbPath);
const apiKey = process.env.GEMINI_API_KEY?.trim();
const model = process.env.GEMINI_LIVE_MODEL?.trim() || 'gemini-3.8-live';
const port = Number(process.env.PORT || 4174);
const allowedStatic = new Set(['/', '/clinic.html', '/clinic.css', '/clinic-recommend.css', '/clinic.js', '/analytics.css', '/analytics.js', '/openmind-mark.svg', '/index.html', '/assessment.html', '/assessment-polish.css', '/casebook.css', '/app.js', '/i18n.js', '/audio-worklet.js', '/report.html', '/report.js', '/report-view.js', '/report.css', '/report-polish.css', '/report-view.css', '/recommend.html', '/recommend.js', '/patient-suggest.html', '/patient-suggest.js', '/assessment-library.html', '/assessment-library.js', '/assessment-library.css', '/draft-live.html', '/draft-live.js', '/draft-live.css']);
const activeAssessments = new Set();

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
  if (url.pathname === '/api/draft-sessions' && request.method === 'POST') {
    if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: 'Send JSON.' });
    let body = '';
    request.on('data', (chunk) => { body += chunk; if (body.length > 1000) request.destroy(); });
    request.on('end', () => {
      try {
        const { draftId, mode } = JSON.parse(body);
        return json(response, 201, draftStore.create(draftId, mode));
      } catch (error) { return json(response, 400, { error: error.message }); }
    });
    return;
  }
  const patientPrescriptionsRoute = /^\/api\/demo-patients\/(demo-[a-z])\/prescriptions$/.exec(url.pathname);
  if (patientPrescriptionsRoute && request.method === 'POST') {
    if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: 'Send JSON.' });
    let body = '';
    request.on('data', (chunk) => { body += chunk; if (body.length > 1000) request.destroy(); });
    request.on('end', () => {
      let formId;
      try { ({ formId } = JSON.parse(body)); }
      catch { return json(response, 400, { error: 'Choose an assessment.' }); }
      const suggestion = suggestForDemoPatient(patientPrescriptionsRoute[1]);
      if (!suggestion) return json(response, 404, { error: 'Demo patient not found.' });
      if (suggestion.status !== 'suggestions' || !suggestion.prescriptionChoices.some((item) => item.id === formId && item.availability === 'available')) {
        return json(response, 409, { error: 'This assessment cannot be prescribed from the current patient summary.' });
      }
      return json(response, 201, store.prescribe(patientPrescriptionsRoute[1], formId));
    });
    return;
  }
  if (url.pathname === '/api/recommendations') {
    if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
    if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: 'Send JSON.' });
    let body = '';
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 4096) tooLarge = true;
    });
    request.on('end', () => {
      if (tooLarge) return json(response, 413, { error: 'Context is too large. Use only structured fields.' });
      try { return json(response, 200, recommendAssessments(JSON.parse(body))); }
      catch (error) { return json(response, 400, { error: error.message }); }
    });
    return;
  }
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
  if (url.pathname === '/api/health') return json(response, 200, { ok: true });
  if (url.pathname === '/api/draft-sessions') return json(response, 200, draftStore.list());
  if (url.pathname.startsWith('/api/draft-sessions/')) {
    const id = url.pathname.slice('/api/draft-sessions/'.length);
    const state = draftStore.get(id);
    return state ? json(response, 200, state) : json(response, 404, { error: 'Live review session not found.' });
  }
  if (url.pathname === '/api/assessment-library') return json(response, 200, listDraftAssessments());
  if (url.pathname.startsWith('/api/assessment-library/')) {
    let id;
    try { id = decodeURIComponent(url.pathname.slice('/api/assessment-library/'.length)); }
    catch { return json(response, 400, { error: 'Invalid assessment ID.' }); }
    const record = getDraftAssessment(id);
    return record ? json(response, 200, record) : json(response, 404, { error: 'Assessment not found.' });
  }
  if (url.pathname === '/api/demo-patients') return json(response, 200, listDemoPatients());
  if (url.pathname === '/api/analytics/overview') return json(response, 200, store.analyticsOverview());
  const patientAnalyticsRoute = /^\/api\/demo-patients\/(demo-[a-z])\/analytics$/.exec(url.pathname);
  if (patientAnalyticsRoute) {
    return getDemoPatient(patientAnalyticsRoute[1])
      ? json(response, 200, store.patientAnalytics(patientAnalyticsRoute[1]))
      : json(response, 404, { error: 'Demo patient not found.' });
  }
  if (patientPrescriptionsRoute) {
    return getDemoPatient(patientPrescriptionsRoute[1])
      ? json(response, 200, store.patientPrescriptions(patientPrescriptionsRoute[1]))
      : json(response, 404, { error: 'Demo patient not found.' });
  }
  const patientReportsRoute = /^\/api\/demo-patients\/(demo-[a-z])\/reports$/.exec(url.pathname);
  if (patientReportsRoute) {
    return getDemoPatient(patientReportsRoute[1])
      ? json(response, 200, store.patientResults(patientReportsRoute[1]))
      : json(response, 404, { error: 'Demo patient not found.' });
  }
  const prescriptionRoute = /^\/api\/prescriptions\/([0-9a-f-]{36})$/i.exec(url.pathname);
  if (prescriptionRoute) {
    const prescription = store.getPrescription(prescriptionRoute[1]);
    return prescription ? json(response, 200, { ...prescription, patient: getDemoPatient(prescription.demoPatientId) })
      : json(response, 404, { error: 'Prescription not found.' });
  }
  const patientRoute = /^\/api\/demo-patients\/(demo-[a-z])\/recommendations$/.exec(url.pathname);
  if (patientRoute) {
    try {
      const suggestion = suggestForDemoPatient(patientRoute[1], url.searchParams.get('focus') || '');
      return suggestion ? json(response, 200, suggestion) : json(response, 404, { error: 'Demo patient not found.' });
    } catch (error) { return json(response, 400, { error: error.message }); }
  }
  if (url.pathname === '/api/config') {
    return json(response, 200, { geminiConfigured: Boolean(apiKey), model, webcamFrameRate: 1, languages });
  }
  if (url.pathname === '/api/form') {
    let form;
    try { form = getAssessmentForm(url.searchParams.get('formId') || 'phq9', url.searchParams.get('language') || 'en'); }
    catch { return json(response, 400, { error: 'Unsupported assessment language.' }); }
    return json(response, 200, {
      formId: form.formId,
      language: form.language,
      version: form.version,
      title: form.title,
      instructions: form.instructions,
      referencePeriod: form.referencePeriod,
      options: form.options,
      questions: form.questions,
      questionCount: form.questions.length,
      source: form.source,
      scoringSource: form.scoringSource,
    });
  }
  if (url.pathname === '/api/results') return json(response, 200, store.results());
  if (url.pathname.startsWith('/api/results/')) {
    const id = url.pathname.slice('/api/results/'.length);
    const assessment = store.get(id);
    if (!assessment || assessment.status !== 'completed') return json(response, 404, { error: 'Result not found.' });
    return json(response, 200, assessment);
  }
  if (!allowedStatic.has(url.pathname)) return json(response, 404, { error: 'Not found.' });
  const filename = url.pathname === '/' ? 'clinic.html' : url.pathname === '/assessment.html' ? 'index.html' : url.pathname.slice(1);
  const path = join(publicRoot, filename);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
  try {
    const content = readFileSync(path);
    response.writeHead(200, {
      'content-type': `${types[extname(path)] || 'application/octet-stream'}; charset=utf-8`,
      'cache-control': 'no-store',
    });
    response.end(content);
  } catch {
    json(response, 404, { error: 'File not found.' });
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 300_000 });
wss.on('connection', (socket, request) => {
  const origin = request.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
    socket.close(1008, 'Unexpected origin.');
    return;
  }
  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
  const mode = url.searchParams.get('mode');
  const language = url.searchParams.get('language') || 'en';
  const prescriptionId = url.searchParams.get('prescriptionId') || '';
  const prescription = store.getPrescription(prescriptionId);
  const demoPatientId = prescription?.demoPatientId || null;
  const formId = prescription?.formId || null;
  let form;
  try { form = getAssessmentForm(formId, language); }
  catch { socket.close(1008, 'Unsupported assessment language.'); return; }
  if (!['demo', 'live'].includes(mode)) {
    socket.close(1008, 'Choose demo or live mode.');
    return;
  }
  if (!demoPatientId) {
    socket.close(1008, 'A valid prescription is required before starting PHQ-9.');
    return;
  }
  const suggestion = suggestForDemoPatient(demoPatientId);
  if (!suggestion || suggestion.status !== 'suggestions' ||
      !suggestion.prescriptionChoices.some((item) => item.id === formId && item.availability === 'available')) {
    socket.close(1008, 'This assessment is not available for this demo patient.');
    return;
  }
  if (mode === 'live' && !apiKey) {
    socket.send(JSON.stringify({ type: 'error', message: 'Set GEMINI_API_KEY in .env before live mode.' }));
    socket.close(1008, 'Gemini API key missing.');
    return;
  }

  const requestedId = url.searchParams.get('assessmentId');
  if (requestedId && requestedId !== prescription.assessmentId) {
    socket.close(1008, 'Assessment does not belong to this prescription.');
    return;
  }
  const assessment = requestedId ? store.get(requestedId) : store.startPrescription(prescriptionId, mode, language);
  if (!assessment || assessment.formId !== formId || assessment.mode !== mode || assessment.language !== language || assessment.demoPatientId !== demoPatientId || assessment.status === 'completed' || activeAssessments.has(assessment.id)) {
    socket.close(1008, 'Assessment cannot be resumed.');
    return;
  }
  activeAssessments.add(assessment.id);
  let pending = null;
  let lastVideoAt = 0;
  let bridge = null;

  function send(message) {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  }

  function sendState(state) {
    send({
      type: 'state',
      assessment: state,
      question: assessmentQuestion(formId, state.currentNumber, language),
    });
  }

  sendState(assessment);
  if (mode === 'live') {
    bridge = new GeminiBridge({ apiKey, model, socket, store, assessmentId: assessment.id, formId, language, onState: sendState });
    bridge.start().catch((error) => send({ type: 'error', message: error.message }));
  }

  socket.on('message', (payload, isBinary) => {
    try {
      if (isBinary) {
        if (mode !== 'live' || !bridge || payload.length < 3) return;
        const kind = payload[0];
        const data = payload.subarray(1);
        if (kind === 1 && data.length % 2 === 0) bridge.sendAudio(data);
        if (kind === 2 && data[0] === 0xff && data[1] === 0xd8 &&
            data.at(-2) === 0xff && data.at(-1) === 0xd9 && Date.now() - lastVideoAt >= 950) {
          lastVideoAt = Date.now();
          bridge.sendVideo(data);
        }
        return;
      }

      const message = JSON.parse(payload.toString('utf8'));
      if (message.type === 'select') {
        if (bridge) throw new Error('Answer in your own words in Live mode.');
        else {
          const state = store.get(assessment.id);
          if (state.status !== 'in_progress') throw new Error('Assessment is completed.');
          if (!Number.isInteger(message.value) || message.value < 0 || message.value >= form.options.length) throw new Error(`Choose a value from 0 to ${form.options.length - 1}.`);
          pending = { number: state.currentNumber, value: message.value };
          send({ type: 'proposal', number: pending.number, value: pending.value, label: form.options[pending.value].label });
        }
      } else if (message.type === 'say') {
        if (!bridge) throw new Error('Text conversation requires Live mode.');
        if (store.get(assessment.id)?.status !== 'in_progress') throw new Error('Review the answers on screen.');
        bridge.sendText(message.text);
      } else if (message.type === 'confirm') {
        if (bridge) {
          const result = bridge.confirm();
          if (!result.accepted) throw new Error(result.error);
          bridge.afterConfirmation(result);
        } else {
          if (!pending) throw new Error('Select an answer first.');
          const state = store.record(assessment.id, pending.number, pending.value, 'demo');
          pending = null;
          sendState(state);
        }
      } else if (message.type === 'cancel') {
        if (bridge) { bridge.cancel(); bridge.afterCancellation(); }
        else { pending = null; send({ type: 'proposal_cleared' }); }
      } else if (message.type === 'finalize') {
        const state = store.finalize(assessment.id, message.answers);
        sendState(state);
        bridge?.stop();
      } else {
        throw new Error('Unknown message type.');
      }
    } catch (error) {
      send({ type: 'error', message: error.message });
    }
  });

  socket.on('close', () => {
    activeAssessments.delete(assessment.id);
    bridge?.stop();
  });
});

const draftWss = new WebSocketServer({ noServer: true, maxPayload: 300_000 });
server.on('upgrade', (request, socket, head) => {
  let pathname;
  try { pathname = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`).pathname; }
  catch { socket.destroy(); return; }
  const target = pathname === '/ws' ? wss : pathname === '/draft-ws' ? draftWss : null;
  if (!target) { socket.destroy(); return; }
  target.handleUpgrade(request, socket, head, (client) => target.emit('connection', client, request));
});
const activeDraftSessions = new Set();
draftWss.on('connection', (socket, request) => {
  const origin = request.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
    socket.close(1008, 'Unexpected origin.');
    return;
  }
  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
  const sessionId = url.searchParams.get('sessionId') || '';
  const draft = draftStore.get(sessionId);
  const form = draft && getLiveDraftForm(draft.formId);
  if (!draft || !form || draft.status === 'completed' || activeDraftSessions.has(sessionId)) {
    socket.close(1008, 'Live review session is unavailable.');
    return;
  }
  if (draft.mode === 'live' && draft.status === 'in_progress' && !apiKey) {
    socket.close(1008, 'Gemini Live is not configured.');
    return;
  }
  activeDraftSessions.add(sessionId);
  let pending = null;
  let bridge = null;
  let lastVideoAt = 0;
  const bridgeStore = { get: (id) => draftStore.get(id), record: (...args) => draftStore.record(...args) };

  function send(message) {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  }
  function sendState(state) {
    send({ type: 'state', assessment: state,
      question: state.currentNumber ? { number: state.currentNumber, total: form.questions.length, ...form.questions[state.currentNumber - 1] } : null });
  }

  sendState(draft);
  if (draft.mode === 'live' && draft.status === 'in_progress') {
    bridge = new GeminiBridge({ apiKey, model, socket, store: bridgeStore, assessmentId: sessionId,
      formId: form.formId, language: 'en', formOverride: form, onState: sendState });
    bridge.start().catch((error) => send({ type: 'error', message: error.message }));
  }

  socket.on('message', (payload, isBinary) => {
    try {
      if (isBinary) {
        if (!bridge || payload.length < 3) return;
        const kind = payload[0];
        const data = payload.subarray(1);
        if (kind === 1 && data.length % 2 === 0) bridge.sendAudio(data);
        if (kind === 2 && data[0] === 0xff && data[1] === 0xd8 && data.at(-2) === 0xff &&
            data.at(-1) === 0xd9 && Date.now() - lastVideoAt >= 950) {
          lastVideoAt = Date.now();
          bridge.sendVideo(data);
        }
        return;
      }
      const message = JSON.parse(payload.toString('utf8'));
      if (message.type === 'select') {
        if (draft.mode !== 'demo') throw new Error('Describe your answer during the live conversation.');
        const state = draftStore.get(sessionId);
        if (state.status !== 'in_progress') throw new Error('Review the answers on screen.');
        const options = form.questions[state.currentNumber - 1].options;
        if (!Number.isInteger(message.value) || message.value < 0 || message.value >= options.length) throw new RangeError('Choose an available option.');
        pending = { number: state.currentNumber, value: message.value };
        send({ type: 'proposal', number: pending.number, value: pending.value, label: options[pending.value].label });
      } else if (message.type === 'say') {
        if (!bridge) throw new Error('Text conversation requires Gemini Live.');
        if (draftStore.get(sessionId)?.status !== 'in_progress') throw new Error('Review the answers on screen.');
        bridge.sendText(message.text);
      } else if (message.type === 'confirm') {
        if (bridge) {
          const result = bridge.confirm();
          if (!result.accepted) throw new Error(result.error);
          bridge.afterConfirmation(result);
        } else {
          if (!pending) throw new Error('Choose an answer first.');
          const state = draftStore.record(sessionId, pending.number, pending.value, 'demo');
          pending = null;
          sendState(state);
        }
      } else if (message.type === 'cancel') {
        if (bridge) { bridge.cancel(); bridge.afterCancellation(); }
        else { pending = null; send({ type: 'proposal_cleared' }); }
      } else if (message.type === 'finalize') {
        const state = draftStore.finalize(sessionId, message.answers);
        sendState(state);
        bridge?.stop();
      } else throw new Error('Unknown message type.');
    } catch (error) { send({ type: 'error', message: error.message }); }
  });
  socket.on('close', () => { activeDraftSessions.delete(sessionId); bridge?.stop(); });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`OpenMind assessments: http://127.0.0.1:${port}`);
  console.log(`Voice assessment: ${apiKey ? 'ready' : 'unavailable; on-screen assessment available'}`);
  console.log(`SQLite database: ${dbPath}`);
});

function shutdown() {
  for (const client of wss.clients) client.close();
  for (const client of draftWss.clients) client.close();
  wss.close();
  draftWss.close();
  server.close(() => { store.close(); draftStore.close(); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
