const $ = (id) => document.getElementById(id);
const query = new URL(location.href).searchParams;
let draftId = query.get('draftId') || '';
let sessionId = query.get('sessionId') || '';
let form = null;
let state = null;
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
    const row = element('div', undefined, `draft-line ${speaker}`);
    row.append(element('strong', speaker === 'gemini' ? 'Assistant' : speaker === 'participant' ? 'You' : 'System'), element('span', text));
    area.append(row);
    if (key) transcriptRows.set(key, row);
  }
  area.scrollTop = area.scrollHeight;
}

function stopPlayback() {
  for (const source of playbackSources) { try { source.stop(); } catch {} }
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
  stopPlayback();
  audioContext?.close().catch(() => {});
  audioContext = null;
}

function renderProposal(message) {
  $('draft-confirmation').hidden = false;
  $('draft-proposal').textContent = message.summary || message.label || 'Is this the answer you meant?';
  for (const option of $('draft-options').children) option.classList.toggle('selected', Number(option.dataset.value) === message.value);
}

function renderReview() {
  $('draft-start').hidden = true;
  $('draft-question-card').hidden = true;
  $('draft-review').hidden = false;
  $('draft-complete').hidden = true;
  const container = $('draft-review-items');
  container.replaceChildren();
  state.answers.forEach((answer, index) => {
    const row = element('label', undefined, 'draft-review-row');
    row.append(element('strong', `${index + 1}. ${form.questions[index].text}`));
    const select = element('select');
    select.dataset.index = String(index);
    form.questions[index].options.forEach((option, value) => select.add(new Option(option.label, String(value))));
    select.value = String(answer.value);
    row.append(select); container.append(row);
  });
  setStatus('Review every response, then save this unscored session.');
}

function renderComplete() {
  $('draft-question-card').hidden = true;
  $('draft-review').hidden = true;
  $('draft-complete').hidden = false;
  $('draft-start').hidden = true;
  const area = $('draft-result-items');
  area.replaceChildren();
  state.answers.forEach((answer, index) => {
    const row = element('div', undefined, 'draft-review-row');
    row.append(element('strong', `${index + 1}. ${form.questions[index].text}`), element('p', form.questions[index].options[answer.value]?.label || 'Unrecorded'));
    area.append(row);
  });
  $('draft-saved-at').textContent = `Saved ${new Date(state.completedAt).toLocaleString()} · ${state.reviewChangeCount} final answer change(s) · No score`;
  setStatus('Completed answers saved locally. No score was calculated.');
  stopMedia();
}

function renderState(nextState) {
  state = nextState;
  $('draft-mode').textContent = nextState.mode === 'live' ? 'VOICE' : 'ON SCREEN';
  $('draft-start').hidden = true;
  if (nextState.status === 'completed') return renderComplete();
  if (nextState.status === 'review') return renderReview();
  $('draft-review').hidden = true;
  $('draft-complete').hidden = true;
  $('draft-question-card').hidden = false;
  $('draft-confirmation').hidden = true;
  const index = nextState.currentNumber - 1;
  const question = form.questions[index];
  $('draft-progress').textContent = `Question ${index + 1} of ${form.questions.length}`;
  $('draft-progress-bar').style.width = `${Math.round((index / form.questions.length) * 100)}%`;
  $('draft-question').textContent = question.text;
  const options = $('draft-options');
  options.replaceChildren();
  if (nextState.mode === 'demo') {
    question.options.forEach((option, value) => {
      const button = element('button', option.label, 'draft-option');
      button.type = 'button'; button.dataset.value = String(value);
      button.addEventListener('click', () => send({ type: 'select', value }));
      options.append(button);
    });
  }
  setStatus(nextState.mode === 'live' ? 'Describe your answer aloud or type it below.' : 'Choose an answer, then confirm it.');
}

function connect() {
  const connection = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/draft-ws?sessionId=${encodeURIComponent(sessionId)}`);
  socket = connection;
  setStatus('Connecting…');
  connection.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'state') renderState(message.assessment);
    else if (message.type === 'proposal') renderProposal(message);
    else if (message.type === 'proposal_cleared') $('draft-confirmation').hidden = true;
    else if (message.type === 'audio') playPcm(message.data);
    else if (message.type === 'audio_interrupt') stopPlayback();
    else if (message.type === 'transcript') transcript(message.speaker, message.text, message.messageId);
    else if (message.type === 'live_status') {
      if (message.status === 'connected') {
        setStatus('Voice conversation connected.');
        $('draft-text').disabled = false; $('draft-send').disabled = false;
      } else if (message.detail) transcript('system', message.detail);
    } else if (message.type === 'error') transcript('system', message.message);
  };
  connection.onerror = () => transcript('system', 'Connection error.');
  connection.onclose = () => {
    if (socket !== connection || state?.status === 'completed') return;
    stopMedia();
    $('draft-text').disabled = true; $('draft-send').disabled = true;
    if (state?.status === 'in_progress') {
      $('draft-start').hidden = false;
      setStatus('Disconnected. Use the resume button to continue this saved session.');
    } else if (state?.status === 'review') {
      $('draft-start').hidden = false;
      $('draft-start-live').disabled = true;
      $('draft-start-screen').disabled = false;
      $('draft-start-screen').textContent = 'Reconnect to save review';
      setStatus('Disconnected. Reconnect to save the reviewed answers.');
    }
  };
}

async function start(mode) {
  $('draft-start-live').disabled = true;
  $('draft-start-screen').disabled = true;
  try {
    if (mode === 'live') await startMicrophone();
    if (!sessionId) {
      const response = await fetch('/api/draft-sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draftId, mode }) });
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
$('draft-mic').addEventListener('click', () => { muted = !muted; $('draft-mic').textContent = muted ? 'Unmute microphone' : 'Mute microphone'; });
$('draft-camera-toggle').addEventListener('click', toggleCamera);
$('draft-print').addEventListener('click', () => window.print());
window.addEventListener('beforeunload', () => { socket?.close(); stopMedia(); });

try {
  if (sessionId) {
    const response = await fetch(`/api/draft-sessions/${encodeURIComponent(sessionId)}`);
    if (!response.ok) throw new Error('Saved review session not found.');
    state = await response.json();
    draftId = state.formId;
  }
  if (!draftId) throw new Error('Choose an assessment in the library first.');
  const response = await fetch(`/api/assessment-library/${encodeURIComponent(draftId)}`);
  if (!response.ok) throw new Error('Assessment not found.');
  form = await response.json();
  if (!form.previewAvailable) throw new Error('This assessment has incomplete answer options.');
  $('draft-title').textContent = form.title;
  document.title = `${form.title} | OpenMind`;
  $('draft-period').textContent = form.referencePeriod ? `Reference period: ${form.referencePeriod}` : `${form.extractedItemCount} questions`;
  $('draft-source').href = /^https:\/\//.test(form.sourceUrl) ? form.sourceUrl : '#';
  $('draft-source').hidden = !/^https:\/\//.test(form.sourceUrl);
  const config = await (await fetch('/api/config')).json();
  $('draft-start-live').disabled = !config.geminiConfigured;
  $('draft-start-screen').disabled = false;
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
  } else setStatus(config.geminiConfigured ? 'Ready to begin an unscored review.' : 'Voice is unavailable. On-screen review is ready.');
} catch (error) {
  setStatus(error.message);
  $('draft-start-live').disabled = true;
  $('draft-start-screen').disabled = true;
}
