import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { assertAnswer, getForm, scoreAnswers } from './assessment.js';

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS assessments (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL CHECK (form_id = 'phq9'),
      form_version TEXT NOT NULL,
      language TEXT NOT NULL CHECK (language IN ('en', 'hi')),
      mode TEXT NOT NULL CHECK (mode IN ('demo', 'live')),
      collection_method TEXT NOT NULL CHECK (collection_method IN ('explicit_choice', 'conversational_inference')),
      status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
      review_ready INTEGER NOT NULL DEFAULT 0 CHECK (review_ready IN (0, 1)),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      scores_json TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS answers (
      assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 9),
      value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 3),
      method TEXT NOT NULL CHECK (method IN ('voice', 'screen', 'demo')),
      response_summary TEXT,
      answered_at TEXT NOT NULL,
      PRIMARY KEY (assessment_id, question_number)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS answer_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 9),
      previous_value INTEGER NOT NULL CHECK (previous_value BETWEEN 0 AND 3),
      final_value INTEGER NOT NULL CHECK (final_value BETWEEN 0 AND 3),
      changed_at TEXT NOT NULL
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
          language TEXT NOT NULL CHECK (language IN ('en', 'hi')),
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
  const insertAssessment = db.prepare(`INSERT INTO assessments (id, form_id, form_version, language, mode, collection_method, status, started_at)
    VALUES (?, 'phq9', ?, ?, ?, ?, 'in_progress', ?)`);
  const selectAssessment = db.prepare('SELECT * FROM assessments WHERE id = ?');
  const selectAnswers = db.prepare('SELECT * FROM answers WHERE assessment_id = ? ORDER BY question_number');
  const countRevisions = db.prepare('SELECT COUNT(*) AS count FROM answer_revisions WHERE assessment_id = ?');
  const insertAnswer = db.prepare('INSERT INTO answers VALUES (?, ?, ?, ?, ?, ?)');
  const markReview = db.prepare("UPDATE assessments SET review_ready = 1 WHERE id = ? AND status = 'in_progress'");
  const updateAnswer = db.prepare('UPDATE answers SET value = ? WHERE assessment_id = ? AND question_number = ?');
  const insertRevision = db.prepare('INSERT INTO answer_revisions (assessment_id, question_number, previous_value, final_value, changed_at) VALUES (?, ?, ?, ?, ?)');
  const completeAssessment = db.prepare("UPDATE assessments SET status = 'completed', completed_at = ?, scores_json = ? WHERE id = ? AND status = 'in_progress'");
  const listCompleted = db.prepare("SELECT * FROM assessments WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 25");

  function get(id) {
    const row = selectAssessment.get(id);
    if (!row) return null;
    const answers = selectAnswers.all(id);
    return {
      id: row.id, formId: row.form_id, formVersion: row.form_version,
      language: row.language, mode: row.mode, collectionMethod: row.collection_method,
      status: row.status === 'completed' ? 'completed' : row.review_ready ? 'review' : 'in_progress',
      startedAt: row.started_at, completedAt: row.completed_at,
      currentNumber: row.status === 'completed' || row.review_ready ? null : answers.length + 1,
      answers: answers.map((answer) => ({ number: answer.question_number, value: answer.value,
        method: answer.method, responseSummary: answer.response_summary, answeredAt: answer.answered_at })),
      reviewChangeCount: countRevisions.get(id).count,
      scores: row.scores_json ? JSON.parse(row.scores_json) : null,
    };
  }

  function create(mode, language = 'en') {
    if (!['demo', 'live'].includes(mode)) throw new RangeError('Unsupported mode.');
    const assessmentForm = getForm(language);
    const id = randomUUID();
    insertAssessment.run(id, assessmentForm.version, language, mode, mode === 'live' ? 'conversational_inference' : 'explicit_choice', new Date().toISOString());
    return get(id);
  }

  function record(id, number, value, method, summary = null) {
    assertAnswer(value);
    if (!['voice', 'screen', 'demo'].includes(method)) throw new RangeError('Unsupported answer method.');
    if (summary !== null && (typeof summary !== 'string' || !summary.trim() || summary.length > 240)) throw new RangeError('Response summary must be short text.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const before = get(id);
      if (!before) throw new Error('Assessment not found.');
      if (before.status !== 'in_progress') throw new Error('Assessment is already completed.');
      if (number !== before.currentNumber) throw new Error('Answer is for the wrong question.');
      const timestamp = new Date().toISOString();
      insertAnswer.run(id, number, value, method, summary?.trim() ?? null, timestamp);
      if (number === 9) markReview.run(id);
      db.exec('COMMIT');
      return get(id);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function finalize(id, finalValues) {
    if (!Array.isArray(finalValues) || finalValues.length !== 9) {
      throw new RangeError('Final review must include exactly nine answers.');
    }
    finalValues.forEach(assertAnswer);
    db.exec('BEGIN IMMEDIATE');
    try {
      const before = get(id);
      if (!before) throw new Error('Assessment not found.');
      if (before.status !== 'review' || before.answers.length !== 9) {
        throw new Error('Assessment is not ready for final review.');
      }
      const timestamp = new Date().toISOString();
      for (let index = 0; index < 9; index++) {
        const previous = before.answers[index].value;
        const final = finalValues[index];
        if (previous !== final) {
          updateAnswer.run(final, id, index + 1);
          insertRevision.run(id, index + 1, previous, final, timestamp);
        }
      }
      const scores = scoreAnswers(finalValues);
      completeAssessment.run(timestamp, JSON.stringify(scores), id);
      db.exec('COMMIT');
      return get(id);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function results() {
    return listCompleted.all().map((row) => ({
      id: row.id, formId: row.form_id, formVersion: row.form_version,
      language: row.language, mode: row.mode, collectionMethod: row.collection_method,
      completedAt: row.completed_at, scores: JSON.parse(row.scores_json),
    }));
  }

  return { create, get, record, finalize, results, close: () => db.close() };
}
