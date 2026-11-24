import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { getCatalogEntry } from '../src/assessment-catalog.js';

test('imported questionnaire supports a saved unscored WebSocket session', { timeout: 20000 }, async () => {
  const port = 45000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: '', ALLOW_SQLITE_TEST_BACKEND: 'true', PORT: String(port), DB_PATH: ':memory:', GEMINI_API_KEY: '' },
    stdio: 'ignore',
  });
  let socket;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { ready = (await fetch(`${base}/api/health`)).ok; if (ready) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true);
    assert.equal((await fetch(`${base}/draft-live.html`)).status, 200);
    assert.equal((await fetch(`${base}/draft-live.js`)).status, 200);
    const catalogue = await (await fetch(`${base}/api/assessment-library`)).json();
    const selected = catalogue.find((item) => item.title === 'Flourishing Scale (FS)');
    assert.equal(selected.previewAvailable, true);
    const form = await (await fetch(`${base}/api/assessment-library/${encodeURIComponent(selected.id)}`)).json();
    const createdResponse = await fetch(`${base}/api/draft-sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftId: selected.id, mode: 'demo' }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.formId, selected.id);
    assert.equal(created.scores, null);
    socket = new WebSocket(`ws://127.0.0.1:${port}/draft-ws?sessionId=${created.id}`);
    const queue = [];
    const waiters = [];
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (waiters.length) waiters.shift()(message);
      else queue.push(message);
    });
    const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => waiters.push(resolve));
    await once(socket, 'open');
    assert.equal((await next()).assessment.currentNumber, 1);
    for (let number = 1; number <= form.questions.length; number++) {
      socket.send(JSON.stringify({ type: 'select', value: 0 }));
      assert.equal((await next()).type, 'proposal');
      socket.send(JSON.stringify({ type: 'confirm' }));
      const state = await next();
      assert.equal(state.assessment.answers.length, number);
      assert.equal(state.assessment.status, number === form.questions.length ? 'review' : 'in_progress');
    }
    const finalValues = form.questions.map(() => 0);
    finalValues[0] = 1;
    socket.send(JSON.stringify({ type: 'finalize', answers: finalValues }));
    const final = await next();
    assert.equal(final.assessment.status, 'completed');
    assert.equal(final.assessment.scores, null);
    assert.equal(final.assessment.answers[0].value, 1);
    const saved = await (await fetch(`${base}/api/draft-sessions/${created.id}`)).json();
    assert.equal(saved.reviewChangeCount, 1);
    assert.equal(saved.scores, null);
    const assignmentResponse = await fetch(`${base}/api/demo-patients/demo-a/prescriptions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ formId: `draft:${selected.id}` }),
    });
    assert.equal(assignmentResponse.status, 201);
    const assignment = await assignmentResponse.json();
    assert.equal(assignment.kind, 'draft');
    assert.equal(assignment.status, 'assigned');
    const linked = await fetch(`${base}/api/draft-sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prescriptionId: assignment.id, mode: 'demo' }),
    });
    assert.equal(linked.status, 201);
    const linkedSession = await linked.json();
    assert.equal(linkedSession.demoPatientId, 'demo-a');
    assert.equal(linkedSession.prescriptionId, assignment.id);
    assert.equal((await (await fetch(`${base}/api/prescriptions/${assignment.id}`)).json()).assessmentId, linkedSession.id);
    assert.equal((await (await fetch(`${base}/api/demo-patients/demo-a/prescriptions`)).json())[0].kind, 'draft');
    const overview = await (await fetch(`${base}/api/analytics/overview`)).json();
    assert.equal(overview.totals.prescribed, 1);
    assert.equal(overview.byForm.find((item) => item.formId === `draft:${selected.id}`).prescribed, 1);
    const blocked = catalogue.find((item) => !item.previewAvailable);
    const blockedResponse = await fetch(`${base}/api/demo-patients/demo-a/prescriptions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ formId: `draft:${blocked.id}` }),
    });
    assert.equal(blockedResponse.status, 409);
    const duplicateResponse = await fetch(`${base}/api/demo-patients/demo-a/prescriptions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ formId: `draft:${getCatalogEntry('phq9').catalogDraftId}` }),
    });
    assert.equal(duplicateResponse.status, 409);
  } finally {
    socket?.close();
    child.kill();
  }
});
