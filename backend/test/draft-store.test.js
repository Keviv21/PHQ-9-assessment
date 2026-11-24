import test from 'node:test';
import assert from 'node:assert/strict';
import { openDraftStore } from '../src/draft-store.js';
import { getLiveDraftForm, listDraftAssessments } from '../src/draft-library.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('imported live reviews save answers without generating a score', () => {
  const store = openDraftStore(':memory:');
  try {
    const catalogue = listDraftAssessments();
    assert.equal(catalogue.length, 186);
    assert.equal(catalogue.filter((item) => item.previewAvailable).length, 162);
    assert.equal(catalogue.find((item) => item.title === 'Alcohol Use Disorders Identification Test (AUDIT)').previewAvailable, true);
    assert.equal(catalogue.find((item) => item.title === 'Adolescent Dissociative Experiences Scale (A-DES)').previewAvailable, true);
    assert.equal(catalogue.find((item) => item.title === 'Strengths and Difficulties Questionnaire (SDQ)').previewAvailable, false);
    const numericForm = getLiveDraftForm(catalogue.find((item) => item.title === 'Adolescent Dissociative Experiences Scale (A-DES)').id);
    assert.equal(numericForm.questions[0].options[0].label, '0 — NEVER');
    assert.equal(numericForm.questions[0].options[1].label, '1');
    assert.equal(numericForm.questions[0].options[10].label, '10 — ALWAYS');
    const numericSession = store.create(numericForm.formId, 'demo');
    assert.equal(store.record(numericSession.id, 1, 10, 'demo').answers[0].value, 10);
    const ready = catalogue.filter((item) => item.previewAvailable)
      .sort((a, b) => a.extractedItemCount - b.extractedItemCount)[0];
    const form = getLiveDraftForm(ready.id);
    assert.equal(form.questions.length, ready.extractedItemCount);
    assert.equal(getLiveDraftForm(catalogue.find((item) => !item.previewAvailable).id), null);
    assert.throws(() => store.create(catalogue.find((item) => !item.previewAvailable).id), RangeError);

    const started = store.create(ready.id, 'live');
    assert.equal(started.currentNumber, 1);
    assert.equal(started.scores, null);
    assert.throws(() => store.record(started.id, 1, 999, 'voice'), RangeError);
    for (let number = 1; number <= form.questions.length; number++) {
      const state = store.record(started.id, number, 0, 'voice', 'Confirmed response');
      assert.equal(state.answers.length, number);
    }
    assert.equal(store.get(started.id).status, 'review');
    const values = form.questions.map(() => 0);
    values[0] = 1;
    const saved = store.finalize(started.id, values);
    assert.equal(saved.status, 'completed');
    assert.equal(saved.answers[0].value, 1);
    assert.equal(saved.reviewChangeCount, 1);
    assert.equal(saved.scores, null);
    assert.equal(store.list()[0].id, started.id);
  } finally { store.close(); }
});

test('completed imported review survives reopening the SQLite database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'openmind-draft-review-'));
  const path = join(directory, 'review.sqlite');
  let store = openDraftStore(path);
  try {
    const form = getLiveDraftForm('positive-and-negative-affect-schedule-panas--a8754da2630c');
    const session = store.create(form.formId, 'demo');
    form.questions.forEach((_, index) => store.record(session.id, index + 1, 0, 'demo'));
    store.finalize(session.id, form.questions.map(() => 0));
    store.close();
    store = openDraftStore(path);
    const saved = store.get(session.id);
    assert.equal(saved.status, 'completed');
    assert.equal(saved.answers.length, form.questions.length);
    assert.equal(saved.scores, null);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an imported review can be assigned to a sample patient and resumed', () => {
  const store = openDraftStore(':memory:');
  try {
    const form = getLiveDraftForm(listDraftAssessments().find((item) => item.title === 'Flourishing Scale (FS)').id);
    const assignment = store.prescribe('demo-a', form.formId);
    assert.equal(assignment.kind, 'draft');
    assert.equal(assignment.status, 'assigned');
    const session = store.startPrescription(assignment.id, 'demo');
    assert.equal(session.demoPatientId, 'demo-a');
    assert.equal(session.prescriptionId, assignment.id);
    assert.equal(store.startPrescription(assignment.id, 'demo').id, session.id);
    assert.throws(() => store.startPrescription(assignment.id, 'live'));
    form.questions.forEach((_, index) => store.record(session.id, index + 1, 0, 'demo'));
    store.finalize(session.id, form.questions.map(() => 0));
    assert.equal(store.getPrescription(assignment.id).status, 'completed');
    assert.equal(store.patientPrescriptions('demo-a').length, 1);
    assert.equal(store.patientPrescriptions('demo-a')[0].completedAt, store.get(session.id).completedAt);
    assert.equal(store.patientPrescriptions('demo-b').length, 0);
    assert.equal(store.get(session.id).scores, null);
  } finally { store.close(); }
});
