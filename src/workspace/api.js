import { reportPdf } from "./report-pdf.js";
import { WebSocketServer } from "ws";
import { catalogue } from "./catalogue.js";
import { LANGUAGES } from "./languages.js";
import { createRecommender } from "./recommendations.js";
import { createTranslationsService } from "./translations.js";
import { GeminiBridge } from "./live-bridge.js";
import { assessmentReport, reportHtml } from "./report.js";
import { definition } from "./catalogue.js";
import { HttpError } from "./errors.js";
import { doctorGuidance } from "./doctor-guidance.js";
export function createWorkspaceApi(
  dbPath,
  {
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_LIVE_MODEL || "gemini-3.8-live",
    port = 4174,
    store,
    recommend = createRecommender(store),
    translations = createTranslationsService(store),
  } = {},
) {
  const live = new Map(),
    wss = new WebSocketServer({ noServer: true, maxPayload: 64000 });
  const reply = (res, status, data) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  async function body(req, maxBytes = 220000) {
    if (!req.headers["content-type"]?.startsWith("application/json"))
      throw new HttpError(415, "Send JSON.");
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += Buffer.byteLength(chunk);
      chunks.push(Buffer.from(chunk));
      if (bytes > maxBytes)
        throw new HttpError(413, "Request is too large.");
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new HttpError(400, "Invalid JSON.");
    }
  }
  async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/workspace/")) return false;
    try {
      if (["POST", "PATCH"].includes(req.method)) {
        const origin = req.headers.origin;
        if (
          origin &&
          !["http://localhost:" + port, "http://127.0.0.1:" + port].includes(
            origin,
          )
        )
          throw new HttpError(403, "Unexpected origin.");
      }
      const p = url.pathname
        .slice("/api/workspace/".length)
        .split("/")
        .map(decodeURIComponent);
      let data;
      if (req.method === "GET" && p[0] === "catalogue" && p.length === 1)
        data = {
          catalogue: catalogue(),
          languages: LANGUAGES,
          geminiConfigured: Boolean(apiKey?.trim()),
        };
      else if (p[0] === "catalogue" && p.length === 2 && req.method === "GET") {
        data = definition(p[1]);
        if (!data) throw new HttpError(404, "Assessment not found.");
      } else if (p[0] === "patients" && p.length === 1 && req.method === "GET")
        data = (await store.listPatients());
      else if (p[0] === "analytics" && p[1] === "overview" && p.length === 2 && req.method === "GET")
        data = await store.analyticsOverview();
      else if (p[0] === "patients" && p[2] === "prescriptions" && p.length === 3 && req.method === "GET")
        data = await store.patientPrescriptions(p[1]);
      else if (p[0] === "patients" && p.length === 1 && req.method === "POST")
        data = (await store.createPatient(await body(req)));
      else if (p[0] === "patient-imports" && p.length === 2 && p[1] === "preview" && req.method === "POST")
        data = await store.previewPatientImport(await body(req, 2200000));
      else if (p[0] === "patient-imports" && p.length === 1 && req.method === "POST")
        data = await store.importPatient(await body(req, 2200000));
      else if (p[0] === "patients" && p.length === 3 && p[2] === "records" && req.method === "GET")
        data = await store.patientRecords(p[1]);
      else if (p[0] === "patients" && p.length === 4 && p[2] === "records" && req.method === "GET")
        data = await store.patientRecord(p[1], p[3]);
      else if (p[0] === "patients" && p.length === 3 && p[2] === "records" && req.method === "POST")
        data = await store.addPatientNote(p[1], await body(req));
      else if (p[0] === "patients" && p.length === 2 && req.method === "GET")
        data = (await store.patient(p[1]));
      else if (
        p[0] === "patients" &&
        p.length === 3 &&
        p[2] === "doctor-guidance" &&
        ["GET", "POST"].includes(req.method)
      )
        data = doctorGuidance(
          (await store.patient(p[1])),
          req.method === "POST" ? await body(req) : undefined,
        );
      else if (
        p[0] === "patients" &&
        p[2] === "recommendations" &&
        req.method === "POST"
      )
        data = await recommend(p[1], await body(req));
      else if (
        p[0] === "patients" &&
        p[2] === "prescriptions" &&
        req.method === "POST"
      )
        data = (await store.prescribe(p[1], (await body(req)).assessmentId));
      else if (
        p[0] === "patients" &&
        p[2] === "sessions" &&
        req.method === "GET"
      )
        data = (await store.sessions(p[1]));
      else if (
        p[0] === "patients" &&
        p[2] === "analytics" &&
        req.method === "GET"
      )
        data = (await store.analytics(p[1]));
      else if (
        p[0] === "prescriptions" &&
        p.length === 2 &&
        req.method === "GET"
      )
        data = (await store.prescription(p[1]));
      else if (
        p[0] === "prescriptions" &&
        p[2] === "sessions" &&
        req.method === "POST"
      ) {
        const { language = "en", mode = "screen" } = await body(req);
        if (
          !LANGUAGES.some((l) => l.code === language) ||
          !["chat", "voice", "screen"].includes(mode)
        )
          throw new HttpError(400, "Choose a supported language and mode.");
        if (mode !== "screen" && !apiKey?.trim())
          throw new HttpError(
            503,
            "Gemini is not configured. Use on-screen choices.",
          );
        const rx = (await store.prescription(p[1]));
        data = rx.session
          ? (await store.createSession(rx.id, rx.session.definition, language, mode))
          : (await store.createSession(
              rx.id,
              await translations.localize(rx.definition, language),
              language,
              mode,
            ));
      } else if (p[0] === "sessions" && p.length === 2 && req.method === "GET")
        data = (await store.get(p[1]));
      else if (p[0] === "sessions" && p.length === 3 && p[2] === "preferences" && req.method === "PATCH") {
        const input = await body(req);
        if (!LANGUAGES.some((l) => l.code === input.language) || !["chat", "voice", "screen"].includes(input.mode))
          throw new HttpError(400, "Choose a supported language and mode.");
        if (input.mode !== "screen" && !apiKey?.trim())
          throw new HttpError(503, "Conversation is unavailable. You can continue with answer choices.");
        const current = await store.get(p[1]);
        if (current.status !== "draft" || current.revision !== input.revision)
          throw new HttpError(409, "This session changed. Reload it before switching preferences.");
        const localized = input.language === current.language ? current.definition
          : await translations.localize(current.definition, input.language);
        data = await store.preferences(p[1], input, localized);
        // A live conversation must restart with the updated language and mode.
        const previous = live.get(p[1]);
        if (previous) {
          previous.bridge.stop();
          previous.socket.close(1000, "Preferences changed");
          live.delete(p[1]);
        }
      } else if (
        p[0] === "sessions" &&
        p[2] === "answers" &&
        req.method === "PATCH"
      ) {
        data = (await store.answer(p[1], await body(req)));
        live.get(p[1])?.bridge.update(data);
      } else if (
        p[0] === "sessions" &&
        p[2] === "finalize" &&
        req.method === "POST"
      ) {
        data = (await store.finalize(p[1], (await body(req)).revision));
        live.get(p[1])?.bridge.update(data);
      } else if (
        p[0] === "sessions" &&
        p[2] === "report" &&
        req.method === "GET"
      ) {
        const s = (await store.get(p[1]));
        const report = assessmentReport(s, await store.patient(s.patientId), await store.sessions(s.patientId));
        if (url.searchParams.get("format") === "json") { reply(res, 200, report); return true; }
        if (url.searchParams.get("format") === "pdf") {
          const pdf = await reportPdf(report);
          res.writeHead(200, { "content-type": "application/pdf", "cache-control": "no-store", "content-disposition": `attachment; filename="assessment-${s.id}.pdf"` });
          res.end(pdf); return true;
        }
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          ...(url.searchParams.has("download")
            ? {
                "content-disposition": `attachment; filename="assessment-${s.id}.html"`,
              }
            : {}),
        });
        res.end(reportHtml(report));
        return true;
      } else throw new HttpError(404, "Endpoint not found.");
      reply(res, 200, data);
    } catch (e) {
      reply(res, e.status || 500, {
        error: e.status
          ? e.message
          : "The request could not be completed. Please retry.",
      });
    }
    return true;
  }
  wss.on("connection", async (socket, request) => {
    let id, bridge;
    const send = (data) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(data));
    };
    try {
      const origin = request.headers.origin;
      if (
        origin &&
        !["http://localhost:" + port, "http://127.0.0.1:" + port].includes(
          origin,
        )
      )
        throw new Error();
      id = new URL(request.url, "http://localhost").searchParams.get(
        "sessionId",
      );
      const state = (await store.get(id));
      if (
        state.status !== "draft" ||
        state.sessionMode === "screen" ||
        live.has(id) ||
        !apiKey?.trim()
      )
        throw new Error();
      if (socket.readyState !== 1) return;
      bridge = new GeminiBridge({
        apiKey,
        model,
        state,
        send,
        getState: async () => (await store.get(id)),
        recordAnswer: async (answer) => (await store.answer(id, answer, "gemini")),
      });
      live.set(id, { bridge, socket });
      bridge.start();
      socket.on("message", (payload, binary) => {
        try {
          if (binary) {
            if (state.sessionMode === "voice") bridge.sendAudio(payload);
            return;
          }
          const m = JSON.parse(payload.toString());
          if (m.type === "text") bridge.sendText(m.text);
          else if (m.type === "audio_end") bridge.endAudio();
          else if (m.type === "camera" && state.sessionMode === "voice")
            bridge.sendImage(m.data);
          else throw new Error();
        } catch {
          send({
            type: "status",
            status: "error",
            message:
              "Could not send this response. Reconnect or use the answer choices.",
          });
        }
      });
      socket.on("close", () => {
        bridge.stop();
        if (live.get(id)?.socket === socket) live.delete(id);
      });
    } catch {
      socket.close(1008, "Session unavailable.");
    }
  });
  return {
    handle,
    wss,
    close() {
      for (const { bridge, socket } of live.values()) {
        bridge.stop();
        socket.close();
      }
      wss.close();
      return store.close();
    },
  };
}
