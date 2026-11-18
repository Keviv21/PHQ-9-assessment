import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPostgres } from '../src/storage/postgres/database.js';
import { openPostgresWorkspace } from '../src/storage/postgres/workspace-store.js';
import { createMemoryCache } from '../src/storage/memory-cache.js';
import { definition } from '../src/workspace/catalogue.js';

test('memory caches isolate values, keys and evict least recently used entries', () => {
  const cache = createMemoryCache(2);
  const value = { items: [1] };
  cache.set(['a', 'b'], value);
  value.items.push(2);
  assert.deepEqual(cache.get(['a', 'b']), { items: [1] });
  cache.get(['a', 'b']).items.push(3);
  cache.set(['a:b'], { other: true });
  assert.deepEqual(cache.get(['a', 'b']), { items: [1] });
  cache.set(['third'], {});
  assert.equal(cache.get(['a:b']), null);
  assert.deepEqual(cache.get(['a', 'b']), { items: [1] });
});

test('core PostgreSQL startup uses four core tables and preserves sessions across cache resets', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const schema = 'core_test_' + randomUUID().replaceAll('-', '');
  let db = await openPostgres(process.env.TEST_DATABASE_URL, { schema });
  try {
    let store = await openPostgresWorkspace(db, { seed: false });
    const patient = await store.createPatient({ name: 'Synthetic core patient', historySummary: 'Synthetic history' });
    const rx = await store.prescribe(patient.id, 'GAD7');
    const frozen = structuredClone(definition('GAD7'));
    let session = await store.createSession(rx.id, frozen, 'en', 'screen');
    for (const question of session.definition.questions) {
      session = await store.answer(session.id, { questionId: question.id, value: 0, revision: session.revision });
    }
    session = await store.finalize(session.id, session.revision);
    assert.equal(session.status, 'completed');
    assert.equal(session.calculatedResults.metrics[0].value, 0);
    assert.equal(session.calculatedResults.metrics[0].status, 'draft_unvalidated');
    assert.equal((await store.patientPrescriptions(patient.id))[0].metrics[0].value, 0);
    await store.saveRecommendation(patient.id, 'context', { suggestions: ['GAD7'] });
    await store.saveTranslation('definition', 'hi', { title: 'Translated example' });
    assert.deepEqual(await store.recommendation(patient.id, 'context'), { suggestions: ['GAD7'] });
    assert.equal(await store.recommendation(patient.id, 'changed'), null);
    assert.deepEqual(await store.translation('definition', 'hi'), { title: 'Translated example' });
    assert.equal(await store.translation('definition', 'es'), null);
    await db.close();
    db = await openPostgres(process.env.TEST_DATABASE_URL, { schema });
    store = await openPostgresWorkspace(db, { seed: false });
    assert.equal(await store.recommendation(patient.id, 'context'), null);
    assert.equal(await store.translation('definition', 'hi'), null);
    assert.deepEqual(await store.get(session.id), session);
    assert.deepEqual(await store.patient(patient.id), patient);
    const tables = (await db.pool.query('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename', [schema])).rows.map(row => row.tablename);
    assert.deepEqual(tables, ['assessment_prescriptions', 'assessment_sessions', 'patient_records', 'patients']);
  } finally {
    await db.pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await db.close();
  }
});
