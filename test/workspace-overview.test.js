import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { buildOverview, prescriptionSummary } from "../src/workspace/analytics-overview.js";
import { openWorkspaceStore } from "../src/storage/sqlite/workspace-store.js";
import { createWorkspaceApi } from "../src/workspace/api.js";
import { definition } from "../src/workspace/catalogue.js";

const now = new Date("2026-01-15T00:00:00Z");
const row = (extra) => ({ assessmentId: "GAD7", title: "GAD-7", status: "completed", createdAt: "2026-01-01T00:00:00Z", ...extra });
test("Overview counts prescriptions once, includes unscored completions and uses UTC months and valid durations", () => {
  const result = buildOverview([
    row({ completedAt: "2026-01-01T02:00:00Z" }),
    row({ completedAt: "2026-01-01T04:00:00Z" }),
    row({ status: "assigned" }), row({ status: "in-progress" }),
    row({ assessmentId: "other", title: "Other", createdAt: "2025-07-31T00:00:00Z", completedAt: "2025-07-31T23:00:00-02:00" }),
    row({ completedAt: "2025-12-31T23:00:00Z" }), // Negative duration excluded from median.
  ], now);
  assert.deepEqual(result.totals, { prescribed: 6, completed: 4, inProgress: 1, notStarted: 1, completionRate: 67, medianCompletionHours: 4 });
  assert.deepEqual(result.months.map(m => m.month), ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"]);
  assert.deepEqual(result.months.map(m => m.completed), [1, 0, 0, 0, 1, 2]);
  assert.equal(result.byForm[0].prescribed, 5);
  assert.equal(buildOverview([row({ completedAt: "2026-01-01T02:00:00Z" }), row({ completedAt: "2026-01-01T04:00:00Z" })], now).totals.medianCompletionHours, 3);
  assert.equal(buildOverview([], now).totals.completionRate, null);
  assert.equal(buildOverview([], now).totals.medianCompletionHours, null);
  assert.equal(buildOverview([row({ completedAt: "invalid" })], now).totals.medianCompletionHours, null);
});

test("Report summaries expose scores only for completed, explicitly scored snapshots", () => {
  const input = { id: "rx", assessment_id: "GAD7", session_id: "session", status: "completed", score: 0, scoring_enabled: true, score_min: 0, score_max: 21, title: "Saved title" };
  assert.equal(prescriptionSummary(input).score, 0);
  assert.equal(prescriptionSummary(input).title, "Saved title");
  for (const extra of [{ scoring_enabled: false }, { score: 22 }, { status: "draft" }, { score: null }, { score_max: null }])
    assert.equal(prescriptionSummary({ ...input, ...extra }).score, null);
});

test("Reports API includes assigned, in-progress and completed tests, isolates patients and avoids answer payloads", async () => {
  const store = openWorkspaceStore(":memory:", { seed: false });
  const patient = store.createPatient({ name: "Synthetic report patient", historySummary: "Synthetic only" });
  const other = store.createPatient({ name: "Other synthetic patient", historySummary: "Synthetic only" });
  const assigned = store.prescribe(patient.id, "GAD7"), draft = store.prescribe(patient.id, "GAD7"), completed = store.prescribe(patient.id, "GAD7");
  store.createSession(draft.id, definition("GAD7"), "en", "screen");
  let s = store.createSession(completed.id, definition("GAD7"), "en", "screen");
  for (const q of s.definition.questions) s = store.answer(s.id, { questionId: q.id, value: q.options[0].value, revision: s.revision });
  store.finalize(s.id, s.revision);
  const api = createWorkspaceApi(null, { store, apiKey: "" });
  const server = http.createServer((req, res) => api.handle(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/workspace`;
  try {
    const reports = await (await fetch(`${base}/patients/${patient.id}/prescriptions`)).json();
    assert.equal(reports.length, 3);
    assert.equal(reports.find(r => r.id === assigned.id).status, "assigned");
    assert.equal(reports.find(r => r.id === draft.id).status, "in-progress");
    const done = reports.find(r => r.id === completed.id);
    assert.equal(done.status, "completed"); assert.equal(done.sessionId, s.id); assert.equal(done.score, null);
    assert.ok(reports.every(r => !("answers" in r) && !("definition" in r)));
    assert.deepEqual(await (await fetch(`${base}/patients/${other.id}/prescriptions`)).json(), []);
    assert.equal((await fetch(`${base}/patients/missing/prescriptions`)).status, 404);
    const { totals } = await (await fetch(`${base}/analytics/overview`)).json();
    assert.equal(totals.prescribed, 3); assert.equal(totals.completed, 1);
    assert.equal(totals.notStarted, 1); assert.equal(totals.inProgress, 1); assert.equal(totals.completionRate, 33);
    assert.equal((await fetch(`${base}/sessions/${done.sessionId}/report`)).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); api.close(); }
});
