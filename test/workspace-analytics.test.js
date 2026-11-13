import test from "node:test";
import assert from "node:assert/strict";
import { groupPatientAssessments } from "../src/workspace/patient-analytics.js";
const definition = {
  id: "sample",
  title: "Synthetic questionnaire",
  version: "v1",
  scoring: { enabled: true, min: 0, max: 6 },
  questions: [
    {
      id: "q1",
      text: "Synthetic question one",
      options: [
        { value: 0, label: "Never" },
        { value: 1, label: "Sometimes" },
      ],
    },
    {
      id: "q2",
      text: "Synthetic question two",
      options: [
        { value: 0, label: "Never" },
        { value: 1, label: "Sometimes" },
      ],
    },
  ],
};
function visit(id, extra = {}) {
  return {
    id,
    assessmentId: "sample",
    prescriptionId: id,
    definition: structuredClone(definition),
    language: "en",
    status: "completed",
    answers: [0, 1],
    score: 3,
    severity: "Recorded level",
    sessionMode: "screen",
    startedAt: "2026-11-01T10:00:00Z",
    completedAt: `2026-11-${id}T10:03:00Z`,
    ...extra,
  };
}
test("Patient analytics adapts Sagar visit grouping without mixing versions, languages or score scales", () => {
  const states = [
    visit("02"),
    visit("01"),
    visit("03", { language: "hi" }),
    visit("04", { definition: { ...definition, version: "v2" } }),
    visit("05", {
      definition: {
        ...definition,
        scoring: { enabled: true, min: 0, max: 10 },
      },
    }),
    visit("06", { status: "draft" }),
  ];
  const groups = groupPatientAssessments(states);
  assert.equal(groups.length, 4);
  const repeat = groups.find((g) => g.results.length === 2);
  assert.deepEqual(
    repeat.results.map((r) => r.id),
    ["01", "02"],
  );
  assert.deepEqual(
    repeat.results.map((r) => r.values),
    [[3], [3]],
  );
  assert.equal(repeat.results[0].elapsedSeconds, 180);
  assert.equal(repeat.results[0].responses[1].response, "Sometimes");
  const changed = visit("07");
  changed.definition.questions[0].text = "Changed question";
  assert.equal(groupPatientAssessments([visit("01"), changed]).length, 2);
});
test("Unscored or missing results never become clinical scores, percentiles or invented duration", () => {
  const d = { ...definition, scoring: { enabled: false } };
  const [group] = groupPatientAssessments([
    visit("01", {
      definition: d,
      score: 5,
      startedAt: null,
      sessionMode: "voice",
    }),
  ]);
  assert.equal(group.scored, false);
  assert.deepEqual(group.metrics, []);
  assert.deepEqual(group.results[0].values, []);
  assert.equal(group.results[0].score, null);
  assert.equal(group.results[0].severity, null);
  assert.equal(group.results[0].elapsedSeconds, null);
  assert.equal(group.results[0].collectionMethod, "conversational_inference");
  assert.equal("percentile" in group.results[0], false);
  for (const score of [null, NaN, 7, -1]) {
    const [g] = groupPatientAssessments([visit("01", { score })]);
    assert.deepEqual(g.results[0].values, [null]);
  }
});
test("Visit details retain saved translated question and full response labels", () => {
  const d = structuredClone(definition);
  d.localized = {
    language: "hi",
    title: "अनुवाद",
    questions: d.questions.map((q) => ({
      ...q,
      text: "प्रश्न " + q.id,
      options: [
        { value: 0, label: "कभी नहीं" },
        { value: 1, label: "कभी कभी" },
      ],
    })),
  };
  const [g] = groupPatientAssessments([
    visit("01", { language: "hi", definition: d }),
  ]);
  assert.equal(g.title, "अनुवाद");
  assert.equal(g.results[0].responses[0].response, "कभी नहीं");
  assert.equal(g.results[0].responses[1].question, "प्रश्न q2");
});
