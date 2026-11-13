import test from 'node:test';
import assert from 'node:assert/strict';
import { getDemoPatient, listDemoPatients, suggestForDemoPatient } from '../src/demo-patients.js';
import { openStore } from '../src/store.js';

test('patient selection derives current concerns and a primary suggestion with evidence', () => {
  assert.equal(listDemoPatients().length, 5);
  const depression = suggestForDemoPatient('demo-a');
  assert.deepEqual(depression.context.concerns, ['depression']);
  assert.equal(depression.primaryAssessmentId, 'phq9');
  assert.equal(depression.recommendations[0].evidence.length, 2);
  assert.equal(depression.recommendations[0].catalogDraftId, 'patient-health-questionnaire-depression-phq-9--8f81b7b3270c');

  const anxiety = suggestForDemoPatient('demo-b');
  assert.equal(anxiety.primaryAssessmentId, 'gad7');
  assert.deepEqual(anxiety.context.concerns, ['anxiety', 'stress']);
  assert.deepEqual(anxiety.recommendations.map((item) => [item.id, item.availability]),
    [['gad7', 'available'], ['dass21', 'separate_prototype']]);
  assert.deepEqual(anxiety.recommendations[0].evidence.map((item) => item.source), ['recent_clinician_summary.anxiety']);
  assert.deepEqual(anxiety.recommendations[1].evidence.map((item) => item.source),
    ['recent_clinician_summary.anxiety', 'recent_clinician_summary.stress']);
  assert.deepEqual(anxiety.prescriptionChoices.map((item) => item.id), ['gad7', 'phq9', 'pcl5']);
  assert.equal(anxiety.prescriptionChoices[1].selectionBasis, 'clinician_option');
  assert.equal(anxiety.prescriptionChoices[2].availability, 'requires_trauma_review');
  assert.equal(suggestForDemoPatient('demo-b', 'stress').prescriptionChoices[0].priority, 2);
  assert.throws(() => suggestForDemoPatient('demo-b', 'traumaSymptoms'), /current concern/);
  assert.equal(suggestForDemoPatient('demo-c').primaryAssessmentId, 'pcl5');
  assert.equal(suggestForDemoPatient('demo-d').primaryAssessmentId, 'dass21');
  assert.equal(suggestForDemoPatient('demo-z'), null);
});

test('historical mood and seizure-related fear do not become current psychiatric concerns', () => {
  const neurological = suggestForDemoPatient('demo-e');
  assert.deepEqual(neurological.context.concerns, []);
  assert.equal(neurological.status, 'needs_review');
  assert.equal(neurological.primaryAssessmentId, null);
  assert.deepEqual(neurological.recommendations, []);
  assert.equal(neurological.ignoredObservations.length, 3);
  assert.match(neurological.ignoredObservations[0].reason, /Historical/);
  const changed = getDemoPatient('demo-e');
  changed.summary.observations[0].status = 'current';
  assert.equal(getDemoPatient('demo-e').summary.observations[0].status, 'historical');
});

test('a completed PHQ-9 result retains its selected demo patient', () => {
  const store = openStore(':memory:');
  try {
    let assessment = store.create('demo', 'hi', 'demo-a');
    assert.equal(assessment.demoPatientId, 'demo-a');
    for (let number = 1; number <= 9; number++) assessment = store.record(assessment.id, number, 0, 'demo');
    assessment = store.finalize(assessment.id, Array(9).fill(0));
    assert.equal(assessment.demoPatientId, 'demo-a');
    assert.equal(store.results()[0].demoPatientId, 'demo-a');
    assert.throws(() => store.create('demo', 'en', 'patient-real'), /Unsupported demo patient/);
  } finally { store.close(); }
});

test('prescription links one patient to one resumable session and report', () => {
  const store = openStore(':memory:');
  try {
    const prescription = store.prescribe('demo-a', 'phq9');
    assert.equal(prescription.status, 'assigned');
    assert.throws(() => store.prescribe('demo-b', 'dass21'), /Unsupported prescription/);
    let assessment = store.startPrescription(prescription.id, 'demo', 'en');
    assert.equal(store.startPrescription(prescription.id, 'demo', 'en').id, assessment.id);
    assert.equal(store.getPrescription(prescription.id).status, 'in_progress');
    for (let number = 1; number <= 9; number++) assessment = store.record(assessment.id, number, 0, 'demo');
    store.finalize(assessment.id, Array(9).fill(0));
    assert.equal(store.getPrescription(prescription.id).status, 'completed');
    assert.equal(store.patientResults('demo-a').length, 1);
    assert.equal(store.patientResults('demo-b').length, 0);
    assert.equal(store.patientPrescriptions('demo-a').length, 1);
  } finally { store.close(); }
});
