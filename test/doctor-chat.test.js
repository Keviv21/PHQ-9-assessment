import test from 'node:test';
import assert from 'node:assert/strict';
import { getDemoPatient } from '../src/demo-patients.js';
import { answerDoctor, fallbackDoctor, retrieveDoctorCandidates, validateDoctorMessage } from '../src/doctor-chat.js';

test('doctor conversation accepts only de-identified short messages', () => {
  assert.equal(validateDoctorMessage('The patient also reports sleep problems.').message,
    'The patient also reports sleep problems.');
  assert.throws(() => validateDoctorMessage('Email me at doctor@example.com'), RangeError);
  assert.throws(() => validateDoctorMessage('Call +91 98313 07912'), RangeError);
  assert.throws(() => validateDoctorMessage('Question', [{ role: 'doctor', text: 'person@example.com' }]), RangeError);
});

test('Gemini suggestions are limited to retrieved, runnable catalogue IDs', async () => {
  const patient = getDemoPatient('demo-b');
  const candidates = retrieveDoctorCandidates(patient, 'The patient also has sleep problems.');
  const catalogueItem = candidates.find((item) => item.id.startsWith('definition:'));
  assert.ok(catalogueItem);
  assert.equal(candidates.some((item) => item.id === 'pcl5'), false);
  let request;
  const result = await answerDoctor({
    patient, message: 'The patient also has sleep problems.',
    generate: async (value) => {
      request = value;
      return { output_text: JSON.stringify({ reply: 'Please review the sleep concern before choosing.', suggestions: [
        { id: catalogueItem.id, reason: 'The doctor described a current sleep concern.' },
        { id: 'draft:made-up-test', reason: 'Invented' },
        { id: 'pcl5', reason: 'Exposure not confirmed' },
      ] }) };
    },
  });
  assert.equal(request.response_format.mime_type, 'application/json');
  assert.equal(request.response_format.schema.type, 'object');
  assert.equal(request.store, false);
  assert.deepEqual(result.suggestions.map((item) => item.id), [catalogueItem.id]);
  assert.ok(['definition_draft', 'answer_only'].includes(result.suggestions[0].kind));
  assert.equal(result.reviewedByDoctor, false);
});

test('local fallback is labelled and uses only catalogue matches', () => {
  const result = fallbackDoctor(getDemoPatient('demo-b'), 'The patient also has sleep problems.');
  assert.equal(result.source, 'local_fallback');
  assert.ok(result.suggestions.length);
  assert.ok(result.suggestions.every((item) => item.id.startsWith('definition:') || item.id.startsWith('draft:')));
});
