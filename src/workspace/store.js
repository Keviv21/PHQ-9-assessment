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
  function createPatient(input) {
    if (
      typeof input.name !== "string" ||
      !input.name.trim() ||
      input.name.length > 150
    )
      throw new HttpError(400, "Enter a patient name (up to 150 characters).");
    if (
      typeof input.historySummary !== "string" ||
      !input.historySummary.trim() ||
      input.historySummary.length > 24000
    )
      throw new HttpError(
        400,
        "Enter a patient history summary (up to 24,000 characters).",
      );
    const age =
      input.age === "" || input.age == null ? null : Number(input.age);
    if (age !== null && (!Number.isInteger(age) || age < 0 || age > 130))
      throw new HttpError(400, "Enter a valid age.");
    if (
      input.email &&
      (typeof input.email !== "string" ||
        input.email.length > 254 ||
        !/^\S+@\S+\.\S+$/.test(input.email))
    )
      throw new HttpError(400, "Enter a valid email address.");
    if (
      input.gender &&
      !["Male", "Female", "Other", "Prefer not to say"].includes(input.gender)
    )
      throw new HttpError(400, "Choose a gender from the list.");
    return putPatient({
      id: randomUUID(),
      name: input.name.trim(),
      label: input.name.trim(),
      recordedAge: age,
      gender: input.gender || null,
      email: input.email || null,
      historySummary: input.historySummary.trim(),
      source: "Added by clinician",
      createdAt: new Date().toISOString(),
    });
  }
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
  function answer(id, { questionId, value, revision }, method = "screen") {
    const s = get(id);
    if (s.status !== "draft" || revision !== s.revision)
      throw new HttpError(
        409,
        "The answer changed. Refresh this session before trying again.",
      );
    const index = s.definition.questions.findIndex((q) => q.id === questionId);
    if (
      index < 0 ||
      !s.definition.questions[index].options.some((o) => o.value === value)
    )
      throw new HttpError(400, "Choose a valid response.");
    if (
      index > s.answers.findIndex((v) => v === null) &&
      s.answers.some((v) => v === null)
    )
      throw new HttpError(409, "Answer the current question first.");
    s.answers[index] = value;
    s.revision++;
    return update(s);
  }
  function finalize(id, revision) {
    const s = get(id);
    if (s.status === "completed") return s;
    if (s.revision !== revision)
      throw new HttpError(409, "Answers changed; review them again.");
    if (s.answers.includes(null))
      throw new HttpError(400, "Answer every question before saving.");
    Object.assign(s, scoreDefinition(s.definition, s.answers), {
      status: "completed",
      completedAt: new Date().toISOString(),
    });
    s.revision++;
    return update(s);
  }
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
