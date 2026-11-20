import { copy } from './i18n.js';
import { renderReport } from './report-view.js';
import { fetchQuestionnaire, questionnaireLanguage } from './questionnaire-language.js';
import { answerSelection } from './answer-selection.js';

const $ = (id) => document.getElementById(id);
const ui = {
  connection: $('connection'), startLive: $('start-live'), startDemo: $('start-demo'), keyNote: $('key-note'),
  progressLabel: $('progress-label'), progressBar: $('progress-bar'), questionArea: $('question-area'),
  options: $('answer-options'), results: $('results'), mode: $('mode-label'),
  preview: $('preview'), cameraPlaceholder: $('camera-placeholder'), micToggle: $('mic-toggle'),
  cameraToggle: $('camera-toggle'), transcript: $('transcript'), liveLabel: $('live-label'), recent: $('recent-results'),
  language: $('language'), conversationMode: $('conversation-mode'), textForm: $('text-form'),
  textInput: $('text-input'), sendText: $('send-text'), patientContext: $('patient-context'),
  assessmentTitle: $('assessment-title'), assessmentAvatar: $('assessment-avatar'),
  assessmentPeriod: $('assessment-period'), assessmentIntro: $('assessment-intro'), questionCount: $('question-count'),
  footer: $('footer-note') || document.querySelector('[data-i18n="footer"]'),
};

let form;
const selection = answerSelection();
let conversationMode = 'voice';
let formId = 'phq9';
const prescriptionId = new URLSearchParams(location.search).get('prescriptionId');
let demoPatientId = null;
let demoPatientLabel = null;
const language = questionnaireLanguage(ui.language, {
  note: $('assessment-language-note'),
  async load(code) {
    if (socket?.readyState === WebSocket.CONNECTING) throw new Error('Wait for the assessment to connect, then try again.');
    if (socket?.readyState === WebSocket.OPEN) {
      send({ type: 'set_language', language: code });
      return;
    }
    const localized = await fetchQuestionnaire(`/api/form?formId=${encodeURIComponent(formId)}`, code);
    form = localized;
    localizePage();
    if (state && state.status !== 'completed') renderState(state);
    return localized;
  },
});
const t = (key) => copy[form?.language]?.[key] || copy.en?.[key] || '';
function localizePage() {
  document.documentElement.lang = 'en';
  if (!state) {
    setStatus('Ready to begin');
    if (ui.startLive) ui.startLive.textContent = conversationMode === 'text' ? 'Start text conversation' : 'Start voice conversation';
  }
  ui.cameraToggle.textContent = camera ? 'Turn camera off' : 'Turn camera on';
  ui.micToggle.textContent = muted ? 'Turn microphone on' : 'Turn microphone off';
  if (config) ui.keyNote.textContent = config.geminiConfigured
    ? 'Voice assessment is ready.'
    : 'Voice assessment is unavailable. You can complete the assessment on screen.';
  ui.textInput.placeholder = conversationMode === 'text' ? 'Type your response here and press Enter...' : 'You can type a response here during a Live session';
  if (ui.conversationMode) ui.conversationMode.value = conversationMode;
  if (demoPatientLabel) ui.patientContext.textContent = `Selected patient: ${demoPatientLabel}`;
  if (form) {
    const name = formId.toUpperCase();
    document.title = `${name} Assessment | OpenMind`;
    ui.assessmentTitle.textContent = form.shortTitle || name;
    ui.assessmentAvatar.textContent = formId === 'phq9' ? 'PH' : formId === 'gad7' ? 'GA' : 'PC';
    const formInfoEn = {
      phq9: { period: 'PAST TWO WEEKS', intro: 'Discuss nine symptoms from the past two weeks.' },
      gad7: { period: 'PAST TWO WEEKS', intro: 'Discuss seven anxiety symptoms from the past two weeks.' },
      pcl5: { period: 'PAST MONTH', intro: 'Discuss twenty PTSD symptoms from the past month.' },
    };
    const info = formInfoEn[formId] || { period: 'PAST TWO WEEKS', intro: 'Discuss symptoms from the past two weeks.' };
    ui.assessmentPeriod.textContent = form.referencePeriod || info.period;
    ui.assessmentIntro.textContent = form.language === 'en' ? info.intro : form.instructions;
    ui.assessmentPeriod.lang = ui.assessmentIntro.lang = form.language;
    ui.questionCount.textContent = String(form.questions.length);
    const badge = ui.questionArea.querySelector('.question-number');
    if (badge && !state) badge.textContent = name;
    if (ui.footer && formId !== 'phq9') ui.footer.textContent = 'Review your answers before generating the report.';
  }
  for (const line of ui.transcript.querySelectorAll('.line.person strong')) {
    line.textContent = t('you');
  }
  refreshRecent().catch(() => {});
}

async function applyConversationMode() {
  const isText = conversationMode === 'text';
  if (ui.conversationMode) ui.conversationMode.value = conversationMode;
  if (!state && ui.startLive) {
    ui.startLive.textContent = isText ? 'Start text conversation' : 'Start voice conversation';
  }
  if (isText) {
    stopPlayback();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }
  if (mode === 'live' && socket?.readyState === WebSocket.OPEN) {
    if (isText) {
      stopPlayback();
      muted = true;
      ui.micToggle.textContent = 'Turn microphone on';
      ui.mode.textContent = 'TEXT';
      ui.liveLabel.textContent = 'TEXT';
      ui.textInput.disabled = false;
      ui.sendText.disabled = false;
      ui.textInput.placeholder = 'Type your response here and press Enter...';
      ui.textInput.focus();
      appendTranscript('system', 'Switched to text conversation. You can type your responses below.');
    } else {
      muted = false;
      ui.micToggle.textContent = 'Turn microphone off';
      ui.mode.textContent = 'LIVE';
      ui.liveLabel.textContent = 'CONNECTED';
      if (!microphone) {
        try {
          await startMicrophone();
        } catch (error) {
          appendTranscript('system', `Microphone access failed: ${error.message}. Continuing in text conversation.`);
          conversationMode = 'text';
          if (ui.conversationMode) ui.conversationMode.value = 'text';
          return;
        }
      }
      if (audioContext?.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }
      ui.textInput.placeholder = 'You can type a response here during a Live session';
      appendTranscript('system', 'Switched to voice conversation. Speak into your microphone.');
    }
  } else {
    ui.textInput.placeholder = isText
      ? 'Text mode selected. Start conversation to begin typing.'
      : 'You can type a response here during a Live session';
  }
}
let config;
let socket;
let state;
let mode;
let lockedMode = null;
let reviewValues;
let finalizeButton;
let microphone;
let camera;
let audioContext;
let captureNode;
let cameraTimer;
let muted = false;
let playbackTime = 0;
const playbackSources = new Set();
const transcriptRows = new Map();

function setStatus(message) { ui.connection.textContent = message; }
function send(value) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); }
function appendTranscript(speaker, text, messageId = null) {
  if (!text?.trim()) return;
  if (ui.transcript.querySelector('.empty')) ui.transcript.textContent = '';
  const existing = messageId ? transcriptRows.get(messageId) : null;
  if (existing?.isConnected) {
    existing.querySelector('span').textContent = text;
    ui.transcript.scrollTop = ui.transcript.scrollHeight;
    return;
  }
  const line = document.createElement('div');
  line.className = `line ${speaker === 'participant' ? 'person' : ''}`;
  const name = document.createElement('strong');
  name.textContent = speaker === 'participant' ? t('you') : speaker === 'gemini' ? 'Gemini' : 'System';
  const body = document.createElement('span');
  body.textContent = text;
  line.append(name, body);
  if (messageId) {
    line.dataset.messageId = messageId;
    transcriptRows.set(messageId, line);
  }
  ui.transcript.append(line);
  while (ui.transcript.children.length > 24) {
    const first = ui.transcript.firstChild;
    if (first.dataset.messageId) transcriptRows.delete(first.dataset.messageId);
    first.remove();
  }
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
}

function renderState(next) {
  const existingReview = state?.id === next.id && state.status === 'review';
  state = next;
  if (next.status === 'review') {
    renderReview(next, existingReview ? reviewValues : null);
    return;
  }
  const completed = next.status === 'completed';
  const total = form.questions.length;
  const questionNumber = completed ? total : next.currentNumber;
  ui.progressLabel.textContent = `${completed ? total : questionNumber - 1} / ${total} answered`;
  ui.progressBar.style.width = `${(completed ? total : questionNumber - 1) / total * 100}%`;
  ui.questionArea.replaceChildren();
  const badge = document.createElement('span');
  badge.className = 'question-number';
  badge.textContent = completed ? 'COMPLETE' : `QUESTION ${String(questionNumber).padStart(2, '0')}`;
  const heading = document.createElement('h2');
  heading.textContent = completed ? t('assessmentComplete') : form.questions[questionNumber - 1].text;
  const helper = document.createElement('p');
  helper.textContent = completed ? t('savedLocally') : form.instructions;
  heading.lang = helper.lang = ui.options.lang = form.language;
  heading.dir = helper.dir = 'auto';
  ui.questionArea.append(badge, heading, helper);
  ui.options.replaceChildren();
  ui.results.classList.toggle('hidden', !completed);
  if (completed) {
    finalizeButton = null;
    renderReport(ui.results, next, form, { printableLink: true });
    if (mode === 'live') {
      stopInputMedia();
      const completedSocket = socket;
      setTimeout(() => {
        if (socket === completedSocket) { stopMedia(); completedSocket?.close(); }
      }, 20000);
    } else {
      stopMedia();
      socket?.close();
    }
    refreshRecent();
    setStatus('All answers saved locally.');
    return;
  }
  for (const option of form.options) {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'option';
    choice.setAttribute('aria-pressed', 'false');
    choice.innerHTML = '<span class="number"></span><span><strong></strong><small></small></span>';
    choice.querySelector('.number').textContent = String(option.value);
    choice.querySelector('strong').textContent = option.label;
    choice.querySelector('strong').dir = choice.querySelector('small').dir = 'auto';
    choice.querySelector('small').textContent = option.description;
    choice.addEventListener('click', () => {
      if (socket?.readyState !== WebSocket.OPEN || !selection.show(choice)) return;
      send({ type: 'select', number: questionNumber, value: option.value });
      appendTranscript('participant', option.label);
    });
    ui.options.append(choice);
  }
  if (mode === 'demo' && 'speechSynthesis' in window) {
    speechSynthesis.cancel();
    if (conversationMode !== 'text') {
      const utterance = new SpeechSynthesisUtterance(heading.textContent);
      utterance.lang = config.languages.find(({ code }) => code === form.language)?.speechCode || 'en-US';
      utterance.rate = 0.95;
      speechSynthesis.speak(utterance);
    }
  }
}

function renderReview(next, edits) {
  reviewValues = edits ?? next.answers.map((answer) => answer.value);
  ui.progressLabel.textContent = `${form.questions.length} / ${form.questions.length} answered`;
  ui.progressBar.style.width = '100%';
  ui.questionArea.replaceChildren();
  const badge = document.createElement('span');
  badge.className = 'question-number';
  badge.textContent = 'FINAL REVIEW';
  const heading = document.createElement('h2');
  heading.textContent = formId === 'phq9' ? 'Review your nine answers' : `Review your ${form.questions.length} answers`;
  const helper = document.createElement('p');
  helper.textContent = 'Check each answer and make any final changes before generating the report.';
  ui.questionArea.append(badge, heading, helper);
  ui.options.replaceChildren();
  ui.results.classList.remove('hidden');
  ui.results.replaceChildren();
  ui.textInput.disabled = true;
  ui.sendText.disabled = true;
  if (mode === 'live') stopInputMedia();
  else if ('speechSynthesis' in window) speechSynthesis.cancel();

  const notice = document.createElement('p');
  notice.className = 'phq-report-alert';
  notice.setAttribute('role', 'alert');
  notice.textContent = 'Item 9 was answered positively. Please contact a qualified clinician promptly for follow-up. This assessment does not send an alert. If you may not be able to stay safe, seek immediate local emergency help.';
  notice.hidden = formId !== 'phq9' || reviewValues[8] === 0;
  ui.results.append(notice);

  const list = document.createElement('div');
  list.className = 'review-list';
  form.questions.forEach((question, index) => {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'review-item';
    const legend = document.createElement('legend');
    legend.textContent = `${index + 1}. ${question.text}`;
    fieldset.append(legend);
    const choices = document.createElement('div');
    choices.className = 'review-choices';
    for (const option of form.options) {
      const label = document.createElement('label');
      label.className = 'review-choice';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `review-q${index + 1}`;
      input.value = String(option.value);
      input.checked = reviewValues[index] === option.value;
      input.addEventListener('change', () => {
        reviewValues[index] = option.value;
        notice.hidden = formId !== 'phq9' || reviewValues[8] === 0;
      });
      const text = document.createElement('span');
      text.textContent = option.label;
      label.append(input, text);
      choices.append(label);
    }
    fieldset.append(choices);
    list.append(fieldset);
  });
  ui.results.append(list);
  finalizeButton = document.createElement('button');
  finalizeButton.type = 'button';
  finalizeButton.className = 'button primary review-finalize';
  finalizeButton.textContent = 'Confirm answers and generate report';
  finalizeButton.addEventListener('click', () => {
    if (socket?.readyState !== WebSocket.OPEN) {
      appendTranscript('system', 'Connection lost. Restart the assessment to review answers.');
      return;
    }
    finalizeButton.disabled = true;
    send({ type: 'finalize', answers: [...reviewValues] });
  });
  ui.results.append(finalizeButton);
}

function stopPlayback() {
  for (const source of playbackSources) { try { source.stop(); } catch {} }
  playbackSources.clear();
  playbackTime = audioContext?.currentTime || 0;
}

function playPcm(base64) {
  if (!audioContext || conversationMode === 'text') return;
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const sampleCount = Math.floor(bytes.byteLength / 2);
  if (!sampleCount) return;
  const samples = new DataView(bytes.buffer);
  const buffer = audioContext.createBuffer(1, sampleCount, 24000);
  const output = buffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) output[i] = samples.getInt16(i * 2, true) / 32768;
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  source.onended = () => playbackSources.delete(source);
  playbackSources.add(source);
  playbackTime = Math.max(playbackTime, audioContext.currentTime + 0.06);
  source.start(playbackTime);
  playbackTime += buffer.duration;
}

async function startMicrophone() {
  microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  audioContext = new AudioContext();
  await audioContext.audioWorklet.addModule('/audio-worklet.js');
  const source = audioContext.createMediaStreamSource(microphone);
  captureNode = new AudioWorkletNode(audioContext, 'pcm16-capture');
  captureNode.port.onmessage = (event) => {
    if (muted || socket?.readyState !== WebSocket.OPEN || !event.data) return;
    const bytes = new Uint8Array(event.data);
    const packet = new Uint8Array(bytes.length + 1);
    packet[0] = 1;
    packet.set(bytes, 1);
    socket.send(packet);
  };
  source.connect(captureNode);
  captureNode.connect(audioContext.destination);
  await audioContext.resume();
  ui.micToggle.disabled = false;
  ui.cameraToggle.disabled = false;
}

async function toggleCamera() {
  if (camera) {
    clearInterval(cameraTimer);
    camera.getTracks().forEach((track) => track.stop());
    camera = null;
    ui.preview.srcObject = null;
    ui.preview.style.display = 'none';
    ui.cameraPlaceholder.style.display = '';
    ui.cameraToggle.textContent = 'Turn camera on';
    return;
  }
  try {
    camera = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360, frameRate: 1 }, audio: false });
    ui.preview.srcObject = camera;
    ui.preview.style.display = 'block';
    ui.cameraPlaceholder.style.display = 'none';
    ui.cameraToggle.textContent = 'Turn camera off';
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 360;
    cameraTimer = setInterval(() => {
      if (!camera || socket?.readyState !== WebSocket.OPEN || ui.preview.readyState < 2) return;
      canvas.getContext('2d').drawImage(ui.preview, 0, 0, 640, 360);
      canvas.toBlob(async (blob) => {
        if (!blob || !camera || socket?.readyState !== WebSocket.OPEN) return;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const packet = new Uint8Array(bytes.length + 1);
        packet[0] = 2; packet.set(bytes, 1);
        socket.send(packet);
      }, 'image/jpeg', 0.55);
    }, 1100);
  } catch (error) { appendTranscript('system', `Camera unavailable: ${error.message}`); }
}

function stopInputMedia() {
  clearInterval(cameraTimer);
  camera?.getTracks().forEach((track) => track.stop());
  camera = null;
  microphone?.getTracks().forEach((track) => track.stop());
  microphone = null;
  captureNode?.disconnect();
  captureNode = null;
  ui.preview.srcObject = null;
  ui.preview.style.display = 'none';
  ui.cameraPlaceholder.style.display = '';
  ui.cameraToggle.textContent = 'Turn camera on';
  ui.cameraToggle.disabled = true;
  ui.micToggle.disabled = true;
}

function stopMedia() {
  stopInputMedia();
  stopPlayback();
  audioContext?.close().catch(() => {});
  audioContext = null;
}

async function start(nextMode) {
  if (language.pending) { setStatus('Wait for the questionnaire language to load.'); return; }
  const oldSocket = socket;
  selection.clear();
  socket = null;
  if (oldSocket && oldSocket.readyState <= WebSocket.OPEN) oldSocket.close();
  stopMedia();
  state = null;
  mode = nextMode;
  if (nextMode === 'demo') {
    document.body.classList.add('demo-mode');
  } else {
    document.body.classList.remove('demo-mode');
  }
  ui.mode.textContent = nextMode.toUpperCase();
  ui.liveLabel.textContent = nextMode === 'live' ? 'CONNECTING' : 'DEMO';
  ui.textInput.disabled = true;
  ui.sendText.disabled = true;
  ui.textInput.value = '';
  ui.transcript.replaceChildren();
  transcriptRows.clear();
  const emptyTranscript = document.createElement('p'); emptyTranscript.className = 'empty'; emptyTranscript.textContent = 'The conversation will appear here.'; ui.transcript.append(emptyTranscript);
  ui.startLive.disabled = true;
  ui.startDemo.disabled = true;
  setStatus('Connecting…');
  if (nextMode === 'live') {
    if (conversationMode === 'voice') {
      try { await startMicrophone(); }
      catch (error) {
        appendTranscript('system', `Microphone access failed: ${error.message}`);
        setStatus('Microphone unavailable');
        ui.startLive.disabled = false; ui.startDemo.disabled = false;
        stopMedia();
        return;
      }
    } else {
      try {
        await startMicrophone();
        muted = true;
        ui.micToggle.textContent = 'Turn microphone on';
      } catch {
        muted = true;
      }
    }
  }
  const prescriptionQuery = `&prescriptionId=${encodeURIComponent(prescriptionId)}`;
  const connection = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws?mode=${nextMode}&language=${encodeURIComponent(language.code)}${prescriptionQuery}`);
  socket = connection;
  connection.onopen = () => setStatus(nextMode === 'demo' ? 'Form test in progress' : 'Connecting…');
  connection.onmessage = async (event) => {
    if (socket !== connection) return;
    const message = JSON.parse(event.data);
    if (message.type === 'state') {
      if (selection.visible) await selection.visible;
      if (socket !== connection || connection.readyState !== WebSocket.OPEN) return;
      selection.clear();
      if (message.questionnaire) {
        form = message.questionnaire;
        language.accept(form);
        localizePage();
      }
      lockedMode = nextMode;
      renderState(message.assessment);
    }
    else if (message.type === 'language_error') language.fail(message.message);
    else if (message.type === 'proposal' && mode === 'live') send({ type: 'confirm' });
    else if (message.type === 'audio') {
      if (conversationMode !== 'text') playPcm(message.data);
    }
    else if (message.type === 'audio_interrupt') stopPlayback();
    else if (message.type === 'transcript') appendTranscript(message.speaker, message.text, message.messageId);
    else if (message.type === 'live_status') {
      ui.liveLabel.textContent = conversationMode === 'text' ? 'TEXT' : message.status.toUpperCase();
      if (message.status === 'connected') {
        setStatus('CONNECTED');
        ui.textInput.disabled = false;
        ui.sendText.disabled = false;
        if (conversationMode === 'text') {
          ui.mode.textContent = 'TEXT';
          muted = true;
          ui.micToggle.textContent = 'Turn microphone on';
          ui.textInput.placeholder = 'Type your response here and press Enter...';
          setTimeout(() => ui.textInput.focus(), 80);
        }
      }
      else { ui.textInput.disabled = true; ui.sendText.disabled = true; }
      if (message.detail) appendTranscript('system', message.detail);
    }
    else if (message.type === 'error') {
      selection.clear();
      appendTranscript('system', message.message);
      if (state?.status === 'review' && finalizeButton) finalizeButton.disabled = false;
    }
  };
  connection.onerror = () => appendTranscript('system', 'Connection error. Check the server terminal.');
  connection.onclose = () => {
    if (socket !== connection) return;
    selection.clear();
    language.restore();
    ui.startLive.disabled = !config.geminiConfigured || (lockedMode && lockedMode !== 'live') || state?.status === 'completed';
    ui.startDemo.disabled = (lockedMode && lockedMode !== 'demo') || state?.status === 'completed';
    ui.textInput.disabled = true;
    ui.sendText.disabled = true;
    if (state?.status !== 'completed') {
      setStatus('Disconnected. Start again to resume your saved answers.');
      stopMedia();
    }
  };
}

async function refreshRecent() {
  if (!demoPatientId) return;
  const response = await fetch(`/api/demo-patients/${encodeURIComponent(demoPatientId)}/reports`);
  const results = await response.json();
  ui.recent.replaceChildren();
  if (!results.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No completed assessments yet.'; ui.recent.append(empty); return; }
  for (const item of results.slice(0, 5)) {
    const row = document.createElement('a'); row.className = 'recent-item';
    row.href = `/report.html?id=${encodeURIComponent(item.id)}`;
    row.setAttribute('aria-label', `Open PHQ-9 report completed ${new Date(item.completedAt).toLocaleString('en-IN')}`);
    const kind = item.collectionMethod === 'conversational_inference' ? 'Conversation' : item.mode === 'live' ? 'Live' : 'Form test';
    const patientName = item.demoPatientId ? ` · Selected patient ${item.demoPatientId.slice(-1).toUpperCase()}` : '';
    const title = document.createElement('strong'); title.textContent = `${item.formId.toUpperCase()} · ${kind}${patientName} · ${item.language?.toUpperCase() || 'EN'} · ${item.scores.rawTotal} / ${item.scores.maxTotal || 27}${item.scores.requiresHumanFollowUp ? ' · Follow-up needed' : ''}`;
    const date = document.createElement('span'); date.textContent = new Date(item.completedAt).toLocaleString('en-IN');
    row.append(title, date); ui.recent.append(row);
  }
}

ui.startLive.addEventListener('click', () => start('live'));
ui.startDemo.addEventListener('click', () => start('demo'));
ui.textForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const response = ui.textInput.value.trim();
  if (!response || mode !== 'live' || socket?.readyState !== WebSocket.OPEN) return;
  send({ type: 'say', text: response });
  appendTranscript('participant', response);
  ui.textInput.value = '';
});
ui.cameraToggle.addEventListener('click', toggleCamera);
ui.micToggle.addEventListener('click', () => {
  muted = !muted;
  ui.micToggle.textContent = muted ? 'Turn microphone on' : 'Turn microphone off';
});
if (ui.conversationMode) {
  ui.conversationMode.addEventListener('change', () => {
    conversationMode = ui.conversationMode.value;
    applyConversationMode();
  });
}
window.addEventListener('beforeunload', stopMedia);

try {
  if (!prescriptionId) throw new Error('A prescription is required. Return to NovoPsych assessments.');
  const [configResponse, prescriptionResponse] = await Promise.all([
    fetch('/api/config'), fetch(`/api/prescriptions/${encodeURIComponent(prescriptionId)}`),
  ]);
  config = await configResponse.json();
  if (!prescriptionResponse.ok) throw new Error('Prescription not found.');
  const prescription = await prescriptionResponse.json();
  if (prescription.status === 'completed') throw new Error('This prescription is completed. Open its report from View test reports.');
  formId = prescription.formId;
  const preferred = new URL(location.href).searchParams.get('language') || prescription.language || 'en';
  form = await fetchQuestionnaire(`/api/form?formId=${encodeURIComponent(formId)}`, 'en');
  language.restore();
  if (config.languages.some(({ code }) => code === preferred)) await language.change(preferred);
  demoPatientId = prescription.demoPatientId;
  demoPatientLabel = prescription.patient.label;
  ui.patientContext.hidden = false;
  if (prescription.status === 'in_progress') {
    lockedMode = prescription.mode;
  }
  localizePage();
  ui.progressLabel.textContent = `0 / ${form.questions.length}`;
  ui.startLive.disabled = !config.geminiConfigured || (prescription.status === 'in_progress' && prescription.mode !== 'live');
  ui.startDemo.disabled = prescription.status === 'in_progress' && prescription.mode !== 'demo';
  ui.keyNote.textContent = config.geminiConfigured
    ? 'Voice assessment is ready.'
    : 'Voice assessment is unavailable. You can complete the assessment on screen.';
  await refreshRecent();
} catch (error) {
  setStatus(error.message);
  ui.keyNote.textContent = `Could not load the form: ${error.message}`;
  ui.startLive.disabled = true; ui.startDemo.disabled = true;
}
