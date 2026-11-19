import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { scoreAnswers } from '../src/assessment.js';
import { openStore } from '../src/store.js';

test('existing completed results survive the final-review schema upgrade', () => {
  const dir = mkdtempSync(join(tmpdir(), 'phq9-legacy-'));
  const path = join(dir, 'prototype.sqlite');
  try {
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE assessments (
        id TEXT PRIMARY KEY, form_id TEXT NOT NULL CHECK (form_id = 'phq9'), form_version TEXT NOT NULL,
        language TEXT NOT NULL CHECK (language = 'en'), mode TEXT NOT NULL CHECK (mode IN ('demo', 'live')),
        collection_method TEXT NOT NULL CHECK (collection_method IN ('explicit_choice', 'conversational_inference')),
        status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
        started_at TEXT NOT NULL, completed_at TEXT, scores_json TEXT
      ) STRICT;
      CREATE TABLE answers (
        assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
        question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 9),
        value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 3),
        method TEXT NOT NULL CHECK (method IN ('voice', 'screen', 'demo')),
        response_summary TEXT, answered_at TEXT NOT NULL,
        PRIMARY KEY (assessment_id, question_number)
      ) STRICT;
    `);
    const scores = scoreAnswers(Array(9).fill(0));
    old.prepare('INSERT INTO assessments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'legacy', 'phq9', 'v1-prototype', 'en', 'demo', 'explicit_choice', 'completed',
      '2026-11-01T00:00:00.000Z', '2026-11-01T00:01:00.000Z', JSON.stringify(scores),
    );
    const insertAnswer = old.prepare('INSERT INTO answers VALUES (?, ?, ?, ?, ?, ?)');
    for (let number = 1; number <= 9; number++) insertAnswer.run('legacy', number, 0, 'demo', null, '2026-11-01T00:00:00.000Z');
    old.close();

    const store = openStore(path);
    try {
      const previous = store.get('legacy');
      assert.equal(previous.status, 'completed');
      assert.equal(previous.answers.length, 9);
      assert.equal(previous.scores.rawTotal, 0);
      assert.equal(previous.reviewChangeCount, 0);
      assert.equal(previous.language, 'en');
      assert.equal(previous.demoPatientId, null);
      assert.equal(store.create('demo', 'en', 'demo-a').demoPatientId, 'demo-a');
      assert.equal(store.prescribe('demo-a', 'phq9').status, 'assigned');
      let hindi = store.create('demo', 'hi');
      for (let number = 1; number <= 9; number++) hindi = store.record(hindi.id, number, 0, 'demo');
      assert.equal(store.finalize(hindi.id, Array(9).fill(0)).language, 'hi');
      assert.equal(store.get('legacy').answers.length, 9);
      let current = store.create('demo');
      for (let number = 1; number <= 9; number++) current = store.record(current.id, number, 0, 'demo');
      assert.equal(current.status, 'review');
      assert.equal(store.finalize(current.id, Array(9).fill(0)).status, 'completed');
    } finally { store.close(); }
  } finally {
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
    rmdirSync(dir);
  }
});

test('previous PHQ-9 prescriptions and answers survive the three-form schema upgrade', () => {
  const dir = mkdtempSync(join(tmpdir(), 'assessment-three-form-'));
  const path = join(dir, 'prototype.sqlite');
  try {
    const old = new DatabaseSync(path);
    old.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE assessments (
        id TEXT PRIMARY KEY, form_id TEXT NOT NULL CHECK (form_id = 'phq9'),
        form_version TEXT NOT NULL, language TEXT NOT NULL CHECK (language IN ('en', 'hi')),
        mode TEXT NOT NULL CHECK (mode IN ('demo', 'live')),
        collection_method TEXT NOT NULL CHECK (collection_method IN ('explicit_choice', 'conversational_inference')),
        status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
        review_ready INTEGER NOT NULL DEFAULT 0 CHECK (review_ready IN (0, 1)),
        demo_patient_id TEXT, started_at TEXT NOT NULL, completed_at TEXT, scores_json TEXT
      ) STRICT;
      CREATE TABLE answers (
        assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
        question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 9),
        value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 3),
        method TEXT NOT NULL CHECK (method IN ('voice', 'screen', 'demo')),
        response_summary TEXT, answered_at TEXT NOT NULL,
        PRIMARY KEY (assessment_id, question_number)
      ) STRICT;
      CREATE TABLE answer_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
        question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 9),
        previous_value INTEGER NOT NULL CHECK (previous_value BETWEEN 0 AND 3),
        final_value INTEGER NOT NULL CHECK (final_value BETWEEN 0 AND 3), changed_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE prescriptions (
        id TEXT PRIMARY KEY, demo_patient_id TEXT NOT NULL,
        form_id TEXT NOT NULL CHECK (form_id = 'phq9'), created_at TEXT NOT NULL,
        assessment_id TEXT UNIQUE REFERENCES assessments(id)
      ) STRICT;
      INSERT INTO assessments VALUES ('old-session', 'phq9', 'v1-prototype', 'en', 'demo',
        'explicit_choice', 'in_progress', 0, 'demo-a', '2026-11-01T00:00:00.000Z', NULL, NULL);
      INSERT INTO answers VALUES ('old-session', 1, 2, 'demo', NULL, '2026-11-01T00:01:00.000Z');
      INSERT INTO prescriptions VALUES ('old-prescription', 'demo-a', 'phq9',
        '2026-11-01T00:00:00.000Z', 'old-session');
    `);
    old.close();
    const store = openStore(path);
    try {
      assert.equal(store.get('old-session').answers[0].value, 2);
      assert.equal(store.getPrescription('old-prescription').assessmentId, 'old-session');
      assert.equal(store.startPrescription('old-prescription', 'demo', 'en').id, 'old-session');
      assert.equal(store.prescribe('demo-b', 'gad7').formId, 'gad7');
      assert.equal(store.create('demo', 'en', 'demo-c', 'pcl5').formId, 'pcl5');
    } finally { store.close(); }
  } finally {
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
    rmdirSync(dir);
  }
});
