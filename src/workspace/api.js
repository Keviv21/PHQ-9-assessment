import { WebSocketServer } from "ws";
import { catalogue } from "./catalogue.js";
import { LANGUAGES } from "./languages.js";
import { openWorkspaceStore } from "./store.js";
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
    store = openWorkspaceStore(dbPath),
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
  async function body(req) {
    if (!req.headers["content-type"]?.startsWith("application/json"))
      throw new HttpError(415, "Send JSON.");
    let data = "";
    for await (const chunk of req) {
      data += chunk;
      if (data.length > 220000)
        throw new HttpError(413, "Request is too large.");
    }
    try {
      return JSON.parse(data);
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
        data = store.listPatients();
      else if (p[0] === "patients" && p.length === 1 && req.method === "POST")
        data = store.createPatient(await body(req));
      else if (p[0] === "patients" && p.length === 2 && req.method === "GET")
        data = store.patient(p[1]);
      else if (
        p[0] === "patients" &&
        p.length === 3 &&
        p[2] === "doctor-guidance" &&
        ["GET", "POST"].includes(req.method)
      )
        data = doctorGuidance(
          store.patient(p[1]),
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
        data = store.prescribe(p[1], (await body(req)).assessmentId);
      else if (
        p[0] === "patients" &&
        p[2] === "sessions" &&
        req.method === "GET"
      )
        data = store.sessions(p[1]);
      else if (
        p[0] === "patients" &&
        p[2] === "analytics" &&
        req.method === "GET"
      )
        data = store.analytics(p[1]);
      else if (
        p[0] === "prescriptions" &&
        p.length === 2 &&
        req.method === "GET"
      )
        data = store.prescription(p[1]);
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
        const rx = store.prescription(p[1]);
        data = rx.session
          ? store.createSession(rx.id, rx.session.definition, language, mode)
          : store.createSession(
              rx.id,
              await translations.localize(rx.definition, language),
              language,
              mode,
            );
      } else if (p[0] === "sessions" && p.length === 2 && req.method === "GET")
        data = store.get(p[1]);
      else if (
        p[0] === "sessions" &&
        p[2] === "answers" &&
        req.method === "PATCH"
      ) {
        data = store.answer(p[1], await body(req));
        live.get(p[1])?.bridge.update(data);
      } else if (
        p[0] === "sessions" &&
        p[2] === "finalize" &&
        req.method === "POST"
      ) {
        data = store.finalize(p[1], (await body(req)).revision);
        live.get(p[1])?.bridge.update(data);
      } else if (
        p[0] === "sessions" &&
        p[2] === "report" &&
        req.method === "GET"
      ) {
        const s = store.get(p[1]);
        const report = assessmentReport(s, store.patient(s.patientId));
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
  wss.on("connection", (socket, request) => {
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
      const state = store.get(id);
      if (
        state.status !== "draft" ||
        state.sessionMode === "screen" ||
        live.has(id) ||
        !apiKey?.trim()
      )
        throw new Error();
      bridge = new GeminiBridge({
        apiKey,
        model,
        state,
        send,
        getState: async () => store.get(id),
        recordAnswer: async (answer) => store.answer(id, answer, "gemini"),
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
      store.close();
    },
  };
}
