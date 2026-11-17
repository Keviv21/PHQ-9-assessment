import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { openWorkspaceStore } from "../src/storage/sqlite/workspace-store.js";
import { definition, catalogue } from "../src/workspace/catalogue.js";
import { assessmentReport, reportHtml } from "../src/workspace/report.js";
import { GeminiBridge } from "../src/workspace/live-bridge.js";
import { PcmResampler, matchSpokenOption } from "../public/session/media.js";

for (const rate of [16000, 44100, 48000]) {
  for (const type of ["worklet", "fallback"])
    test(`${type} keeps audio continuous at ${rate} Hz`, () => {
      const packets = [];
      let push;
      if (type === "fallback") {
        const resampler = new PcmResampler(rate, (b) =>
          packets.push(new Int16Array(b)),
        );
        push = (x) => resampler.push(x);
      } else {
        let Processor;
        runInNewContext(
          readFileSync(
            new URL("../public/shared/audio-worklet.js", import.meta.url),
            "utf8",
          ),
          {
            sampleRate: rate,
            AudioWorkletProcessor: class {
              port = { postMessage: (b) => packets.push(new Int16Array(b)) };
            },
            registerProcessor: (_, c) => (Processor = c),
          },
        );
        const processor = new Processor();
        push = (x) => processor.process([[x]], [[new Float32Array(128)]]);
      }
      const input = Float32Array.from({ length: rate + 128 }, (_, i) =>
        Math.sin((2 * Math.PI * 440 * i) / rate),
      );
      for (let i = 0; i < input.length; i += 128)
        push(input.subarray(i, i + 128));
      assert.equal(packets.length, 10);
      for (let p = 0; p < 10; p++)
        for (let i = 0; i < 1600; i++) {
          const expected =
            Math.sin((2 * Math.PI * 440 * (p * 1600 + i)) / 16000) * 32767;
          assert.ok(
            Math.abs(packets[p][i] - expected) < 150,
            `discontinuity at ${p}:${i}`,
          );
        }
    });
}

test("Browser speech matches only complete, unambiguous translated labels with original values", () => {
  const options = [
    { value: 7, label: "Not at all" },
    { value: 20, label: "Nearly every day" },
  ];
  assert.equal(matchSpokenOption("Not at all.", options), 7);
  assert.equal(matchSpokenOption("not nearly every day", options), null);
  assert.equal(matchSpokenOption("every day", options), null);
  assert.equal(matchSpokenOption("3", options), null);
  assert.equal(
    matchSpokenOption("कभी नहीं", [
      { value: 4, label: "कभी नहीं" },
      { value: 8, label: "कभी-कभी" },
    ]),
    4,
  );
  assert.equal(
    matchSpokenOption("same", [
      { value: 1, label: "Same" },
      { value: 2, label: "Same" },
    ]),
    null,
  );
});

test("Saved summaries and corrections appear in reports while raw source and doctor conversations do not", () => {
  const store = openWorkspaceStore(":memory:", { seed: false });
  try {
    const patient = store.createPatient({
        name: "<script>Patient</script>",
        historySummary: "PRIVATE HISTORY",
      }),
      rx = store.prescribe(patient.id, "GAD7");
    let s = store.createSession(rx.id, definition("GAD7"), "en", "voice");
    assert.throws(() => assessmentReport(s, patient), { status: 409 });
    const q = s.definition.questions[0];
    s = store.answer(
      s.id,
      {
        questionId: q.id,
        value: q.options[1].value,
        revision: s.revision,
        summary: "<img onerror=alert(1)> response",
      },
      "gemini",
    );
    assert.equal(s.answerDetails[0].method, "gemini");
    for (const question of s.definition.questions.slice(1))
      s = store.answer(s.id, {
        questionId: question.id,
        value: question.options[0].value,
        revision: s.revision,
      });
    const before = s.revision;
    s = store.answer(s.id, {
      questionId: q.id,
      value: q.options[0].value,
      revision: before,
    });
    assert.equal(s.answerRevisions.length, 1);
    assert.equal(s.answerDetails[0].summary, null);
    assert.throws(
      () =>
        store.answer(s.id, {
          questionId: q.id,
          value: q.options[1].value,
          revision: before,
        }),
      { status: 409 },
    );
    s = store.finalize(s.id, s.revision);
    const report = assessmentReport(s, patient),
      html = reportHtml(report);
    assert.equal(report.score, null);
    assert.equal(report.severity, null);
    assert.deepEqual(report.bands, []);
    assert.equal(
      report.responseCounts.reduce((n, c) => n + c.count, 0),
      s.answers.length,
    );
    assert.match(html, /Response distribution/);
    assert.match(html, /Answer revisions/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>|PRIVATE HISTORY|3 min 35s/);
    assert.equal(
      store.analytics(patient.id).groups[0].results[0].answerRevisions.length,
      1,
    );
    assert.throws(
      () =>
        store.answer(s.id, {
          questionId: q.id,
          value: 0,
          revision: s.revision,
        }),
      { status: 409 },
    );
  } finally {
    store.close();
  }
});

test("Camera forwarding is voice-only, validated and blocked after pause or disconnect", () => {
  const sent = [];
  const bridge = new GeminiBridge({
    client: {},
    state: { sessionMode: "voice" },
    send: () => {},
  });
  bridge.ready = true;
  bridge.session = { sendRealtimeInput: (x) => sent.push(x), close: () => {} };
  const data = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
  bridge.sendImage(data);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].video.mimeType, "image/jpeg");
  assert.throws(() => bridge.sendImage("invalid"));
  bridge.paused = true;
  bridge.sendImage(data);
  bridge.paused = false;
  bridge.state.sessionMode = "chat";
  bridge.sendImage(data);
  assert.equal(sent.length, 1);
  bridge.state.sessionMode = "voice";
  bridge.stop();
  bridge.sendImage(data);
  assert.equal(sent.length, 1);
});

test("Catalogue categories preserve all current assessment definitions and question counts", () => {
  const items = catalogue();
  assert.equal(items.length, 186);
  assert.ok(new Set(items.map((a) => a.category)).size > 5);
  items.forEach((a) => {
    assert.ok(a.category);
    assert.equal(a.questionCount, definition(a.id).questions.length);
  });
});

test("Live answer tool persists its brief summary through the workspace store", async () => {
  const store = openWorkspaceStore(":memory:", { seed: false });
  try {
    const p = store.createPatient({
        name: "Synthetic",
        historySummary: "Synthetic history",
      }),
      rx = store.prescribe(p.id, "GAD7");
    const s = store.createSession(rx.id, definition("GAD7"), "en", "chat");
    const bridge = new GeminiBridge({
      client: {},
      state: s,
      send: () => {},
      getState: async () => store.get(s.id),
      recordAnswer: async (a) => store.answer(s.id, a, "gemini"),
    });
    bridge.ready = true;
    bridge.session = {
      sendClientContent: () => {},
      sendToolResponse: () => {},
      close: () => {},
    };
    bridge.sendText("Synthetic response corresponding to the first label");
    await bridge.onMessage({
      toolCall: {
        functionCalls: [
          {
            id: "test-call",
            name: "record_answer",
            args: {
              questionId: s.definition.questions[0].id,
              revision: 0,
              value: s.definition.questions[0].options[0].value,
              summary: "Brief synthetic response summary.",
            },
          },
        ],
      },
    });
    assert.equal(
      store.get(s.id).answerDetails[0].summary,
      "Brief synthetic response summary.",
    );
    assert.equal(store.get(s.id).revision, 1);
    bridge.stop();
  } finally {
    store.close();
  }
});
