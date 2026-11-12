import http from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { currentQuestion, getForm, languages } from './assessment.js';
import { openStore } from './store.js';
import { GeminiBridge } from './gemini-bridge.js';
import { recommendAssessments } from './recommendation.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicRoot = join(root, 'public');
const dbPath = process.env.DB_PATH || fileURLToPath(new URL('../data/prototype.sqlite', import.meta.url));
const store = openStore(dbPath);
const apiKey = process.env.GEMINI_API_KEY?.trim();
const model = process.env.GEMINI_LIVE_MODEL?.trim() || 'gemini-3.8-live';
const port = Number(process.env.PORT || 4174);
const allowedStatic = new Set(['/', '/index.html', '/casebook.css', '/app.js', '/i18n.js', '/audio-worklet.js', '/report.html', '/report.js', '/report-view.js', '/report.css', '/report-view.css', '/recommend.html', '/recommend.js']);
const activeAssessments = new Set();

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
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
  if (url.pathname === '/api/config') {
    return json(response, 200, { geminiConfigured: Boolean(apiKey), model, webcamFrameRate: 1, languages });
  }
  if (url.pathname === '/api/form') {
    let form;
    try { form = getForm(url.searchParams.get('language') || 'en'); }
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
  const path = join(publicRoot, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
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

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 300_000 });
wss.on('connection', (socket, request) => {
  const origin = request.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
    socket.close(1008, 'Unexpected origin.');
    return;
  }
  const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
  const mode = url.searchParams.get('mode');
  const language = url.searchParams.get('language') || 'en';
  let form;
  try { form = getForm(language); }
  catch { socket.close(1008, 'Unsupported assessment language.'); return; }
  if (!['demo', 'live'].includes(mode)) {
    socket.close(1008, 'Choose demo or live mode.');
    return;
  }
  if (mode === 'live' && !apiKey) {
    socket.send(JSON.stringify({ type: 'error', message: 'Set GEMINI_API_KEY in .env before live mode.' }));
    socket.close(1008, 'Gemini API key missing.');
    return;
  }

  const requestedId = url.searchParams.get('assessmentId');
  const assessment = requestedId ? store.get(requestedId) : store.create(mode, language);
  if (!assessment || assessment.mode !== mode || assessment.language !== language || assessment.status === 'completed' || activeAssessments.has(assessment.id)) {
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
      question: currentQuestion(state.currentNumber, language),
    });
  }

  sendState(assessment);
  if (mode === 'live') {
    bridge = new GeminiBridge({ apiKey, model, socket, store, assessmentId: assessment.id, language, onState: sendState });
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
          if (!Number.isInteger(message.value) || message.value < 0 || message.value > 3) throw new Error('Choose 0, 1, 2, or 3.');
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

server.listen(port, '127.0.0.1', () => {
  console.log(`PHQ-9 prototype: http://127.0.0.1:${port}`);
  console.log(`Gemini Live: ${apiKey ? 'configured' : 'not configured; demo mode available'}`);
  console.log(`SQLite database: ${dbPath}`);
});

function shutdown() {
  for (const client of wss.clients) client.close();
  wss.close();
  server.close(() => store.close());
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
