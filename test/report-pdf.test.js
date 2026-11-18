import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import http from "node:http";
import { chromium } from "playwright-core";
import { openWorkspaceStore } from "../src/storage/sqlite/workspace-store.js";
import { definition } from "../src/workspace/catalogue.js";
import { createWorkspaceApi } from "../src/workspace/api.js";
import { reportPdf } from "../src/workspace/report-pdf.js";
import { syntheticReport } from "../src/workspace/report-preview.js";

test("Local API returns the same patient result as HTML/JSON and a real multipage PDF", {
  skip: !existsSync(process.env.REPORT_CHROMIUM_PATH || chromium.executablePath()),
}, async () => {
  const store = openWorkspaceStore(":memory:", { seed: false });
  const patient = store.createPatient({ name: "Synthetic PDF patient", age: 35, gender: "Female", historySummary: "Synthetic PDF fixture only" });
  const rx = store.prescribe(patient.id, "GAD7");
  let s = store.createSession(rx.id, definition("GAD7"), "en", "screen");
  for (const q of s.definition.questions) s = store.answer(s.id, { questionId: q.id, value: q.options[0].value, revision: s.revision });
  s = store.finalize(s.id, s.revision);
  const api = createWorkspaceApi(":memory:", { store, apiKey: "" });
  const server = http.createServer((req, res) => api.handle(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/workspace/sessions/${s.id}/report`;
  try {
    const model = await (await fetch(`${url}?format=json`)).json();
    assert.equal(model.patient.id, patient.id);
    assert.equal(model.metrics[0].value, 0);
    assert.equal(model.metrics[0].status, "draft_unvalidated");
    const html = await (await fetch(url)).text();
    assert.match(html, /Draft score — not clinically validated/);
    for (const m of model.metrics) assert.ok(html.includes(m.label));
    assert.doesNotMatch(html, /(?:href|src)=["']https?:/);
    const response = await fetch(`${url}?format=pdf`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-disposition"), /\.pdf/);
    const pdf = Buffer.from(await response.arrayBuffer());
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.length > 10000);
    assert.ok((pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length >= 2);
    assert.equal((await fetch(url.replace(s.id, "no-such-session") + "?format=pdf")).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    api.close();
  }
});
test("PDF renderer fails explicitly when its local browser is unavailable", async () => {
  const previous = process.env.REPORT_CHROMIUM_PATH;
  process.env.REPORT_CHROMIUM_PATH = "/not-a-browser-for-this-synthetic-test";
  try {
    await assert.rejects(reportPdf(syntheticReport(definition("GAD7"))), e => e.status === 503 && /Local PDF renderer/.test(e.message));
  } finally {
    if (previous === undefined) delete process.env.REPORT_CHROMIUM_PATH;
    else process.env.REPORT_CHROMIUM_PATH = previous;
  }
});
