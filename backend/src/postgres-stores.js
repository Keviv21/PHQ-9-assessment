import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { assertAssessmentAnswer, getAssessmentForm, hasBundledTranslation, scoreAssessment, validateAssessmentLanguage } from './forms.js';
import { buildOverview, buildPatientAnalytics } from './analytics.js';
import { getDraftAssessment, getLiveDraftForm } from './draft-library.js';
import { dass21DraftId, scoreImportedAssessment } from './draft-scoring.js';

// Keep the prototype separate from the other application's public tables.
const schema = 'pod_assessment_prototype';
const sessions = `${schema}.sessions`;
const prescriptions = `${schema}.prescriptions`;

export function openPostgresStores(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required for PostgreSQL storage.');
  const parsed = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname ||
      parsed.searchParams.get('sslmode') !== 'verify-full') {
    throw new Error('DATABASE_URL must be a PostgreSQL URL with sslmode=verify-full.');
  }
  const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000 });
  pool.on('error', (error) => {
    console.warn('PostgreSQL idle connection closed:', error.code || error.message);
  });

  async function initialize(initializeAdditional = async () => {}) {
    return transaction(async (client) => {
      // Cold starts can initialize the same database simultaneously. PostgreSQL's
      // IF NOT EXISTS does not itself prevent concurrent catalogue creation races.
      await client.query('SELECT pg_advisory_xact_lock(764920011)');
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${sessions} (
        id UUID PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('scored', 'draft')),
        form_id TEXT NOT NULL,
        patient_id TEXT,
        state JSONB NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${prescriptions} (
        id UUID PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('scored', 'draft')),
        patient_id TEXT NOT NULL,
        form_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        session_id UUID UNIQUE REFERENCES ${sessions}(id)
      )`);
      await client.query(`CREATE INDEX IF NOT EXISTS prototype_sessions_patient_completed
        ON ${sessions}(patient_id, completed_at) WHERE completed_at IS NOT NULL`);
      await client.query(`CREATE INDEX IF NOT EXISTS prototype_prescriptions_patient_created
        ON ${prescriptions}(patient_id, created_at DESC)`);
      await initializeAdditional(client);
      return true;
    });
  }

  async function transaction(operation) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async function getState(id, kind, client = pool, lock = false) {
    const result = await client.query(`SELECT state FROM ${sessions} WHERE id = $1 AND kind = $2${lock ? ' FOR UPDATE' : ''}`, [id, kind]);
    return result.rows[0]?.state ?? null;
  }

  async function putState(state, kind, client = pool) {
    await client.query(`UPDATE ${sessions} SET state = $1::jsonb, completed_at = $2 WHERE id = $3 AND kind = $4`,
      [JSON.stringify(state), state.completedAt, state.id, kind]);
  }

  async function insertState(state, kind, client = pool) {
    await client.query(`INSERT INTO ${sessions} (id, kind, form_id, patient_id, state, started_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)`, [state.id, kind, state.formId,
      state.demoPatientId, JSON.stringify(state), state.startedAt]);
  }

  async function prescriptionRow(id, kind, client = pool, lock = false) {
    const result = await client.query(`SELECT p.*, s.state AS session_state FROM ${prescriptions} p
      LEFT JOIN ${sessions} s ON s.id = p.session_id
      WHERE p.id = $1 AND p.kind = $2${lock ? ' FOR UPDATE OF p' : ''}`, [id, kind]);
    return result.rows[0] ?? null;
  }

  function prescriptionSummary(row) {
    if (!row) return null;
    return { id: row.id, kind: row.kind, formId: row.form_id,
      demoPatientId: row.patient_id, createdAt: row.created_at.toISOString(),
      completedAt: row.session_state?.completedAt ?? null,
      assessmentId: row.session_id, mode: row.session_state?.mode ?? null,
      language: row.session_state?.language ?? null,
      status: row.session_state?.status === 'completed' ? 'completed' :
        row.session_id ? 'in_progress' : 'assigned',
      ...(row.kind === 'draft' ? { unscored: row.form_id !== dass21DraftId } : {}),
    };
  }

  async function listPrescriptions(patientId, kind) {
    const result = await pool.query(`SELECT p.*, s.state AS session_state FROM ${prescriptions} p
      LEFT JOIN ${sessions} s ON s.id = p.session_id
      WHERE p.patient_id = $1 AND p.kind = $2 ORDER BY p.created_at DESC`, [patientId, kind]);
    return result.rows.map(prescriptionSummary);
  }

  async function prescribe(patientId, formId, kind) {
    if (!/^demo-[a-z]$/.test(patientId)) throw new RangeError('Unsupported patient.');
    if (kind === 'scored' && !['phq9', 'gad7', 'pcl5'].includes(formId)) throw new RangeError('Unsupported prescription.');
    if (kind === 'draft' && !getLiveDraftForm(formId)) throw new RangeError('This imported assessment is unavailable for assignment.');
    const id = randomUUID();
    await pool.query(`INSERT INTO ${prescriptions} (id, kind, patient_id, form_id) VALUES ($1, $2, $3, $4)`,
      [id, kind, patientId, formId]);
    return prescriptionSummary(await prescriptionRow(id, kind));
  }

  function newScoredState(mode, language, patientId, formId) {
    if (!['demo', 'live'].includes(mode)) throw new RangeError('Unsupported mode.');
    if (patientId !== null && !/^demo-[a-z]$/.test(patientId)) throw new RangeError('Unsupported demo patient.');
    validateAssessmentLanguage(language);
    const form = getAssessmentForm(formId, hasBundledTranslation(formId, language) ? language : 'en');
    return { id: randomUUID(), formId, formVersion: form.version, language, mode,
      collectionMethod: mode === 'live' ? 'conversational_inference' : 'explicit_choice',
      demoPatientId: patientId, status: 'in_progress', startedAt: new Date().toISOString(),
      completedAt: null, currentNumber: 1, answers: [], reviewChangeCount: 0,
      answerRevisions: [], scores: null };
  }

  const scoredStore = {
    async create(mode, language = 'en', patientId = null, formId = 'phq9') {
      const state = newScoredState(mode, language, patientId, formId);
      await insertState(state, 'scored');
      return state;
    },
    get: (id) => getState(id, 'scored'),
    async updateLanguage(id, language) {
      return transaction(async (client) => {
        const state = await getState(id, 'scored', client, true);
        if (!state || state.status === 'completed') throw new Error('No active assessment.');
        state.language = validateAssessmentLanguage(language);
        await putState(state, 'scored', client);
        return state;
      });
    },
    async record(id, number, value, method, summary = null) {
      if (!['voice', 'screen', 'demo'].includes(method)) throw new RangeError('Unsupported answer method.');
      if (summary !== null && (typeof summary !== 'string' || !summary.trim() || summary.length > 240)) throw new RangeError('Response summary must be short text.');
      return transaction(async (client) => {
        const state = await getState(id, 'scored', client, true);
        if (!state) throw new Error('Assessment not found.');
        assertAssessmentAnswer(state.formId, value);
        if (state.status !== 'in_progress') throw new Error('Assessment is already completed.');
        if (number !== state.currentNumber) throw new Error('Answer is for the wrong question.');
        state.answers.push({ number, value, method, responseSummary: summary?.trim() ?? null,
          answeredAt: new Date().toISOString() });
        if (state.answers.length === getAssessmentForm(state.formId).questions.length) {
          state.status = 'review';
          state.currentNumber = null;
        } else state.currentNumber = state.answers.length + 1;
        await putState(state, 'scored', client);
        return state;
      });
    },
    async finalize(id, finalValues) {
      if (!Array.isArray(finalValues)) throw new RangeError('Final review needs an answer array.');
      return transaction(async (client) => {
        const state = await getState(id, 'scored', client, true);
        if (!state) throw new Error('Assessment not found.');
        const count = getAssessmentForm(state.formId).questions.length;
        if (state.status !== 'review' || state.answers.length !== count || finalValues.length !== count) {
          throw new Error('Assessment is not ready for final review.');
        }
        finalValues.forEach((value) => assertAssessmentAnswer(state.formId, value));
        const changedAt = new Date().toISOString();
        finalValues.forEach((value, index) => {
          if (value !== state.answers[index].value) state.answerRevisions.push({
            questionNumber: index + 1, previousValue: state.answers[index].value,
            finalValue: value, changedAt,
          });
        });
        state.reviewChangeCount = state.answerRevisions.length;
        state.answers.forEach((answer, index) => { answer.value = finalValues[index]; });
        state.scores = scoreAssessment(state.formId, finalValues);
        state.status = 'completed';
        state.completedAt = new Date().toISOString();
        await putState(state, 'scored', client);
        return state;
      });
    },
    async results() {
      const result = await pool.query(`SELECT state FROM ${sessions} WHERE kind = 'scored' AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 25`);
      return result.rows.map(({ state }) => scoredSummary(state));
    },
    async patientResults(patientId) {
      const result = await pool.query(`SELECT state FROM ${sessions} WHERE kind = 'scored' AND patient_id = $1 AND completed_at IS NOT NULL ORDER BY completed_at DESC`, [patientId]);
      return result.rows.map(({ state }) => scoredSummary(state));
    },
    async patientAnalytics(patientId, importedRows = []) {
      const result = await pool.query(`SELECT state FROM ${sessions} WHERE kind = 'scored' AND patient_id = $1 AND completed_at IS NOT NULL ORDER BY completed_at, id`, [patientId]);
      return buildPatientAnalytics(patientId, [...result.rows.map(({ state }) => ({
        id: state.id, form_id: state.formId, form_version: state.formVersion,
        language: state.language, mode: state.mode, completed_at: state.completedAt,
        scores: state.scores,
      })), ...importedRows]);
    },
    async analyticsOverview(importedRows = []) {
      const result = await pool.query(`SELECT p.form_id, p.created_at, p.session_id AS assessment_id,
        s.state->>'status' AS assessment_status, s.completed_at FROM ${prescriptions} p
        LEFT JOIN ${sessions} s ON s.id = p.session_id WHERE p.kind = 'scored' ORDER BY p.created_at`);
      return buildOverview([...result.rows.map(analyticsRow), ...importedRows]);
    },
    prescribe: (patientId, formId) => prescribe(patientId, formId, 'scored'),
    getPrescription: async (id) => prescriptionSummary(await prescriptionRow(id, 'scored')),
    patientPrescriptions: (patientId) => listPrescriptions(patientId, 'scored'),
    async startPrescription(id, mode, language) {
      const state = await transaction(async (client) => {
        const row = await prescriptionRow(id, 'scored', client, true);
        if (!row) throw new Error('Prescription not found.');
        if (row.session_id) {
          const previous = await getState(row.session_id, 'scored', client, true);
          if (previous?.status === 'in_progress' && language && previous.language !== language) {
            previous.language = validateAssessmentLanguage(language);
            await putState(previous, 'scored', client);
          }
          return previous;
        }
        const fresh = newScoredState(mode, language, row.patient_id, row.form_id);
        await insertState(fresh, 'scored', client);
        await client.query(`UPDATE ${prescriptions} SET session_id = $1 WHERE id = $2`, [fresh.id, id]);
        return fresh;
      });
      return state;
    },
    close: async () => {},
  };

  function scoredSummary(state) {
    return { id: state.id, formId: state.formId, formVersion: state.formVersion,
      language: state.language, mode: state.mode, collectionMethod: state.collectionMethod,
      demoPatientId: state.demoPatientId, completedAt: state.completedAt, scores: state.scores };
  }

  function analyticsRow(row) {
    return { ...row, created_at: row.created_at.toISOString(),
      completed_at: row.completed_at?.toISOString() ?? null };
  }

  function newDraftState(formId, mode, prescriptionId = null, patientId = null) {
    if (!['demo', 'live'].includes(mode)) throw new RangeError('Unsupported mode.');
    if (!getLiveDraftForm(formId)) throw new RangeError('This assessment does not have complete answer options.');
    return { id: randomUUID(), formId, prescriptionId, demoPatientId: patientId,
      formVersion: 'imported-draft-v1', language: 'en', mode,
      collectionMethod: mode === 'live' ? 'conversational_inference' : 'explicit_choice',
      status: 'in_progress', startedAt: new Date().toISOString(), completedAt: null,
      currentNumber: 1, answers: [], reviewChangeCount: 0, scores: null, unscored: true };
  }

  const draftStore = {
    async create(formId, mode = 'live', prescriptionId = null) {
      const state = newDraftState(formId, mode, prescriptionId);
      await insertState(state, 'draft');
      return state;
    },
    get: (id) => getState(id, 'draft'),
    async record(id, number, value, method, summary = null) {
      return transaction(async (client) => {
        const state = await getState(id, 'draft', client, true);
        if (!state || state.status !== 'in_progress') throw new Error('No active draft assessment.');
        const form = getLiveDraftForm(state.formId);
        if (number !== state.currentNumber) throw new RangeError('Answer is for the wrong question.');
        if (!Number.isInteger(value) || value < 0 || value >= form.questions[number - 1].options.length) throw new RangeError('Answer is outside the current question options.');
        if (!['voice', 'screen', 'demo'].includes(method)) throw new RangeError('Unsupported answer method.');
        if (summary !== null && (typeof summary !== 'string' || !summary.trim() || summary.length > 240)) throw new RangeError('Response summary must be short text.');
        state.answers.push({ number, value, method, responseSummary: summary?.trim() ?? null,
          answeredAt: new Date().toISOString() });
        if (state.answers.length === form.questions.length) {
          state.status = 'review';
          state.currentNumber = null;
        } else state.currentNumber = state.answers.length + 1;
        await putState(state, 'draft', client);
        return state;
      });
    },
    async finalize(id, values) {
      return transaction(async (client) => {
        const state = await getState(id, 'draft', client, true);
        if (!state || state.status !== 'review') throw new Error('Assessment is not ready for final review.');
        const form = getLiveDraftForm(state.formId);
        if (!Array.isArray(values) || values.length !== form.questions.length) throw new RangeError('Review every answer before finishing.');
        values.forEach((value, index) => {
          if (!Number.isInteger(value) || value < 0 || value >= form.questions[index].options.length) throw new RangeError(`Invalid answer for question ${index + 1}.`);
        });
        state.reviewChangeCount = values.filter((value, index) => value !== state.answers[index].value).length;
        state.answers.forEach((answer, index) => { answer.value = values[index]; });
        state.status = 'completed';
        state.completedAt = new Date().toISOString();
        state.scores = scoreImportedAssessment(state.formId, values);
        state.unscored = !state.scores;
        await putState(state, 'draft', client);
        return state;
      });
    },
    async list() {
      const result = await pool.query(`SELECT state FROM ${sessions} WHERE kind = 'draft' ORDER BY started_at DESC LIMIT 25`);
      return result.rows.map(({ state }) => ({ id: state.id, formId: state.formId,
        mode: state.mode, status: state.status, startedAt: state.startedAt,
        completedAt: state.completedAt, unscored: state.formId !== dass21DraftId }));
    },
    prescribe: (patientId, formId) => prescribe(patientId, formId, 'draft'),
    getPrescription: async (id) => prescriptionSummary(await prescriptionRow(id, 'draft')),
    patientPrescriptions: (patientId) => listPrescriptions(patientId, 'draft'),
    async startPrescription(id, mode) {
      return transaction(async (client) => {
        const row = await prescriptionRow(id, 'draft', client, true);
        if (!row) throw new Error('Assignment not found.');
        if (row.session_id) {
          if (row.session_state.mode !== mode || row.session_state.status === 'completed') throw new Error('Assignment cannot be started in this mode.');
          return row.session_state;
        }
        const state = newDraftState(row.form_id, mode, id, row.patient_id);
        await insertState(state, 'draft', client);
        await client.query(`UPDATE ${prescriptions} SET session_id = $1 WHERE id = $2`, [state.id, id]);
        return state;
      });
    },
    async analyticsPrescriptionRows() {
      const result = await pool.query(`SELECT p.*, s.state AS session_state, s.completed_at FROM ${prescriptions} p
        LEFT JOIN ${sessions} s ON s.id = p.session_id WHERE p.kind = 'draft' ORDER BY p.created_at`);
      return result.rows.map((row) => ({ form_id: row.form_id === dass21DraftId ? 'dass21' : `draft:${row.form_id}`,
        form_title: getDraftAssessment(row.form_id)?.title || row.form_id,
        created_at: row.created_at.toISOString(), assessment_id: row.session_id,
        assessment_status: row.session_state?.status ?? null,
        completed_at: row.completed_at?.toISOString() ?? null }));
    },
    async patientAnalyticsRows(patientId) {
      const result = await pool.query(`SELECT p.id AS prescription_id, s.state FROM ${prescriptions} p
        JOIN ${sessions} s ON s.id = p.session_id
        WHERE p.kind = 'draft' AND p.patient_id = $1 AND s.completed_at IS NOT NULL
        ORDER BY s.completed_at, s.id`, [patientId]);
      return result.rows.map(({ prescription_id, state }) => ({ id: state.id, prescription_id,
        form_id: state.formId === dass21DraftId ? 'dass21' : `draft:${state.formId}`,
        form_title: getDraftAssessment(state.formId)?.title || state.formId,
        form_version: state.formVersion, language: state.language, mode: state.mode,
        completed_at: state.completedAt, scores: state.scores }));
    },
    close: async () => {},
  };

  return { store: scoredStore, draftStore, initialize, pool,
    health: async () => { await pool.query('SELECT 1'); return true; },
    close: () => pool.end(), schema };
}
