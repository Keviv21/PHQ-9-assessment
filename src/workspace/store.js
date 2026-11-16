import { createPatientRecord, answerState, finalizeState } from "./state.js";
import {
  answerError,
  answerType,
  currentQuestionIndex,
  visibleQuestion,
  responseLabel,
} from "../../public/workspace-answers.js";
import { presentation } from "./presentation.js";
import { groupPatientAssessments } from "./patient-analytics.js";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { patientImportRecord } from "./patient-import.js";
import { definition } from "./catalogue.js";
import { scoreDefinition } from "./definition.js";
import { HttpError } from "./errors.js";
export function openWorkspaceStore(
  path,
  {
    seed = true,
    patientFile = process.env.NEUROTWIN_PATIENT_FILE ||
      fileURLToPath(
        new URL("../../local-data/neurotwin-patient.json", import.meta.url),
      ),
  } = {},
) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS workspace_patients(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_prescriptions(id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES workspace_patients(id),assessment_id TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_sessions(id TEXT PRIMARY KEY,prescription_id TEXT NOT NULL UNIQUE REFERENCES workspace_prescriptions(id),data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_recommendations(patient_id TEXT PRIMARY KEY REFERENCES workspace_patients(id),context_hash TEXT NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_translations(hash TEXT NOT NULL,language TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(hash,language));`);
  const patient = (id) => {
    const r = db
      .prepare("SELECT data FROM workspace_patients WHERE id=?")
      .get(id);
    if (!r) throw new HttpError(404, "Patient not found.");
    return JSON.parse(r.data);
  };
  function putPatient(p) {
    db.prepare("INSERT INTO workspace_patients(id,data) VALUES(?,?)").run(
      p.id,
      JSON.stringify(p),
    );
    return p;
  }
  if (seed) {
    if (
      existsSync(patientFile) &&
      !db
        .prepare("SELECT 1 FROM workspace_patients WHERE id=?")
        .get("john-neurotwin")
    ) {
      const p = patientImportRecord(
        JSON.parse(readFileSync(patientFile, "utf8")),
      );
      putPatient({
        ...p,
        id: "john-neurotwin",
        label: p.name,
        source: "NeuroTwin",
        createdAt: new Date().toISOString(),
      });
    }
    const demos = JSON.parse(
      readFileSync(
        new URL("../../data/demo-patients.json", import.meta.url),
        "utf8",
      ),
    ).slice(1);
    for (const p of demos)
      if (!db.prepare("SELECT 1 FROM workspace_patients WHERE id=?").get(p.id))
        putPatient({
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
        });
  }
  function createPatient(input) { return putPatient(createPatientRecord(input)); }
  const listPatients = () =>
    db
      .prepare("SELECT data FROM workspace_patients")
      .all()
      .map((r) => JSON.parse(r.data))
      .sort((a, b) =>
        a.id === "john-neurotwin"
          ? -1
          : b.id === "john-neurotwin"
            ? 1
            : a.name.localeCompare(b.name),
      )
      .map(({ sourceProfile, ...p }) => p);
  function prescription(id) {
    const r = db
      .prepare("SELECT * FROM workspace_prescriptions WHERE id=?")
      .get(id);
    if (!r) throw new HttpError(404, "Prescription not found.");
    return {
      id: r.id,
      patientId: r.patient_id,
      assessmentId: r.assessment_id,
      createdAt: r.created_at,
      patient: patient(r.patient_id),
      definition: definition(r.assessment_id),
      session: sessionForPrescription(id),
    };
  }
  function prescribe(patientId, assessmentId) {
    patient(patientId);
    const d = definition(assessmentId);
    if (!d?.runnable)
      throw new HttpError(
        422,
        d?.availabilityReason || "Assessment not available.",
      );
    const id = randomUUID();
    db.prepare("INSERT INTO workspace_prescriptions VALUES(?,?,?,?)").run(
      id,
      patientId,
      assessmentId,
      new Date().toISOString(),
    );
    return prescription(id);
  }
  function get(id) {
    const r = db
      .prepare("SELECT data FROM workspace_sessions WHERE id=?")
      .get(id);
    if (!r) throw new HttpError(404, "Session not found.");
    return JSON.parse(r.data);
  }
  function sessionForPrescription(id) {
    const r = db
      .prepare("SELECT data FROM workspace_sessions WHERE prescription_id=?")
      .get(id);
    return r ? JSON.parse(r.data) : null;
  }
  function createSession(prescriptionId, localized, language, mode) {
    if (!["chat", "voice", "screen"].includes(mode))
      throw new HttpError(400, "Choose Chat, Voice or On-screen.");
    const rx = prescription(prescriptionId);
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
    db.prepare("INSERT INTO workspace_sessions VALUES(?,?,?)").run(
      state.id,
      prescriptionId,
      JSON.stringify(state),
    );
    return state;
  }
  function update(state) {
    db.prepare("UPDATE workspace_sessions SET data=? WHERE id=?").run(
      JSON.stringify(state),
      state.id,
    );
    return state;
  }
  function answer(id, input, method = "screen") { return update(answerState(get(id), input, method)); }
  function finalize(id, revision) { return update(finalizeState(get(id), revision)); }
  function sessions(patientId) {
    patient(patientId);
    return db
      .prepare(
        "SELECT s.data FROM workspace_sessions s JOIN workspace_prescriptions p ON p.id=s.prescription_id WHERE p.patient_id=?",
      )
      .all(patientId)
      .map((r) => JSON.parse(r.data))
      .sort((a, b) =>
        (b.completedAt || b.startedAt).localeCompare(
          a.completedAt || a.startedAt,
        ),
      );
  }
  function analytics(patientId) {
    const p = patient(patientId),
      states = sessions(patientId);
    const assigned = db
      .prepare(
        "SELECT count(*) AS count FROM workspace_prescriptions p WHERE patient_id=? AND NOT EXISTS (SELECT 1 FROM workspace_sessions s WHERE s.prescription_id=p.id)",
      )
      .get(patientId).count;
    return {
      patient: {
        id: p.id,
        name: p.name,
        recordedAge: p.recordedAge,
        gender: p.gender,
      },
      completed: states.filter((s) => s.status === "completed").length,
      drafts: states.filter((s) => s.status === "draft").length,
      assigned,
      groups: groupPatientAssessments(states),
    };
  }
  return {
    patient,
    listPatients,
    createPatient,
    prescribe,
    prescription,
    createSession,
    get,
    answer,
    finalize,
    sessions,
    analytics,
    recommendation: (id, hash) => {
      const r = db
        .prepare(
          "SELECT data FROM workspace_recommendations WHERE patient_id=? AND context_hash=?",
        )
        .get(id, hash);
      return r ? JSON.parse(r.data) : null;
    },
    saveRecommendation: (id, hash, data) =>
      db
        .prepare(
          "INSERT INTO workspace_recommendations VALUES(?,?,?) ON CONFLICT(patient_id) DO UPDATE SET context_hash=excluded.context_hash,data=excluded.data",
        )
        .run(id, hash, JSON.stringify(data)),
    translation: (hash, language) => {
      const r = db
        .prepare(
          "SELECT data FROM workspace_translations WHERE hash=? AND language=?",
        )
        .get(hash, language);
      return r ? JSON.parse(r.data) : null;
    },
    saveTranslation: (hash, language, data) =>
      db
        .prepare("INSERT OR REPLACE INTO workspace_translations VALUES(?,?,?)")
        .run(hash, language, JSON.stringify(data)),
    close: () => db.close(),
  };
}
