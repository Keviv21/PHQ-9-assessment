import { copy, speechCodes } from './i18n.js';
import { renderReport } from './report-view.js';

const $ = (id) => document.getElementById(id);
const ui = {
  connection: $('connection'), startLive: $('start-live'), startDemo: $('start-demo'), keyNote: $('key-note'),
  progressLabel: $('progress-label'), progressBar: $('progress-bar'), questionArea: $('question-area'),
  options: $('answer-options'), confirmation: $('confirmation'), pendingLabel: $('pending-label'),
  confirm: $('confirm-answer'), cancel: $('cancel-answer'), results: $('results'), mode: $('mode-label'),
  preview: $('preview'), cameraPlaceholder: $('camera-placeholder'), micToggle: $('mic-toggle'),
  cameraToggle: $('camera-toggle'), transcript: $('transcript'), liveLabel: $('live-label'), recent: $('recent-results'),
  language: $('language'), selectedLanguage: $('selected-language'), textForm: $('text-form'),
  textInput: $('text-input'), sendText: $('send-text'),
};

let form;
let language = 'en';
const t = (key) => copy[language][key];
function localizePage() {
  document.documentElement.lang = language;
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  if (!state) setStatus(t('ready'));
  ui.cameraToggle.textContent = t(camera ? 'turnCameraOff' : 'turnCameraOn');
  ui.micToggle.textContent = t(muted ? 'turnMicOn' : 'turnMicOff');
  if (config) ui.keyNote.textContent = t(config.geminiConfigured ? 'keyDetected' : 'keyMissing');
  ui.selectedLanguage.textContent = ui.language.selectedOptions[0].textContent;
  ui.textInput.placeholder = t('textPlaceholder');
  refreshRecent().catch(() => {});
}
let config;
let socket;
let state;
let pending;
let mode;
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

function setStatus(message) { ui.connection.textContent = message; }
function send(value) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); }
function appendTranscript(speaker, text) {
  if (!text?.trim()) return;
  if (ui.transcript.querySelector('.empty')) ui.transcript.textContent = '';
  const line = document.createElement('div');
  line.className = `line ${speaker === 'participant' ? 'person' : ''}`;
  const name = document.createElement('strong');
  name.textContent = speaker === 'participant' ? t('you') : speaker === 'gemini' ? 'Gemini' : t('system');
  const body = document.createElement('span');
  body.textContent = text;
  line.append(name, body);
  ui.transcript.append(line);
  while (ui.transcript.children.length > 24) ui.transcript.firstChild.remove();
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
}

function renderState(next) {
  state = next;
  pending = null;
  ui.confirmation.classList.add('hidden');
  if (next.status === 'review') {
    renderReview(next);
    return;
  }
  const completed = next.status === 'completed';
  const total = form.questions.length;
  const questionNumber = completed ? total : next.currentNumber;
  ui.progressLabel.textContent = `${completed ? total : questionNumber - 1} / ${total} ${t('answered')}`;
  ui.progressBar.style.width = `${(completed ? total : questionNumber - 1) / total * 100}%`;
  ui.questionArea.replaceChildren();
  const badge = document.createElement('span');
  badge.className = 'question-number';
  badge.textContent = completed ? t('complete') : `${t('question')} ${String(questionNumber).padStart(2, '0')}`;
  const heading = document.createElement('h2');
  heading.textContent = completed ? t('assessmentComplete') : form.questions[questionNumber - 1].text;
  const helper = document.createElement('p');
  helper.textContent = completed ? t('savedLocally') : t('howMuch');
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
    setStatus(t('savedLocally'));
    return;
  }
  for (const option of mode === 'demo' ? form.options : []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option';
    button.innerHTML = `<span class="number">${option.value}</span><span><strong></strong><small></small></span>`;
    button.querySelector('strong').textContent = option.label;
    button.querySelector('small').textContent = option.description;
    button.addEventListener('click', () => send({ type: 'select', value: option.value }));
    ui.options.append(button);
  }
  if (mode === 'demo' && 'speechSynthesis' in window) {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`${t('question')} ${questionNumber}. ${heading.textContent}`);
    utterance.lang = speechCodes[language];
    utterance.rate = 0.95;
    speechSynthesis.speak(utterance);
  }
}

function renderReview(next) {
  reviewValues = next.answers.map((answer) => answer.value);
  ui.progressLabel.textContent = `${form.questions.length} / ${form.questions.length} ${t('answered')}`;
  ui.progressBar.style.width = '100%';
  ui.questionArea.replaceChildren();
  const badge = document.createElement('span');
  badge.className = 'question-number';
  badge.textContent = t('finalReview');
  const heading = document.createElement('h2');
  heading.textContent = t('reviewTitle');
  const helper = document.createElement('p');
  helper.textContent = t('reviewIntro');
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
  notice.textContent = t('followUpNotice');
  notice.hidden = reviewValues[8] === 0;
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
        notice.hidden = reviewValues[8] === 0;
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
  finalizeButton.textContent = t('finalizeReport');
  finalizeButton.addEventListener('click', () => {
    if (socket?.readyState !== WebSocket.OPEN) {
      appendTranscript('system', t('connectionLost'));
      return;
    }
    finalizeButton.disabled = true;
    send({ type: 'finalize', answers: [...reviewValues] });
  });
  ui.results.append(finalizeButton);
}

function renderProposal(message) {
  pending = message;
  ui.pendingLabel.textContent = mode === 'live' ? message.summary : `${message.value} — ${message.label}`;
  ui.confirmation.classList.remove('hidden');
  [...ui.options.children].forEach((button, index) => button.classList.toggle('selected', index === message.value));
}

function stopPlayback() {
  for (const source of playbackSources) { try { source.stop(); } catch {} }
  playbackSources.clear();
  playbackTime = audioContext?.currentTime || 0;
}

function playPcm(base64) {
  if (!audioContext) return;
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
    ui.cameraToggle.textContent = t('turnCameraOn');
    return;
  }
  try {
    camera = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360, frameRate: 1 }, audio: false });
    ui.preview.srcObject = camera;
    ui.preview.style.display = 'block';
    ui.cameraPlaceholder.style.display = 'none';
    ui.cameraToggle.textContent = t('turnCameraOff');
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
  } catch (error) { appendTranscript('system', `${t('cameraUnavailable')}: ${error.message}`); }
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
  ui.cameraToggle.textContent = t('turnCameraOn');
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
  const oldSocket = socket;
  socket = null;
  if (oldSocket && oldSocket.readyState <= WebSocket.OPEN) oldSocket.close();
  stopMedia();
  pending = null;
  state = null;
  mode = nextMode;
  ui.language.disabled = true;
  ui.mode.textContent = nextMode.toUpperCase();
  ui.liveLabel.textContent = nextMode === 'live' ? 'CONNECTING' : 'DEMO';
  ui.textInput.disabled = true;
  ui.sendText.disabled = true;
  ui.textInput.value = '';
  ui.transcript.replaceChildren();
  const emptyTranscript = document.createElement('p'); emptyTranscript.className = 'empty'; emptyTranscript.textContent = t('conversationEmpty'); ui.transcript.append(emptyTranscript);
  ui.startLive.disabled = true;
  ui.startDemo.disabled = true;
  setStatus(t('connecting'));
  if (nextMode === 'live') {
    try { await startMicrophone(); }
    catch (error) {
      appendTranscript('system', `${t('microphoneFailed')}: ${error.message}`);
      setStatus(t('microphoneUnavailable'));
      ui.startLive.disabled = false; ui.startDemo.disabled = false;
      ui.language.disabled = false;
      stopMedia();
      return;
    }
  }
  const connection = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws?mode=${nextMode}&language=${language}`);
  socket = connection;
  connection.onopen = () => setStatus(nextMode === 'demo' ? t('demoInProgress') : t('connecting'));
  connection.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'state') renderState(message.assessment);
    else if (message.type === 'proposal') renderProposal(message);
    else if (message.type === 'proposal_cleared') { pending = null; ui.confirmation.classList.add('hidden'); [...ui.options.children].forEach((button) => button.classList.remove('selected')); }
    else if (message.type === 'audio') playPcm(message.data);
    else if (message.type === 'audio_interrupt') stopPlayback();
    else if (message.type === 'transcript') appendTranscript(message.speaker, message.text);
    else if (message.type === 'live_status') {
      ui.liveLabel.textContent = message.status.toUpperCase();
      if (message.status === 'connected') { setStatus(t('connected')); ui.textInput.disabled = false; ui.sendText.disabled = false; }
      else { ui.textInput.disabled = true; ui.sendText.disabled = true; }
      if (message.detail) appendTranscript('system', message.detail);
    }
    else if (message.type === 'error') { appendTranscript('system', message.message); if (state?.status === 'review' && finalizeButton) finalizeButton.disabled = false; }
  };
  connection.onerror = () => appendTranscript('system', t('connectionError'));
  connection.onclose = () => {
    if (socket !== connection) return;
    ui.startLive.disabled = !config.geminiConfigured;
    ui.startDemo.disabled = false;
    ui.language.disabled = false;
    ui.textInput.disabled = true;
    ui.sendText.disabled = true;
    if (state?.status !== 'completed') { setStatus(t('disconnected')); stopMedia(); }
  };
}

async function refreshRecent() {
  const response = await fetch('/api/results');
  const results = await response.json();
  ui.recent.replaceChildren();
  if (!results.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = t('resultsEmpty'); ui.recent.append(empty); return; }
  for (const item of results.slice(0, 5)) {
    const row = document.createElement('a'); row.className = 'recent-item';
    row.href = `/report.html?id=${encodeURIComponent(item.id)}`;
    row.setAttribute('aria-label', `${t('openReport')} ${new Date(item.completedAt).toLocaleString(item.language === 'hi' ? 'hi-IN' : 'en-IN')}`);
    const kind = item.collectionMethod === 'conversational_inference' ? t('conversation') : item.mode === 'live' ? t('previousLive') : t('formTest');
    const title = document.createElement('strong'); title.textContent = `${kind} · ${item.language?.toUpperCase() || 'EN'} · ${item.scores.rawTotal} / 27${item.scores.requiresHumanFollowUp ? ` · ${t('followUpNeeded')}` : ''}`;
    const date = document.createElement('span'); date.textContent = new Date(item.completedAt).toLocaleString(item.language === 'hi' ? 'hi-IN' : 'en-IN');
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
ui.language.addEventListener('change', async () => {
  const selected = ui.language.value;
  ui.language.disabled = true;
  try {
    const response = await fetch(`/api/form?language=${encodeURIComponent(selected)}`);
    if (!response.ok) throw new Error(t('formLoadFailed'));
    form = await response.json();
    language = selected;
    state = null;
    pending = null;
    ui.questionArea.replaceChildren();
    const heading = document.createElement('h2'); heading.dataset.i18n = 'chooseMode';
    const info = document.createElement('p'); info.dataset.i18n = 'cameraInfo';
    ui.questionArea.append(heading, info);
    ui.options.replaceChildren();
    ui.confirmation.classList.add('hidden');
    ui.results.classList.add('hidden');
    ui.progressLabel.textContent = `0 / ${form.questions.length}`;
    ui.progressBar.style.width = '0%';
    localizePage();
  } catch (error) { ui.language.value = language; appendTranscript('system', error.message); }
  finally { ui.language.disabled = false; }
});
ui.confirm.addEventListener('click', () => send({ type: 'confirm' }));
ui.cancel.addEventListener('click', () => send({ type: 'cancel' }));
ui.cameraToggle.addEventListener('click', toggleCamera);
ui.micToggle.addEventListener('click', () => {
  muted = !muted;
  ui.micToggle.textContent = t(muted ? 'turnMicOn' : 'turnMicOff');
});
window.addEventListener('beforeunload', stopMedia);

try {
  [form, config] = await Promise.all([fetch('/api/form?language=en').then((response) => response.json()), fetch('/api/config').then((response) => response.json())]);
  localizePage();
  ui.startLive.disabled = !config.geminiConfigured;
  ui.keyNote.textContent = config.geminiConfigured
    ? t('keyDetected')
    : t('keyMissing');
  await refreshRecent();
} catch (error) {
  setStatus(t('serverUnavailable'));
  ui.keyNote.textContent = `${t('couldNotLoad')}: ${error.message}`;
  ui.startLive.disabled = true; ui.startDemo.disabled = true;
}
