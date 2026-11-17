const byId = (id) => document.getElementById(id);
let patientId = '';
let eligible = false;
let configured = false;
let history = [];
let requestNumber = 0;

function node(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function appendMessage(role, text, source = 'gemini') {
  const area = byId('doctor-chat-messages');
  if (area.firstElementChild?.classList.contains('doctor-chat-intro')) area.replaceChildren();
  const bubble = node('div', undefined, `doctor-chat-bubble ${role}`);
  bubble.append(node('strong', role === 'doctor' ? 'Doctor' : source === 'local_fallback' ? 'Local catalogue match' : 'Gemini'), node('p', text));
  area.append(bubble);
  area.scrollTop = area.scrollHeight;
}

function renderSuggestions(items) {
  const area = byId('doctor-chat-suggestions');
  area.replaceChildren();
  if (!items.length) return;
  area.append(node('h3', 'Suggestions to review'));
  for (const item of items) {
    const row = node('div', undefined, 'doctor-chat-suggestion');
    const text = node('div');
    const scoreLabel = item.kind === 'scored' ? 'Scored assessment' :
      item.kind === 'answer_only' ? 'Answers only' : 'Score available';
    text.append(node('strong', item.title), node('p', item.reason), node('small', scoreLabel));
    const choose = node('button', 'Select', 'button outline');
    choose.type = 'button';
    choose.addEventListener('click', () => window.dispatchEvent(new CustomEvent('clinic:select-assessment', { detail: { id: item.id } })));
    row.append(text, choose);
    area.append(row);
  }
}

function reset(patient, status) {
  ++requestNumber;
  patientId = patient;
  eligible = status === 'suggestions';
  history = [];
  byId('doctor-chat-messages').replaceChildren(node('p', eligible ?
    'Describe a current concern or ask about another assessment. Suggestions are for doctor review.' :
    'Complete the safety or age review before discussing an assignment.', 'doctor-chat-intro'));
  byId('doctor-chat-suggestions').replaceChildren();
  byId('doctor-chat-input').value = '';
  byId('doctor-chat-input').disabled = !eligible || !configured;
  byId('doctor-chat-send').disabled = !eligible || !configured;
}

window.addEventListener('clinic:patient-change', () => reset('', ''));
window.addEventListener('clinic:patient-context', (event) => reset(event.detail.patientId, event.detail.status));

byId('doctor-chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = byId('doctor-chat-input').value.trim();
  if (!message || !patientId || !eligible || !configured) return;
  const current = ++requestNumber;
  byId('doctor-chat-send').disabled = true;
  byId('doctor-chat-input').value = '';
  appendMessage('doctor', message);
  try {
    const response = await fetch(`/api/demo-patients/${encodeURIComponent(patientId)}/doctor-chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, history: history.slice(-8) }),
    });
    const result = await response.json();
    if (current !== requestNumber) return;
    if (!response.ok) throw new Error(result.error || 'Doctor conversation is unavailable.');
    appendMessage('assistant', result.reply, result.source);
    history.push({ role: 'doctor', text: message }, { role: 'assistant', text: result.reply });
    history = history.slice(-8);
    renderSuggestions(result.suggestions || []);
  } catch (error) {
    if (current === requestNumber) appendMessage('assistant', error.message);
  } finally {
    if (current === requestNumber) byId('doctor-chat-send').disabled = false;
  }
});

try {
  const response = await fetch('/api/config');
  if (response.ok) configured = Boolean((await response.json()).geminiConfigured);
  if (!configured) byId('doctor-chat-messages').replaceChildren(node('p',
    'Set GEMINI_API_KEY in .env and restart the server to use the doctor conversation.', 'doctor-chat-intro'));
  byId('doctor-chat-input').disabled = !configured || !eligible;
  byId('doctor-chat-send').disabled = !configured || !eligible;
} catch {
  byId('doctor-chat-input').disabled = true;
  byId('doctor-chat-send').disabled = true;
}
