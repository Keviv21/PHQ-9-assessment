import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  answerType,
  answerError,
  currentQuestionIndex,
  visibleQuestion,
  numericSchema,
  responseLabel,
} from "../public/workspace-answers.js";
import { normalizeAssessment } from "../src/workspace/normalize.js";
import {
  validateDefinition,
  scoreDefinition,
} from "../src/workspace/definition.js";
import { definition, catalogue } from "../src/workspace/catalogue.js";
import { openWorkspaceStore } from "../src/workspace/store.js";
import { assessmentReport, reportHtml } from "../src/workspace/report.js";
import { GeminiBridge } from "../src/workspace/live-bridge.js";
import { createTranslationsService } from "../src/workspace/translations.js";
const cssId = "client-satisfaction-survey-css--5a9e654edbc6";
const skip = { skipped: true, reason: "not_applicable" };
const choice = {
  id: "Q1",
  text: "Synthetic choices",
  response_type: "single_choice",
  options: [
    { id: "O1", value: 1, printed_value: 1, label: "Yes", score: 1 },
    { id: "O2", value: 0, printed_value: 0, label: "No", score: 0 },
  ],
  input_spec: { answer_schema: { type: "string", enum: ["O1", "O2"] } },
};
const mixed = () => ({
  schemaVersion: 3,
  id: "synthetic-mixed",
  version: "test",
  title: "Synthetic types",
  instructions: "Synthetic only",
  scoring: { enabled: false },
  questions: [
    structuredClone(choice),
    {
      id: "Q2",
      text: "Count",
      response_type: "integer",
      options: [],
      input_spec: {
        answer_schema: { type: "integer", minimum: 0, maximum: 7 },
      },
      display_if: { item_id: "Q1", operator: "equals", value: "O1" },
    },
    {
      id: "Q3",
      text: "Feedback",
      response_type: "text",
      options: [],
      input_spec: { answer_schema: { type: "string", minLength: 1 } },
      display_if: {
        item_id: "Q2",
        operator: "gt",
        value: 0,
        value_field: "printed_value",
      },
    },
    {
      ...structuredClone(choice),
      id: "Q4",
      response_type: "multiple_choice",
      input_spec: {
        answer_schema: {
          type: "array",
          items: { type: "string", enum: ["O1", "O2"] },
          uniqueItems: true,
          minItems: 1,
        },
        exclusive_option_ids: ["O2"],
      },
    },
    {
      id: "Q5",
      text: "Measurement",
      response_type: "number",
      options: [],
      input_spec: {
        answer_schema: { type: "number", minimum: 0, maximum: 12.5 },
      },
    },
  ],
});
function workspace(d, path = ":memory:") {
  const store = openWorkspaceStore(path, { seed: false });
  const patient = store.createPatient({
    name: "Synthetic answer types",
    age: 30,
    historySummary: "Synthetic fixture.",
  });
  const rx = store.prescribe(patient.id, cssId);
  const state = store.createSession(rx.id, d, "en", "screen");
  return { store, patient, state };
}
function submit(store, s, id, value) {
  return store.answer(s.id, { questionId: id, value, revision: s.revision });
}

test("CSS preserves source types and option IDs; feedback and explicit Q7 skip survive reopening and reports", () => {
  const d = definition(cssId),
    dir = mkdtempSync(join(tmpdir(), "typed-css-")),
    path = join(dir, "test.sqlite");
  let { store, patient, state: s } = workspace(d, path);
  try {
    assert.equal(d.runnable, true);
    assert.deepEqual(d.questions.map(answerType), [
      ...Array(8).fill("single_choice"),
      "text",
      "text",
    ]);
    assert.ok(
      d.questions
        .slice(0, 8)
        .every((q) => q.options.length === 5 && q.options.every((o) => o.id)),
    );
    assert.equal(d.questions[8].input_spec.answer_schema.minLength, 1);
    assert.throws(() => submit(store, s, "Q1", skip), /cannot be skipped/);
    for (const q of d.questions.slice(0, 8))
      s = submit(store, s, q.id, q.id === "Q7" ? skip : q.options[0].value);
    assert.throws(() => submit(store, s, "Q9", 0), /written feedback/);
    assert.throws(() => submit(store, s, "Q9", "   "), /written feedback/);
    s = submit(store, s, "Q9", "Helpful explanations <script>");
    s = submit(store, s, "Q10", "More flexible appointments.");
    s = submit(store, s, "Q9", "Clear explanations <script>");
    s = store.finalize(s.id, s.revision);
    assert.equal(s.score, null);
    assert.deepEqual(s.answers[6], skip);
    assert.equal(s.answerDetails[8].feedback, true);
    store.close();
    store = openWorkspaceStore(path, { seed: false });
    s = store.get(s.id);
    assert.equal(s.answers[8], "Clear explanations <script>");
    const report = assessmentReport(s, patient);
    assert.equal(report.responses[8].feedback, true);
    assert.match(report.responses[6].response, /Skipped/);
    assert.equal(
      report.responseCounts.reduce((n, r) => n + r.count, 0),
      7,
    );
    assert.match(reportHtml(report), /Clear explanations &lt;script&gt;/);
    assert.match(reportHtml(report), /Written feedback · not scored/);
    const visit = store.analytics(patient.id).groups[0].results[0];
    assert.equal(visit.answeredCount, 9);
    assert.equal(visit.responses[9].response, "More flexible appointments.");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Numbers enforce source bounds, checkboxes reject duplicates/unknown values and preserve exclusive choices", () => {
  const d = mixed();
  validateDefinition(d);
  const count = d.questions[1],
    check = d.questions[3],
    number = d.questions[4];
  for (const value of [-1, 8, 1.5, "2", NaN, Infinity])
    assert.ok(answerError(count, value), String(value));
  assert.equal(answerError(count, 0), null);
  assert.equal(answerError(count, 7), null);
  assert.equal(answerError(number, 1.25), null);
  assert.ok(answerError(number, 12.6));
  for (const v of [[], [1, 1], [1, 0], [9], "1"])
    assert.ok(answerError(check, v));
  assert.equal(answerError(check, [0]), null);
  assert.equal(responseLabel(check, [0]), "No");
  const unbounded = {
    ...number,
    input_spec: { answer_schema: { type: "number", minimum: 0 } },
  };
  assert.equal(answerError(unbounded, 1000000), null);
});

test("Conditional answers follow source option IDs, clear on parent edits, require newly visible answers, and never become zero", () => {
  const d = mixed();
  const { store, state } = workspace(d);
  let s = state;
  try {
    s = submit(store, s, "Q1", 1);
    s = submit(store, s, "Q2", 2);
    s = submit(store, s, "Q3", "Source feedback");
    s = submit(store, s, "Q4", [1]);
    s = submit(store, s, "Q5", 1.25);
    s = submit(store, s, "Q1", 0);
    assert.equal(s.answers[1], null);
    assert.equal(s.answers[2], null);
    assert.equal(currentQuestionIndex(d, s.answers), -1);
    assert.throws(() => submit(store, s, "Q2", 0), /not currently applicable/);
    assert.equal(
      s.answerRevisions.filter((r) => r.method === "condition").length,
      2,
    );
    s = submit(store, s, "Q1", 1);
    assert.equal(currentQuestionIndex(d, s.answers), 1);
    assert.throws(
      () => store.finalize(s.id, s.revision),
      /Answer every question/,
    );
    s = submit(store, s, "Q2", 0);
    assert.equal(visibleQuestion(d, s.answers, d.questions[2]), false);
    s = store.finalize(s.id, s.revision);
    assert.deepEqual(s.answers, [1, 0, null, [1], 1.25]);
    const withHiddenAnswer = [1, 0, "stale", [1], 1.25];
    assert.throws(
      () => scoreDefinition(d, withHiddenAnswer),
      /hidden question/,
    );
  } finally {
    store.close();
  }
});

test("Unresolved conditions and unsupported types identify their exact question", () => {
  const raw = {
    assessment_id: "synthetic",
    assessment: { name: "Synthetic" },
    administration: { instructions: "Respond" },
    questionnaire: {
      item_count: 1,
      items: [
        {
          id: "Q9",
          text: "Unsupported",
          response_type: "date",
          input_spec: { kind: "date" },
        },
      ],
    },
  };
  assert.match(
    normalizeAssessment(raw).definition.availabilityReason,
    /Q9 \(date\): unsupported answer type/,
  );
  const d = mixed();
  d.questions[1].display_if = {
    context_key: "unavailable",
    operator: "equals",
    value: true,
  };
  assert.throws(
    () => validateDefinition(d),
    /Q2.*unavailable context unavailable/,
  );
});

test("Written feedback is excluded from an explicitly configured sum score", () => {
  const d = mixed();
  d.questions = [d.questions[0], { ...d.questions[2], display_if: null }];
  d.scoring = {
    enabled: true,
    method: "sum",
    min: 0,
    max: 1,
    bands: [{ min: 0, max: 1, label: "Synthetic" }],
  };
  assert.deepEqual(scoreDefinition(d, [1, "Written feedback"]), {
    score: 1,
    severity: "Synthetic",
  });
});

test("Every runnable imported questionnaire accepts source-valid typed answers and completes without an invented score", () => {
  for (const item of catalogue().filter((r) => r.runnable)) {
    const d = definition(item.id),
      answers = d.questions.map(() => null);
    validateDefinition(d);
    for (
      let i = currentQuestionIndex(d, answers);
      i !== -1;
      i = currentQuestionIndex(d, answers)
    ) {
      const q = d.questions[i],
        type = answerType(q);
      answers[i] =
        type === "text"
          ? "Synthetic feedback"
          : type === "multiple_choice"
            ? [q.options[0].value]
            : type === "single_choice"
              ? q.options[0].value
              : (numericSchema(q).minimum ?? 0);
      assert.equal(answerError(q, answers[i]), null, `${item.title} ${q.id}`);
    }
    assert.deepEqual(
      scoreDefinition(d, answers),
      { score: null, severity: null },
      item.title,
    );
  }
});

test("Translated mixed questions retain input rules, option IDs, and numeric or written response values", async () => {
  const { store } = workspace(mixed());
  try {
    const client = {
      models: {
        generateContent: async ({ contents }) => {
          const source = JSON.parse(contents);
          return {
            text: JSON.stringify({
              ...source,
              title: "Cuestionario de prueba",
              instructions: "Indique su respuesta.",
              referencePeriod: source.referencePeriod ? "Durante las últimas dos semanas" : "",
              ui: Object.fromEntries(Object.entries(source.ui).map(([key, value]) => [key, "Indique su respuesta " + (value.match(/\{\w+\}/g) || []).join(" ")])),
              questions: source.questions.map((q) => ({
                ...q,
                text: "Pregunta " + q.id,
                contextText: q.contextText ? "Durante la última semana" : "",
                options: q.options.map((o) => ({
                  ...o,
                  label: o.label === "Yes" ? "Sí" : "No",
                })),
              })),
            }),
          };
        },
      },
    };
    const d = await createTranslationsService(store, { client }).localize(
      mixed(),
      "es",
    );
    assert.equal(d.questions[0].options[0].id, "O1");
    assert.equal(d.questions[1].input_spec.answer_schema.maximum, 7);
    assert.equal(d.localized.questions[2].options.length, 0);
    assert.equal(d.localized.questions[0].options[0].label, "Sí");
  } finally {
    store.close();
  }
});

test("Gemini records typed feedback and valid checkbox arrays, rejects invalid numbers, and advances past hidden fields", async () => {
  const { store, state } = workspace(mixed());
  let saved = submit(store, state, "Q1", 1);
  const b = new GeminiBridge({
    apiKey: "synthetic",
    model: "synthetic",
    state: saved,
    send: () => {},
    getState: () => store.get(saved.id),
    recordAnswer: (a) => store.answer(saved.id, a, "gemini"),
    client: {},
  });
  b.session = {
    sendToolResponse: () => {},
    sendClientContent: () => {},
    close: () => {},
  };
  const call = async (q, value) => {
    b.hasResponse = true;
    await b.onMessage({
      toolCall: {
        functionCalls: [
          {
            id: "call-" + b.state.revision,
            name: "record_answer",
            args: {
              questionId: q,
              value,
              revision: b.state.revision,
              summary: "Explicit synthetic response",
            },
          },
        ],
      },
    });
  };
  try {
    await call("Q2", 8);
    assert.equal(b.state.answers[1], null);
    await call("Q2", 0);
    assert.equal(b.current().id, "Q4");
    await call("Q4", [1]);
    assert.deepEqual(b.state.answers[3], [1]);
    await call("Q5", 1.25);
    assert.equal(b.state.answers[4], 1.25);
  } finally {
    b.stop();
    store.close();
  }
});

test("Gemini preserves the participant's written words as feedback", async () => {
  const d = mixed();
  d.questions = [{ ...d.questions[2], display_if: null }];
  const { store, state } = workspace(d);
  const bridge = new GeminiBridge({
    apiKey: "synthetic",
    model: "synthetic",
    state,
    send: () => {},
    getState: () => store.get(state.id),
    recordAnswer: (a) => store.answer(state.id, a, "gemini"),
    client: {},
  });
  bridge.session = {
    sendToolResponse: () => {},
    sendClientContent: () => {},
    close: () => {},
  };
  bridge.hasResponse = true;
  try {
    await bridge.onMessage({
      toolCall: {
        functionCalls: [
          {
            id: "feedback",
            name: "record_answer",
            args: {
              questionId: "Q3",
              revision: 0,
              value: "I would like later appointments.",
              summary: "Requests later appointments.",
            },
          },
        ],
      },
    });
    const saved = store.get(state.id);
    assert.equal(saved.answers[0], "I would like later appointments.");
    assert.equal(saved.answerDetails[0].feedback, true);
    assert.equal(store.finalize(saved.id, saved.revision).score, null);
  } finally {
    bridge.stop();
    store.close();
  }
});
