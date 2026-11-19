import { openPostgresStores } from '../src/postgres-stores.js';
import { openDefinitionStore } from '../src/definition-store.js';
import { getDefinition } from '../src/definition-library.js';

const postgres = openPostgresStores();
const definitions = openDefinitionStore({ pool: postgres.pool });
let prescriptionId;
let sessionId;
try {
  await postgres.initialize();
  await definitions.initialize();
  const form = getDefinition('adult-adhd-self-report-scale-asrs--814829bfeff1');
  const prescription = await definitions.prescribe('demo-a', form.id);
  prescriptionId = prescription.id;
  const state = await definitions.start(prescriptionId);
  sessionId = state.id;
  const answers = Object.fromEntries(form.questions.map((item) => [item.id, item.options[0].id]));
  const completed = await definitions.save(sessionId, answers, true);
  if (completed.scores.metrics.find((metric) => metric.id === 'part_a_raw')?.value !== 0) {
    throw new Error('PostgreSQL source-draft score did not match the fixture.');
  }
  if ((await definitions.getPrescription(prescriptionId)).status !== 'completed') {
    throw new Error('PostgreSQL assignment did not persist completion.');
  }
  console.log('PostgreSQL definition assignment, answers, and draft report: OK');
} finally {
  if (prescriptionId) await postgres.pool.query(
    'DELETE FROM pod_assessment_prototype.definition_prescriptions WHERE id=$1', [prescriptionId]);
  if (sessionId) await postgres.pool.query(
    'DELETE FROM pod_assessment_prototype.definition_sessions WHERE id=$1', [sessionId]);
  await postgres.close();
}
