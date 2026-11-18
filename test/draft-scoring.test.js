import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkspaceStore } from "../src/storage/sqlite/workspace-store.js";
import { visibleQuestion } from "../public/shared/answers.js";
import { records } from "../src/workspace/catalogue.js";
import { assessmentReport, reportHtml } from "../src/workspace/report.js";
import { finalizeState } from "../src/workspace/state.js";
import { calculateReportMetrics } from "../src/workspace/report-calculation.js";
import { savedSessionMetrics } from "../src/workspace/session-results.js";
import { groupPatientAssessments } from "../src/workspace/patient-analytics.js";
const get = part => [...records.values()].find(r => r.definition.id.includes(part)).definition;
const fas = get("fatigue-assessment-scale-fas");
const state = (d, answers) => ({ id: "synthetic", patientId: "synthetic", assessmentId: d.id, definition: d, language: "en", sessionMode: "screen", revision: 0, status: "draft", answers, startedAt: "2026-01-01T00:00:00Z" });

test("FAS submission persists draft 18/50 across database reopening and matches reports/analytics", () => {
  const dir = mkdtempSync(join(tmpdir(), "draft-score-")), path = join(dir, "test.sqlite");
  let store = openWorkspaceStore(path, { seed: false });
  try {
    const patient = store.createPatient({ name: "Synthetic scoring fixture", historySummary: "Synthetic only" });
    const rx = store.prescribe(patient.id, fas.id);
    let s = store.createSession(rx.id, fas, "en", "screen");
    for (const q of fas.questions) s = store.answer(s.id, { questionId: q.id, value: q.options[0].value, revision: s.revision });
    s = store.finalize(s.id, s.revision);
    const result = s.calculatedResults;
    assert.equal(result.metrics[0].value, 18); // Eight 1s and two reverse-encoded 5s.
    assert.equal(result.metrics[0].max, 50);
    assert.equal(result.metrics[0].status, "draft_unvalidated");
    assert.equal(result.metrics[0].descriptor, null);
    assert.equal(s.definition.scoring.enabled, false);
    assert.deepEqual(store.finalize(s.id, s.revision).calculatedResults, result);
    store.close(); store = openWorkspaceStore(path, { seed: false });
    const saved = store.get(s.id);
    assert.deepEqual(saved.calculatedResults, result);
    assert.equal(store.patientPrescriptions(patient.id)[0].metrics[0].value, 18);
    const report = assessmentReport(saved, patient);
    assert.deepEqual(report.metrics, result.metrics);
    assert.match(reportHtml(report), /Draft score — not clinically validated/);
    const [group] = groupPatientAssessments([saved]);
    assert.equal(group.draftScores, true);
    assert.deepEqual(group.results[0].values, [18]);
    assert.equal(group.metrics[0].max, 50);
    // PostgreSQL JSONB can reorder object keys without changing the recorded inputs.
    const reordered = JSON.parse(JSON.stringify(saved, (_, value) => value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).reverse().map(key => [key, value[key]])) : value));
    assert.deepEqual(savedSessionMetrics(reordered), result.metrics);
    const changed = structuredClone(saved); changed.answers[0] = fas.questions[0].options[1].value;
    assert.equal(savedSessionMetrics(changed), null);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("Old completed sessions are not silently recalculated; incomplete submissions still fail", () => {
  const s = state(fas, fas.questions.map(q => q.options[0].value));
  const old = { ...s, status: "completed", completedAt: "2026-01-02T00:00:00Z" };
  assert.equal(finalizeState(old, 0).calculatedResults, undefined);
  assert.ok(assessmentReport(old, { id: "synthetic" }).metrics.every(m => m.value === null));
  s.answers[0] = null;
  assert.throws(() => finalizeState(s, 0), /Answer every question/);
});

test("Draft arithmetic withholds missing/unsupported rules and omits clinical descriptors", () => {
  const answers = fas.questions.map(q => q.options[0].value);
  const d = structuredClone(fas);
  d.scoring.rules[0].severity_bands = [{ minimum_inclusive: 10, maximum_inclusive: 50, label: "Do not publish unvalidated classification" }];
  assert.equal(calculateReportMetrics(d, answers, {}, { draftScores: true })[0].descriptor, null);
  answers[0] = null;
  assert.equal(calculateReportMetrics(d, answers, {}, { draftScores: true })[0].value, null);
  answers[0] = fas.questions[0].options[0].value;
  d.scoring.rules[0].method = "unsupported";
  d.reporting.metrics[0].calculation_method = "unsupported";
  assert.equal(calculateReportMetrics(d, answers, {}, { draftScores: true })[0].value, null);
});

test("BAM submission saves separate domain scores without inventing an overall total", () => {
  const d = get("brief-addiction-monitor-bam");
  const answers = d.questions.map(q => ["integer", "number"].includes(q.response_type) ? 0 : q.options[0].value);
  d.questions.forEach((q, i) => { if (!visibleQuestion(d, answers, q)) answers[i] = null; });
  const s = finalizeState(state(d, answers), 0);
  assert.equal(s.score, null);
  assert.deepEqual(s.calculatedResults.metrics.map(m => [m.label, m.max]), [["Substance Use", 90], ["Risk Factors", 180], ["Protective Factors", 180]]);
  assert.ok(s.calculatedResults.metrics.every(m => m.value !== null && m.status === "draft_unvalidated"));
});
