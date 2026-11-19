import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreDefinition } from '../src/definition-scoring.js';

const definitions = JSON.parse(readFileSync(new URL('../data/assessment-library.json', import.meta.url))).records;
const benchmarks = JSON.parse(readFileSync(new URL('fixtures/scoring-benchmarks.json', import.meta.url)));

test('imported draft engine matches 137 supplied source-based score assertions across eight instruments', () => {
  let count = 0;
  for (const assessment of benchmarks.assessments) {
    const definition = definitions.find(d => d.id === assessment.assessment_id);
    assert.ok(definition);
    for (const example of assessment.cases.filter(c => c.kind !== 'known_source_gap')) {
      const result = scoreDefinition(definition, example.answers, example.context || {}, { draftScores: true });
      for (const [id, expected] of Object.entries(example.expected_scores)) {
        const value = result.metrics.find(m => m.id === id)?.value;
        if (expected === null) assert.equal(value, null, example.id);
        else assert.ok(typeof value === 'number' && Math.abs(value - expected) < 0.0001, `${example.id}: expected ${expected}, got ${value}`);
        count++;
      }
      assert.ok(result.metrics.every(m => m.band === null), 'draft results do not enable clinical interpretation');
    }
  }
  assert.equal(count, 137);
});

test('known partial-response and NA denominator gaps are withheld instead of reporting misleading means', () => {
  let count = 0;
  for (const assessment of benchmarks.assessments) {
    const definition = definitions.find(d => d.id === assessment.assessment_id);
    for (const example of assessment.cases.filter(c => c.kind === 'known_source_gap')) {
      const result = scoreDefinition(definition, example.answers, example.context || {}, { draftScores: true });
      for (const id of Object.keys(example.expected_scores)) {
        assert.equal(result.metrics.find(m => m.id === id)?.value, null, example.id);
        count++;
      }
    }
  }
  assert.equal(count, 3);
});
