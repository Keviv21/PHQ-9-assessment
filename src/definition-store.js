import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { getDefinition, definitionVersion, sourceSha256 } from './definition-library.js';
import { conditionState, scoreDefinition, validateAnswer } from './definition-scoring.js';
import { contentHash } from './assessment-content.js';

const schema = 'pod_assessment_prototype';
const prescriptionsTable = `${schema}.definition_prescriptions`;
const sessionsTable = `${schema}.definition_sessions`;

function summary(row) {
  if (!row) return null;
  return { id: row.id, kind: 'definition', demoPatientId: row.patient_id,
    formId: row.form_id, assessmentId: row.session_id ?? null,
    createdAt: row.created_at, status: row.session_status ?? 'assigned',
    unscored: !(getDefinition(row.form_id)?.rules.length) };
}

function newSession(prescription) {
  const form = getDefinition(prescription.formId);
  return { id: randomUUID(), prescriptionId: prescription.id, demoPatientId: prescription.demoPatientId,
    formId: form.id, formVersion: form.versionId ?? definitionVersion, sourceSha256: form.sourceSha256 ?? sourceSha256,
    // Save the exact questionnaire and rules used for this session.
    formSnapshot: form, answers: {}, context: {}, status: 'in_progress',
    startedAt: new Date().toISOString(), completedAt: null, scores: null };
}

function validatedAnswers(state, answers, complete) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new RangeError('Answers must be an object.');
  const known = new Set(state.formSnapshot.questions.map(({ id }) => id));
  if (Object.keys(answers).some((id) => !known.has(id))) throw new RangeError('Unknown question ID.');
  const clean = {};
  for (const item of state.formSnapshot.questions) {
    const display = conditionState(item.displayIf, answers, state.formSnapshot.questions, state.context);
    if (display === null && complete) throw new RangeError(`Branch condition for ${item.id} is unresolved.`);
    if (display === false) continue;
    if (!Object.hasOwn(answers, item.id)) {
      if (complete) throw new RangeError(`Answer ${item.id} before submitting.`);
      continue;
    }
    clean[item.id] = validateAnswer(item, answers[item.id]);
  }
  return clean;
}

export function openDefinitionStore({ path, pool } = {}) {
  if (!pool && !path) throw new Error('A database is required.');
  if (pool) return openPostgres(pool);
  return openSqlite(path);
}

function validatedContext(state, context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) throw new RangeError('Context must be an object.');
  const allowed = new Set(['attends_school', 'works_or_studies', 'source_scoring_sex']);
  if (Object.keys(context).some((key) => !allowed.has(key))) throw new RangeError('Unknown assessment context.');
  for (const key of ['attends_school', 'works_or_studies']) {
    if (Object.hasOwn(context, key) && typeof context[key] !== 'boolean') throw new RangeError(`Invalid ${key} context.`);
  }
  if (Object.hasOwn(context, 'source_scoring_sex') && !['female', 'male'].includes(context.source_scoring_sex)) {
    throw new RangeError('Invalid source scoring category.');
  }
  return context;
}

function openSqlite(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS definition_prescriptions (
    id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, form_id TEXT NOT NULL,
    created_at TEXT NOT NULL, session_id TEXT UNIQUE)`);
  db.exec(`CREATE TABLE IF NOT EXISTS definition_sessions (
    id TEXT PRIMARY KEY, prescription_id TEXT NOT NULL UNIQUE,
    state_json TEXT NOT NULL)`);
  const selectPrescription = db.prepare(`SELECT p.*, json_extract(s.state_json,'$.status') AS session_status
    FROM definition_prescriptions p LEFT JOIN definition_sessions s ON s.id=p.session_id WHERE p.id=?`);
  const selectPatient = db.prepare(`SELECT p.*, json_extract(s.state_json,'$.status') AS session_status
    FROM definition_prescriptions p LEFT JOIN definition_sessions s ON s.id=p.session_id
    WHERE p.patient_id=? ORDER BY p.created_at DESC`);
  const selectSession = db.prepare('SELECT state_json FROM definition_sessions WHERE id=?');
  const selectAllAnalytics = db.prepare(`SELECT p.*, s.state_json FROM definition_prescriptions p
    LEFT JOIN definition_sessions s ON s.id=p.session_id ORDER BY p.created_at`);
  const selectPatientAnalytics = db.prepare(`SELECT p.id AS prescription_id, s.state_json FROM definition_prescriptions p
    JOIN definition_sessions s ON s.id=p.session_id WHERE p.patient_id=? ORDER BY p.created_at`);
  const update = db.prepare('UPDATE definition_sessions SET state_json=? WHERE id=?');
  function getSession(id) { const row = selectSession.get(id); return row ? JSON.parse(row.state_json) : null; }
  function getPrescription(id) { return summary(selectPrescription.get(id)); }
  return {
    initialize: async () => true, getPrescription,
    patientPrescriptions: async (id) => selectPatient.all(id).map(summary),
    async prescribe(patientId, formId) {
      if (!/^demo-[a-z]$/.test(patientId) || !getDefinition(formId)?.questions.length) throw new RangeError('Assessment unavailable.');
      const id = randomUUID();
      db.prepare('INSERT INTO definition_prescriptions VALUES (?,?,?,?,NULL)').run(id, patientId, formId, new Date().toISOString());
      return getPrescription(id);
    },
    async start(prescriptionId) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const prescription = getPrescription(prescriptionId);
        if (!prescription) throw new RangeError('Assignment not found.');
        if (prescription.assessmentId) { db.exec('COMMIT'); return getSession(prescription.assessmentId); }
        const state = newSession(prescription);
        db.prepare('INSERT INTO definition_sessions VALUES (?,?,?)').run(state.id, prescriptionId, JSON.stringify(state));
        db.prepare('UPDATE definition_prescriptions SET session_id=? WHERE id=?').run(state.id, prescriptionId);
        db.exec('COMMIT'); return state;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    getSession: async (id) => getSession(id),
    async analyticsPrescriptionRows() {
      return selectAllAnalytics.all().map((row) => ({
        form_id: `definition:${row.form_id}`, form_title: getDefinition(row.form_id)?.title || row.form_id,
        created_at: row.created_at, assessment_id: row.session_id,
        assessment_status: row.state_json ? JSON.parse(row.state_json).status : null,
        completed_at: row.state_json ? JSON.parse(row.state_json).completedAt : null,
      }));
    },
    async patientSessions(patientId) {
      return selectPatientAnalytics.all(patientId).map(row => JSON.parse(row.state_json));
    },
    async patientAnalyticsRows(patientId) {
      return selectPatientAnalytics.all(patientId).map((row) => ({ id: JSON.parse(row.state_json).id,
        prescription_id: row.prescription_id, kind: 'definition', ...definitionAnalyticsState(JSON.parse(row.state_json)) }))
        .filter((row) => row.completed_at);
    },
    async save(id, answers, finish = false, context = null) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const state = getSession(id);
        if (!state || state.status !== 'in_progress') throw new RangeError('Session is unavailable.');
        if (context !== null) state.context = validatedContext(state, context);
        state.answers = validatedAnswers(state, answers, finish);
        if (finish) {
          state.status = 'completed'; state.completedAt = new Date().toISOString();
          state.scores = scoreDefinition(state.formSnapshot, state.answers, state.context);
        }
        update.run(JSON.stringify(state), id);
        db.exec('COMMIT'); return state;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close: async () => db.close(),
  };
}

function openPostgres(pool) {
  const patientIdPattern = /^(?:demo-[a-z]|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
  async function getPrescription(id, client = pool) {
    const result = await client.query(`SELECT p.*, s.state->>'status' AS session_status FROM ${prescriptionsTable} p
      LEFT JOIN ${sessionsTable} s ON s.id=p.session_id WHERE p.id=$1`, [id]);
    const row = result.rows[0];
    return summary(row && { ...row, created_at: row.created_at.toISOString() });
  }
  async function getSession(id, client = pool, lock = false) {
    const result = await client.query(`SELECT state FROM ${sessionsTable} WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
    return result.rows[0]?.state ?? null;
  }
  async function transaction(operation) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await operation(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  return {
    async initialize(client = pool) {
      await client.query(`CREATE TABLE IF NOT EXISTS ${sessionsTable} (
        id UUID PRIMARY KEY, prescription_id UUID NOT NULL UNIQUE, state JSONB NOT NULL)`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${prescriptionsTable} (
        id UUID PRIMARY KEY, patient_id TEXT NOT NULL, form_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), session_id UUID UNIQUE REFERENCES ${sessionsTable}(id))`);
    },
    getPrescription,
    async patientPrescriptions(patientId) {
      const result = await pool.query(`SELECT p.*, s.state->>'status' AS session_status FROM ${prescriptionsTable} p
        LEFT JOIN ${sessionsTable} s ON s.id=p.session_id WHERE p.patient_id=$1 ORDER BY p.created_at DESC`, [patientId]);
      return result.rows.map((row) => summary({ ...row, created_at: row.created_at.toISOString() }));
    },
    async prescribe(patientId, formId) {
      if (!patientIdPattern.test(patientId) || !getDefinition(formId)?.questions.length) throw new RangeError('Assessment unavailable.');
      const id = randomUUID();
      await pool.query(`INSERT INTO ${prescriptionsTable} (id, patient_id, form_id) VALUES ($1,$2,$3)`, [id, patientId, formId]);
      return getPrescription(id);
    },
    async start(prescriptionId) {
      return transaction(async (client) => {
        const result = await client.query(`SELECT id, patient_id, form_id, session_id, created_at FROM ${prescriptionsTable} WHERE id=$1 FOR UPDATE`, [prescriptionId]);
        const row = result.rows[0];
        if (!row) throw new RangeError('Assignment not found.');
        if (row.session_id) return getSession(row.session_id, client);
        const state = newSession(summary({ ...row, created_at: row.created_at.toISOString() }));
        await client.query(`INSERT INTO ${sessionsTable} (id,prescription_id,state) VALUES ($1,$2,$3::jsonb)`, [state.id, prescriptionId, JSON.stringify(state)]);
        await client.query(`UPDATE ${prescriptionsTable} SET session_id=$1 WHERE id=$2`, [state.id, prescriptionId]);
        return state;
      });
    },
    getSession,
    async analyticsPrescriptionRows() {
      const result = await pool.query(`SELECT p.*, s.state->>'status' AS session_status,
        s.state->>'completedAt' AS completed_at FROM ${prescriptionsTable} p
        LEFT JOIN ${sessionsTable} s ON s.id=p.session_id ORDER BY p.created_at`);
      return result.rows.map((row) => ({ form_id: `definition:${row.form_id}`,
        form_title: getDefinition(row.form_id)?.title || row.form_id,
        created_at: row.created_at.toISOString(), assessment_id: row.session_id,
        assessment_status: row.session_status, completed_at: row.completed_at }));
    },
    async patientSessions(patientId) {
      const result = await pool.query(`SELECT s.state FROM ${prescriptionsTable} p JOIN ${sessionsTable} s ON s.id=p.session_id WHERE p.patient_id=$1`, [patientId]);
      return result.rows.map(row => row.state);
    },
    async patientAnalyticsRows(patientId) {
      const result = await pool.query(`SELECT p.id AS prescription_id, s.state FROM ${prescriptionsTable} p
        JOIN ${sessionsTable} s ON s.id=p.session_id WHERE p.patient_id=$1 ORDER BY p.created_at`, [patientId]);
      return result.rows.map((row) => ({ id: row.state.id, prescription_id: row.prescription_id,
        kind: 'definition', ...definitionAnalyticsState(row.state) })).filter((row) => row.completed_at);
    },
    async save(id, answers, finish = false, context = null) {
      return transaction(async (client) => {
        const state = await getSession(id, client, true);
        if (!state || state.status !== 'in_progress') throw new RangeError('Session is unavailable.');
        if (context !== null) state.context = validatedContext(state, context);
        state.answers = validatedAnswers(state, answers, finish);
        if (finish) {
          state.status = 'completed'; state.completedAt = new Date().toISOString();
          state.scores = scoreDefinition(state.formSnapshot, state.answers, state.context);
        }
        await client.query(`UPDATE ${sessionsTable} SET state=$1::jsonb WHERE id=$2`, [JSON.stringify(state), id]);
        return state;
      });
    },
    close: async () => {},
  };
}

function definitionAnalyticsState(state) {
  return { form_id: `definition:${state.formId}`, form_title: state.formSnapshot.title,
    form_version: state.formSnapshot.versionId ?? state.formVersion, language: state.formSnapshot.language || 'en', mode: 'screen',
    compatibility_key: contentHash({ definition: state.formSnapshot.runtimeHash ?? state.formSnapshot, context: state.context || {}, engine: state.scores?.engineVersion ?? 'legacy' }),
    overall_metric_id: state.formSnapshot.reporting?.interpretation?.overall_total ?? null,
    completed_at: state.completedAt, scores: state.scores };
}
