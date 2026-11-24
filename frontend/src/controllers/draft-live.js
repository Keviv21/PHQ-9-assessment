import { apiFetch as fetch, socketUrl } from '../api/client.js';
import { renderDraftReport } from './report-view.js';
import { fetchQuestionnaire, questionnaireLanguage } from './questionnaire-language.js';
import { answerSelection } from './answer-selection.js';

const $ = (id) => document.getElementById(id);
const query = new URL(location.href).searchParams;
let draftId = query.get('draftId') || '';
let sessionId = query.get('sessionId') || '';
const prescriptionId = query.get('prescriptionId') || '';
let form = null;
let state = null;
let config = { geminiConfigured: false };
let socket = null;
let microphone = null;
let audioContext = null;
let captureNode = null;
let camera = null;
let cameraTimer = null;
let muted = false;
let playbackTime = 0;
const playbackSources = new Set();
const transcriptRows = new Map();
const selection = answerSelection();
const language = questionnaireLanguage($('draft-language-select'), {
  note: $('draft-language-note'),
  async load(code) {
    if (socket?.readyState === WebSocket.CONNECTING) throw new Error('Wait for the assessment to connect, then try again.');
    if (socket?.readyState === WebSocket.OPEN) {
      send({ type: 'set_language', language: code });
      return;
    }
    const questionnaire = await fetchQuestionnaire(`/api/assessment-library/${encodeURIComponent(draftId)}`, code);
    applyQuestionnaire(questionnaire);
    if (state && state.status !== 'completed') renderState(state);
    return questionnaire;
  },
});

function applyQuestionnaire(questionnaire) {
  form = { ...form, ...questionnaire };
  $('draft-title').textContent = form.title;
  $('draft-title').lang = form.language;
  $('draft-period').textContent = form.referencePeriod || `${form.questions.length} questions`;
  document.title = `${form.title} | OpenMind`;
}

function element(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function setStatus(message) { $('draft-status').textContent = message; }
function send(message) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }

function transcript(speaker, text, messageId = null) {
  if (!text) return;
  const area = $('draft-transcript');
  const key = messageId ? `${speaker}:${messageId}` : null;
  if (key && transcriptRows.has(key)) {
    transcriptRows.get(key).lastChild.textContent = text;
  } else {
    if (area.firstElementChild?.classList.contains('draft-muted')) area.replaceChildren();
    const row = element('div', undefined, `line draft-line ${speaker === 'participant' ? 'person' : ''}`);
    row.append(element('strong', speaker === 'gemini' ? 'Assistant' : speaker === 'participant' ? 'You' : 'System'), element('span', text));
    area.append(row);
    if (key) transcriptRows.set(key, row);
  }
  area.scrollTop = area.scrollHeight;
}

function stopPlayback() {
  for (const source of playbackSources) { try { source.stop(); } catch { } }
  playbackSources.clear();
  playbackTime = 0;
}

function playPcm(base64) {
  if (!audioContext) return;
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const count = Math.floor(bytes.length / 2);
  if (!count) return;
  const samples = new DataView(bytes.buffer);
  const buffer = audioContext.createBuffer(1, count, 24000);
  const output = buffer.getChannelData(0);
  for (let index = 0; index < count; index++) output[index] = samples.getInt16(index * 2, true) / 32768;
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
    const data = new Uint8Array(event.data);
    const packet = new Uint8Array(data.length + 1);
    packet[0] = 1; packet.set(data, 1);
    socket.send(packet);
  };
  source.connect(captureNode);
  captureNode.connect(audioContext.destination);
  await audioContext.resume();
  $('draft-mic').disabled = false;
  $('draft-camera-toggle').disabled = false;
}

async function toggleCamera() {
  if (camera) {
    clearInterval(cameraTimer);
    camera.getTracks().forEach((track) => track.stop());
    camera = null;
    $('draft-video').srcObject = null;
    $('draft-video').style.display = 'none';
    $('draft-camera-off').hidden = false;
    $('draft-camera-toggle').textContent = 'Turn camera on';
    return;
  }
  try {
    camera = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360, frameRate: 1 }, audio: false });
    const video = $('draft-video');
    video.srcObject = camera;
    video.style.display = 'block';
    $('draft-camera-off').hidden = true;
    $('draft-camera-toggle').textContent = 'Turn camera off';
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 360;
    cameraTimer = setInterval(() => {
      if (!camera || socket?.readyState !== WebSocket.OPEN || video.readyState < 2) return;
      canvas.getContext('2d').drawImage(video, 0, 0, 640, 360);
      canvas.toBlob(async (blob) => {
        if (!blob || !camera || socket?.readyState !== WebSocket.OPEN) return;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const packet = new Uint8Array(bytes.length + 1);
        packet[0] = 2; packet.set(bytes, 1); socket.send(packet);
      }, 'image/jpeg', 0.55);
    }, 1100);
  } catch (error) { transcript('system', `Camera unavailable: ${error.message}`); }
}

function stopMedia() {
  clearInterval(cameraTimer);
  camera?.getTracks().forEach((track) => track.stop());
  camera = null;
  microphone?.getTracks().forEach((track) => track.stop());
  microphone = null;
  captureNode?.disconnect();
  captureNode = null;
  $('draft-video').srcObject = null;
  $('draft-video').style.display = 'none';
  $('draft-camera-off').hidden = false;
  $('draft-camera-toggle').textContent = 'Turn camera on';
  $('draft-camera-toggle').disabled = true;
  $('draft-mic').disabled = true;
  $('draft-mic').textContent = 'Turn microphone off';
  $('draft-session-mode').textContent = 'OFF';
  stopPlayback();
  audioContext?.close().catch(() => { });
  audioContext = null;
}

function renderProposal(message) {
  if (state?.mode === 'live') {
    send({ type: 'confirm' });
    return;
  }
  $('draft-confirmation').hidden = false;
  $('draft-proposal').textContent = message.summary || message.label || 'Is this the answer you meant?';
  for (const option of $('draft-options').children) option.classList.toggle('selected', Number(option.dataset.value) === message.value);
}

function renderReview(values) {
  $('draft-start').hidden = true;
  $('draft-question-card').hidden = true;
  $('draft-review').hidden = false;
  $('draft-complete').hidden = true;
  const container = $('draft-review-items');
  container.lang = form.language || 'en';
  container.replaceChildren();
  state.answers.forEach((answer, index) => {
    const row = element('label', undefined, 'draft-review-row');
    row.append(element('strong', `${index + 1}. ${form.questions[index].text}`));
    const select = element('select');
    select.dataset.index = String(index);
    form.questions[index].options.forEach((option, value) => select.add(new Option(option.label, String(value))));
    select.value = values?.[index] ?? String(answer.value);
    row.append(select); container.append(row);
  });
  $('draft-review-help').textContent = 'Check every response. The report uses your final answers.';
  setStatus('Review every response, then save this session.');
}

function renderComplete() {
  $('draft-question-card').hidden = true;
  $('draft-review').hidden = true;
  $('draft-complete').hidden = false;
  $('draft-start').hidden = true;
  renderDraftReport($('draft-inline-report'), state, form);
  $('draft-report-link').hidden = false;
  $('draft-report-link').href = `/report.html?draftSessionId=${encodeURIComponent(state.id)}`;
  setStatus('Assessment completed.');
  stopMedia();
}

function renderState(nextState) {
  const reviewValues = state?.status === 'review'
    ? [...$('draft-review-items').querySelectorAll('select')].map((select) => select.value) : null;
  state = nextState;
  $('draft-mode').textContent = nextState.mode === 'live' ? 'VOICE' : 'ON SCREEN';
  $('draft-session-mode').textContent = nextState.mode === 'live' ? 'VOICE' : 'ON SCREEN';
  $('draft-mode-select').value = nextState.mode === 'live' ? 'live' : 'demo';
  $('draft-start').hidden = true;
  if (nextState.status === 'completed') return renderComplete();
  if (nextState.status === 'review') return renderReview(reviewValues);
  $('draft-review').hidden = true;
  $('draft-complete').hidden = true;
  $('draft-question-card').hidden = false;
  $('draft-confirmation').hidden = true;
  const index = nextState.currentNumber - 1;
  const question = form.questions[index];
  $('draft-progress').textContent = `${index + 1} / ${form.questions.length}`;
  $('draft-progress-bar').style.width = `${Math.round((index / form.questions.length) * 100)}%`;
  $('draft-question-number').textContent = `QUESTION ${index + 1}`;
  $('draft-question').textContent = question.text;
  $('draft-question').lang = form.language || 'en';
  $('draft-question').dir = 'auto';
  $('draft-question-help').textContent = index === 0 ? form.instructions : '';
  $('draft-question-help').lang = form.language || 'en';
  $('draft-question-help').dir = 'auto';
  $('draft-question-help').hidden = index !== 0 || !form.instructions;
  const options = $('draft-options');
  options.lang = form.language || 'en';
  options.replaceChildren();
  question.options.forEach((option, value) => {
    const choice = element(nextState.mode === 'demo' ? 'button' : 'div', undefined,
      `option draft-option${nextState.mode === 'live' ? ' voice-option' : ''}`);
    const label = element('span');
    label.dir = 'auto';
    label.append(element('strong', option.label));
    choice.append(element('span', String(value), 'number'), label);
    if (nextState.mode === 'demo') {
      choice.type = 'button';
      choice.setAttribute('aria-pressed', 'false');
      choice.addEventListener('click', () => {
        if (socket?.readyState !== WebSocket.OPEN || !selection.show(choice)) return;
        send({ type: 'select', number: nextState.currentNumber, value });
      });
    }
    choice.dataset.value = String(value);
    options.append(choice);
  });
  setStatus(nextState.mode === 'live' ? 'Describe your answer aloud or type it below.' : 'Choose an answer to continue.');
}

function connect() {
  const preferredMode = state?.mode ? `&mode=${encodeURIComponent(state.mode)}` : '';
  const connection = new WebSocket(socketUrl(`/draft-ws?sessionId=${encodeURIComponent(sessionId)}&language=${encodeURIComponent(language.code)}${preferredMode}`));
  socket = connection;
  setStatus('Connecting…');
  connection.onmessage = async (event) => {
    if (socket !== connection) return;
    const message = JSON.parse(event.data);
    if (message.type === 'state') {
      if (selection.visible) await selection.visible;
      if (socket !== connection || connection.readyState !== WebSocket.OPEN) return;
      selection.clear();
      if (message.questionnaire) {
        applyQuestionnaire(message.questionnaire);
        language.accept(message.questionnaire);
      }
      renderState(message.assessment);
    }
    else if (message.type === 'language_error') language.fail(message.message);
    else if (message.type === 'proposal' && state?.mode === 'live') renderProposal(message);
    else if (message.type === 'proposal_cleared') {
      $('draft-confirmation').hidden = true;
      for (const option of $('draft-options').children) option.classList.remove('selected');
    }
    else if (message.type === 'audio') playPcm(message.data);
    else if (message.type === 'audio_interrupt') stopPlayback();
    else if (message.type === 'transcript') transcript(message.speaker, message.text, message.messageId);
    else if (message.type === 'live_status') {
      if (message.status === 'connected') {
        setStatus('Voice conversation connected.');
        $('draft-text').disabled = false; $('draft-send').disabled = false;
      } else {
        $('draft-text').disabled = true; $('draft-send').disabled = true;
        if (message.detail) transcript('system', message.detail);
      }
    } else if (message.type === 'error') {
      selection.clear();
      transcript('system', message.message);
    }
  };
  connection.onerror = () => transcript('system', 'Connection error.');
  connection.onclose = () => {
    if (socket !== connection || state?.status === 'completed') return;
    selection.clear();
    language.restore();
    stopMedia();
    $('draft-text').disabled = true; $('draft-send').disabled = true;
    $('draft-start-live').disabled = !config.geminiConfigured || state?.mode !== 'live';
    $('draft-start-screen').disabled = Boolean(state && state.mode !== 'demo');
    if (state?.status === 'in_progress') {
      $('draft-start').hidden = false;
      $('draft-start-live').textContent = 'Resume voice conversation';
      $('draft-start-screen').textContent = 'Resume on screen';
      setStatus('Disconnected. Use the resume button to continue this saved session.');
    } else if (state?.status === 'review') {
      $('draft-start').hidden = false;
      $('draft-start-live').disabled = true;
      $('draft-start-screen').disabled = false;
      $('draft-start-screen').textContent = 'Reconnect to save review';
      setStatus('Disconnected. Reconnect to save the reviewed answers.');
    } else {
      $('draft-start').hidden = false;
      $('draft-start-live').disabled = !config.geminiConfigured;
      setStatus('Connection closed. Try starting again.');
    }
  };
}

async function start(mode) {
  if (language.pending) { setStatus('Wait for the questionnaire language to load.'); return; }
  $('draft-start-live').disabled = true;
  $('draft-start-screen').disabled = true;
  try {
    if (mode === 'live') await startMicrophone();
    if (!sessionId) {
      const response = await fetch('/api/draft-sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(prescriptionId ? { prescriptionId, mode } : { draftId, mode }) });
      const created = await response.json();
      if (!response.ok) throw new Error(created.error || 'Could not start the review.');
      sessionId = created.id;
      const url = new URL(location.href);
      url.searchParams.set('sessionId', sessionId);
      history.replaceState({}, '', url);
    }
    connect();
  } catch (error) {
    stopMedia();
    setStatus(error.message);
    $('draft-start-live').disabled = false;
    $('draft-start-screen').disabled = false;
  }
}

$('draft-start-live').addEventListener('click', () => start('live'));
$('draft-start-screen').addEventListener('click', () => start('demo'));
$('draft-confirm').addEventListener('click', () => send({ type: 'confirm' }));
$('draft-cancel').addEventListener('click', () => send({ type: 'cancel' }));
$('draft-finish').addEventListener('click', () => {
  const values = [...$('draft-review-items').querySelectorAll('select')].map((select) => Number(select.value));
  $('draft-finish').disabled = true;
  send({ type: 'finalize', answers: values });
  setTimeout(() => { if (state?.status === 'review') $('draft-finish').disabled = false; }, 1500);
});
$('draft-text-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = $('draft-text').value.trim();
  if (!text) return;
  send({ type: 'say', text });
  transcript('participant', text);
  $('draft-text').value = '';
});
$('draft-mic').addEventListener('click', () => { muted = !muted; $('draft-mic').textContent = muted ? 'Turn microphone on' : 'Turn microphone off'; });
$('draft-camera-toggle').addEventListener('click', toggleCamera);
window.addEventListener('beforeunload', () => { socket?.close(); stopMedia(); });

try {
  if (prescriptionId) {
    const response = await fetch(`/api/prescriptions/${encodeURIComponent(prescriptionId)}`);
    if (!response.ok) throw new Error('Assigned assessment not found.');
    const prescription = await response.json();
    if (prescription.kind !== 'draft') throw new Error('This link is for a scored assessment.');
    draftId = prescription.formId;
    if (prescription.assessmentId) sessionId = prescription.assessmentId;
    $('draft-patient').textContent = `Assigned to ${prescription.patient.label}`;
  }
  if (sessionId) {
    const response = await fetch(`/api/draft-sessions/${encodeURIComponent(sessionId)}`);
    if (!response.ok) throw new Error('Saved review session not found.');
    state = await response.json();
    if (prescriptionId && state.prescriptionId !== prescriptionId) throw new Error('Saved review does not belong to this assignment.');
    const requestedMode = query.get('mode');
    if (state.status === 'in_progress' && ['demo', 'live'].includes(requestedMode)) state.mode = requestedMode;
    draftId = state.formId;
  }
  if (!draftId) throw new Error('Choose an assessment in the library first.');
  const response = await fetch(`/api/assessment-library/${encodeURIComponent(draftId)}`);
  if (!response.ok) throw new Error('Assessment not found.');
  form = await response.json();
  if (!form.previewAvailable) throw new Error('This assessment has incomplete answer options.');
  applyQuestionnaire({ language: 'en' });
  $('draft-count').textContent = String(form.questions.length);
  $('draft-progress').textContent = `0 / ${form.questions.length}`;
  $('draft-source').href = /^https:\/\//.test(form.sourceUrl) ? form.sourceUrl : '#';
  $('draft-source').hidden = !/^https:\/\//.test(form.sourceUrl);
  config = await (await fetch('/api/config')).json();
  if (config.languages?.length) {
    const langSelect = $('draft-language-select');
    langSelect.replaceChildren();
    for (const lang of config.languages) {
      langSelect.append(new Option(lang.name, lang.code));
    }
    language.restore();
    const preferred = query.get('language');
    if (config.languages.some(({ code }) => code === preferred)) await language.change(preferred);
  }
  $('draft-start-live').disabled = !config.geminiConfigured;
  $('draft-start-screen').disabled = false;
  $('draft-mode-select').addEventListener('change', async () => {
    const chosenMode = $('draft-mode-select').value;
    if (!state) {
      if (chosenMode === 'live') $('draft-start-live').focus();
      else $('draft-start-screen').focus();
      return;
    }
    if (state.status === 'in_progress') {
      if (chosenMode === 'demo') {
        stopMedia();
        state.mode = 'demo';
        $('draft-mode').textContent = 'ON SCREEN';
        $('draft-session-mode').textContent = 'ON SCREEN';
        send({ type: 'switch_mode', mode: 'demo' });
        renderState(state);
      } else if (chosenMode === 'live') {
        if (!config.geminiConfigured) {
          setStatus('Voice conversation is not configured.');
          $('draft-mode-select').value = 'demo';
          return;
        }
        try {
          await startMicrophone();
          state.mode = 'live';
          $('draft-mode').textContent = 'VOICE';
          $('draft-session-mode').textContent = 'VOICE';
          send({ type: 'switch_mode', mode: 'live' });
          renderState(state);
        } catch (err) {
          transcript('system', `Microphone access failed: ${err.message}`);
          $('draft-mode-select').value = 'demo';
        }
      }
      const url = new URL(location.href);
      url.searchParams.set('mode', state.mode);
      history.replaceState({}, '', url);
    }
  });
  if (state) {
    if (state.status === 'completed') renderComplete();
    else if (state.status === 'review') { renderReview(); connect(); }
    else {
      $('draft-start-live').textContent = 'Resume voice conversation';
      $('draft-start-screen').textContent = 'Resume on screen';
      $('draft-start-live').disabled = state.mode !== 'live' || !config.geminiConfigured;
      $('draft-start-screen').disabled = state.mode !== 'demo';
      renderState(state);
      $('draft-start').hidden = false;
    }
  } else setStatus(config.geminiConfigured ? 'Ready to begin.' : 'Voice is unavailable. On-screen review is ready.');
} catch (error) {
  setStatus(error.message);
  $('draft-start-live').disabled = true;
  $('draft-start-screen').disabled = true;
}
