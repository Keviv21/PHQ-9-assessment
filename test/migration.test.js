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
