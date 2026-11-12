import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

test('form-test WebSocket flow allows final review before generating a PHQ-9 report', { timeout: 20000 }, async () => {
  const port = 43000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const root = fileURLToPath(new URL('..', import.meta.url));
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DB_PATH: ':memory:', GEMINI_API_KEY: '' },
    stdio: 'ignore',
  });
  let socket;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null) break;
      try { ready = (await fetch(`${base}/api/health`)).ok; if (ready) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, 'server started');
    const page = await (await fetch(`${base}/`)).text();
    assert.match(page, /PHQ-9/);
    assert.match(page, /recommend\.html/);
    assert.match(page, /report-view\.css/);
    const reportPage = await (await fetch(`${base}/report.html`)).text();
    assert.match(reportPage, /Print \/ Save as PDF/);
    assert.equal((await fetch(`${base}/report.js`)).status, 200);
    assert.equal((await fetch(`${base}/report-view.js`)).status, 200);
    assert.equal((await fetch(`${base}/report.css`)).status, 200);
    assert.equal((await fetch(`${base}/report-view.css`)).status, 200);
    assert.equal((await fetch(`${base}/recommend.html`)).status, 200);
    assert.equal((await fetch(`${base}/recommend.js`)).status, 200);
    const suggestion = await fetch(`${base}/api/recommendations`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ageGroup: '19to64', concerns: ['depression'], traumaExposure: 'notReported', safetyStatus: 'noneReported' }),
    });
    assert.equal(suggestion.status, 200);
    assert.equal((await suggestion.json()).recommendations[0].id, 'phq9');
    const rejected = await fetch(`${base}/api/recommendations`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ageGroup: '19to64', concerns: [], traumaExposure: 'notReported', safetyStatus: 'noneReported', patientId: 'private' }),
    });
    assert.equal(rejected.status, 400);
    const form = await (await fetch(`${base}/api/form`)).json();
    assert.equal(form.questions.length, 9);
    assert.equal(form.referencePeriod, 'Past two weeks');
    const hindiForm = await (await fetch(`${base}/api/form?language=hi`)).json();
    assert.equal(hindiForm.language, 'hi');
    assert.equal(hindiForm.questions.length, 9);
    assert.equal(hindiForm.options[0].label, 'एक भी दिन नहीं');
    assert.equal((await fetch(`${base}/api/form?language=mr`)).status, 400);
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws?mode=demo&language=en`);
    const messages = [];
    const waiters = [];
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (waiters.length) waiters.shift()(message);
      else messages.push(message);
    });
    await once(socket, 'open');
    const next = () => messages.length ? Promise.resolve(messages.shift()) : new Promise((resolve) => waiters.push(resolve));
    assert.equal((await next()).assessment.currentNumber, 1);
    for (let number = 1; number <= 9; number++) {
      socket.send(JSON.stringify({ type: 'select', value: number === 9 ? 1 : 0 }));
      assert.equal((await next()).number, number);
      socket.send(JSON.stringify({ type: 'confirm' }));
      const saved = await next();
      assert.equal(saved.assessment.answers.length, number);
      if (number === 9) {
        assert.equal(saved.assessment.status, 'review');
        assert.equal(saved.assessment.scores, null);
      }
    }
    assert.deepEqual(await (await fetch(`${base}/api/results`)).json(), []);
    const finalValues = [2, 0, 0, 0, 0, 0, 0, 0, 1];
    socket.send(JSON.stringify({ type: 'finalize', answers: finalValues }));
    const finalized = await next();
    assert.equal(finalized.assessment.status, 'completed');
    assert.equal(finalized.assessment.answers[0].value, 2);
    assert.equal(finalized.assessment.scores.rawTotal, 3);
    assert.equal(finalized.assessment.scores.requiresHumanFollowUp, true);
    const results = await (await fetch(`${base}/api/results`)).json();
    assert.equal(results.length, 1);
    assert.equal(results[0].scores.rawTotal, 3);
    const reportData = await (await fetch(`${base}/api/results/${results[0].id}`)).json();
    assert.equal(reportData.answers.length, 9);
    assert.equal(reportData.scores.requiresHumanFollowUp, true);

    socket.close();
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws?mode=demo&language=hi`);
    const hindiMessages = [];
    const hindiWaiters = [];
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (hindiWaiters.length) hindiWaiters.shift()(message);
      else hindiMessages.push(message);
    });
    await once(socket, 'open');
    const nextHindi = () => hindiMessages.length ? Promise.resolve(hindiMessages.shift()) : new Promise((resolve) => hindiWaiters.push(resolve));
    const firstHindi = await nextHindi();
    assert.equal(firstHindi.assessment.language, 'hi');
    assert.equal(firstHindi.question.text, hindiForm.questions[0].text);
    for (let number = 1; number <= 9; number++) {
      socket.send(JSON.stringify({ type: 'select', value: 0 }));
      assert.equal((await nextHindi()).number, number);
      socket.send(JSON.stringify({ type: 'confirm' }));
      assert.equal((await nextHindi()).assessment.answers.length, number);
    }
    socket.send(JSON.stringify({ type: 'finalize', answers: Array(9).fill(0) }));
    const hindiCompleted = await nextHindi();
    assert.equal(hindiCompleted.assessment.status, 'completed');
    assert.equal(hindiCompleted.assessment.language, 'hi');
    assert.equal(hindiCompleted.assessment.scores.rawTotal, 0);
  } finally {
    socket?.close();
    child.kill();
  }
});
