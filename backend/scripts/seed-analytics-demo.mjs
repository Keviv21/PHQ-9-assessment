import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { getAssessmentForm } from '../src/forms.js';
import { getLiveDraftForm } from '../src/draft-library.js';
import { dass21DraftId } from '../src/draft-scoring.js';
import { openStore } from '../src/store.js';
import { openDraftStore } from '../src/draft-store.js';

const defaultPath = fileURLToPath(new URL('../data/analytics-demo.sqlite', import.meta.url));
const path = resolve(process.argv[2] || defaultPath);
if (existsSync(path)) {
  console.error(`Demo database already exists: ${path}. Choose a new filename to keep existing data intact.`);
  process.exit(1);
}
mkdirSync(dirname(path), { recursive: true });

const main = openStore(path);
const imported = openDraftStore(path);
const dated = [];

function mainAssessment(formId, values, daysAgo) {
  const form = getAssessmentForm(formId, 'en');
  if (values.length !== form.questions.length) throw new Error(`Wrong answer count for ${formId}.`);
  const prescription = main.prescribe('demo-b', formId);
  const session = main.startPrescription(prescription.id, 'demo', 'en');
  values.forEach((value, index) => main.record(session.id, index + 1, value, 'demo'));
  main.finalize(session.id, values);
  dated.push({ kind: 'main', prescriptionId: prescription.id, sessionId: session.id, daysAgo });
}

function importedAssessment(formId, values, daysAgo) {
  const form = getLiveDraftForm(formId);
  if (!form || values.length !== form.questions.length) throw new Error(`Wrong answer count for ${formId}.`);
  const prescription = imported.prescribe('demo-b', formId);
  const session = imported.startPrescription(prescription.id, 'demo');
  values.forEach((value, index) => imported.record(session.id, index + 1, value, 'demo'));
  imported.finalize(session.id, values);
  dated.push({ kind: 'imported', prescriptionId: prescription.id, sessionId: session.id, daysAgo });
}

try {
  mainAssessment('gad7', [3, 2, 2, 2, 2, 2, 2], 85);
  mainAssessment('phq9', [2, 2, 2, 1, 1, 1, 1, 1, 0], 70);
  importedAssessment(dass21DraftId, Array(21).fill(2), 55);
  mainAssessment('gad7', [2, 2, 1, 1, 1, 1, 1], 30);
  importedAssessment('flourishing-scale-fs--36825cb5960c', Array(8).fill(0), 20);
  mainAssessment('phq9', [1, 1, 1, 1, 1, 0, 0, 0, 0], 12);
  importedAssessment(dass21DraftId, Array(21).fill(1), 5);
  mainAssessment('gad7', [1, 1, 1, 0, 0, 0, 0], 3);
} finally {
  main.close();
  imported.close();
}

const db = new DatabaseSync(path);
try {
  db.exec('BEGIN IMMEDIATE');
  const updateMainPrescription = db.prepare('UPDATE prescriptions SET created_at = ? WHERE id = ?');
  const updateMainSession = db.prepare('UPDATE assessments SET started_at = ?, completed_at = ? WHERE id = ?');
  const updateAnswers = db.prepare('UPDATE answers SET answered_at = ? WHERE assessment_id = ?');
  const updateImportedPrescription = db.prepare('UPDATE draft_prescriptions SET created_at = ? WHERE id = ?');
  const updateImportedSession = db.prepare('UPDATE draft_sessions SET started_at = ?, completed_at = ?, answers_json = ? WHERE id = ?');
  const readImportedAnswers = db.prepare('SELECT answers_json FROM draft_sessions WHERE id = ?');
  for (const item of dated) {
    const completed = new Date(Date.now() - item.daysAgo * 86400000).toISOString();
    const started = new Date(Date.parse(completed) - 3600000).toISOString();
    const assigned = new Date(Date.parse(started) - 86400000).toISOString();
    if (item.kind === 'main') {
      updateMainPrescription.run(assigned, item.prescriptionId);
      updateMainSession.run(started, completed, item.sessionId);
      updateAnswers.run(started, item.sessionId);
    } else {
      updateImportedPrescription.run(assigned, item.prescriptionId);
      const answers = JSON.parse(readImportedAnswers.get(item.sessionId).answers_json)
        .map((answer) => ({ ...answer, answeredAt: started }));
      updateImportedSession.run(started, completed, JSON.stringify(answers), item.sessionId);
    }
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally { db.close(); }

console.log(`Created synthetic analytics database: ${path}`);
console.log('Sample patient: demo-b; 8 completed assessments across 4 forms over 85 days.');
