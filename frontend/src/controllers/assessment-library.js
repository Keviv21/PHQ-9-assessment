import { apiFetch as fetch } from '../api/client.js';
const byId = (id) => document.getElementById(id);
const pageSize = 18;
let catalogue = [];
let page = 1;
let activeRecord = null;
let answers = [];
let questionIndex = 0;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function sourceLink(record) {
  if (!/^https:\/\//.test(record.sourceUrl)) return null;
  const link = node('a', 'View source', 'library-source');
  link.href = record.sourceUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function visibleRecords() {
  const search = byId('library-search').value.trim().toLocaleLowerCase();
  const filter = byId('library-filter').value;
  return catalogue.filter((record) =>
    record.title.toLocaleLowerCase().includes(search) &&
    (filter === 'all' || (filter === 'preview' ? record.previewAvailable : !record.previewAvailable)));
}

function renderList() {
  const filtered = visibleRecords();
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  page = Math.min(page, pages);
  byId('library-count').textContent = `${filtered.length} of ${catalogue.length} assessments`;
  byId('library-page').textContent = `Page ${page} of ${pages}`;
  byId('library-previous').disabled = page === 1;
  byId('library-next').disabled = page === pages;
  const list = byId('library-list');
  list.replaceChildren();
  if (!filtered.length) {
    list.append(node('p', 'No assessments match this search.', 'empty-state'));
    return;
  }
  for (const record of filtered.slice((page - 1) * pageSize, page * pageSize)) {
    const card = node('article', undefined, 'library-card');
    const heading = node('h2', record.title);
    const detail = node('p', `${record.extractedItemCount} questions · ${record.previewAvailable ? 'Preview available' : 'Questions unavailable'}`);
    const status = node('span', record.previewAvailable ? 'Available' : 'Unavailable', `library-status${record.previewAvailable ? '' : ' incomplete'}`);
    const button = node('button', record.previewAvailable ? 'Preview questions' : 'View details', 'button outline');
    button.type = 'button';
    button.addEventListener('click', () => openDetail(record.id));
    card.append(heading, detail, status, button);
    if (record.previewAvailable) {
      const live = node('a', 'Start live review', 'library-live-link');
      live.href = `/draft-live.html?draftId=${encodeURIComponent(record.id)}`;
      card.append(live);
    }
    list.append(card);
  }
}

function showCatalogue() {
  activeRecord = null;
  answers = [];
  byId('library-catalogue').hidden = false;
  byId('library-detail').hidden = true;
  byId('library-detail').replaceChildren();
}

async function renderRecentSessions() {
  try {
    const response = await fetch('/api/draft-sessions');
    if (!response.ok) return;
    const sessions = await response.json();
    const area = byId('library-sessions');
    area.replaceChildren();
    if (!sessions.length) {
      area.append(node('p', 'No saved reviews yet.', 'empty-state'));
      return;
    }
    for (const session of sessions.slice(0, 10)) {
      const title = catalogue.find((item) => item.id === session.formId)?.title || session.formId;
      const link = node('a', `${title} · ${session.status === 'completed' ? 'Completed' : 'Continue'} · ${new Date(session.startedAt).toLocaleString()}`, 'library-session-link');
      link.href = `/draft-live.html?sessionId=${encodeURIComponent(session.id)}`;
      area.append(link);
    }
  } catch { /* The catalogue remains usable if session history is unavailable. */ }
}

function detailHeader(record) {
  const fragment = document.createDocumentFragment();
  const back = node('button', '← Back to assessment library', 'library-back');
  back.type = 'button';
  back.addEventListener('click', showCatalogue);
  const title = node('h2', record.title);
  const status = node('p', 'Questionnaire preview', 'library-detail-status');
  fragment.append(back, title, status);
  if (record.referencePeriod) fragment.append(node('p', `Reference period: ${record.referencePeriod}`));
  if (record.instructions) fragment.append(node('p', record.instructions, 'library-instructions'));
  const source = sourceLink(record);
  if (source) fragment.append(source);
  if (record.previewAvailable) {
    const live = node('a', 'Start live review', 'button primary library-live-button');
    live.href = `/draft-live.html?draftId=${encodeURIComponent(record.id)}`;
    fragment.append(live);
  }
  return fragment;
}

function renderQuestion() {
  const record = activeRecord;
  const question = record.questions[questionIndex];
  const area = byId('library-detail');
  area.replaceChildren(detailHeader(record));
  const form = node('section', undefined, 'library-question');
  form.append(node('p', `Question ${questionIndex + 1} of ${record.questions.length}`, 'library-progress'), node('h3', question.text));
  const choices = node('fieldset', undefined, 'library-choices');
  choices.append(node('legend', 'Select one answer'));
  question.options.forEach((option, index) => {
    const label = node('label', undefined, 'library-choice');
    const radio = node('input');
    radio.type = 'radio';
    radio.name = 'library-answer';
    radio.value = String(index);
    radio.checked = answers[questionIndex] === index;
    radio.addEventListener('change', () => {
      answers[questionIndex] = index;
      next.disabled = false;
    });
    label.append(radio, node('span', option.label));
    choices.append(label);
  });
  form.append(choices);
  const actions = node('div', undefined, 'library-actions');
  const previous = node('button', 'Previous question', 'button outline');
  previous.type = 'button';
  previous.disabled = questionIndex === 0;
  previous.addEventListener('click', () => { questionIndex -= 1; renderQuestion(); });
  const next = node('button', questionIndex === record.questions.length - 1 ? 'Review answers' : 'Next question', 'button primary');
  next.type = 'button';
  next.disabled = answers[questionIndex] === undefined;
  next.addEventListener('click', () => {
    if (questionIndex === record.questions.length - 1) renderReview();
    else { questionIndex += 1; renderQuestion(); }
  });
  actions.append(previous, next);
  if (answers.filter((answer) => answer !== undefined).length === record.questions.length && questionIndex < record.questions.length - 1) {
    const review = node('button', 'Review all answers', 'button outline');
    review.type = 'button';
    review.addEventListener('click', renderReview);
    actions.append(review);
  }
  form.append(actions);
  area.append(form, node('p', 'Internal preview only. Answers are held in this browser session and are not saved or scored.', 'library-disclaimer'));
}

function renderReview() {
  const area = byId('library-detail');
  area.replaceChildren(detailHeader(activeRecord), node('h3', 'Review answers'));
  const list = node('ol', undefined, 'library-review');
  activeRecord.questions.forEach((question, index) => {
    const item = node('li');
    item.append(node('strong', question.text), node('p', question.options[answers[index]]?.label || 'No answer'));
    const editAnswer = node('button', `Edit answer ${index + 1}`, 'library-edit');
    editAnswer.type = 'button';
    editAnswer.addEventListener('click', () => { questionIndex = index; renderQuestion(); });
    item.append(editAnswer);
    list.append(item);
  });
  const actions = node('div', undefined, 'library-actions');
  const edit = node('button', 'Edit last answer', 'button outline');
  edit.type = 'button';
  edit.addEventListener('click', renderQuestion);
  const finish = node('button', 'Finish preview', 'button primary');
  finish.type = 'button';
  finish.addEventListener('click', () => {
    area.replaceChildren(detailHeader(activeRecord), node('p', 'Preview complete. No score or report was generated, and your answers were not saved.', 'library-complete'));
    answers = [];
  });
  actions.append(edit, finish);
  area.append(list, actions);
}

async function openDetail(id) {
  byId('library-catalogue').hidden = true;
  const area = byId('library-detail');
  area.hidden = false;
  area.replaceChildren(node('p', 'Loading assessment…'));
  try {
    const response = await fetch(`/api/assessment-library/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('Could not load this assessment.');
    activeRecord = await response.json();
    answers = [];
    questionIndex = 0;
    if (activeRecord.previewAvailable) renderQuestion();
    else {
      area.replaceChildren(detailHeader(activeRecord), node('p', `Preview unavailable: ${activeRecord.extractedItemCount ? `${activeRecord.incompleteItems} item(s) need complete answer options` : 'no questions were extracted'}.`, 'library-unavailable'));
    }
  } catch (error) {
    area.replaceChildren(node('p', error.message, 'library-unavailable'));
  }
}

byId('library-search').addEventListener('input', () => { page = 1; renderList(); });
byId('library-filter').addEventListener('change', () => { page = 1; renderList(); });
byId('library-previous').addEventListener('click', () => { page -= 1; renderList(); });
byId('library-next').addEventListener('click', () => { page += 1; renderList(); });

try {
  const response = await fetch('/api/assessment-library');
  if (!response.ok) throw new Error('Could not load the assessment library.');
  catalogue = await response.json();
  renderList();
  renderRecentSessions();
} catch (error) {
  byId('library-count').textContent = error.message;
}
