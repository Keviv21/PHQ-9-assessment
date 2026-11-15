import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { getLiveDraftForm } from './draft-library.js';

export function openDraftStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS draft_sessions (
    id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('demo', 'live')),
    status TEXT NOT NULL CHECK (status IN ('in_progress', 'review', 'completed')),
    answers_json TEXT NOT NULL,
    review_change_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT
  ) STRICT`);
  db.exec(`CREATE TABLE IF NOT EXISTS draft_prescriptions (
    id TEXT PRIMARY KEY,
    demo_patient_id TEXT NOT NULL,
    draft_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT`);
  if (!db.prepare('PRAGMA table_info(draft_sessions)').all().some((column) => column.name === 'prescription_id')) {
    db.exec('ALTER TABLE draft_sessions ADD COLUMN prescription_id TEXT');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS draft_session_prescription ON draft_sessions(prescription_id) WHERE prescription_id IS NOT NULL');
  const insert = db.prepare("INSERT INTO draft_sessions (id, draft_id, mode, status, answers_json, started_at, prescription_id) VALUES (?, ?, ?, 'in_progress', '[]', ?, ?)");
  const select = db.prepare(`SELECT s.*, p.demo_patient_id FROM draft_sessions s
    LEFT JOIN draft_prescriptions p ON p.id = s.prescription_id WHERE s.id = ?`);
  const listRecent = db.prepare('SELECT id, draft_id, mode, status, started_at, completed_at FROM draft_sessions ORDER BY started_at DESC LIMIT 25');
  const insertPrescription = db.prepare('INSERT INTO draft_prescriptions (id, demo_patient_id, draft_id, created_at) VALUES (?, ?, ?, ?)');
  const selectPrescription = db.prepare(`SELECT p.*, s.id AS session_id, s.status AS session_status, s.mode AS session_mode
    FROM draft_prescriptions p LEFT JOIN draft_sessions s ON s.prescription_id = p.id WHERE p.id = ?`);
  const listPatientPrescriptions = db.prepare(`SELECT p.*, s.id AS session_id, s.status AS session_status, s.mode AS session_mode
    FROM draft_prescriptions p LEFT JOIN draft_sessions s ON s.prescription_id = p.id WHERE p.demo_patient_id = ? ORDER BY p.created_at DESC`);
  const saveAnswers = db.prepare('UPDATE draft_sessions SET answers_json = ?, status = ? WHERE id = ?');
  const complete = db.prepare("UPDATE draft_sessions SET answers_json = ?, status = 'completed', review_change_count = ?, completed_at = ? WHERE id = ? AND status = 'review'");

  function get(id) {
    const row = select.get(id);
    if (!row) return null;
    const answers = JSON.parse(row.answers_json);
    return {
      id: row.id,
      formId: row.draft_id,
      prescriptionId: row.prescription_id,
      demoPatientId: row.demo_patient_id ?? null,
      formVersion: 'imported-draft-v1',
      language: 'en',
      mode: row.mode,
      collectionMethod: row.mode === 'live' ? 'conversational_inference' : 'explicit_choice',
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      currentNumber: row.status === 'in_progress' ? answers.length + 1 : null,
      answers,
      reviewChangeCount: row.review_change_count,
      scores: null,
      unscored: true,
    };
  }

  function create(draftId, mode = 'live', prescriptionId = null) {
    if (!['demo', 'live'].includes(mode)) throw new RangeError('Unsupported mode.');
    if (!getLiveDraftForm(draftId)) throw new RangeError('This assessment does not have complete answer options.');
    const id = randomUUID();
    insert.run(id, draftId, mode, new Date().toISOString(), prescriptionId);
    return get(id);
  }

  function prescriptionSummary(row) {
    if (!row) return null;
    return {
      id: row.id, kind: 'draft', formId: row.draft_id,
      demoPatientId: row.demo_patient_id, createdAt: row.created_at,
      assessmentId: row.session_id, mode: row.session_mode,
      status: row.session_status === 'completed' ? 'completed' : row.session_id ? 'in_progress' : 'assigned',
      unscored: true,
    };
  }

  function getPrescription(id) { return prescriptionSummary(selectPrescription.get(id)); }

  function patientPrescriptions(patientId) {
    return listPatientPrescriptions.all(patientId).map(prescriptionSummary);
  }

  function prescribe(patientId, draftId) {
    if (!/^demo-[a-z]$/.test(patientId) || !getLiveDraftForm(draftId)) {
      throw new RangeError('This imported assessment is unavailable for assignment.');
    }
    const id = randomUUID();
    insertPrescription.run(id, patientId, draftId, new Date().toISOString());
    return getPrescription(id);
  }

  function startPrescription(id, mode) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const prescription = getPrescription(id);
      if (!prescription) throw new Error('Assignment not found.');
      const session = prescription.assessmentId ? get(prescription.assessmentId) :
        create(prescription.formId, mode, id);
      if (session.mode !== mode || session.status === 'completed') throw new Error('Assignment cannot be started in this mode.');
      db.exec('COMMIT');
      return session;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function record(id, number, value, method, summary = null) {
    const state = get(id);
    if (!state || state.status !== 'in_progress') throw new Error('No active draft assessment.');
    const form = getLiveDraftForm(state.formId);
    if (number !== state.currentNumber) throw new RangeError('Answer is for the wrong question.');
    if (!Number.isInteger(value) || value < 0 || value >= form.questions[number - 1].options.length) {
      throw new RangeError('Answer is outside the current question options.');
    }
    if (!['voice', 'screen', 'demo'].includes(method)) throw new RangeError('Unsupported answer method.');
    if (summary !== null && (typeof summary !== 'string' || !summary.trim() || summary.length > 240)) {
      throw new RangeError('Response summary must be short text.');
    }
    const answers = [...state.answers, { number, value, method, responseSummary: summary?.trim() ?? null, answeredAt: new Date().toISOString() }];
    saveAnswers.run(JSON.stringify(answers), answers.length === form.questions.length ? 'review' : 'in_progress', id);
    return get(id);
  }

  function finalize(id, values) {
    const state = get(id);
    if (!state || state.status !== 'review') throw new Error('Assessment is not ready for final review.');
    const form = getLiveDraftForm(state.formId);
    if (!Array.isArray(values) || values.length !== form.questions.length) throw new RangeError('Review every answer before finishing.');
    values.forEach((value, index) => {
      if (!Number.isInteger(value) || value < 0 || value >= form.questions[index].options.length) {
        throw new RangeError(`Invalid answer for question ${index + 1}.`);
      }
    });
    const revisions = values.filter((value, index) => value !== state.answers[index].value).length;
    const answers = state.answers.map((answer, index) => ({ ...answer, value: values[index] }));
    complete.run(JSON.stringify(answers), revisions, new Date().toISOString(), id);
    return get(id);
  }

  function list() {
    return listRecent.all().map((row) => ({
      id: row.id, formId: row.draft_id, mode: row.mode, status: row.status,
      startedAt: row.started_at, completedAt: row.completed_at, unscored: true,
    }));
  }

  return { create, get, record, finalize, list, prescribe, getPrescription,
    patientPrescriptions, startPrescription, close: () => db.close() };
}
