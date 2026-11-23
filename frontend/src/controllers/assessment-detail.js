import { apiFetch as fetch } from '../api/client.js';
const byId = (id) => document.getElementById(id);
const params = new URL(location.href).searchParams;
const definitionId = params.get('id') || '';
const patientId = /^demo-[a-z]$/.test(params.get('patient') || '') ? params.get('patient') : '';
const coreSelections = {
  'patient-health-questionnaire-depression-phq-9--8f81b7b3270c': 'phq9',
  'generalised-anxiety-disorder-assessment-gad-7--265a24c61d94': 'gad7',
  'ptsd-checklist-5-pcl-5--5a88422b610e': 'pcl5',
};
const dassId = 'depression-anxiety-stress-scales-short-form-dass-21--acf13d5bf87b';
let detail = null;
let activeTab = 'overview';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function paragraphs(parent, text) {
  for (const part of (text || '').split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean)) {
    parent.append(element('p', part));
  }
}

function sourceSections(parent, sections) {
  for (const section of sections || []) {
    parent.append(element('h3', section.title));
    paragraphs(parent, section.text);
  }
}

function renderOverview(panel) {
  panel.append(element('h2', 'About this assessment'));
  paragraphs(panel, detail.description);
  if (detail.administration) {
    panel.append(element('h3', 'Administration'));
    paragraphs(panel, detail.administration);
  }
  sourceSections(panel, detail.sections.overview);
}

function renderScoring(panel) {
  panel.append(element('h2', 'Scoring & interpretation'));
  const metrics = detail.reporting.metrics || [];
  if (metrics.length) {
    panel.append(element('p', 'The supplied reporting definition lists these score components. The assessment report calculates results from completed responses.'));
    const table = element('table', undefined, 'metric-table');
    const head = element('thead');
    const headRow = element('tr');
    for (const label of ['Score component', 'Possible range', 'Method']) headRow.append(element('th', label));
    head.append(headRow);
    const body = element('tbody');
    for (const metric of metrics) {
      const row = element('tr');
      const range = Number.isFinite(metric.minimum) && Number.isFinite(metric.maximum) ?
        `${metric.minimum}–${metric.maximum}` : 'Varies';
      row.append(element('td', metric.label), element('td', range), element('td', metric.method || 'Defined in source rules'));
      body.append(row);
    }
    table.append(head, body);
    panel.append(table);
  } else {
    panel.append(element('p', detail.reporting.mode === 'unavailable' ?
      'A questionnaire is not available in the supplied definition.' :
      'The supplied definition does not specify a numeric score. Responses are reviewed individually.'));
  }
  sourceSections(panel, detail.sections.scoring);
}

function renderPsychometrics(panel) {
  panel.append(element('h2', 'Psychometrics'));
  if (detail.sections.psychometrics.length) sourceSections(panel, detail.sections.psychometrics);
  else panel.append(element('p', 'No psychometric summary was included in the supplied assessment details.', 'muted'));
}

function renderReferences(panel) {
  panel.append(element('h2', 'References'));
  if (!detail.references.length) {
    panel.append(element('p', 'No reference citations were included in the supplied assessment details.', 'muted'));
    return;
  }
  const list = element('ol', undefined, 'reference-list');
  for (const citation of detail.references) list.append(element('li', citation));
  panel.append(list);
}

function showTab(name) {
  activeTab = name;
  for (const tab of document.querySelectorAll('[data-tab]')) {
    const selected = tab.dataset.tab === name;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  const panel = byId('detail-tab-panel');
  panel.setAttribute('aria-labelledby', `tab-${name}`);
  panel.replaceChildren();
  ({ overview: renderOverview, scoring: renderScoring,
    psychometrics: renderPsychometrics, references: renderReferences })[name](panel);
}

function renderPreview() {
  byId('preview-title').textContent = detail.title;
  const area = byId('preview-questions');
  area.replaceChildren();
  if (!detail.previewQuestions.length) {
    area.append(element('p', 'Questionnaire preview unavailable.', 'muted'));
  }
  for (const [index, question] of detail.previewQuestions.entries()) {
    const row = element('div', undefined, 'preview-question');
    row.append(element('strong', `${index + 1}. ${question.text}`));
    if (question.options.length) {
      const options = element('div', undefined, 'preview-options');
      options.setAttribute('aria-label', `${question.options.length} response options`);
      for (const option of question.options) {
        const dot = element('span');
        dot.title = option;
        options.append(dot);
      }
      row.append(options);
    }
    area.append(row);
  }
  const report = byId('preview-metrics');
  report.replaceChildren();
  if (!detail.reporting.metrics.length) {
    report.append(element('p', detail.reporting.mode === 'unavailable' ?
      'No report structure is available for this questionnaire.' :
      'Individual responses are shown in the report.', 'muted'));
    return;
  }
  for (const metric of detail.reporting.metrics.slice(0, 5)) {
    const row = element('div', undefined, 'report-metric');
    row.append(element('span', metric.label), element('strong',
      Number.isFinite(metric.minimum) && Number.isFinite(metric.maximum) ? `${metric.minimum}–${metric.maximum}` : 'Score'));
    report.append(row);
  }
  if (detail.reporting.metrics.length > 5) report.append(element('p',
    `+${detail.reporting.metrics.length - 5} additional score components`, 'muted'));
}

function render() {
  document.title = `${detail.title} | OpenMind`;
  byId('assessment-title').textContent = detail.title;
  byId('assessment-description').textContent = detail.description;
  const facts = byId('assessment-facts');
  facts.replaceChildren();
  for (const fact of [
    detail.minutes ? `${detail.minutes} minutes` : '',
    detail.ageLabel,
    detail.questionCount ? `${detail.questionCount} questions` : '',
    detail.referencePeriod ? `Reference period: ${detail.referencePeriod}` : '',
  ].filter(Boolean)) facts.append(element('span', fact, 'fact'));
  const categories = byId('assessment-categories');
  categories.replaceChildren(...detail.categories.map((category) => element('span', category)));
  renderPreview();
  showTab(activeTab);
  const back = new URL('/clinic.html', location.origin);
  if (patientId) {
    back.searchParams.set('prescribePatient', patientId);
    back.searchParams.set('returnTo', 'library');
  }
  byId('back-link').href = back;
  const select = new URL(back);
  if (patientId) {
    select.searchParams.delete('returnTo');
    select.searchParams.set('select', coreSelections[definitionId] ||
      (definitionId === dassId ? `draft:${definitionId}` : `definition:${definitionId}`));
  } else {
    byId('select-assessment').firstChild.textContent = 'Choose a patient to assign ';
  }
  byId('select-assessment').href = select;
  byId('detail-status').hidden = true;
  byId('detail-content').hidden = false;
}

for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll('[data-tab]')];
    const index = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
      (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    showTab(tabs[next].dataset.tab);
  });
}

try {
  if (!definitionId) throw new Error('Choose an assessment from the library to view its details.');
  const response = await fetch(`/api/assessment-details/${encodeURIComponent(definitionId)}`);
  if (!response.ok) throw new Error(response.status === 404 ? 'Assessment details were not found.' : 'Could not load assessment details.');
  detail = await response.json();
  render();
} catch (error) {
  byId('detail-status').classList.add('error');
  byId('detail-status').textContent = error.message;
}
