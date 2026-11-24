import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { importContent, loadContent } from '../src/content-db.js';

test('assessment and patient API content comes from the database and preserves published versions', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'pod-content-test-'));
  const path = join(directory, 'content.sqlite');
  context.after(() => {
    assert.equal(dirname(resolve(path)), resolve(directory));
    rmSync(directory, { recursive: true, force: true });
  });
  const bundle = JSON.parse(readFileSync(new URL('../data/all-assessments.json', import.meta.url), 'utf8'));
  const patients = JSON.parse(readFileSync(new URL('../data/demo-patients.json', import.meta.url), 'utf8'));
  await importContent(bundle, patients, { sqliteOnly: true, path });
  const first = bundle.assessments[0];
  const changedVersion = structuredClone(bundle);
  changedVersion.assessments[0].assessment.name = 'A changed questionnaire';
  await assert.rejects(importContent(changedVersion, patients, { sqliteOnly: true, path }),
    /changed without a new definition_version/);

  // A direct database edit demonstrates that the runtime loader does not read the import JSON.
  const db = new DatabaseSync(path);
  try {
    const patient = { ...patients[0], label: 'Patient from the database' };
    const assessment = { ...first, assessment: { ...first.assessment, name: 'Assessment from the database' } };
    db.prepare('UPDATE content_patients SET profile_json = ? WHERE id = ?').run(JSON.stringify(patient), patient.id);
    db.prepare('UPDATE assessment_versions SET payload_json = ? WHERE assessment_id = ? AND active = 1')
      .run(JSON.stringify(assessment), first.assessment_id);
  } finally { db.close(); }
  const loaded = await loadContent({ sqliteOnly: true, path });
  assert.equal(loaded.patients.find((patient) => patient.id === patients[0].id).label, 'Patient from the database');
  assert.equal(loaded.assessments.find((entry) => entry.assessment_id === first.assessment_id).assessment.name,
    'Assessment from the database');
});
