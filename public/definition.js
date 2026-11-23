import { renderDefinitionReport } from './report-view.js';

const $ = (id) => document.getElementById(id);
const prescriptionId = new URL(location.href).searchParams.get('prescriptionId');
let state;
let items = [];
let index = 0;
let voice;
const transcriptRows = new Map();
const screens = ['intro', 'questionnaire', 'review', 'report'];
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
function show(name) {
  for (const id of screens) $(id).hidden = id !== name;
  $('definition-start').hidden = name !== 'intro';
  $('definition-modes').hidden = name !== 'intro';
  $('error').hidden = true;
  const isVoice = name === 'questionnaire' && Boolean(voice?.active);
  $('definition-live-label').textContent = isVoice ? 'VOICE' : name === 'questionnaire' ? 'ON SCREEN' : 'OFF';
  $('definition-mode-label').textContent = $('definition-live-label').textContent;
  $('voice-text').disabled = !isVoice;
  $('voice-send').disabled = !isVoice;
  $('voice-mute').disabled = !isVoice || !voice?.microphone;
  $('voice-mute').textContent = voice?.muted ? 'Turn microphone on' : 'Turn microphone off';
  $('voice-camera-toggle').disabled = !isVoice;
  $('voice-camera-toggle').textContent = voice?.camera ? 'Turn camera off' : 'Turn camera on';
  $('voice-camera-placeholder').hidden = Boolean(voice?.camera);
  $('definition-mode').disabled = name !== 'intro';
  $('definition-language').disabled = name !== 'intro';
}
function fail(message) { $('error').textContent = message; $('error').hidden = false; }
async function api(path, options) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
function request(method, body) { return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }; }
function condition(condition, answers) {
  if (!condition) return true;
  if (condition.any) return condition.any.some((entry) => conditionCheck(entry, answers));
  if (condition.all) return condition.all.every((entry) => conditionCheck(entry, answers));
  return conditionCheck(condition, answers);
}
function conditionCheck(condition, answers) {
  if (condition.context_key) {
    if (!Object.hasOwn(state.context || {}, condition.context_key)) return false;
    return state.context[condition.context_key] === condition.value;
  }
  const answer = answers[condition.item_id];
  if (answer === undefined) return false;
  const item = state.formSnapshot.questions.find((candidate) => candidate.id === condition.item_id);
  const value = condition.value_field && condition.value_field !== 'answer_id' && typeof answer === 'string' ?
    item?.options?.find((option) => option.id === answer)?.[condition.value_field] : answer;
  if (condition.operator === 'contains_any') return Array.isArray(answer) && condition.value.some((id) => answer.includes(id));
  if (condition.operator === 'equals') return value === condition.value;
  if (condition.operator === 'gt') return Number(value) > Number(condition.value);
  return false;
}
function visibleItems(answers) { return state.formSnapshot.questions.filter((item) => condition(item.displayIf, answers)); }
function inputFor(item, answer, review = false) {
  const wrap = node('div');
  if (['choice', 'single_choice', 'multiple_choice'].includes(item.responseType)) {
    const multiple = item.responseType === 'multiple_choice';
    if (review && !multiple) {
      const select = node('select');
      select.append(new Option('Select an answer', ''));
      for (const option of item.options) select.append(new Option(option.text, option.id));
      select.value = answer || '';
      select.dataset.answerFor = item.id;
      wrap.append(select);
    } else {
      for (const option of item.options) {
        const label = node('label', undefined, review ? '' : 'option');
        const input = node('input'); input.type = multiple ? 'checkbox' : 'radio';
        input.name = item.id; input.value = option.id;
        input.checked = multiple ? (answer || []).includes(option.id) : answer === option.id;
        if (multiple && item.inputSpec?.exclusive_option_ids?.includes(option.id)) input.dataset.exclusive = 'true';
        label.append(input, node('span', option.text || option.id)); wrap.append(label);
      }
      if (multiple) wrap.addEventListener('change', (event) => {
        if (!event.target.checked) return;
        const exclusive = wrap.querySelectorAll('input[data-exclusive=true]');
        if (event.target.dataset.exclusive === 'true') wrap.querySelectorAll('input:not([data-exclusive=true])').forEach((input) => { input.checked = false; });
        else exclusive.forEach((input) => { input.checked = false; });
      });
    }
  } else {
    const input = node(item.responseType === 'text' ? 'textarea' : 'input');
    if (item.responseType !== 'text') { input.type = 'number'; input.step = item.responseType === 'integer' ? '1' : 'any'; }
    const schema = item.inputSpec?.answer_schema || {};
    if (schema.minimum !== undefined) input.min = schema.minimum;
    if (schema.maximum !== undefined) input.max = schema.maximum;
    input.value = answer ?? ''; input.className = review ? '' : 'field'; input.dataset.answerFor = item.id;
    wrap.append(input);
    if (item.inputSpec?.unit) wrap.append(node('small', ` ${item.inputSpec.unit}`, 'muted'));
  }
  return wrap;
}
function readAnswer(item, wrap) {
  if (item.responseType === 'multiple_choice') return [...wrap.querySelectorAll('input:checked')].map((input) => input.value);
  if (['choice', 'single_choice'].includes(item.responseType)) return wrap.querySelector('input:checked')?.value || wrap.querySelector('select')?.value || null;
  const raw = wrap.querySelector('input,textarea').value.trim();
  if (raw === '') return null;
  return item.responseType === 'text' ? raw : Number(raw);
}
function renderVoiceAnswerGuide(item) {
  const guide = $('voice-answer-guide');
  guide.replaceChildren();
  if (['choice', 'single_choice', 'multiple_choice'].includes(item.responseType)) {
    if (item.responseType === 'multiple_choice') guide.append(node('p', 'You may describe more than one response.', 'voice-guide-label'));
    const options = node('div', undefined, 'voice-reference-options');
    for (const [index, option] of item.options.entries()) {
      const choice = node('div', undefined, 'option voice-reference-option voice-choice');
      choice.dataset.optionId = option.id;
      choice.append(node('span', String(index + 1), 'number'));
      choice.append(node('strong', option.text || option.id));
      options.append(choice);
    }
    guide.append(options);
  } else if (['integer', 'number'].includes(item.responseType)) {
    const schema = item.inputSpec?.answer_schema || {};
    const range = schema.minimum !== undefined && schema.maximum !== undefined ?
      ` between ${schema.minimum} and ${schema.maximum}` : schema.minimum !== undefined ?
        ` of at least ${schema.minimum}` : schema.maximum !== undefined ? ` up to ${schema.maximum}` : '';
    guide.append(node('p', `Please describe a ${item.responseType === 'integer' ? 'whole ' : ''}number${range}${item.inputSpec?.unit ? ` ${item.inputSpec.unit}` : ''}.`, 'voice-guide-label'));
  } else {
    guide.append(node('p', 'Please describe your response in your own words.', 'voice-guide-label'));
  }
}
function question() {
  items = visibleItems(state.answers);
  index = Math.min(index, items.length - 1);
  const item = items[index];
  if (!item) { review(); return; }
  $('progress-text').textContent = `${index + 1} / ${items.length}`;
  $('progress-fill').style.width = `${Math.round((index + 1) / items.length * 100)}%`;
  $('question-number').textContent = `QUESTION ${index + 1}`;
  $('question').textContent = item.text;
  $('reference').textContent = state.formSnapshot.referencePeriod?.instruction_claims?.join(', ') || '';
  $('input-area').replaceChildren(inputFor(item, state.answers[item.id]));
  $('input-area').hidden = Boolean(voice?.active);
  renderVoiceAnswerGuide(item);
  $('voice-answer-guide').hidden = !voice?.active;
  $('back').disabled = index === 0;
  $('next').textContent = index === items.length - 1 ? 'Review answers' : 'Save & continue';
  $('screen-actions').hidden = Boolean(voice?.active);
  show('questionnaire');
}
async function save(answers, context = state.context) {
  state = await api(`/api/definition-sessions/${state.id}`, request('PUT', { answers, context }));
  $('save-status').textContent = 'Saved';
}
async function next() {
  const item = items[index];
  const value = readAnswer(item, $('input-area'));
  if (value === null || (Array.isArray(value) && !value.length)) { fail('Please answer this question.'); return; }
  try {
    $('next').disabled = true;
    await save({ ...state.answers, [item.id]: value });
    items = visibleItems(state.answers);
    const nextIndex = items.findIndex((candidate) => candidate.id === item.id) + 1;
    if (nextIndex < items.length) { index = nextIndex; question(); }
    else review();
  } catch (error) { fail(error.message); }
  finally { $('next').disabled = false; }
}
function review() {
  show('review');
  const list = $('review-list'); list.replaceChildren();
  for (const item of visibleItems(state.answers)) {
    const row = node('div', undefined, 'review-item');
    row.append(node('strong', `${item.order ?? ''}. ${item.text}`));
    const input = inputFor(item, state.answers[item.id], true);
    input.dataset.questionId = item.id; row.append(input); list.append(row);
  }
}
async function finish() {
  const answers = { ...state.answers };
  for (const item of visibleItems(answers)) {
    const wrap = [...$('review-list').children].find((row) => row.lastChild.dataset.questionId === item.id)?.lastChild;
    if (!wrap) continue;
    const value = readAnswer(item, wrap);
    if (value === null || (Array.isArray(value) && !value.length)) { fail(`Answer ${item.id} before submitting.`); return; }
    answers[item.id] = value;
  }
  try {
    $('finish').disabled = true;
    state = await api(`/api/definition-sessions/${state.id}/finish`, request('POST', { answers, context: state.context }));
    report();
  } catch (error) { fail(error.message); }
  finally { $('finish').disabled = false; }
}
function report() {
  show('report');
  renderDefinitionReport($('definition-inline-report'), state);
  $('open-report').href = `/report.html?definitionSessionId=${encodeURIComponent(state.id)}`;
}
function updateSelectedModeLabel() {
  $('start-selected').textContent = $('definition-mode').value === 'voice'
    ? 'Start voice conversation'
    : 'Complete on screen';
}
async function init() {
  if (!prescriptionId) throw new Error('Open this assessment from an assigned patient link.');
  const requestedMode = new URL(location.href).searchParams.get('mode');
  if (requestedMode === 'voice' || requestedMode === 'screen') $('definition-mode').value = requestedMode;
  const prescription = await api(`/api/definition-prescriptions/${prescriptionId}`);
  if (prescription.assessmentId) state = await api(`/api/definition-sessions/${prescription.assessmentId}`);
  const form = state?.formSnapshot || await api(`/api/definitions/${encodeURIComponent(prescription.formId)}`);
  $('side-title').textContent = form.title;
  $('side-description').textContent = form.description;
  $('side-count').textContent = String(form.questions.length);
  $('intro-count').textContent = `0 / ${form.questions.length}`;
  updateSelectedModeLabel();
  $('side-patient').textContent = `Assigned to ${prescription.patient?.label || 'patient'}`;
  const keys = new Set(form.questions.map((item) => item.displayIf?.context_key).filter(Boolean));
  if (form.rules.some((rule) => (Array.isArray(rule.context_constraints) ? rule.context_constraints : [rule.context_constraints])
    .some((constraint) => constraint?.context_key === 'source_scoring_sex'))) keys.add('source_scoring_sex');
  const prompts = { attends_school: 'Does the respondent attend school?',
    works_or_studies: 'Does the respondent currently work or study?',
    source_scoring_sex: 'Source scoring category (if applicable)' };
  const fields = $('context-fields'); fields.replaceChildren();
  for (const key of keys) {
    const label = node('label', prompts[key] || key);
    label.className = 'context-label';
    const select = node('select'); select.dataset.contextKey = key; select.className = 'field';
    select.append(new Option('Select an answer', ''));
    if (key === 'source_scoring_sex') {
      select.append(new Option('Female (source category)', 'female'), new Option('Male (source category)', 'male'));
    } else select.append(new Option('Yes', 'true'), new Option('No', 'false'));
    select.value = state?.context?.[key] === undefined ? '' : String(state.context[key]);
    label.append(select); fields.append(label);
  }
  if (state?.status === 'completed') report();
  else if (state) {
    items = visibleItems(state.answers);
    index = items.findIndex((item) => !Object.hasOwn(state.answers, item.id));
    if (index < 0) review(); else question();
  }
  else show('intro');
}
function initialContext() {
  const context = {};
  for (const select of $('context-fields').querySelectorAll('select')) {
    if (!select.value && select.dataset.contextKey !== 'source_scoring_sex') throw new Error('Answer the context question before starting.');
    if (select.value) context[select.dataset.contextKey] = select.value === 'true' ? true : select.value === 'false' ? false : select.value;
  }
  return context;
}
async function begin(useVoice) {
  try {
    const url = new URL(location.href);
    url.searchParams.set('mode', useVoice ? 'voice' : 'screen');
    history.replaceState({}, '', url);
    if (useVoice) {
      await ensureVoice();
      await voice.prepareAudio();
    }
    if (!state) {
      const context = initialContext();
      state = await api(`/api/definition-prescriptions/${prescriptionId}/start`, request('POST', {}));
      await save(state.answers, context);
    }
    items = visibleItems(state.answers);
    index = items.findIndex((item) => !Object.hasOwn(state.answers, item.id));
    if (index < 0) { if (useVoice) voice.stop(); review(); return; }
    if (useVoice) voice.connect(state.id);
    question();
  } catch (error) { if (useVoice) voice?.stop(); fail(error.message); }
}
function appendTranscript(speaker, text, messageId = null) {
  if (!text) return;
  const area = $('voice-transcript');
  const key = messageId ? `${speaker}:${messageId}` : null;
  if (key && transcriptRows.has(key)) transcriptRows.get(key).lastChild.textContent = text;
  else {
    if (area.firstElementChild?.classList.contains('empty')) area.replaceChildren();
    const row = node('div', undefined, `line voice-line ${speaker === 'participant' ? 'person' : ''}`);
    row.append(node('strong', speaker === 'gemini' ? 'Assistant' : speaker === 'participant' ? 'You' : 'System'), node('span', text));
    area.append(row);
    if (key) transcriptRows.set(key, row);
  }
  area.scrollTop = area.scrollHeight;
}
async function ensureVoice() {
  if (voice) return voice;
  let DefinitionVoiceClient;
  try { ({ DefinitionVoiceClient } = await import('./definition-voice.js')); }
  catch { throw new Error('Voice files are unavailable. Restart the assessment server and refresh this page.'); }
  voice = new DefinitionVoiceClient({
  onState: (nextState, current) => {
    state = nextState;
    if (state.status === 'review') { voice.stop(); review(); return; }
    items = visibleItems(state.answers);
    index = Math.max(0, items.findIndex((item) => item.id === current?.id));
    question();
  },
  onProposal: () => voice.send({ type: 'confirm' }),
  onClear: () => {},
  onStatus: (message) => { $('voice-status').textContent = message; },
  onTranscript: appendTranscript,
  onError: (message) => { appendTranscript('system', message); },
  onClose: () => {
    if (state?.status === 'in_progress') { question(); fail('Voice disconnected. Your recorded answers were saved. Continue on screen.'); }
  },
  });
  return voice;
}
$('definition-mode').addEventListener('change', updateSelectedModeLabel);
$('start-selected').addEventListener('click', () => begin($('definition-mode').value === 'voice'));
$('voice-mute').addEventListener('click', () => { $('voice-mute').textContent = voice.mute() ? 'Turn microphone on' : 'Turn microphone off'; });
$('voice-camera-toggle').addEventListener('click', async () => {
  try {
    const on = await voice.toggleCamera($('voice-preview'));
    $('voice-camera-toggle').textContent = on ? 'Turn camera off' : 'Turn camera on';
    $('voice-camera-placeholder').hidden = on;
  } catch (error) { fail(`Camera unavailable: ${error.message}`); }
});
$('voice-text-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = $('voice-text').value.trim();
  if (!text) return;
  try { voice.send({ type: 'say', text }); appendTranscript('participant', text); $('voice-text').value = ''; }
  catch (error) { fail(error.message); }
});
$('next').addEventListener('click', next);
$('back').addEventListener('click', () => { if (index > 0) { index--; question(); } });
$('review-back').addEventListener('click', () => { index = Math.max(0, visibleItems(state.answers).length - 1); question(); });
$('finish').addEventListener('click', finish);
window.addEventListener('beforeunload', () => voice?.stop());
init().catch((error) => fail(error.message));
