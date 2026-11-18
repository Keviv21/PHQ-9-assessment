import test from "node:test";
import assert from "node:assert/strict";
import { records } from "../src/workspace/catalogue.js";
import { calculateRule, calculateReportMetrics, reportCondition, responseStatus, validateReporting } from "../src/workspace/report-calculation.js";
import { assessmentReport, reportHtml } from "../src/workspace/report.js";
import { syntheticReport } from "../src/workspace/report-preview.js";
const fixture = () => ({ id: "synthetic", title: "Synthetic math", version: "1", language: "en", instructions: "Synthetic only", scoring: { enabled: false, missing_item_policy: { action: "withhold_result_if_any_required_response_is_missing" }, rules: [] }, questions: [1, 2, 3].map(n => ({ id: `Q${n}`, text: `Item ${n}`, options: [{ id: "a", value: "a", printed_value: 0, label: "Zero" }, { id: "b", value: "b", printed_value: 4, label: "Four" }] })) });
const rule = (extra = {}) => ({ id: "sum", item_ids: ["Q1", "Q2", "Q3"], method: "sum", value_field: "printed_value", multiplier: 1, minimum: 0, maximum: 12, ...extra });
const get = text => [...records.values()].find(r => r.definition.title.includes(text)).definition;
test("All 186 reporting configurations retain rules, groups, histories and review gates", () => {
  assert.equal(records.size, 186);
  let rules = 0;
  for (const { definition: d } of records.values()) {
    assert.deepEqual(validateReporting(d), [], d.title);
    assert.equal(d.scoring.enabled, false);
    assert.equal(d.review.readyForClinicalUse, false);
    assert.equal(d.reporting.item_history.length, d.questions.length);
    rules += d.scoring.rules.length;
    const preview = syntheticReport(d);
    assert.equal(preview.preview, true);
    assert.match(reportHtml(preview), /DEVELOPMENT PREVIEW/);
    assert.ok(preview.metrics.every(m => m.value === null || m.status === "development_preview"));
    assert.ok(calculateReportMetrics(d, Array(d.questions.length).fill(0)).every(m => m.value === null));
  }
  assert.equal(rules, 729);
});
test("Explicit arithmetic: sum, mean, thresholds, weighted sum, transforms and option overrides", () => {
  const d = fixture(), a = ["a", "b", "b"];
  assert.equal(calculateRule(d, a, rule()).value, 8);
  assert.equal(calculateRule(d, a, rule({ method: "mean", multiplier: 3 })).value, 8);
  assert.equal(calculateRule(d, a, rule({ method: "count_threshold", threshold: 3, operator: ">=", item_thresholds: { Q1: 0 } })).value, 3);
  assert.equal(calculateRule(d, a, rule({ method: "weighted_sum", item_coefficients: { Q2: -1 } })).value, 0);
  assert.equal(calculateRule(d, a, rule({ item_transforms: { Q1: { scale: -1, offset: 6 } }, maximum: 20 })).value, 14);
  assert.equal(calculateRule(d, a, rule({ option_value_overrides: { Q2: { b: 0 } } })).value, 4);
  const reordered = structuredClone(d); reordered.questions.forEach(q => q.options.reverse());
  assert.equal(calculateRule(reordered, a, rule()).value, 8);
  d.questions[0].reverse_scored = true;
  assert.equal(calculateRule(d, a, rule()).value, 8, "No double reversal from a descriptive flag");
});
test("Zero, missing, skipped and unknown eligibility stay distinct; no unsupported rule is guessed", () => {
  const d = fixture(), a = ["a", "a", "a"];
  assert.equal(calculateRule(d, a, rule()).value, 0);
  assert.equal(calculateRule(d, [null, "a", "a"], rule()).value, null);
  assert.equal(calculateRule(d, [{ skipped: true, reason: "not_applicable" }, "a", "a"], rule()).value, null);
  d.questions[0].display_if = { context_key: "works", operator: "equals", value: true };
  assert.equal(responseStatus(d, a, d.questions[0]), "eligibility_unknown");
  assert.equal(calculateRule(d, a, rule(), {}).value, null);
  assert.equal(calculateRule(d, a, rule({ ineligible_item_policy: "zero" }), { works: false }).value, 0);
  assert.equal(calculateRule(d, ["a", "b", "b"], rule({ method: "mean", ineligible_item_policy: "exclude" }), { works: false }).value, 4);
  assert.equal(reportCondition({ any: [d.questions[0].display_if, { context_key: "other", operator: "equals", value: true }] }, d, a, { other: true }), true);
  for (const extra of [{ method: "unknown" }, { missing_item_policy: "guess" }, { multiplier: null }, { formula: "eval this" }]) assert.equal(calculateRule(fixture(), a, rule(extra)).value, null);
});
test("Draft gates cannot be bypassed by toggling only scoring.enabled", () => {
  const d = structuredClone(get("(BAM)")), preview = syntheticReport(d);
  assert.deepEqual(preview.metrics.map(m => [m.label, m.min, m.max]), [["Substance Use", 0, 90], ["Risk Factors", 0, 180], ["Protective Factors", 0, 180]]);
  d.scoring.enabled = true;
  assert.ok(calculateReportMetrics(d, []).every(m => m.value === null));
  assert.equal(syntheticReport(get("(LEC-5)")).metrics.length, 0);
  assert.equal(syntheticReport(get("(SDQ)")).reportingMode, "unavailable");
  assert.equal(syntheticReport(get("(asQ)")).metrics.length, 0);
  assert.ok(syntheticReport(get("(MAPsy)")).limitations.some(t => /partial coverage/i.test(t)));
});
test("Comparison histories isolate patients, definitions, respondent types and context", () => {
  const d = fixture(); d.scoring = { enabled: true, min: 0, max: 12 };
  const s = { id: "current", patientId: "p", assessmentId: d.id, definition: d, language: "en", status: "completed", sessionMode: "screen", answers: ["a", "b", "b"], score: 8, completedAt: "2026-11-18T00:00:00Z" };
  const old = { ...s, id: "old", score: 4, completedAt: "2026-11-01T00:00:00Z" };
  const history = [old, { ...old, id: "foreign", patientId: "other" }, { ...old, id: "proxy", respondentType: "proxy" }, { ...old, id: "version", definition: { ...d, version: "2" } }, { ...old, id: "context", context: { works: true } }];
  const r = assessmentReport(s, { id: "p", name: "Synthetic" }, history);
  assert.equal(r.comparisons.length, 1); assert.equal(r.comparisons[0].delta, 4);
  assert.equal(r.metricHistory[0].points.length, 2);
  assert.equal(r.responseHistory[0].visits.length, 2);
  assert.throws(() => assessmentReport(s, { id: "other" }), /not found/);
  assert.throws(() => assessmentReport(s, { id: "p" }, [], { syntheticPreview: true }), /synthetic/);
  assert.doesNotMatch(reportHtml(r), /https?:\/\//);
});
