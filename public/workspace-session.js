import { $, el, api, reportLinks } from "./workspace-common.js";
import { LiveAudio } from "./workspace-audio.js";
import {
  presentation,
  sessionLabels,
  formatLabel,
} from "./workspace-presentation.js";
let rx,
  config,
  state,
  connection,
  audio,
  camera,
  connected = false,
  muted = false,
  busy = false,
  paused = false,
  leaving = false,
  generation = 0;
const prescriptionId = new URL(location.href).searchParams.get(
  "prescriptionId",
);
const mode = () => document.querySelector('input[name="mode"]:checked').value;
const language = () => $("session-language").value;
const label = (key, values = {}) =>
  formatLabel(
    sessionLabels(
      state?.definition || rx?.definition,
      state?.language || language(),
    )[key],
    values,
  );
function error(message) {
  $("session-error").hidden = !message;
  $("session-error").textContent = message || "";
}
function status(message) {
  $("session-status").textContent = message;
}
function addMessage(speaker, text) {
  const log = $("session-transcript"),
    row = el(
      "div",
      undefined,
      `chat-message ${speaker === "you" ? "user" : "assistant"}`,
    );
  row.append(
    el("strong", speaker === "you" ? label("you") : "Gemini"),
    el("p", text),
  );
  log.append(row);
  while (log.children.length > 80) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}
function disconnect() {
  generation++;
  connected = false;
  const ws = connection;
  connection = null;
  ws?.close();
  audio?.close();
  audio = null;
  $("microphone-toggle").disabled = true;
  $("disconnect-session").disabled = true;
  $("session-text").disabled = true;
  $("session-send").disabled = true;
}
function stopCamera() {
  camera?.getTracks().forEach((t) => t.stop());
  camera = null;
  $("camera-preview").srcObject = null;
  $("camera-preview").hidden = true;
  $("camera-placeholder").hidden = false;
  $("camera-toggle").textContent = "Turn camera on";
}
function render() {
  if (!state) return;
  const d = presentation(state.definition, state.language),
    index = state.answers.findIndex((v) => v === null),
    complete = state.status === "completed",
    review = index === -1 && !complete;
  $("session-title").textContent = d.title;
  $("session-setup").classList.add("started");
  $("session-language").value = state.language;
  $("session-language").disabled = true;
  $("session-modes").disabled = true;
  document.querySelector(
    `input[name="mode"][value="${state.sessionMode}"]`,
  ).checked = true;
  $("mode-badge").textContent = state.sessionMode;
  $("setup-note").textContent =
    `${config.languages.find((l) => l.code === state.language)?.name || state.language} · ${{ chat: "Chat with Gemini", voice: "Voice conversation", screen: "On-screen questionnaire" }[state.sessionMode]}`;
  $("session-start").hidden =
    complete || review || state.sessionMode === "screen" || connected;
  $("session-start").textContent = label("reconnect");
  $("question-chat-grid").hidden = complete || review;
  $("session-review").hidden = !review;
  $("session-complete").hidden = !complete;
  if (complete) {
    $("completed-analytics").href =
      `/?view=analytics&patient=${state.patientId}&session=${state.id}`;
    disconnect();
    stopCamera();
    $("session-setup").hidden = true;
    $("completed-report").replaceChildren(
      el(
        "p",
        state.score == null
          ? "Responses saved without a score; the source disables scoring."
          : `Score: ${state.score} / ${d.scoring.max}`,
      ),
      reportLinks(state.id),
    );
    return;
  }
  if (review) {
    disconnect();
    $("session-start").hidden = true;
    $("review-title").textContent = label("review");
    $("review-hint").textContent = label("reviewHint");
    $("save-assessment").textContent = label("save");
    const box = $("review-answers");
    box.replaceChildren();
    d.questions.forEach((q, i) => {
      const row = el("label", undefined, "review-row");
      row.append(el("strong", `${i + 1}. ${q.text}`));
      const select = el("select");
      select.setAttribute("aria-label", `Review ${q.id}`);
      q.options.forEach((o) =>
        select.add(new Option(o.label, String(o.value))),
      );
      select.value = String(state.answers[i]);
      select.onchange = () => saveAnswer(q.id, Number(select.value));
      row.append(select);
      box.append(row);
    });
    return;
  }
  const q = d.questions[index];
  $("question-progress").textContent = label("progress", {
    count: state.answers.filter((v) => v !== null).length,
    total: d.questions.length,
  });
  $("question-progress-bar").max = d.questions.length;
  $("question-progress-bar").value = state.answers.filter(
    (v) => v !== null,
  ).length;
  $("question-title").textContent = q.text;
  $("question-title").lang = state.language;
  $("question-period").textContent = d.referencePeriod || d.instructions;
  $("question-hint").textContent = label("autoSave");
  $("question-options").replaceChildren();
  q.options.forEach((o) => {
    const row = el("label", undefined, "workspace-option"),
      input = el("input");
    input.type = "radio";
    input.name = "answer";
    input.value = String(o.value);
    input.disabled = busy;
    input.onchange = () => saveAnswer(q.id, o.value);
    row.append(input, el("span", o.label));
    $("question-options").append(row);
  });
  $("original-question").replaceChildren(
    el("p", state.definition.questions[index].text),
    el(
      "p",
      state.definition.questions[index].options.map((o) => o.label).join(" · "),
    ),
  );
  $("session-chat").hidden = state.sessionMode === "screen";
  $("question-chat-grid").classList.toggle(
    "screen-only",
    state.sessionMode === "screen",
  );
  $("session-text").lang = state.language;
  $("session-text").placeholder = label("placeholder");
  $("microphone-toggle").hidden = state.sessionMode !== "voice";
  $("microphone-toggle").textContent = label(muted ? "unmute" : "mute");
  $("session-chat").querySelector("h2").textContent = label("conversation");
  $("session-send").textContent = label("send");
  document.querySelector('label[for="session-text"]').textContent =
    label("response");
}
async function saveAnswer(questionId, value) {
  if (busy) return;
  busy = true;
  error("");
  render();
  try {
    state = await api(`sessions/${state.id}/answers`, {
      method: "PATCH",
      body: JSON.stringify({ questionId, value, revision: state.revision }),
    });
  } catch (e) {
    error(e.message);
    try {
      state = await api(`sessions/${state.id}`);
    } catch {}
  } finally {
    busy = false;
    render();
  }
}
async function connect() {
  disconnect();
  const current = generation;
  paused = false;
  muted = false;
  status(label("connecting"));
  try {
    if (state.sessionMode === "voice") {
      audio = new LiveAudio((buffer) => {
        if (connection?.readyState === 1 && connection.bufferedAmount < 64000)
          connection.send(buffer);
      });
      await audio.start();
      if (current !== generation || leaving) return;
      audio.mute(true);
    }
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/workspace-ws?sessionId=${state.id}`,
    );
    connection = ws;
    ws.onmessage = (e) => {
      if (current !== generation) return;
      const m = JSON.parse(e.data);
      if (m.type === "status") {
        if (m.status === "connected") {
          connected = true;
          status(label("connected"));
          $("session-text").disabled = false;
          $("session-send").disabled = false;
          $("disconnect-session").disabled = false;
          $("microphone-toggle").disabled = state.sessionMode !== "voice";
          audio?.mute(false);
          render();
        } else if (m.status === "error") {
          error(m.message);
          disconnect();
          render();
        } else status(m.status);
      } else if (m.type === "state") {
        state = m.state;
        render();
      } else if (m.type === "audio") audio?.play(m.data);
      else if (m.type === "audio_interrupt") audio?.interrupt();
      else if (m.type === "transcript")
        addMessage(
          ["user", "participant"].includes(m.speaker) ? "you" : "gemini",
          m.text,
        );
      else if (m.type === "paused") {
        paused = true;
        audio?.mute(true);
        error(m.message);
        $("session-text").disabled = true;
        $("session-send").disabled = true;
      }
    };
    ws.onclose = () => {
      if (current !== generation) return;
      disconnect();
      status(label("disconnected"));
      render();
    };
    ws.onerror = () => {
      if (current === generation)
        error(
          "The conversation could not connect. Your saved answers remain available.",
        );
    };
  } catch (e) {
    if (current === generation) {
      disconnect();
      error(e.message);
      render();
    }
  }
}
$("session-start").onclick = async () => {
  if (busy) return;
  busy = true;
  error("");
  $("session-start").disabled = true;
  $("session-language").disabled = true;
  $("session-modes").disabled = true;
  status("Preparing questions and complete answer choices…");
  try {
    if (!state)
      state = await api(`prescriptions/${prescriptionId}/sessions`, {
        method: "POST",
        body: JSON.stringify({ language: language(), mode: mode() }),
      });
    if (leaving) return;
    render();
    if (
      state.status === "draft" &&
      state.answers.includes(null) &&
      state.sessionMode !== "screen"
    )
      await connect();
    else status(label("databaseSaved"));
  } catch (e) {
    error(e.message);
    if (!state) {
      $("session-language").disabled = false;
      $("session-modes").disabled = false;
    }
  } finally {
    busy = false;
    $("session-start").disabled = false;
    if (state) render();
  }
};
for (const input of document.querySelectorAll('input[name="mode"]'))
  input.onchange = () => {
    $("session-start").textContent =
      mode() === "voice"
        ? "Start with voice"
        : mode() === "chat"
          ? "Start with chat"
          : "Start on-screen questionnaire";
  };
$("session-chat-form").onsubmit = (e) => {
  e.preventDefault();
  const text = $("session-text").value.trim();
  if (!text || !connected || paused) return;
  connection.send(JSON.stringify({ type: "text", text }));
  addMessage("you", text);
  $("session-text").value = "";
};
$("microphone-toggle").onclick = () => {
  muted = !muted;
  audio?.mute(muted || paused);
  $("microphone-toggle").textContent = label(muted ? "unmute" : "mute");
  if (muted && connection?.readyState === 1)
    connection.send(JSON.stringify({ type: "audio_end" }));
};
$("disconnect-session").onclick = () => {
  disconnect();
  status(label("disconnected"));
  render();
};
$("camera-toggle").onclick = async () => {
  if (camera) {
    stopCamera();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
    if (leaving) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    camera = stream;
    $("camera-preview").srcObject = stream;
    $("camera-preview").hidden = false;
    $("camera-placeholder").hidden = true;
    $("camera-toggle").textContent = "Turn camera off";
  } catch {
    error(
      "Camera preview is unavailable. The assessment can continue without it.",
    );
  }
};
$("save-assessment").onclick = async () => {
  if (busy) return;
  busy = true;
  $("save-assessment").disabled = true;
  try {
    state = await api(`sessions/${state.id}/finalize`, {
      method: "POST",
      body: JSON.stringify({ revision: state.revision }),
    });
    render();
  } catch (e) {
    error(e.message);
  } finally {
    busy = false;
    $("save-assessment").disabled = false;
  }
};
addEventListener("pagehide", () => {
  leaving = true;
  disconnect();
  stopCamera();
});
try {
  [rx, config] = await Promise.all([
    api(`prescriptions/${prescriptionId}`),
    api("catalogue"),
  ]);
  $("session-title").textContent = rx.definition.title;
  $("session-patient").textContent =
    `For ${rx.patient.name} · ${rx.definition.questions.length} questions`;
  $("back-patient").href = `/?patient=${rx.patientId}`;
  for (const id of ["side-analytics", "completed-analytics"])
    $(id).href = `/?view=analytics&patient=${rx.patientId}`;
  $("completed-patient").href = `/?view=reports&patient=${rx.patientId}`;
  config.languages.forEach((l) =>
    $("session-language").add(new Option(l.name, l.code)),
  );
  if (!config.geminiConfigured) {
    for (const input of document.querySelectorAll('input[name="mode"]'))
      if (input.value !== "screen") input.disabled = true;
    document.querySelector('input[value="screen"]').checked = true;
    $("session-start").textContent = "Start on-screen questionnaire";
    status("Gemini is not configured. On-screen responses remain available.");
  }
  state = rx.session;
  $("session-start").disabled = false;
  if (state) render();
} catch (e) {
  error(e.message);
}
