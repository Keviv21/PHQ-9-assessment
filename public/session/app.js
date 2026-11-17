import { mergeTranscript, requestedLanguage } from "../shared/language-guard.js";
import {
  answerType,
  currentQuestionIndex,
  visibleQuestion,
} from "../shared/answers.js";
import { answerInput } from "./answer-input.js";
import {
  BrowserSpeech,
  matchSpokenOption,
  speechLocale,
} from "./media.js";
import { $, el, api, reportLinks } from "../shared/api.js";
import { LiveAudio } from "./audio.js";
import {
  presentation,
  sessionLabels,
  formatLabel,
} from "../shared/presentation.js";
let rx,
  config,
  state,
  connection,
  audio,
  camera,
  cameraTimer,
  cameraGeneration = 0,
  currentTurn = null,
  connected = false,
  connecting = false,
  queuedLanguage = null,
  muted = false,
  busy = false,
  paused = false,
  leaving = false,
  pendingPreferences = null,
  exitDestination = null,
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
  renderConversationStatus();
}
function addMessage(speaker, text, chunk = false) {
  if (!text?.trim()) return;
  if (
    chunk &&
    currentTurn?.speaker === speaker &&
    currentTurn.body.isConnected
  ) {
    currentTurn.body.textContent = mergeTranscript(currentTurn.body.textContent, text);
    $("session-transcript").scrollTop = $("session-transcript").scrollHeight;
    return;
  }
  const log = $("session-transcript"),
    row = el(
      "div",
      undefined,
      `chat-message ${speaker === "you" ? "user" : "assistant"}`,
    );
  row.append(
    el("strong", speaker === "you" ? label("you") : "Assessment assistant"),
    el("p", text),
  );
  log.append(row);
  currentTurn = chunk ? { speaker, body: row.querySelector("p") } : null;
  while (log.children.length > 80) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}
function disconnect() {
  generation++;
  currentTurn = null;
  stopCameraSharing();
  connected = false;
  connecting = false;
  const ws = connection;
  connection = null;
  ws?.close();
  audio?.close();
  audio = null;
  $("microphone-toggle").disabled = true;
  $("disconnect-session").disabled = true;
  $("session-text").disabled = true;
  $("session-send").disabled = true;
  renderConversationStatus();
}
function stopCameraSharing() {
  clearInterval(cameraTimer);
  cameraTimer = null;
  $("share-camera").checked = false;
  $("share-camera").disabled = true;
  $("camera-sharing-status").textContent =
    "Camera preview stays on this device unless sharing is enabled.";
}
function stopCamera() {
  cameraGeneration++;
  stopCameraSharing();
  camera?.getTracks().forEach((t) => t.stop());
  camera = null;
  $("camera-preview").srcObject = null;
  $("camera-preview").hidden = true;
  $("camera-placeholder").hidden = false;
  $("camera-toggle").textContent = "Turn camera on";
}
function render() {
  updateExitDialog();
  if (!state) return;
  const d = presentation(state.definition, state.language),
    index = currentQuestionIndex(state.definition, state.answers),
    complete = state.status === "completed",
    review = index === -1 && !complete;
  $("pause-assessment").disabled = complete;
  $("pause-assessment").hidden = complete;
  renderConversationStatus();
  if (queuedLanguage && !busy && !leaving) {
    const nextLanguage = queuedLanguage;
    queuedLanguage = null;
    queueMicrotask(() => switchConversationLanguage(nextLanguage));
  }
  $("session-title").textContent = d.title;
  $("session-patient").textContent =
    `For ${rx.patient.name} · ${d.questions.length} questions`;
  $("session-setup").classList.add("started");
  $("session-language").value = pendingPreferences?.language || state.language;
  $("session-language").disabled = busy || complete;
  $("session-modes").disabled = busy || complete;
  document.querySelector(
    `input[name="mode"][value="${pendingPreferences?.mode || state.sessionMode}"]`,
  ).checked = true;
  $("mode-badge").textContent = {
    screen: "On-screen",
    chat: "Chat",
    voice: "Voice",
  }[state.sessionMode];
  $("setup-note").textContent = config.geminiConfigured
    ? "Switch language or response mode here at any time. Your saved answers stay in place."
    : "Answer choices are available. Text and voice conversations are currently unavailable.";
  $("session-start").hidden =
    complete || review || state.sessionMode === "screen" || connected;
  $("session-start").textContent = state.sessionMode === "voice" ? "Connect voice" : "Reconnect conversation";
  $("session-start").disabled = busy;
  $("question-chat-grid").hidden = complete || review;
  $("session-review").hidden = !review;
  $("session-complete").hidden = !complete;
  if (complete) {
    speech.stop();
    globalThis.speechSynthesis?.cancel();
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
    speech.stop();
    globalThis.speechSynthesis?.cancel();
    stopCamera();
    disconnect();
    $("session-start").hidden = true;
    $("review-title").textContent = label("review");
    $("review-hint").textContent = label("reviewHint");
    $("save-assessment").textContent = label("submit");
    const box = $("review-answers");
    box.replaceChildren();
    d.questions.forEach((q, i) => {
      if (!visibleQuestion(state.definition, state.answers, q)) return;
      const row = el("div", undefined, "review-row");
      if (q.context_text) row.append(el("p", q.context_text, "muted-text"));
      row.append(el("strong", `${i + 1}. ${q.text}`));
      row.append(
        answerInput(q, {
          value: state.answers[i],
          disabled: busy,
          labels: sessionLabels(state.definition, state.language),
          onSave: (value) => saveAnswer(q.id, value),
        }),
      );
      box.append(row);
    });
    return;
  }
  const q = d.questions[index];
  $("question-progress").textContent = label("progress", {
    count: state.answers.filter((v) => v !== null).length,
    total: d.questions.filter((q) =>
      visibleQuestion(state.definition, state.answers, q),
    ).length,
  });
  $("question-progress-bar").max = d.questions.filter((q) =>
    visibleQuestion(state.definition, state.answers, q),
  ).length;
  $("question-progress-bar").value = state.answers.filter(
    (v) => v !== null,
  ).length;
  $("question-context").textContent = q.context_text || "";
  $("question-context").hidden = !q.context_text;
  $("question-title").textContent = q.text;
  $("question-title").lang = state.language;
  $("question-period").textContent = d.referencePeriod || d.instructions;
  $("question-hint").textContent = label(
    answerType(q) === "single_choice" ? "autoSave" : "reviewHint",
  );
  $("question-options").replaceChildren(
    answerInput(q, {
      disabled: busy,
      labels: sessionLabels(state.definition, state.language),
      onSave: (value) => saveAnswer(q.id, value),
    }),
  );
  $("original-question").replaceChildren(
    el("p", state.definition.questions[index].text),
    el(
      "p",
      state.definition.questions[index].options.map((o) => o.label).join(" · "),
    ),
  );
  $("browser-speech-controls").hidden = state.sessionMode !== "screen";
  $("speak-option").disabled =
    busy || !speech.supported || answerType(q) !== "single_choice";
  $("read-question").disabled = busy || !globalThis.speechSynthesis;
  $("share-camera").disabled =
    !camera || !connected || paused || state.sessionMode !== "voice";
  $("session-chat").hidden = state.sessionMode === "screen";
  $("question-chat-grid").classList.toggle(
    "screen-only",
    state.sessionMode === "screen",
  );
  $("session-text").lang = state.language;
  $("session-text").placeholder = label("placeholder");
  $("microphone-toggle").hidden = state.sessionMode !== "voice";
  renderConversationStatus();
  $("session-chat").querySelector("h2").textContent = label("conversation");
  $("session-send").textContent = label("send");
  document.querySelector('label[for="session-text"]').textContent =
    label("response");
}
async function saveAnswer(questionId, value) {
  if (busy) return;
  busy = true;
  speech.stop();
  globalThis.speechSynthesis?.cancel();
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
  connecting = true;
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
          connecting = false;
          status("");
          $("session-text").disabled = false;
          $("session-send").disabled = false;
          $("disconnect-session").disabled = false;
          $("microphone-toggle").disabled = state.sessionMode !== "voice";
          audio?.mute($("exit-assessment").open || muted || paused);
          render();
        } else if (m.status === "error") {
          error(m.message);
          disconnect();
          render();
        } else status(m.status);
      } else if (m.type === "language_request") {
        addMessage("you", m.text, true);
        currentTurn = null;
        switchConversationLanguage(m.language);
      } else if (m.type === "state") {
        state = m.state;
        render();
      } else if (m.type === "audio" && !$("exit-assessment").open) audio?.play(m.data);
      else if (m.type === "audio_interrupt") audio?.interrupt();
      else if (m.type === "turn_complete") currentTurn = null;
      else if (m.type === "transcript")
        addMessage(
          ["you", "user", "participant"].includes(m.speaker) ? "you" : "gemini",
          m.text,
          true,
        );
      else if (m.type === "paused") {
        paused = true;
        stopCameraSharing();
        audio?.mute(true);
        error(m.message);
        $("session-text").disabled = true;
        $("session-send").disabled = true;
        renderConversationStatus();
      }
    };
    ws.onclose = () => {
      if (current !== generation) return;
      disconnect();
      status("");
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
async function startAssessment() {
  if (busy) return;
  busy = true;
  error("");
  $("session-start").disabled = true;
  $("session-language").disabled = true;
  $("session-modes").disabled = true;
  status("Opening assessment…");
  try {
    if (!state)
      state = await api(`prescriptions/${prescriptionId}/sessions`, {
        method: "POST",
        body: JSON.stringify({ language: language(), mode: mode() }),
      });
    if (leaving) return;
    render();
    if (state.status === "draft" && currentQuestionIndex(state.definition, state.answers) !== -1 && state.sessionMode !== "screen")
      await connect();
    else status("");
  } catch (e) {
    error(e.message);
    status("");
    if (!state) {
      $("session-start").hidden = false;
      $("session-start").textContent = "Retry loading assessment";
    }
  } finally {
    busy = false;
    $("session-start").disabled = false;
    if (state) render();
  }
}
async function changePreferences() {
  if (!state || busy || state.status !== "draft") return;
  const next = { language: language(), mode: mode(), revision: state.revision };
  if (next.language === state.language && next.mode === state.sessionMode) return;
  busy = true;
  pendingPreferences = next;
  error("");
  speech.stop();
  globalThis.speechSynthesis?.cancel();
  disconnect();
  render();
  status(next.language !== state.language ? "Preparing the selected language…" : "Switching response mode…");
  try {
    state = await api(`sessions/${state.id}/preferences`, {
      method: "PATCH",
      body: JSON.stringify(next),
    });
    if (leaving) return;
    render();
    if (state.sessionMode !== "screen" && currentQuestionIndex(state.definition, state.answers) !== -1)
      await connect();
    else status("Preferences updated. Your saved answers are unchanged.");
  } catch (e) {
    error(e.message);
    status("Could not switch preferences. Your saved answers are unchanged.");
    try { state = await api(`sessions/${state.id}`); } catch {}
  } finally {
    busy = false;
    pendingPreferences = null;
    if (!leaving) render();
  }
}
$("session-start").onclick = startAssessment;
$("session-language").onchange = changePreferences;
for (const input of document.querySelectorAll('input[name="mode"]'))
  input.onchange = changePreferences;
$("session-chat-form").onsubmit = (e) => {
  e.preventDefault();
  const text = $("session-text").value.trim();
  if (!text || paused || busy) return;
  const requested = requestedLanguage(text);
  if (requested && requested !== state.language) {
    addMessage("you", text);
    $("session-text").value = "";
    switchConversationLanguage(requested);
    return;
  }
  if (!connected) return;
  connection.send(JSON.stringify({ type: "text", text }));
  addMessage("you", text);
  $("session-text").value = "";
};
$("microphone-toggle").onclick = () => {
  muted = !muted;
  audio?.mute(muted || paused);
  renderConversationStatus();
  if (muted && connection?.readyState === 1)
    connection.send(JSON.stringify({ type: "audio_end" }));
};
$("disconnect-session").onclick = () => {
  disconnect();
  status("");
  render();
};
$("camera-toggle").onclick = async () => {
  if (camera) {
    stopCamera();
    return;
  }
  const cameraToken = ++cameraGeneration;
  $("camera-toggle").disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, frameRate: 1 },
      audio: false,
    });
    if (
      leaving ||
      cameraToken !== cameraGeneration ||
      state?.status === "completed"
    ) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    camera = stream;
    $("camera-preview").srcObject = stream;
    $("camera-preview").hidden = false;
    $("camera-placeholder").hidden = true;
    $("camera-toggle").textContent = "Turn camera off";
    $("share-camera").disabled =
      !connected || paused || state?.sessionMode !== "voice";
  } catch {
    error(
      "Camera preview is unavailable. The assessment can continue without it.",
    );
  } finally {
    $("camera-toggle").disabled = false;
  }
};
$("share-camera").onchange = () => {
  clearInterval(cameraTimer);
  if (!$("share-camera").checked) {
    $("camera-sharing-status").textContent =
      "Camera sharing stopped. Preview stays on this device.";
    return;
  }
  if (!camera || !connected || paused || state?.sessionMode !== "voice") {
    stopCameraSharing();
    return;
  }
  $("camera-sharing-status").textContent =
    "Sharing camera frames with Gemini. Turn off sharing at any time.";
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 240;
  cameraTimer = setInterval(() => {
    const video = $("camera-preview");
    if (
      !camera ||
      !$("share-camera").checked ||
      !connected ||
      paused ||
      connection?.readyState !== 1 ||
      video.readyState < 2 ||
      connection.bufferedAmount > 64000
    )
      return;
    canvas.getContext("2d").drawImage(video, 0, 0, 320, 240);
    const data = canvas.toDataURL("image/jpeg", 0.45).split(",")[1];
    if (data.length <= 48000)
      connection.send(JSON.stringify({ type: "camera", data }));
  }, 1500);
};
const speech = new BrowserSpeech({
  onStatus: (message) => {
    $("speech-status").textContent = message;
  },
  onText: (text) => {
    if (
      !state ||
      state.status !== "draft" ||
      busy ||
      state.sessionMode !== "screen"
    )
      return;
    const q = presentation(state.definition, state.language).questions[
      currentQuestionIndex(state.definition, state.answers)
    ];
    if (!q) return;
    const value = matchSpokenOption(text, q.options);
    if (value === null) {
      speech.stop();
      $("speech-status").textContent =
        `Heard: “${text}”. Please choose a response on screen; no answer was saved.`;
      return;
    }
    saveAnswer(q.id, value);
  },
});
$("speak-option").onclick = () => {
  globalThis.speechSynthesis?.cancel();
  speech.listen(state.language);
};
$("stop-speech").onclick = () => {
  speech.stop();
  globalThis.speechSynthesis?.cancel();
  $("speech-status").textContent = "Speech stopped.";
};
$("read-question").onclick = () => {
  speech.stop();
  globalThis.speechSynthesis?.cancel();
  const d = presentation(state.definition, state.language),
    q = d.questions[currentQuestionIndex(state.definition, state.answers)];
  if (!q || !globalThis.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(
    [
      d.referencePeriod,
      q.context_text,
      q.text,
      ...q.options.map((o) => o.label),
    ]
      .filter(Boolean)
      .join(". "),
  );
  utterance.lang = speechLocale(state.language);
  speechSynthesis.speak(utterance);
};
$("save-assessment").onclick = async () => {
  if (busy) return;
  busy = true;
  $("save-assessment").disabled = true;
  $("save-assessment").textContent = label("submitting");
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
    $("save-assessment").textContent = label("submit");
    updateExitDialog();
  }
};
const iconPaths = {
  mic: ["M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5Z", "M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"],
  muted: ["m3 3 18 18", "M9 9v3a3 3 0 0 0 5 2M9 5a3 3 0 0 1 6 0v5M5 10v2a7 7 0 0 0 12 5M19 10v2M12 19v3M8 22h8"],
  chat: ["M4 4h16v12H9l-5 4V4Z", "M8 8h8M8 12h5"],
  pause: ["M8 5v14M16 5v14"],
  choices: ["M8 6h12M8 12h12M8 18h12", "M3 6h1M3 12h1M3 18h1"],
  connecting: ["M20 12a8 8 0 1 1-8-8"],
};
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("session-control-icon");
  for (const data of iconPaths[name]) {
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", data);
    svg.append(path);
  }
  return svg;
}
function renderConversationStatus() {
  const voice = state?.sessionMode === "voice";
  const kind = connecting ? "connecting" : paused ? "paused" : connected ? (voice && muted ? "muted" : "ready") : "offline";
  const text = connecting ? (voice ? "Connecting voice…" : "Opening text conversation…")
    : paused ? "Conversation paused" : connected ? (voice ? (muted ? "Microphone muted" : "Microphone on · Speak your answer") : "Ready for your reply")
    : "Conversation disconnected";
  const badge = $("conversation-status");
  badge.dataset.state = kind;
  badge.replaceChildren(icon(connecting ? "connecting" : voice ? (muted || !connected ? "muted" : "mic") : "chat"), el("span", text));
  const button = $("microphone-toggle");
  button.hidden = !voice;
  button.setAttribute("aria-label", muted ? "Turn microphone on" : "Mute microphone");
  button.setAttribute("aria-pressed", String(muted));
  button.replaceChildren(icon(muted ? "muted" : "mic"), el("span", muted ? "Unmute" : "Mute"));
}
async function switchConversationLanguage(language) {
  if (!state || leaving || state.status !== "draft" || language === state.language || !config.languages.some(item => item.code === language)) return;
  if (busy) { queuedLanguage = language; return; }
  $("session-language").value = language;
  await changePreferences();
  if (!leaving && state.language === language) {
    const name = config.languages.find(item => item.code === language).name;
    status(`Language changed to ${name}. Your saved answers are unchanged.`);
  }
}
$("pause-assessment").replaceChildren(icon("pause"), el("span", "Pause assessment"));
for (const [value, name] of [["screen", "choices"], ["chat", "chat"], ["voice", "mic"]]) {
  const span = document.querySelector(`input[name="mode"][value="${value}"] + span`);
  span.prepend(icon(name));
}
function updateExitDialog() {
  $("confirm-exit-assessment").disabled = busy;
  $("exit-assessment-status").textContent = busy
    ? "Please wait for the current update to finish before leaving." : "";
}
function requestExit(destination) {
  exitDestination = destination;
  updateExitDialog();
  speech.stop();
  globalThis.speechSynthesis?.cancel();
  audio?.mute(true);
  audio?.interrupt();
  stopCameraSharing();
  if (!$("exit-assessment").open) $("exit-assessment").showModal();
}
document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === "_blank") return;
  if (state?.status !== "draft" || leaving) return;
  event.preventDefault();
  requestExit(link.href);
});
$("pause-assessment").onclick = () => requestExit($("back-patient").href);
$("continue-assessment").onclick = () => $("exit-assessment").close();
$("exit-assessment").addEventListener("close", () => {
  if (!leaving) audio?.mute(muted || paused);
  exitDestination = null;
});
$("confirm-exit-assessment").onclick = () => {
  if (busy) return;
  const destination = exitDestination || $("back-patient").href;
  leaving = true;
  disconnect();
  stopCamera();
  $("exit-assessment").close();
  location.assign(destination);
};
// Browsers supply their own confirmation text for refresh, tab close and browser Back.
addEventListener("beforeunload", (event) => {
  if (!leaving && state?.status === "draft") {
    event.preventDefault();
    event.returnValue = "";
  }
});
addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});
addEventListener("pagehide", () => {
  leaving = true;
  speech.stop();
  globalThis.speechSynthesis?.cancel();
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
  $("back-patient").href = `/?view=reports&patient=${rx.patientId}`;
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
    $("setup-note").textContent = "Answer choices are available. Text and voice conversations are currently unavailable.";
  }
  $("session-language").value = "en";
  state = rx.session;
  if (state) {
    render();
    status(state.sessionMode === "voice" && state.status === "draft" ? "Select Connect voice when you are ready to use the microphone." : "");
    if (state.sessionMode === "chat" && state.status === "draft" && currentQuestionIndex(state.definition, state.answers) !== -1) await startAssessment();
  } else await startAssessment();
} catch (e) {
  error(e.message);
}
