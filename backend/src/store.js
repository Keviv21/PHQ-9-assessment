import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { assertAssessmentAnswer, getAssessmentForm, hasBundledTranslation, scoreAssessment, validateAssessmentLanguage } from './forms.js';
import { buildOverview, buildPatientAnalytics } from './analytics.js';

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS assessments (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL CHECK (form_id IN ('phq9', 'gad7', 'pcl5')),
      form_version TEXT NOT NULL,
      language TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('demo', 'live')),
      collection_method TEXT NOT NULL CHECK (collection_method IN ('explicit_choice', 'conversational_inference')),
      status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
      review_ready INTEGER NOT NULL DEFAULT 0 CHECK (review_ready IN (0, 1)),
      demo_patient_id TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      scores_json TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS answers (
      assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 20),
      value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 4),
      method TEXT NOT NULL CHECK (method IN ('voice', 'screen', 'demo')),
      response_summary TEXT,
      answered_at TEXT NOT NULL,
      PRIMARY KEY (assessment_id, question_number)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS answer_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 20),
      previous_value INTEGER NOT NULL CHECK (previous_value BETWEEN 0 AND 4),
      final_value INTEGER NOT NULL CHECK (final_value BETWEEN 0 AND 4),
      changed_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS prescriptions (
      id TEXT PRIMARY KEY,
      demo_patient_id TEXT NOT NULL,
      form_id TEXT NOT NULL CHECK (form_id IN ('phq9', 'gad7', 'pcl5')),
      created_at TEXT NOT NULL,
      assessment_id TEXT UNIQUE REFERENCES assessments(id)
    ) STRICT;
  `);
  // Preserve results created by earlier versions of the prototype.
  if (!db.prepare('PRAGMA table_info(assessments)').all().some((column) => column.name === 'review_ready')) {
    db.exec('ALTER TABLE assessments ADD COLUMN review_ready INTEGER NOT NULL DEFAULT 0 CHECK (review_ready IN (0, 1))');
  }
  // SQLite cannot alter a CHECK constraint in place. Rebuild only legacy English-only tables.
  const assessmentSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'assessments'").get().sql;
  if (/CHECK\s*\(\s*language\s*=\s*'en'\s*\)/i.test(assessmentSql)) {
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE assessments_new (
          id TEXT PRIMARY KEY,
          form_id TEXT NOT NULL CHECK (form_id = 'phq9'),
          form_version TEXT NOT NULL,
          language TEXT NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('demo', 'live')),
          collection_method TEXT NOT NULL CHECK (collection_method IN ('explicit_choice', 'conversational_inference')),
          status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
          review_ready INTEGER NOT NULL DEFAULT 0 CHECK (review_ready IN (0, 1)),
          started_at TEXT NOT NULL,
          completed_at TEXT,
          scores_json TEXT
        ) STRICT;
        INSERT INTO assessments_new (id, form_id, form_version, language, mode, collection_method, status, review_ready, started_at, completed_at, scores_json)
          SELECT id, form_id, form_version, language, mode, collection_method, status, review_ready, started_at, completed_at, scores_json FROM assessments;
        DROP TABLE assessments;
        ALTER TABLE assessments_new RENAME TO assessments;
        COMMIT;`);
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    } finally { db.exec('PRAGMA foreign_keys = ON'); }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Existing answers failed migration integrity check.');
  }
  if (!db.prepare('PRAGMA table_info(assessments)').all().some((column) => column.name === 'demo_patient_id')) {
    db.exec('ALTER TABLE assessments ADD COLUMN demo_patient_id TEXT');
  }
  const currentSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'assessments'").get().sql;
  if (/CHECK\s*\(\s*form_id\s*=\s*'phq9'\s*\)/i.test(currentSql) || /CHECK\s*\(\s*language\s*IN\s*\('en',\s*'hi'\)\s*\)/i.test(currentSql)) {
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE assessments_multi (
          id TEXT PRIMARY KEY, form_id TEXT NOT NULL CHECK (form_id IN ('phq9', 'gad7', 'pcl5')),
          form_version TEXT NOT NULL, language TEXT NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('demo', 'live')),
          collection_method TEXT NOT NULL CHECK (collection_method IN ('explicit_choice', 'conversational_inference')),
          status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
          review_ready INTEGER NOT NULL DEFAULT 0 CHECK (review_ready IN (0, 1)),
          demo_patient_id TEXT, started_at TEXT NOT NULL, completed_at TEXT, scores_json TEXT
        ) STRICT;
        INSERT INTO assessments_multi SELECT id, form_id, form_version, language, mode, collection_method,
          status, review_ready, demo_patient_id, started_at, completed_at, scores_json FROM assessments;
        CREATE TABLE answers_multi (
          assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
          question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 20),
          value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 4),
          method TEXT NOT NULL CHECK (method IN ('voice', 'screen', 'demo')),
          response_summary TEXT, answered_at TEXT NOT NULL,
          PRIMARY KEY (assessment_id, question_number)
        ) STRICT;
        INSERT INTO answers_multi SELECT * FROM answers;
        CREATE TABLE revisions_multi (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
          question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 20),
          previous_value INTEGER NOT NULL CHECK (previous_value BETWEEN 0 AND 4),
          final_value INTEGER NOT NULL CHECK (final_value BETWEEN 0 AND 4),
          changed_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO revisions_multi SELECT * FROM answer_revisions;
        CREATE TABLE prescriptions_multi (
          id TEXT PRIMARY KEY, demo_patient_id TEXT NOT NULL,
          form_id TEXT NOT NULL CHECK (form_id IN ('phq9', 'gad7', 'pcl5')),
          created_at TEXT NOT NULL, assessment_id TEXT UNIQUE REFERENCES assessments(id)
        ) STRICT;
        INSERT INTO prescriptions_multi SELECT * FROM prescriptions;
        DROP TABLE answer_revisions;
        DROP TABLE answers;
        DROP TABLE prescriptions;
        DROP TABLE assessments;
        ALTER TABLE assessments_multi RENAME TO assessments;
        ALTER TABLE answers_multi RENAME TO answers;
        ALTER TABLE revisions_multi RENAME TO answer_revisions;
        ALTER TABLE prescriptions_multi RENAME TO prescriptions;
        COMMIT;`);
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    } finally { db.exec('PRAGMA foreign_keys = ON'); }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Existing assessment records failed migration integrity check.');
  }
  db.exec("CREATE INDEX IF NOT EXISTS assessments_patient_completed ON assessments(demo_patient_id, completed_at) WHERE status = 'completed'");
  const insertAssessment = db.prepare(`INSERT INTO assessments (id, form_id, form_version, language, mode, collection_method, status, demo_patient_id, started_at)
    VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?, ?)`);
  const selectAssessment = db.prepare('SELECT * FROM assessments WHERE id = ?');
  const selectAnswers = db.prepare('SELECT * FROM answers WHERE assessment_id = ? ORDER BY question_number');
  const countRevisions = db.prepare('SELECT COUNT(*) AS count FROM answer_revisions WHERE assessment_id = ?');
  const insertAnswer = db.prepare('INSERT INTO answers VALUES (?, ?, ?, ?, ?, ?)');
  const markReview = db.prepare("UPDATE assessments SET review_ready = 1 WHERE id = ? AND status = 'in_progress'");
  const updateAssessmentLanguage = db.prepare('UPDATE assessments SET language = ? WHERE id = ?');
  const updateAnswer = db.prepare('UPDATE answers SET value = ? WHERE assessment_id = ? AND question_number = ?');
  const insertRevision = db.prepare('INSERT INTO answer_revisions (assessment_id, question_number, previous_value, final_value, changed_at) VALUES (?, ?, ?, ?, ?)');
  const completeAssessment = db.prepare("UPDATE assessments SET status = 'completed', completed_at = ?, scores_json = ? WHERE id = ? AND status = 'in_progress'");
  const listCompleted = db.prepare("SELECT * FROM assessments WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 25");
  const listPatientCompleted = db.prepare("SELECT * FROM assessments WHERE status = 'completed' AND demo_patient_id = ? ORDER BY completed_at DESC");
  const listPatientAnalytics = db.prepare("SELECT id, form_id, form_version, language, mode, completed_at, scores_json FROM assessments WHERE status = 'completed' AND demo_patient_id = ? ORDER BY completed_at, id");
  const listAnalyticsPrescriptions = db.prepare(`SELECT p.form_id, p.created_at, p.assessment_id,
    a.status AS assessment_status, a.completed_at FROM prescriptions p
    LEFT JOIN assessments a ON a.id = p.assessment_id ORDER BY p.created_at`);
  const insertPrescription = db.prepare('INSERT INTO prescriptions (id, demo_patient_id, form_id, created_at) VALUES (?, ?, ?, ?)');
  const selectPrescription = db.prepare(`SELECT p.*, a.status AS assessment_status, a.mode AS assessment_mode, a.language AS assessment_language
    FROM prescriptions p LEFT JOIN assessments a ON a.id = p.assessment_id WHERE p.id = ?`);
  const listPrescriptions = db.prepare(`SELECT p.*, a.status AS assessment_status, a.mode AS assessment_mode, a.language AS assessment_language
    FROM prescriptions p LEFT JOIN assessments a ON a.id = p.assessment_id WHERE p.demo_patient_id = ? ORDER BY p.created_at DESC`);
  const linkPrescription = db.prepare('UPDATE prescriptions SET assessment_id = ? WHERE id = ? AND assessment_id IS NULL');

  function updateLanguage(id, nextLanguage) {
    updateAssessmentLanguage.run(validateAssessmentLanguage(nextLanguage), id);
    return get(id);
  }

  function get(id) {
    const row = selectAssessment.get(id);
    if (!row) return null;
    const answers = selectAnswers.all(id);
    return {
      id: row.id, formId: row.form_id, formVersion: row.form_version,
      language: row.language, mode: row.mode, collectionMethod: row.collection_method,
      demoPatientId: row.demo_patient_id,
      status: row.status === 'completed' ? 'completed' : row.review_ready ? 'review' : 'in_progress',
      startedAt: row.started_at, completedAt: row.completed_at,
      currentNumber: row.status === 'completed' || row.review_ready ? null : answers.length + 1,
      answers: answers.map((answer) => ({ number: answer.question_number, value: answer.value,
        method: answer.method, responseSummary: answer.response_summary, answeredAt: answer.answered_at })),
      reviewChangeCount: countRevisions.get(id).count,
      scores: row.scores_json ? JSON.parse(row.scores_json) : null,
    };
  }

  function create(mode, language = 'en', demoPatientId = null, formId = 'phq9') {
    if (!['demo', 'live'].includes(mode)) throw new RangeError('Unsupported mode.');
    if (demoPatientId !== null && (typeof demoPatientId !== 'string' || !/^demo-[a-z]$/.test(demoPatientId))) throw new RangeError('Unsupported demo patient.');
    validateAssessmentLanguage(language);
    const assessmentForm = getAssessmentForm(formId, hasBundledTranslation(formId, language) ? language : 'en');
    const id = randomUUID();
    insertAssessment.run(id, formId, assessmentForm.version, language, mode, mode === 'live' ? 'conversational_inference' : 'explicit_choice', demoPatientId, new Date().toISOString());
    return get(id);
  }

  function record(id, number, value, method, summary = null) {
    if (!['voice', 'screen', 'demo'].includes(method)) throw new RangeError('Unsupported answer method.');
    if (summary !== null && (typeof summary !== 'string' || !summary.trim() || summary.length > 240)) throw new RangeError('Response summary must be short text.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const before = get(id);
      if (!before) throw new Error('Assessment not found.');
      assertAssessmentAnswer(before.formId, value);
      if (before.status !== 'in_progress') throw new Error('Assessment is already completed.');
      if (number !== before.currentNumber) throw new Error('Answer is for the wrong question.');
      const timestamp = new Date().toISOString();
      insertAnswer.run(id, number, value, method, summary?.trim() ?? null, timestamp);
      if (number === getAssessmentForm(before.formId).questions.length) markReview.run(id);
      db.exec('COMMIT');
      return get(id);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function finalize(id, finalValues) {
    if (!Array.isArray(finalValues)) throw new RangeError('Final review needs an answer array.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const before = get(id);
      if (!before) throw new Error('Assessment not found.');
      const count = getAssessmentForm(before.formId).questions.length;
      if (before.status !== 'review' || before.answers.length !== count || finalValues.length !== count) {
        throw new Error('Assessment is not ready for final review.');
      }
      finalValues.forEach((value) => assertAssessmentAnswer(before.formId, value));
      const timestamp = new Date().toISOString();
      for (let index = 0; index < count; index++) {
        const previous = before.answers[index].value;
        const final = finalValues[index];
        if (previous !== final) {
          updateAnswer.run(final, id, index + 1);
          insertRevision.run(id, index + 1, previous, final, timestamp);
        }
      }
      const scores = scoreAssessment(before.formId, finalValues);
      completeAssessment.run(timestamp, JSON.stringify(scores), id);
      db.exec('COMMIT');
      return get(id);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function results() {
    return listCompleted.all().map(resultSummary);
  }

  function resultSummary(row) {
    return {
      id: row.id, formId: row.form_id, formVersion: row.form_version,
      language: row.language, mode: row.mode, collectionMethod: row.collection_method,
      demoPatientId: row.demo_patient_id,
      completedAt: row.completed_at, scores: JSON.parse(row.scores_json),
    };
  }

  function patientResults(demoPatientId) {
    return listPatientCompleted.all(demoPatientId).map(resultSummary);
  }

  function patientAnalytics(demoPatientId, importedRows = []) {
    return buildPatientAnalytics(demoPatientId, [...listPatientAnalytics.all(demoPatientId), ...importedRows]);
  }

  function analyticsOverview(importedRows = []) {
    return buildOverview([...listAnalyticsPrescriptions.all(), ...importedRows]);
  }

  function prescriptionSummary(row) {
    if (!row) return null;
    return {
      id: row.id, demoPatientId: row.demo_patient_id, formId: row.form_id,
      createdAt: row.created_at, assessmentId: row.assessment_id,
      mode: row.assessment_mode, language: row.assessment_language,
      status: row.assessment_status === 'completed' ? 'completed' : row.assessment_id ? 'in_progress' : 'assigned',
    };
  }

  function getPrescription(id) {
    return prescriptionSummary(selectPrescription.get(id));
  }

  function patientPrescriptions(demoPatientId) {
    return listPrescriptions.all(demoPatientId).map(prescriptionSummary);
  }

  function prescribe(demoPatientId, formId) {
    if (!/^demo-[a-z]$/.test(demoPatientId) || !['phq9', 'gad7', 'pcl5'].includes(formId)) throw new RangeError('Unsupported prescription.');
    const id = randomUUID();
    insertPrescription.run(id, demoPatientId, formId, new Date().toISOString());
    return getPrescription(id);
  }

  function startPrescription(id, mode, language) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const prescription = getPrescription(id);
      if (!prescription) throw new Error('Prescription not found.');
      if (prescription.assessmentId) {
        let previous = get(prescription.assessmentId);
        if (previous && previous.status === 'in_progress' && language && previous.language !== language) {
          updateLanguage(previous.id, language);
          previous = get(previous.id);
        }
        db.exec('COMMIT');
        return previous;
      }
      const assessment = create(mode, language, prescription.demoPatientId, prescription.formId);
      linkPrescription.run(assessment.id, id);
      db.exec('COMMIT');
      return assessment;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  return { create, get, updateLanguage, record, finalize, results, patientResults, patientAnalytics,
    analyticsOverview, prescribe, getPrescription, patientPrescriptions, startPrescription,
    close: () => db.close() };
}
