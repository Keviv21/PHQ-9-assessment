import {
  answerType,
  currentQuestionIndex,
  visibleQuestion,
} from "./workspace-answers.js";
import { answerInput } from "./workspace-answer-input.js";
import {
  BrowserSpeech,
  matchSpokenOption,
  speechLocale,
} from "./workspace-media.js";
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
  cameraTimer,
  cameraGeneration = 0,
  currentTurn = null,
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
function addMessage(speaker, text, chunk = false) {
  if (!text?.trim()) return;
  if (
    chunk &&
    currentTurn?.speaker === speaker &&
    currentTurn.body.isConnected
  ) {
    currentTurn.body.textContent += text;
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
    el("strong", speaker === "you" ? label("you") : "Gemini"),
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
  if (!state) return;
  const d = presentation(state.definition, state.language),
    index = currentQuestionIndex(state.definition, state.answers),
    complete = state.status === "completed",
    review = index === -1 && !complete;
  $("session-title").textContent = d.title;
  $("session-patient").textContent =
    `For ${rx.patient.name} · ${d.questions.length} questions`;
  $("session-setup").classList.add("started");
  $("session-language").value = state.language;
  $("session-language").disabled = true;
  $("session-modes").disabled = true;
  document.querySelector(
    `input[name="mode"][value="${state.sessionMode}"]`,
  ).checked = true;
  $("mode-badge").textContent = {
    screen: "On-screen",
    chat: "Chat",
    voice: "Voice",
  }[state.sessionMode];
  $("setup-note").textContent =
    `${config.languages.find((l) => l.code === state.language)?.name || state.language} · ${{ chat: "Chat with Gemini", voice: "Voice conversation", screen: "On-screen questionnaire" }[state.sessionMode]}`;
  $("session-start").hidden =
    complete || review || state.sessionMode === "screen" || connected;
  $("session-start").textContent = label("reconnect");
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
    $("save-assessment").textContent = label("save");
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
  $("read-question").disabled = !globalThis.speechSynthesis;
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
  $("microphone-toggle").textContent = label(muted ? "unmute" : "mute");
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
      currentQuestionIndex(state.definition, state.answers) !== -1 &&
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
