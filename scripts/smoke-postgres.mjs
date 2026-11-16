import assert from 'node:assert/strict';
import pg from 'pg';
import { openPostgresStores } from '../src/postgres-stores.js';
import { getLiveDraftForm, listDraftAssessments } from '../src/draft-library.js';
import { dass21DraftId } from '../src/draft-scoring.js';

const database = openPostgresStores();
const patientId = 'demo-z'; // Reserved for this disposable connectivity check.

async function removeTemporaryRows() {
  const cleanup = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
  cleanup.on('error', (error) => console.error('PostgreSQL cleanup connection lost:', error.code || error.message));
  try {
    await cleanup.connect();
    await cleanup.query('BEGIN');
    await cleanup.query('DELETE FROM pod_assessment_prototype.prescriptions WHERE patient_id = $1', [patientId]);
    await cleanup.query('DELETE FROM pod_assessment_prototype.sessions WHERE patient_id = $1', [patientId]);
    await cleanup.query('COMMIT');
  } finally { await cleanup.end(); }
}

try {
  await database.initialize();
  await removeTemporaryRows();
  const { store, draftStore } = database;

  const scoredPrescription = await store.prescribe(patientId, 'phq9');
  let scored = await store.startPrescription(scoredPrescription.id, 'demo', 'en');
  for (let number = 1; number <= 9; number++) {
    scored = await store.record(scored.id, number, 0, 'demo');
  }
  assert.equal(scored.status, 'review');
  scored = await store.finalize(scored.id, [1, ...Array(8).fill(0)]);
  assert.equal(scored.scores.rawTotal, 1);
  assert.equal(scored.answerRevisions.length, 1);
  assert.equal((await store.get(scored.id)).status, 'completed');

  const dassForm = getLiveDraftForm(dass21DraftId);
  const dassPrescription = await draftStore.prescribe(patientId, dass21DraftId);
  let dass = await draftStore.startPrescription(dassPrescription.id, 'demo');
  for (let number = 1; number <= dassForm.questions.length; number++) {
    dass = await draftStore.record(dass.id, number, 0, 'demo');
  }
  dass = await draftStore.finalize(dass.id, dass.answers.map((answer) => answer.value));
  assert.ok(dass.scores);
  assert.equal((await draftStore.get(dass.id)).status, 'completed');

  const unscoredForm = listDraftAssessments().find((entry) =>
    entry.previewAvailable && !entry.scoringAvailable && entry.extractedItemCount <= 5 &&
    !['phq9', 'gad7', 'pcl5'].includes(entry.id));
  assert.ok(unscoredForm, 'No short imported review was found for the smoke check.');
  const unscoredPrescription = await draftStore.prescribe(patientId, unscoredForm.id);
  let unscored = await draftStore.startPrescription(unscoredPrescription.id, 'demo');
  const form = getLiveDraftForm(unscoredForm.id);
  for (let number = 1; number <= form.questions.length; number++) {
    unscored = await draftStore.record(unscored.id, number, 0, 'demo');
  }
  unscored = await draftStore.finalize(unscored.id, unscored.answers.map((answer) => answer.value));
  assert.equal(unscored.scores, null);
  assert.equal((await draftStore.get(unscored.id)).status, 'completed');

  const analytics = await store.patientAnalytics(patientId, await draftStore.patientAnalyticsRows(patientId));
  assert.equal(analytics.totalCompleted, 3);
  assert.equal(analytics.totalScored, 2);

  const probe = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
  probe.on('error', (error) => console.error('PostgreSQL probe connection lost:', error.code || error.message));
  try {
    await probe.connect();
    const result = await probe.query(`SELECT count(*)::integer AS count
      FROM pod_assessment_prototype.sessions WHERE patient_id = $1`, [patientId]);
    assert.equal(result.rows[0].count, 3);
  } finally { await probe.end(); }
  console.log('Neon writes verified: PHQ-9 score, DASS-21 score, and answer-only review.');
  console.log('Patient analytics verified across all three completed assessments.');
} finally {
  try {
    await removeTemporaryRows();
    console.log('Temporary smoke-check records removed.');
  } finally { await database.close(); }
}
