import assert from 'node:assert/strict';
import pg from 'pg';
import WebSocket from 'ws';

const port = Number(process.env.PORT || 4174);
const base = `http://127.0.0.1:${port}`;
const prescriptionIds = [];
const sessionIds = [];
let socket;

function messages(connection) {
  const queue = [];
  let resolver;
  connection.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (resolver) { const resolve = resolver; resolver = null; resolve(message); }
    else queue.push(message);
  });
  return async () => {
    const message = queue.length ? queue.shift() : await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for assessment response.')), 20000);
      resolver = (value) => { clearTimeout(timer); resolve(value); };
    });
    if (message.type === 'error') throw new Error(message.message);
    return message;
  };
}

async function prescribe(formId) {
  const response = await fetch(`${base}/api/demo-patients/demo-a/prescriptions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ formId }),
  });
  assert.equal(response.status, 201, `Could not prescribe ${formId}`);
  const record = await response.json();
  prescriptionIds.push(record.id);
  return record;
}

async function finishOnScreen(url, count) {
  socket = new WebSocket(url);
  const next = messages(socket);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let message = await next();
  assert.equal(message.assessment.currentNumber, 1);
  for (let number = 1; number <= count; number++) {
    socket.send(JSON.stringify({ type: 'select', value: 0 }));
    message = await next();
    assert.equal(message.type, 'proposal');
    socket.send(JSON.stringify({ type: 'confirm' }));
    message = await next();
    assert.equal(message.assessment.answers.length, number);
  }
  assert.equal(message.assessment.status, 'review');
  socket.send(JSON.stringify({ type: 'finalize', answers: Array(count).fill(0) }));
  message = await next();
  assert.equal(message.assessment.status, 'completed');
  sessionIds.push(message.assessment.id);
  socket.close();
  socket = null;
  return message.assessment;
}

try {
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.database, 'postgresql');

  const scoredPrescription = await prescribe('phq9');
  const scored = await finishOnScreen(`ws://127.0.0.1:${port}/ws?mode=demo&language=en&prescriptionId=${scoredPrescription.id}`, 9);
  assert.equal(scored.scores.rawTotal, 0);
  const report = await (await fetch(`${base}/api/results/${scored.id}`)).json();
  assert.equal(report.scores.rawTotal, 0);

  const draftId = 'brief-resilience-scale--cc5d54b07df8';
  const form = await (await fetch(`${base}/api/assessment-library/${draftId}`)).json();
  const draftPrescription = await prescribe(`draft:${draftId}`);
  const created = await fetch(`${base}/api/draft-sessions`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prescriptionId: draftPrescription.id, mode: 'demo' }) });
  assert.equal(created.status, 201);
  const draft = await created.json();
  sessionIds.push(draft.id);
  const completed = await finishOnScreen(`ws://127.0.0.1:${port}/draft-ws?sessionId=${draft.id}`, form.questions.length);
  assert.equal(completed.scores, null);
  assert.equal((await (await fetch(`${base}/api/draft-sessions/${draft.id}`)).json()).status, 'completed');
  console.log('Neon-backed HTTP and WebSocket flows verified for scored and answer-only assessments.');
} finally {
  socket?.close();
  const cleanup = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
  cleanup.on('error', (error) => console.error('PostgreSQL cleanup connection lost:', error.code || error.message));
  try {
    await cleanup.connect();
    await cleanup.query('BEGIN');
    const linked = await cleanup.query('SELECT session_id FROM pod_assessment_prototype.prescriptions WHERE id = ANY($1::uuid[])', [prescriptionIds]);
    const createdSessionIds = [...new Set([...sessionIds, ...linked.rows.map((row) => row.session_id).filter(Boolean)])];
    await cleanup.query('DELETE FROM pod_assessment_prototype.prescriptions WHERE id = ANY($1::uuid[])', [prescriptionIds]);
    await cleanup.query('DELETE FROM pod_assessment_prototype.sessions WHERE id = ANY($1::uuid[])', [createdSessionIds]);
    await cleanup.query('COMMIT');
    console.log('Temporary API smoke-check records removed.');
  } finally { await cleanup.end(); }
}
