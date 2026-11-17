import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('repaired import keeps saved form IDs and uses printed scale values as labels', () => {
  const directory = mkdtempSync(join(tmpdir(), 'openmind-repair-import-'));
  try {
    const previousPath = join(directory, 'previous.json');
    const sourcePath = join(directory, 'source.json');
    const outputPath = join(directory, 'output.json');
    const old = {
      id: 'stable-form-id', title: 'Existing Form', previewAvailable: true,
      referencePeriod: '[object Object]', questions: [{ id: 'Q1', text: 'Original wording', options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] }],
    };
    const blocked = { id: 'newly-repaired', title: 'Repaired Form', previewAvailable: false, questions: [] };
    writeFileSync(previousPath, JSON.stringify({ sourceCount: 2, records: [old, blocked] }));
    writeFileSync(sourcePath, JSON.stringify({ assessments: [
      {
        assessment_id: 'changed-source-id', assessment: { name: 'Existing Form', reference_period: { structured: 'past week' } },
        questionnaire: { items: [{ id: 'Q1', text: 'Changed wording', response_type: 'choice', response_set_id: 'RS1' }],
          response_sets: [{ id: 'RS1', options: [{ id: 'O1', label: 'Often' }, { id: 'O2', label: 'Never' }] }] },
      },
      {
        assessment_id: 'newly-repaired', assessment: { name: 'Repaired Form' },
        questionnaire: { items: [{ id: 'Q1', text: 'A question', response_type: 'choice', response_set_id: 'RS1' }],
          response_sets: [{ id: 'RS1', options: [
            { id: 'O1', label: 'NEVER', printed_value: 0 },
            { id: 'O2', label: null, printed_value: 1 },
            { id: 'O3', label: 'ALWAYS', printed_value: 2 },
          ] }] },
      },
    ] }));
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../scripts/legacy/import-assessment-bundle.mjs', import.meta.url)),
      sourcePath, outputPath, previousPath,
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const records = JSON.parse(readFileSync(outputPath, 'utf8')).records;
    assert.equal(records[0].id, 'stable-form-id');
    assert.equal(records[0].questions[0].text, 'Original wording');
    assert.equal(records[0].referencePeriod, 'past week');
    assert.equal(records[1].previewAvailable, true);
    assert.deepEqual(records[1].questions[0].options.map((option) => option.label), ['0 — NEVER', '1', '2 — ALWAYS']);
    assert.equal(records.every((record) => record.scoringAvailable !== true), true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
