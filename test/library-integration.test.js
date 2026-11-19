import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('exported library completes PHQ-9 and descriptive reports with saved visit history', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'assessment-http-'));
  const port = 46000 + Math.floor(Math.random() * 2000), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: '', DB_PATH: join(directory, 'test.sqlite'), PORT: String(port), GEMINI_API_KEY: '',
      ASSESSMENT_LIBRARY_FILE: 'data/assessment-library.json', ASSESSMENT_DRAFT_SCORES: 'true',
      REPORT_CHROMIUM_PATH: process.env.TEST_REPORT_CHROMIUM_PATH || '' },
  });
  let log = ''; child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
  const api = async (path, method = 'GET', body) => {
    const response = await fetch(base + path, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    assert.ok(response.ok, `${path}: ${response.status}`); return response.json();
  };
  try {
    let ready = false;
    for (let n = 0; n < 100; n++) {
      try { ready = (await fetch(base + '/api/health')).ok; if (ready) break; } catch {}
      if (child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, log);
    assert.equal((await fetch(base + '/definition-information.js')).status, 200);
    const definitions = await api('/api/definitions');
    assert.equal(definitions.length, 186);
    assert.ok(definitions.every(d => d.versionId && d.title));
    assert.doesNotMatch(definitions.map(d => d.title + d.description).join(' '), /novopsych/i);
    const phq = definitions.find(d => d.id.startsWith('patient-health-questionnaire-depression-phq-9'));
    const form = await api(`/api/definitions/${phq.id}`);
    assert.ok(form.sections.length); assert.ok(form.reporting.metrics.length);
    assert.doesNotMatch(JSON.stringify(form), /archive_path|\/home\/|source_provider/);
    async function complete(definition, high = false) {
      const prescription = await api('/api/definition-patients/demo-a/prescriptions', 'POST', { formId: definition.id });
      const session = await api(`/api/definition-prescriptions/${prescription.id}/start`, 'POST', {});
      assert.equal((await fetch(`${base}/api/definition-sessions/${session.id}/report.html`)).status, 409);
      const answers = Object.fromEntries(session.formSnapshot.questions.map(q => [q.id,
        q.responseType === 'multiple_choice' ? [q.options[0].id] : q.options.length ? q.options[high ? q.options.length - 1 : 0].id : q.inputSpec?.answer_schema?.minimum ?? 0]));
      return api(`/api/definition-sessions/${session.id}/finish`, 'POST', { answers });
    }
    const first = await complete(phq), second = await complete(phq, true);
    assert.equal(first.scores.metrics[0].value, 0);
    assert.equal(second.scores.metrics[0].value, 27);
    assert.equal(second.scores.metrics[0].band, null);
    const report = await api(`/api/definition-sessions/${second.id}/report.json`);
    assert.equal(report.metrics[0].previousChange, 27);
    assert.equal(report.responses.length, 9); assert.equal(report.visits.length, 2);
    const html = await (await fetch(`${base}/api/definition-sessions/${second.id}/report.html`)).text();
    assert.match(html, /Draft score/); assert.match(html, /<svg/); assert.doesNotMatch(html, /novopsych/i);
    const lec = definitions.find(d => d.id.startsWith('life-events-checklist-5'));
    const descriptive = await complete(lec);
    const descriptiveReport = await api(`/api/definition-sessions/${descriptive.id}/report.json`);
    assert.equal(descriptiveReport.mode, 'descriptive_responses'); assert.equal(descriptiveReport.metrics.length, 0);
    assert.equal(descriptiveReport.responses.length, 17);
    const analytics = await api('/api/demo-patients/demo-a/analytics');
    assert.equal(analytics.totalCompleted, 3);
    assert.equal(analytics.series.find(s => s.formId === `definition:${phq.id}`).points.length, 2);
    assert.equal((await fetch(`${base}/api/assessment-assets/${'0'.repeat(64)}/A1`)).status, 404);
    if (process.env.TEST_REPORT_CHROMIUM_PATH) {
      const pdf = await fetch(`${base}/api/definition-sessions/${second.id}/report.pdf`);
      assert.equal(pdf.status, 200);
      assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    }
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await rm(directory, { recursive: true, force: true });
  }
});
