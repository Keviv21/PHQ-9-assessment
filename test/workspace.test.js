import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkspaceStore } from "../src/workspace/store.js";
import { catalogue, definition } from "../src/workspace/catalogue.js";
import { createRecommender } from "../src/workspace/recommendations.js";
import {
  createTranslationsService,
  validateTranslation,
} from "../src/workspace/translations.js";
import { createWorkspaceApi } from "../src/workspace/api.js";
import http from "node:http";
const synthetic = {
  name: "Synthetic Test Patient",
  age: 35,
  gender: "Female",
  historySummary:
    "Reports interrupted sleep and persistent worry for two weeks.",
};

test("Workspace imports NeuroTwin first, keeps four samples and saves added patient information", () => {
  const dir = mkdtempSync(join(tmpdir(), "workspace-patient-"));
  const file = join(dir, "patient.json");
  writeFileSync(
    file,
    JSON.stringify({
      digital_twin_report: {
        patient_id: "SYNTHETIC-001",
        sections: {
          clinical__notes_summary: {
            patient_profile: {
              name: "Synthetic NeuroTwin",
              age: 34,
              gender: "Male",
            },
            executive_summary: {
              clinical_conclusion: "Synthetic history only.",
            },
          },
        },
      },
    }),
  );
  const store = openWorkspaceStore(":memory:", { patientFile: file });
  try {
    const patients = store.listPatients();
    assert.equal(patients.length, 5);
    assert.equal(patients[0].id, "john-neurotwin");
    assert.equal(patients.filter((p) => p.source === "Sample").length, 4);
    assert.match(
      store.patient("john-neurotwin").historySummary,
      /Synthetic history/,
    );
    const added = store.createPatient(synthetic);
    assert.equal(store.patient(added.id).name, synthetic.name);
    assert.throws(() => store.createPatient({ ...synthetic, age: 131 }), {
      status: 400,
    });
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
test("The final catalogue is fully listed; patient sessions freeze definitions, reject stale writes and retain unscored results", () => {
  const entries = catalogue();
  assert.equal(entries.length, 186);
  assert.equal(entries.filter((a) => a.runnable).length, 133);
  const dir = mkdtempSync(join(tmpdir(), "workspace-db-")),
    db = join(dir, "test.sqlite");
  let store = openWorkspaceStore(db, { seed: false });
  const patient = store.createPatient(synthetic),
    rx = store.prescribe(patient.id, "GAD7");
  const unavailable = entries.find((a) => !a.runnable);
  assert.throws(() => store.prescribe(patient.id, unavailable.id), {
    status: 422,
  });
  let s = store.createSession(rx.id, definition("GAD7"), "en", "screen");
  const id = s.id;
  assert.throws(
    () =>
      store.answer(id, {
        questionId: s.definition.questions[1].id,
        value: 0,
        revision: 0,
      }),
    { status: 409 },
  );
  for (const q of s.definition.questions) {
    const prev = s.revision;
    s = store.answer(id, {
      questionId: q.id,
      value: q.options[0].value,
      revision: s.revision,
    });
    assert.throws(
      () =>
        store.answer(id, {
          questionId: q.id,
          value: q.options[0].value,
          revision: prev,
        }),
      { status: 409 },
    );
  }
  s = store.finalize(id, s.revision);
  assert.equal(s.score, null);
  assert.equal(s.status, "completed");
  assert.equal(store.analytics(patient.id).completed, 1);
  assert.equal(store.analytics(patient.id).groups[0].scored, false);
  store.close();
  store = openWorkspaceStore(db, { seed: false });
  assert.deepEqual(store.get(id), s);
  assert.equal(store.prescription(rx.id).session.id, id);
  store.close();
  rmSync(dir, { recursive: true });
});
test("Recommendations use the full catalogue and summary; doctor messages are transient and invalid IDs fail", async () => {
  const store = openWorkspaceStore(":memory:", { seed: false }),
    p = store.createPatient(synthetic);
  let captured,
    calls = 0,
    bad = false;
  const recommend = createRecommender(store, {
    client: {
      models: {
        generateContent: async (args) => {
          captured = JSON.parse(args.contents);
          calls++;
          return {
            text: JSON.stringify({
              reply: "Consider this screening option.",
              suggestions: [
                {
                  assessmentId: bad ? "invented" : "GAD7",
                  reason: "Reported persistent worry.",
                  caution: "Needs clinician review.",
                },
              ],
            }),
          };
        },
      },
    },
  });
  try {
    const history = await recommend(p.id);
    assert.equal(history.primaryAssessmentId, "GAD7");
    assert.equal(captured.catalogue.length, 186);
    assert.match(captured.patient.history, /persistent worry/);
    assert.equal(JSON.stringify(captured).includes(synthetic.name), false);
    await recommend(p.id);
    assert.equal(calls, 1);
    await recommend(p.id, {
      source: "doctor",
      messages: [
        { role: "user", text: synthetic.name + " reports new symptoms." },
      ],
    });
    assert.equal(calls, 2);
    assert.equal(JSON.stringify(captured).includes(synthetic.name), false);
    assert.deepEqual(await recommend(p.id), history);
    assert.equal(calls, 2);
    assert.equal(store.sessions(p.id).length, 0);
    bad = true;
    await assert.rejects(
      recommend(p.id, { source: "history", refresh: true }),
      { status: 502 },
    );
    await assert.rejects(
      recommend(p.id, {
        source: "history",
        messages: [{ role: "user", text: "Must not persist" }],
      }),
      { status: 400 },
    );
  } finally {
    store.close();
  }
});
test("Completed workspace reports escape patient content and reject unfinished sessions", async () => {
  const store = openWorkspaceStore(":memory:", { seed: false }),
    p = store.createPatient({ ...synthetic, name: "<script>unsafe</script>" }),
    rx = store.prescribe(p.id, "GAD7");
  let s = store.createSession(rx.id, definition("GAD7"), "en", "screen");
  const api = createWorkspaceApi(":memory:", { store, apiKey: "" });
  const server = http.createServer((req, res) => api.handle(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/workspace`;
  try {
    const preview = await fetch(`${base}/catalogue/GAD7`);
    assert.equal(preview.status, 200);
    assert.deepEqual(
      (await preview.json()).questions,
      definition("GAD7").questions,
    );
    assert.equal(
      (await fetch(`${base}/catalogue/not-an-assessment`)).status,
      404,
    );
    assert.equal((await fetch(`${base}/sessions/${s.id}/report`)).status, 409);
    for (const q of s.definition.questions)
      s = store.answer(s.id, {
        questionId: q.id,
        value: q.options[0].value,
        revision: s.revision,
      });
    s = store.finalize(s.id, s.revision);
    const response = await fetch(`${base}/sessions/${s.id}/report?download=1`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /Print \/ Save as PDF/);
    assert.match(response.headers.get("content-disposition"), /attachment/);
    assert.equal(
      (await fetch(`${base}/patients/${p.id}/analytics`)).status,
      200,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    api.close();
  }
});
test("Workspace translations include option labels and reject changes to canonical values", async () => {
  const store = openWorkspaceStore(":memory:", { seed: false });
  const source = definition("GAD7");
  const provider = {
    models: {
      generateContent: async ({ contents }) => {
        const d = JSON.parse(contents);
        return {
          text: JSON.stringify({
            ...d,
            title: "परीक्षण",
            questions: d.questions.map((q) => ({
              ...q,
              text: "प्रश्न " + q.id,
              options: q.options.map((o) => ({
                ...o,
                label: "उत्तर " + o.value,
              })),
            })),
          }),
        };
      },
    },
  };
  try {
    const service = createTranslationsService(store, { client: provider });
    const translated = await service.localize(source, "hi");
    assert.equal(translated.localized.questions[0].options[0].label, "उत्तर 0");
    assert.deepEqual(translated.questions, source.questions);
    const bad = structuredClone(translated.localized);
    bad.questions[0].options[0].value = 999;
    assert.throws(() => validateTranslation(source, bad));
    assert.deepEqual(
      await createTranslationsService(store, { apiKey: "" }).localize(
        source,
        "hi",
      ),
      translated,
    );
  } finally {
    store.close();
  }
});
