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
    assert.match(page, /Assessments/);
    assert.match(page, /Prescribe Test/);
    assert.match(page, /View Test Reports/);
    assert.match(page, /clinic\.js/);
    assert.equal((await fetch(`${base}/clinic.css`)).status, 200);
    assert.equal((await fetch(`${base}/clinic-recommend.css`)).status, 200);
    assert.equal((await fetch(`${base}/clinic.js`)).status, 200);
    assert.equal((await fetch(`${base}/analytics.js`)).status, 200);
    assert.equal((await fetch(`${base}/analytics.css`)).status, 200);
    assert.match(page, /Assessment Analytics/);
    const emptyOverview = await (await fetch(`${base}/api/analytics/overview`)).json();
    assert.equal(emptyOverview.totals.prescribed, 0);
    assert.equal(emptyOverview.totals.completionRate, null);
    assert.equal((await fetch(`${base}/api/demo-patients/demo-z/analytics`)).status, 404);
    const assessmentPage = await (await fetch(`${base}/assessment.html`)).text();
    assert.match(assessmentPage, /PHQ-9/);
    assert.match(assessmentPage, /report-view\.css/);
    const reportPage = await (await fetch(`${base}/report.html`)).text();
    assert.match(reportPage, /Print \/ Save as PDF/);
    assert.equal((await fetch(`${base}/report.js`)).status, 200);
    assert.equal((await fetch(`${base}/report-view.js`)).status, 200);
    assert.equal((await fetch(`${base}/report.css`)).status, 200);
    assert.equal((await fetch(`${base}/report-view.css`)).status, 200);
    assert.equal((await fetch(`${base}/recommend.html`)).status, 200);
    assert.equal((await fetch(`${base}/recommend.js`)).status, 200);
    assert.equal((await fetch(`${base}/patient-suggest.html`)).status, 200);
    assert.equal((await fetch(`${base}/patient-suggest.js`)).status, 200);
    assert.equal((await fetch(`${base}/assessment-library.css`)).status, 200);
    assert.equal((await fetch(`${base}/assessment-library.js`)).status, 200);
    const libraryResponse = await fetch(`${base}/api/assessment-library`);
    assert.equal(libraryResponse.status, 200);
    const library = await libraryResponse.json();
    assert.equal(library.length, 186);
    assert.equal(library.filter((item) => item.previewAvailable).length, 162);
    assert.ok(library.every((item) => !('questions' in item)));
    const previewRecord = await (await fetch(`${base}/api/assessment-library/${encodeURIComponent(library.find((item) => item.previewAvailable).id)}`)).json();
    assert.ok(previewRecord.questions.length > 0);
    assert.equal(previewRecord.scoringAvailable, false);
    assert.equal((await fetch(`${base}/api/assessment-library/unknown`)).status, 404);
    const demoPatients = await (await fetch(`${base}/api/demo-patients`)).json();
    assert.equal(demoPatients.length, 5);
    assert.deepEqual(Object.keys(demoPatients[0]).sort(), ['id', 'label']);
    const demoSuggestion = await (await fetch(`${base}/api/demo-patients/demo-a/recommendations`)).json();
    assert.equal(demoSuggestion.primaryAssessmentId, 'phq9');
    assert.equal(demoSuggestion.recommendations[0].evidence.length, 2);
    const mixedSuggestion = await (await fetch(`${base}/api/demo-patients/demo-b/recommendations`)).json();
    assert.deepEqual(mixedSuggestion.recommendations.map((item) => item.id), ['gad7', 'dass21']);
    assert.equal(mixedSuggestion.recommendations[1].availability, 'separate_prototype');
    assert.deepEqual(mixedSuggestion.prescriptionChoices.map((item) => item.id), ['gad7', 'phq9', 'pcl5']);
    assert.equal(mixedSuggestion.prescriptionChoices[2].availability, 'requires_trauma_review');
    assert.equal(mixedSuggestion.clarification.question.options.length, 2);
    const stressFocused = await (await fetch(`${base}/api/demo-patients/demo-b/recommendations?focus=stress`)).json();
    assert.equal(stressFocused.clarification.focus, 'stress');
    assert.equal(stressFocused.prescriptionChoices[0].priority, 2);
    assert.equal((await fetch(`${base}/api/demo-patients/demo-b/recommendations?focus=traumaSymptoms`)).status, 400);
    const heldSuggestion = await (await fetch(`${base}/api/demo-patients/demo-e/recommendations`)).json();
    assert.equal(heldSuggestion.status, 'needs_review');
    assert.equal(heldSuggestion.primaryAssessmentId, null);
    assert.equal((await fetch(`${base}/api/demo-patients/demo-z/recommendations`)).status, 404);
    const createPrescription = (patientId, formId) => fetch(`${base}/api/demo-patients/${patientId}/prescriptions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ formId }),
    });
    const manualResponse = await createPrescription('demo-b', 'phq9');
    assert.equal(manualResponse.status, 201);
    const manualPrescription = await manualResponse.json();
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws?mode=demo&language=en&prescriptionId=${manualPrescription.id}`);
    const manualStart = once(socket, 'message');
    await once(socket, 'open');
    assert.equal(JSON.parse((await manualStart)[0].toString()).assessment.formId, 'phq9');
    socket.close();
    await once(socket, 'close');
    assert.equal((await createPrescription('demo-b', 'pcl5')).status, 409);
    assert.equal((await createPrescription('demo-b', 'dass21')).status, 409);
    assert.equal((await createPrescription('demo-e', 'phq9')).status, 409);
    const prescriptionResponse = await createPrescription('demo-a', 'phq9');
    assert.equal(prescriptionResponse.status, 201);
    const prescription = await prescriptionResponse.json();
    assert.equal(prescription.demoPatientId, 'demo-a');
    assert.equal(prescription.status, 'assigned');
    assert.equal((await (await fetch(`${base}/api/prescriptions/${prescription.id}`)).json()).patient.label, 'Aarav Mehta · Sample A');
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
    const noPatient = new WebSocket(`ws://127.0.0.1:${port}/ws?mode=demo&language=en`);
    await once(noPatient, 'open');
    const [closeCode] = await once(noPatient, 'close');
    assert.equal(closeCode, 1008);
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws?mode=demo&language=en&prescriptionId=${prescription.id}`);
    const messages = [];
    const waiters = [];
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (waiters.length) waiters.shift()(message);
      else messages.push(message);
    });
    await once(socket, 'open');
    const next = () => messages.length ? Promise.resolve(messages.shift()) : new Promise((resolve) => waiters.push(resolve));
    const firstState = await next();
    assert.equal(firstState.assessment.currentNumber, 1);
    assert.equal(firstState.assessment.demoPatientId, 'demo-a');
    assert.equal((await (await fetch(`${base}/api/prescriptions/${prescription.id}`)).json()).status, 'in_progress');
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
    assert.equal(results[0].demoPatientId, 'demo-a');
    const firstTimeline = await (await fetch(`${base}/api/demo-patients/demo-a/analytics`)).json();
    assert.equal(firstTimeline.totalCompleted, 1);
    assert.equal(firstTimeline.series[0].points[0].score, 3);
    assert.equal(firstTimeline.series[0].points[0].requiresHumanFollowUp, true);
    const overview = await (await fetch(`${base}/api/analytics/overview`)).json();
    assert.equal(overview.totals.prescribed, 2);
    assert.equal(overview.totals.completed, 1);
    assert.equal(overview.totals.completionRate, 50);
    assert.equal((await (await fetch(`${base}/api/prescriptions/${prescription.id}`)).json()).status, 'completed');
    assert.equal((await (await fetch(`${base}/api/demo-patients/demo-a/reports`)).json()).length, 1);
    assert.equal((await (await fetch(`${base}/api/demo-patients/demo-b/reports`)).json()).length, 0);
    const reportData = await (await fetch(`${base}/api/results/${results[0].id}`)).json();
    assert.equal(reportData.answers.length, 9);
    assert.equal(reportData.scores.requiresHumanFollowUp, true);

    socket.close();
    const hindiPrescription = await (await createPrescription('demo-a', 'phq9')).json();
    socket = new WebSocket(`ws://127.0.0.1:${port}/ws?mode=demo&language=hi&prescriptionId=${hindiPrescription.id}`);
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
    socket.close();

    for (const [patientId, formId, count, maxTotal] of [
      ['demo-b', 'gad7', 7, 21], ['demo-c', 'pcl5', 20, 80],
    ]) {
      const formResponse = await fetch(`${base}/api/form?formId=${formId}&language=en`);
      assert.equal(formResponse.status, 200);
      const otherForm = await formResponse.json();
      assert.equal(otherForm.questions.length, count);
      assert.equal(otherForm.options.length, maxTotal === 80 ? 5 : 4);
      const assigned = await createPrescription(patientId, formId);
      assert.equal(assigned.status, 201);
      const record = await assigned.json();
      socket = new WebSocket(`ws://127.0.0.1:${port}/ws?mode=demo&language=en&prescriptionId=${record.id}`);
      const queue = [];
      const waiters = [];
      socket.on('message', (raw) => {
        const value = JSON.parse(raw.toString());
        if (waiters.length) waiters.shift()(value);
        else queue.push(value);
      });
      await once(socket, 'open');
      const nextOther = () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => waiters.push(resolve));
      assert.equal((await nextOther()).assessment.formId, formId);
      for (let number = 1; number <= count; number++) {
        socket.send(JSON.stringify({ type: 'select', value: number === 1 ? 2 : 0 }));
        assert.equal((await nextOther()).number, number);
        socket.send(JSON.stringify({ type: 'confirm' }));
        const state = await nextOther();
        assert.equal(state.assessment.answers.length, number);
      }
      socket.send(JSON.stringify({ type: 'finalize', answers: [2, ...Array(count - 1).fill(0)] }));
      const completed = await nextOther();
      assert.equal(completed.assessment.status, 'completed');
      assert.equal(completed.assessment.scores.rawTotal, 2);
      assert.equal(completed.assessment.scores.maxTotal, maxTotal);
      assert.equal((await (await fetch(`${base}/api/demo-patients/${patientId}/reports`)).json())[0].formId, formId);
      assert.equal((await (await fetch(`${base}/api/prescriptions/${record.id}`)).json()).status, 'completed');
      socket.close();
    }
    assert.equal((await fetch(`${base}/api/form?formId=pcl5&language=hi`)).status, 400);
  } finally {
    socket?.close();
    child.kill();
  }
});
