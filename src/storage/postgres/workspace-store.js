import { postgresPatientRecords } from "./patient-records.js";
import { createMemoryCache } from "../memory-cache.js";
import { prescriptionSummary, buildOverview } from "../../workspace/analytics-overview.js";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createPatientRecord,
  answerState,
  finalizeState,
  preferencesState,
} from "../../workspace/state.js";
import { patientImportRecord } from "../../workspace/patient-import.js";
import { definition } from "../../workspace/catalogue.js";
import { groupPatientAssessments } from "../../workspace/patient-analytics.js";
import { HttpError } from "../../workspace/errors.js";

export async function openPostgresWorkspace(
  database,
  {
    seed = true,
    patientFile = process.env.NEUROTWIN_PATIENT_FILE ||
      fileURLToPath(
        new URL("../../../local-data/neurotwin-patient.json", import.meta.url),
      ),
  } = {},
) {
  const { pool, table, transaction } = database;
  const recommendations = createMemoryCache();
  const translations = createMemoryCache();
  const patients = table("workspace_patients"),
    prescriptions = table("workspace_prescriptions"),
    sessionsTable = table("workspace_sessions");
  async function patient(id, client = pool) {
    const { rows } = await client.query(
      `SELECT data FROM ${patients} WHERE id=$1`,
      [id],
    );
    if (!rows[0]) throw new HttpError(404, "Patient not found.");
    return rows[0].data;
  }
  async function putPatient(record, seeded = false) {
    await pool.query(
      `INSERT INTO ${patients}(id,data) VALUES($1,$2) ${seeded ? "ON CONFLICT(id) DO NOTHING" : ""}`,
      [record.id, JSON.stringify(record)],
    );
    return record;
  }
  if (seed) {
    if (existsSync(patientFile)) {
      const p = patientImportRecord(
        JSON.parse(readFileSync(patientFile, "utf8")),
      );
      await putPatient(
        {
          ...p,
          id: "john-neurotwin",
          label: p.name,
          source: "NeuroTwin",
          createdAt: new Date().toISOString(),
        },
        true,
      );
    }
    const demos = JSON.parse(
      readFileSync(
        new URL("../../../data/fixtures/demo-patients.json", import.meta.url),
        "utf8",
      ),
    ).slice(1);
    for (const p of demos)
      await putPatient(
        {
          id: p.id,
          name: p.label,
          label: p.label,
          source: "Sample",
          historySummary: [
            p.summary.overview,
            ...p.summary.observations.map(
              (o) => `${o.status}: ${o.description}`,
            ),
          ].join("\n"),
          recordedAge: null,
          gender: null,
          createdAt: new Date().toISOString(),
        },
        true,
      );
  }
  const recordStore = postgresPatientRecords(database);
  await recordStore.backfill();
  async function listPatients() {
    const { rows } = await pool.query(`SELECT data FROM ${patients}`);
    return rows
      .map((r) => r.data)
      .sort((a, b) =>
        a.id === "john-neurotwin"
          ? -1
          : b.id === "john-neurotwin"
            ? 1
            : a.name.localeCompare(b.name),
      )
      .map(({ sourceProfile, ...p }) => p);
  }
  async function get(id, client = pool, lock = false) {
    const { rows } = await client.query(
      `SELECT data FROM ${sessionsTable} WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    );
    if (!rows[0]) throw new HttpError(404, "Session not found.");
    return rows[0].data;
  }
  async function prescription(id, client = pool, lock = false) {
    const { rows } = await client.query(
      `SELECT * FROM ${prescriptions} WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    );
    const r = rows[0];
    if (!r) throw new HttpError(404, "Prescription not found.");
    const existing = await client.query(
      `SELECT data FROM ${sessionsTable} WHERE prescription_id=$1`,
      [id],
    );
    return {
      id: r.id,
      patientId: r.patient_id,
      assessmentId: r.assessment_id,
      createdAt: r.created_at,
      patient: await patient(r.patient_id, client),
      definition: definition(r.assessment_id),
      session: existing.rows[0]?.data || null,
    };
  }
  async function prescribe(patientId, assessmentId) {
    await patient(patientId);
    const d = definition(assessmentId);
    if (!d?.runnable)
      throw new HttpError(
        422,
        d?.availabilityReason || "Assessment not available.",
      );
    const id = randomUUID();
    await pool.query(
      `INSERT INTO ${prescriptions}(id,patient_id,assessment_id,created_at) VALUES($1,$2,$3,$4)`,
      [id, patientId, assessmentId, new Date().toISOString()],
    );
    return prescription(id);
  }
  async function createSession(prescriptionId, localized, language, mode) {
    if (!["screen", "chat", "voice"].includes(mode))
      throw new HttpError(400, "Choose Chat, Voice or On-screen.");
    return transaction(async (client) => {
      const rx = await prescription(prescriptionId, client, true);
      if (rx.session) {
        if (rx.session.language !== language || rx.session.sessionMode !== mode)
          throw new HttpError(
            409,
            "This saved session keeps its original language and mode.",
          );
        return rx.session;
      }
      const state = {
        id: randomUUID(),
        prescriptionId,
        patientId: rx.patientId,
        assessmentId: rx.assessmentId,
        language,
        sessionMode: mode,
        definition: localized,
        answers: localized.questions.map(() => null),
        answerDetails: localized.questions.map(() => null),
        answerRevisions: [],
        revision: 0,
        status: "draft",
        startedAt: new Date().toISOString(),
        completedAt: null,
        score: null,
        severity: null,
      };
      await client.query(
        `INSERT INTO ${sessionsTable}(id,prescription_id,data) VALUES($1,$2,$3)`,
        [state.id, prescriptionId, JSON.stringify(state)],
      );
      return state;
    });
  }
  async function change(id, transition) {
    return transaction(async (client) => {
      const result = transition(await get(id, client, true));
      await client.query(`UPDATE ${sessionsTable} SET data=$1 WHERE id=$2`, [
        JSON.stringify(result),
        id,
      ]);
      return result;
    });
  }
  async function sessions(patientId) {
    await patient(patientId);
    const { rows } = await pool.query(
      `SELECT s.data FROM ${sessionsTable} s JOIN ${prescriptions} p ON p.id=s.prescription_id WHERE p.patient_id=$1`,
      [patientId],
    );
    return rows
      .map((r) => r.data)
      .sort((a, b) =>
        (b.completedAt || b.startedAt).localeCompare(
          a.completedAt || a.startedAt,
        ),
      );
  }
  async function prescriptionRows(patientId) {
    const { rows } = await pool.query(`SELECT p.id, p.assessment_id, p.created_at, s.id AS session_id,
        s.data #> '{status}' AS status,
        s.data #> '{definition,title}' AS title,
        s.data #> '{startedAt}' AS started_at,
        s.data #> '{completedAt}' AS completed_at,
        s.data #> '{language}' AS language,
        s.data #> '{score}' AS score,
        s.data #> '{calculatedResults,metrics}' AS result_metrics,
        s.data #> '{definition,scoring,enabled}' AS scoring_enabled,
        s.data #> '{definition,scoring,min}' AS score_min,
        s.data #> '{definition,scoring,max}' AS score_max
      FROM ${prescriptions} p LEFT JOIN ${sessionsTable} s ON s.prescription_id=p.id
      ${patientId === undefined ? "" : "WHERE p.patient_id=$1"}
      ORDER BY p.created_at DESC, p.id`, patientId === undefined ? [] : [patientId]);
    return rows.map(prescriptionSummary);
  }
  async function patientPrescriptions(patientId) {
    await patient(patientId);
    return prescriptionRows(patientId);
  }
  async function analyticsOverview() { return buildOverview(await prescriptionRows()); }
  async function analytics(patientId) {
    const p = await patient(patientId),
      states = await sessions(patientId);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS count FROM ${prescriptions} p WHERE patient_id=$1 AND NOT EXISTS(SELECT 1 FROM ${sessionsTable} s WHERE s.prescription_id=p.id)`,
      [patientId],
    );
    return {
      patient: {
        id: p.id,
        name: p.name,
        recordedAge: p.recordedAge,
        gender: p.gender,
      },
      completed: states.filter((s) => s.status === "completed").length,
      drafts: states.filter((s) => s.status === "draft").length,
      assigned: rows[0].count,
      groups: groupPatientAssessments(states),
    };
  }
  return {
    patient,
    listPatients,
    createPatient: recordStore.createPatient,
    previewPatientImport: recordStore.previewPatientImport,
    importPatient: recordStore.importPatient,
    addPatientNote: recordStore.addPatientNote,
    patientRecords: recordStore.patientRecords,
    patientRecord: recordStore.patientRecord,
    prescribe,
    prescription,
    createSession,
    get,
    answer: (id, input, method = "screen") =>
      change(id, (s) => answerState(s, input, method)),
    finalize: (id, revision) => change(id, (s) => finalizeState(s, revision)),
    preferences: (id, input, localized) => change(id, (s) => preferencesState(s, input, localized)),
    sessions,
    analytics,
    patientPrescriptions,
    analyticsOverview,
    async recommendation(id, hash) {
      if (!database.persistentCaches) return recommendations.get([id, hash]);
      const r = await pool.query(
        `SELECT data FROM ${table("workspace_recommendations")} WHERE patient_id=$1 AND context_hash=$2`,
        [id, hash],
      );
      return r.rows[0]?.data || null;
    },
    async saveRecommendation(id, hash, data) {
      if (!database.persistentCaches) return recommendations.set([id, hash], data);
      await pool.query(
        `INSERT INTO ${table("workspace_recommendations")} VALUES($1,$2,$3) ON CONFLICT(patient_id) DO UPDATE SET context_hash=EXCLUDED.context_hash,data=EXCLUDED.data`,
        [id, hash, JSON.stringify(data)],
      );
    },
    async translation(hash, language) {
      if (!database.persistentCaches) return translations.get([hash, language]);
      const r = await pool.query(
        `SELECT data FROM ${table("workspace_translations")} WHERE hash=$1 AND language=$2`,
        [hash, language],
      );
      return r.rows[0]?.data || null;
    },
    async saveTranslation(hash, language, data) {
      if (!database.persistentCaches) return translations.set([hash, language], data);
      await pool.query(
        `INSERT INTO ${table("workspace_translations")} VALUES($1,$2,$3) ON CONFLICT(hash,language) DO UPDATE SET data=EXCLUDED.data`,
        [hash, language, JSON.stringify(data)],
      );
    },
    close() {},
  };
}
