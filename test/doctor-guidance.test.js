import test from "node:test";
import assert from "node:assert/strict";
import { doctorGuidance } from "../src/workspace/doctor-guidance.js";
import { definition } from "../src/workspace/catalogue.js";
import { openWorkspaceStore } from "../src/workspace/store.js";
import { createWorkspaceApi } from "../src/workspace/api.js";
import http from "node:http";
const patient = {
  id: "synthetic-patient",
  source: "Added by clinician",
  recordedAge: 35,
  historySummary:
    "Synthetic notes mentioning worry. No structured review supplied.",
};
const context = {
  ageGroup: "19to64",
  safetyStatus: "noneReported",
  traumaExposure: "notReported",
  concerns: ["depression", "anxiety"],
};
test("Doctor guidance reuses sample evidence, ignores historical observations and maps to current catalogue", () => {
  const r = doctorGuidance({ id: "demo-b", source: "Sample" });
  assert.equal(r.primaryAssessmentId, "GAD7");
  assert.ok(r.suggestions[0].evidence.length);
  for (const s of r.suggestions) assert.ok(definition(s.assessmentId));
  const historical = doctorGuidance({ id: "demo-e", source: "Sample" });
  assert.ok(
    historical.ignoredObservations.some((o) => /Historical/.test(o.reason)),
  );
});
test("Doctor priorities reorder suggestions while unknown safety, age and trauma require main reviews", () => {
  const r = doctorGuidance(patient, { context, focus: "anxiety" });
  assert.equal(r.primaryAssessmentId, "GAD7");
  const mood = doctorGuidance(patient, { context, focus: "depression" });
  assert.match(mood.primaryAssessmentId, /phq-9/);
  assert.equal(doctorGuidance(patient).status, "needs_review");
  assert.deepEqual(doctorGuidance(patient).context.concerns, []);
  assert.equal(
    doctorGuidance(patient, {
      context: { ...context, safetyStatus: "concern" },
    }).suggestions.length,
    0,
  );
  assert.equal(
    doctorGuidance(patient, { context: { ...context, ageGroup: "under19" } })
      .suggestions.length,
    0,
  );
  const trauma = { ...context, concerns: ["traumaSymptoms"] };
  const blocked = doctorGuidance(patient, { context: trauma });
  assert.equal(blocked.primaryAssessmentId, null);
  assert.equal(blocked.suggestions[0].available, false);
  assert.ok(
    doctorGuidance(patient, {
      context: { ...trauma, traumaExposure: "confirmed" },
    }).primaryAssessmentId,
  );
  assert.throws(() => doctorGuidance(patient, { context, focus: "stress" }), {
    status: 400,
  });
  assert.throws(
    () =>
      doctorGuidance(patient, { context: { ...context, name: "Not allowed" } }),
    { status: 400 },
  );
  assert.throws(() => doctorGuidance(patient, {}), { status: 400 });
});
test("Doctor review endpoint stays temporary and works without a Gemini key", async () => {
  const store = openWorkspaceStore(":memory:", { seed: false });
  const p = store.createPatient({
    name: "Synthetic patient",
    age: 35,
    historySummary: "Synthetic notes only.",
  });
  const original = store.patient(p.id);
  const workspace = createWorkspaceApi(":memory:", {
    store,
    apiKey: "",
    recommend: () => {
      throw Error("Must not call Gemini");
    },
  });
  const server = http.createServer((req, res) => workspace.handle(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/api/workspace/patients/${p.id}/doctor-guidance`;
  try {
    assert.equal((await (await fetch(base)).json()).status, "needs_review");
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context, focus: "anxiety" }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).primaryAssessmentId, "GAD7");
    assert.deepEqual(store.patient(p.id), original);
    assert.deepEqual(store.sessions(p.id), []);
    assert.deepEqual((await (await fetch(base)).json()).context.concerns, []);
  } finally {
    await new Promise((r) => server.close(r));
    workspace.close();
  }
});
