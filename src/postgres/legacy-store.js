import { randomUUID } from "node:crypto";
import {
  getAssessmentForm,
  assertAssessmentAnswer,
  scoreAssessment,
} from "../forms.js";
import { getLiveDraftForm } from "../draft-library.js";
import { buildOverview, buildPatientAnalytics } from "../analytics.js";

export function openPostgresLegacy(database, { draft = false } = {}) {
  const { pool, table, transaction } = database;
  const sessions = table(draft ? "draft_sessions" : "legacy_sessions"),
    prescriptions = table("legacy_prescriptions");
  async function get(id, client = pool, lock = false) {
    const r = await client.query(
      `SELECT data FROM ${sessions} WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    );
    return r.rows[0]?.data || null;
  }
  async function save(s, client) {
    await client.query(`UPDATE ${sessions} SET data=$1 WHERE id=$2`, [
      JSON.stringify(s),
      s.id,
    ]);
    return s;
  }
  async function insert(s, client = pool) {
    await client.query(`INSERT INTO ${sessions} VALUES($1,$2)`, [
      s.id,
      JSON.stringify(s),
    ]);
    return s;
  }
  function form(s) {
    return draft
      ? getLiveDraftForm(s.formId)
      : getAssessmentForm(s.formId, s.language);
  }
  function checkValue(s, value, number) {
    if (draft) {
      if (
        !Number.isInteger(value) ||
        value < 0 ||
        value >= form(s).questions[number - 1].options.length
      )
        throw new RangeError("Answer is outside the current question options.");
    } else assertAssessmentAnswer(s.formId, value);
  }
  async function create(
    mode,
    language = "en",
    demoPatientId = null,
    formId = "phq9",
    client = pool,
  ) {
    if (!["demo", "live"].includes(mode))
      throw new RangeError("Unsupported mode.");
    if (demoPatientId !== null && !/^demo-[a-z]$/.test(demoPatientId))
      throw new RangeError("Unsupported demo patient.");
    const f = getAssessmentForm(formId, language);
    return insert(
      {
        id: randomUUID(),
        formId,
        formVersion: f.version,
        language,
        mode,
        collectionMethod:
          mode === "live" ? "conversational_inference" : "explicit_choice",
        demoPatientId,
        status: "in_progress",
        startedAt: new Date().toISOString(),
        completedAt: null,
        currentNumber: 1,
        answers: [],
        reviewChangeCount: 0,
        scores: null,
      },
      client,
    );
  }
  async function createDraft(draftId, mode = "live") {
    if (!["demo", "live"].includes(mode))
      throw new RangeError("Unsupported mode.");
    if (!getLiveDraftForm(draftId))
      throw new RangeError(
        "This assessment does not have complete answer options.",
      );
    return insert({
      id: randomUUID(),
      formId: draftId,
      formVersion: "imported-draft-v1",
      language: "en",
      mode,
      collectionMethod:
        mode === "live" ? "conversational_inference" : "explicit_choice",
      status: "in_progress",
      startedAt: new Date().toISOString(),
      completedAt: null,
      currentNumber: 1,
      answers: [],
      reviewChangeCount: 0,
      scores: null,
      unscored: true,
    });
  }
  async function record(id, number, value, method, summary = null) {
    if (!["voice", "screen", "demo"].includes(method))
      throw new RangeError("Unsupported answer method.");
    if (
      summary !== null &&
      (typeof summary !== "string" || !summary.trim() || summary.length > 240)
    )
      throw new RangeError("Response summary must be short text.");
    return transaction(async (client) => {
      const s = await get(id, client, true);
      if (!s || s.status !== "in_progress")
        throw new Error("No active assessment.");
      if (number !== s.currentNumber)
        throw new RangeError("Answer is for the wrong question.");
      checkValue(s, value, number);
      s.answers.push({
        number,
        value,
        method,
        responseSummary: summary?.trim() ?? null,
        answeredAt: new Date().toISOString(),
      });
      s.status =
        s.answers.length === form(s).questions.length
          ? "review"
          : "in_progress";
      s.currentNumber = s.status === "review" ? null : s.answers.length + 1;
      return save(s, client);
    });
  }
  async function finalize(id, values) {
    return transaction(async (client) => {
      const s = await get(id, client, true);
      if (
        !s ||
        s.status !== "review" ||
        !Array.isArray(values) ||
        values.length !== form(s).questions.length
      )
        throw new RangeError("Assessment is not ready for final review.");
      values.forEach((v, i) => checkValue(s, v, i + 1));
      const at = new Date().toISOString();
      s.answerRevisions ||= [];
      values.forEach((v, i) => {
        if (v !== s.answers[i].value) {
          s.reviewChangeCount++;
          s.answerRevisions.push({
            number: i + 1,
            previousValue: s.answers[i].value,
            finalValue: v,
            changedAt: at,
          });
        }
        s.answers[i].value = v;
      });
      s.status = "completed";
      s.completedAt = at;
      s.currentNumber = null;
      s.scores = draft ? null : scoreAssessment(s.formId, values);
      return save(s, client);
    });
  }
  async function all() {
    return (await pool.query(`SELECT data FROM ${sessions}`)).rows.map(
      (r) => r.data,
    );
  }
  const summary = (s) => ({
    id: s.id,
    formId: s.formId,
    formVersion: s.formVersion,
    language: s.language,
    mode: s.mode,
    collectionMethod: s.collectionMethod,
    demoPatientId: s.demoPatientId,
    completedAt: s.completedAt,
    scores: s.scores,
  });
  async function completed(patientId) {
    return (await all())
      .filter(
        (s) =>
          s.status === "completed" &&
          (!patientId || s.demoPatientId === patientId),
      )
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  }
  async function getPrescription(id, client = pool, lock = false) {
    const r = await client.query(
      `SELECT data FROM ${prescriptions} WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    );
    if (!r.rows[0]) return null;
    const p = r.rows[0].data,
      s = p.assessmentId ? await get(p.assessmentId, client) : null;
    return {
      ...p,
      mode: s?.mode || null,
      language: s?.language || null,
      status:
        s?.status === "completed"
          ? "completed"
          : s
            ? "in_progress"
            : "assigned",
    };
  }
  async function prescribe(demoPatientId, formId) {
    if (
      !/^demo-[a-z]$/.test(demoPatientId) ||
      !["phq9", "gad7", "pcl5"].includes(formId)
    )
      throw new RangeError("Unsupported prescription.");
    const p = {
      id: randomUUID(),
      demoPatientId,
      formId,
      createdAt: new Date().toISOString(),
      assessmentId: null,
    };
    await pool.query(`INSERT INTO ${prescriptions} VALUES($1,$2)`, [
      p.id,
      JSON.stringify(p),
    ]);
    return getPrescription(p.id);
  }
  async function startPrescription(id, mode, language) {
    return transaction(async (client) => {
      const p = await getPrescription(id, client, true);
      if (!p) throw new Error("Prescription not found.");
      if (p.assessmentId) return get(p.assessmentId, client);
      const s = await create(mode, language, p.demoPatientId, p.formId, client);
      p.assessmentId = s.id;
      await client.query(`UPDATE ${prescriptions} SET data=$1 WHERE id=$2`, [
        JSON.stringify(p),
        id,
      ]);
      return s;
    });
  }
  async function patientPrescriptions(id) {
    const rows = await pool.query(
      `SELECT id FROM ${prescriptions} WHERE data->>'demoPatientId'=$1 ORDER BY data->>'createdAt' DESC`,
      [id],
    );
    return Promise.all(rows.rows.map((r) => getPrescription(r.id)));
  }
  return {
    get,
    create: draft ? createDraft : create,
    record,
    finalize,
    close() {},
    prescribe,
    getPrescription,
    patientPrescriptions,
    startPrescription,
    async results() {
      return (await completed()).slice(0, 25).map(summary);
    },
    async patientResults(id) {
      return (await completed(id)).map(summary);
    },
    async patientAnalytics(id) {
      return buildPatientAnalytics(
        id,
        (await completed(id)).map((s) => ({
          id: s.id,
          form_id: s.formId,
          form_version: s.formVersion,
          language: s.language,
          mode: s.mode,
          completed_at: s.completedAt,
          scores: s.scores,
        })),
      );
    },
    async analyticsOverview() {
      const rows = await pool.query(`SELECT data FROM ${prescriptions}`);
      return buildOverview(
        await Promise.all(
          rows.rows.map(async ({ data: p }) => {
            const s = p.assessmentId ? await get(p.assessmentId) : null;
            return {
              form_id: p.formId,
              created_at: p.createdAt,
              assessment_id: p.assessmentId,
              assessment_status: s?.status,
              completed_at: s?.completedAt,
            };
          }),
        ),
      );
    },
    async list() {
      return (await all())
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 25)
        .map((s) => ({
          id: s.id,
          formId: s.formId,
          mode: s.mode,
          status: s.status,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
          unscored: true,
        }));
    },
  };
}
