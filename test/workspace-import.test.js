import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAssessment } from '../src/workspace/normalize.js';
import { definition } from '../src/workspace/catalogue.js';

function source() {
  return {
    assessment_id: 'synthetic-import',
    assessment: { name: 'Synthetic import' },
    administration: { instructions: 'Choose one response.' },
    questionnaire: {
      item_count: 1,
      items: [{ id: 'Q1', text: 'Synthetic question', response_type: 'choice', response_set_id: 'RS1' }],
      response_sets: [{ id: 'RS1', options: [
        { printed_value: 0, label: 'Original label', display_label: 'Repaired label' },
        { printed_value: 1, label: null, display_label: '1' },
      ] }],
    },
    scoring: { enabled: false },
  };
}

test('Importer uses repaired display labels and retains legacy label compatibility', () => {
  const raw = source();
  let result = normalizeAssessment(raw).definition;
  assert.equal(result.runnable, true);
  assert.deepEqual(result.questions[0].options.map(o => o.label), ['Repaired label', '1']);
  delete raw.questionnaire.response_sets[0].options[0].display_label;
  result = normalizeAssessment(raw).definition;
  assert.equal(result.questions[0].options[0].label, 'Original label');
  delete raw.questionnaire.response_sets[0].options[1].display_label;
  assert.equal(normalizeAssessment(raw).definition.runnable, false);
});

test('Importer blocks conditional questionnaires until branching is supported', () => {
  const raw = source();
  raw.questionnaire.items[0].display_if = { item_id: 'Q0', operator: 'equals', value: 'O1' };
  const result = normalizeAssessment(raw).definition;
  assert.equal(result.runnable, false);
  assert.match(result.availabilityReason, /conditional questions/);
});

test('Repaired CSI-16 keeps numeric intermediate anchors and remains unscored', () => {
  const result = definition('couples-satisfaction-index-csi-16--9c69dc027c1c');
  assert.equal(result.version, '1.0.0-draft.6');
  assert.equal(result.runnable, true);
  assert.equal(result.scoring.enabled, false);
  assert.deepEqual(result.questions.find(q => q.id === 'Q11').options.map(o => o.label),
    ['INTERESTING', '4', '3', '2', '1', 'BORING']);
});
