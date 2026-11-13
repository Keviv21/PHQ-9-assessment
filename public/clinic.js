const $ = (id) => document.getElementById(id);
const patients = [];
let selectedPatientId = '';
let suggestion = null;
let selectedFormId = '';
let loadNumber = 0;
const sidebar = document.querySelector('.sidebar');
const clinicApp = document.querySelector('.clinic-app');
const sidebarToggle = $('sidebar-toggle');
const sidebarStorageKey = 'openmind-assessment-sidebar-collapsed';
let sidebarPinnedClosed = false;
let sidebarHovered = false;
try { sidebarPinnedClosed = localStorage.getItem(sidebarStorageKey) === 'true'; } catch { /* Storage may be unavailable. */ }

function renderSidebar() {
  const collapsed = sidebarPinnedClosed && !sidebarHovered;
  clinicApp.classList.toggle('sidebar-collapsed', collapsed);
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  const action = collapsed ? 'Expand sidebar' : sidebarPinnedClosed ? 'Keep sidebar expanded' : 'Collapse sidebar';
  sidebarToggle.setAttribute('aria-label', action);
  sidebarToggle.title = action;
}

sidebarToggle.addEventListener('click', () => {
  sidebarPinnedClosed = !sidebarPinnedClosed;
  sidebarHovered = false;
  try { localStorage.setItem(sidebarStorageKey, String(sidebarPinnedClosed)); } catch { /* Storage may be unavailable. */ }
  renderSidebar();
});
sidebar.addEventListener('mouseenter', () => {
  if (window.matchMedia('(min-width: 651px)').matches && sidebarPinnedClosed) {
    sidebarHovered = true;
    renderSidebar();
  }
});
sidebar.addEventListener('mouseleave', () => {
  sidebarHovered = false;
  renderSidebar();
});
sidebar.addEventListener('focusin', () => {
  if (window.matchMedia('(min-width: 651px)').matches && sidebarPinnedClosed) { sidebarHovered = true; renderSidebar(); }
});
sidebar.addEventListener('focusout', (event) => {
  if (!sidebar.contains(event.relatedTarget)) { sidebarHovered = false; renderSidebar(); }
});
renderSidebar();

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function notice(message, alert = false) {
  return el('p', message, `notice${alert ? ' alert' : ''}`);
}

function sourceLabel(source) {
  const labels = {
    'recent_clinician_summary.mood': 'Recent clinician summary · Mood',
    'recent_clinician_summary.function': 'Recent clinician summary · Function',
    'recent_clinician_summary.anxiety': 'Recent clinician summary · Anxiety',
    'recent_clinician_summary.stress': 'Recent clinician summary · Stress',
    'recent_clinician_summary.trauma_symptoms': 'Recent clinician summary · Trauma symptoms',
    'clinical__notes_summary.longitudinal_summary': 'Longitudinal clinical notes',
    'clinical__notes_summary.clinical_inference.aura_analysis': 'Neurological history · Aura',
    'clinical__notes_summary.clinical_inference.sleep_analysis': 'Neurological history · Sleep',
  };
  return labels[source] || 'Clinical summary';
}

function setView(view, updateUrl = true) {
  const reports = view === 'reports';
  const library = view === 'library';
  const analytics = view === 'analytics';
  $('prescribe-view').hidden = reports || library || analytics;
  $('reports-view').hidden = !reports;
  $('library-view').hidden = !library;
  $('analytics-view').hidden = !analytics;
  $('nav-prescribe').classList.toggle('active', !reports && !library && !analytics);
  $('nav-reports').classList.toggle('active', reports);
  $('nav-library').classList.toggle('active', library);
  $('nav-analytics').classList.toggle('active', analytics);
  if (updateUrl) {
    const url = new URL(location.href);
    if (reports || library || analytics) url.searchParams.set('view', view);
    else url.searchParams.delete('view');
    if (!reports && !analytics) url.searchParams.delete('patient');
    history.pushState({}, '', url);
  }
  if (reports && $('report-patient').value) loadReports($('report-patient').value);
  if (analytics) window.dispatchEvent(new Event('clinic:analytics'));
}

function setStep(number) {
  $('choose-patient').hidden = number !== 1;
  $('confirm-step').hidden = number !== 2;
  $('step-one').className = `step ${number === 1 ? 'current' : 'done'}`;
  $('step-two').className = `step ${number === 2 ? 'current' : ''}`;
}

function renderPatientList() {
  const query = $('patient-search').value.trim().toLowerCase();
  const list = $('patient-list');
  list.replaceChildren();
  for (const patient of patients.filter((item) => item.label.toLowerCase().includes(query))) {
    const row = el('label', undefined, `patient-row${patient.id === selectedPatientId ? ' selected' : ''}`);
    const radio = el('input');
    radio.type = 'radio'; radio.name = 'demo-patient'; radio.value = patient.id;
    radio.checked = patient.id === selectedPatientId;
    radio.addEventListener('change', () => {
      selectedPatientId = patient.id;
      suggestion = null;
      selectedFormId = '';
      $('prescription-result').replaceChildren();
      $('next-step').disabled = false;
      renderPatientList();
    });
    const avatar = el('span', patient.id.slice(-1).toUpperCase(), 'patient-avatar');
    const name = el('span', patient.label, 'patient-name');
    name.append(el('small', 'Patient summary available', 'patient-subtitle'));
    row.append(radio, avatar, name);
    list.append(row);
  }
  if (!list.children.length) list.append(el('p', 'No patients match this search.', 'empty-state'));
}

function renderSummary(result) {
  const area = $('patient-summary');
  area.replaceChildren(el('h3', result.patient.label), el('p', result.patient.summary.overview));
  const meta = el('div', undefined, 'meta');
  const age = { under19: 'Under 19', '19to64': 'Adult 19–64', '65plus': 'Adult 65+', unknown: 'Age unknown' };
  const safety = { notReviewed: 'Safety review needed', noneReported: 'Safety reviewed', concern: 'Immediate safety concern' };
  meta.append(el('span', age[result.context.ageGroup]), el('span', safety[result.context.safetyStatus]));
  area.append(meta, el('h3', 'Summary observations'));
  const list = el('ul', undefined, 'summary-list');
  for (const observation of result.patient.summary.observations) {
    const item = el('li', `${observation.description} (${observation.status})`);
    item.append(el('small', sourceLabel(observation.source)));
    list.append(item);
  }
  area.append(list);
  if (result.ignoredObservations?.length) {
    area.append(el('h3', 'Additional context'));
    const ignored = el('ul', undefined, 'summary-list');
    for (const item of result.ignoredObservations) {
      const line = el('li', `${item.description} — ${item.reason}`);
      line.append(el('small', sourceLabel(item.source)));
      ignored.append(line);
    }
    area.append(ignored);
  }
}

function renderSuggestions(result) {
  const area = $('suggestion-output');
  area.replaceChildren(notice(result.message, result.status !== 'suggestions'));
  const selected = result.recommendations.find((item) => item.id === result.primaryAssessmentId);
  if (selected) area.append(el('h3', `Suggested first: ${selected.title}`));
  for (const item of result.recommendations) {
    const card = el('div', undefined, `result${item.id === result.primaryAssessmentId ? ' primary' : ''}`);
    card.append(el('h3', item.title), el('span', item.availability === 'available' ? 'Available to prescribe' : item.availability === 'requires_trauma_review' ? 'Needs trauma review' : 'Not available for prescription', 'tag'), el('p', item.purpose), el('p', item.reason));
    if (item.note) card.append(el('p', item.note));
    for (const missing of item.missingInformation || []) card.append(notice(missing, true));
    if (item.evidence.length) {
      card.append(el('strong', 'Matched summary observations'));
      const list = el('ul', undefined, 'evidence-list');
      for (const evidence of item.evidence) list.append(el('li', `${evidence.description} — ${sourceLabel(evidence.source)}`));
      card.append(list);
    }
    const source = el('a', 'Clinical reference');
    source.href = item.source; source.target = '_blank'; source.rel = 'noopener noreferrer';
    card.append(source);
    area.append(card);
  }
  if (selected && selected.availability !== 'available') area.append(notice(`${selected.title} is relevant but cannot be prescribed here. Review the eligible tests below before making a selection.`));
}

function renderDecision(result) {
  const question = result.clarification?.question;
  $('clarification-panel').hidden = !question;
  if (question) {
    $('clarification-prompt').textContent = question.prompt;
    const focusSelect = $('clarification-focus');
    focusSelect.replaceChildren(new Option('Use summary priorities', ''));
    for (const option of question.options) focusSelect.add(new Option(option.label, option.value));
    focusSelect.value = result.clarification.focus;
  }
  selectedFormId = '';
  const select = $('assessment-select');
  select.replaceChildren(new Option('Select an assessment', ''));
  for (const choice of result.prescriptionChoices || []) {
    const label = choice.availability !== 'available' ? `${choice.title} — needs review` :
      `${choice.title} — ${choice.priority === 1 ? 'recommended' : choice.priority === 2 ? 'secondary option' : 'clinician option'}`;
    const option = new Option(label, choice.id);
    option.disabled = choice.availability !== 'available';
    select.add(option);
  }
  select.disabled = !result.prescriptionChoices?.some((choice) => choice.availability === 'available');
  $('selection-details').replaceChildren(notice(select.disabled ? 'No test can be prescribed until the required review is complete.' : 'Select a test to see why it is available. The doctor makes the final choice.', select.disabled));
  $('prescribe-button').disabled = true;
  $('prescribe-button').textContent = 'Confirm & Prescribe';
}

function updateSelectedChoice() {
  selectedFormId = $('assessment-select').value;
  const choice = suggestion?.prescriptionChoices.find((item) => item.id === selectedFormId && item.availability === 'available');
  $('prescribe-button').disabled = !choice;
  $('prescribe-button').textContent = choice ? `Confirm & prescribe ${choice.title}` : 'Confirm & Prescribe';
  const area = $('selection-details');
  if (!choice) {
    area.replaceChildren(notice('Select a test to see why it is available. The doctor makes the final choice.'));
    return;
  }
  area.replaceChildren(el('p', choice.reason));
  if (choice.evidence.length) area.append(el('p', `Summary evidence: ${choice.evidence.map((item) => item.description).join('; ')}`));
  if (choice.note) area.append(notice(choice.note));
}

async function loadSuggestion(focus = '') {
  const current = ++loadNumber;
  $('patient-summary').replaceChildren(el('p', 'Loading summary…'));
  $('suggestion-output').replaceChildren(el('p', 'Preparing suggestion…'));
  $('prescribe-button').disabled = true;
  $('prescription-result').replaceChildren();
  try {
    const query = focus ? `?focus=${encodeURIComponent(focus)}` : '';
    const response = await fetch(`/api/demo-patients/${encodeURIComponent(selectedPatientId)}/recommendations${query}`);
    if (!response.ok) throw new Error('Could not load this patient summary.');
    const result = await response.json();
    if (current !== loadNumber) return;
    suggestion = result;
    renderSummary(result);
    renderSuggestions(result);
    renderDecision(result);
  } catch (error) {
    if (current !== loadNumber) return;
    $('patient-summary').replaceChildren();
    $('suggestion-output').replaceChildren(notice(error.message, true));
  }
}

async function showConfirmation() {
  if (!selectedPatientId) return;
  setStep(2);
  await loadSuggestion();
}

async function prescribe() {
  if (!suggestion || suggestion.patient.id !== selectedPatientId ||
      !suggestion.prescriptionChoices.some((item) => item.id === selectedFormId && item.availability === 'available')) return;
  $('prescribe-button').disabled = true;
  $('prescription-result').replaceChildren();
  try {
    const response = await fetch(`/api/demo-patients/${encodeURIComponent(selectedPatientId)}/prescriptions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ formId: selectedFormId }),
    });
    const record = await response.json();
    if (!response.ok) throw new Error(record.error || 'Could not prescribe the test.');
    const card = el('div', undefined, 'prescribed-card');
    card.append(el('h3', `${record.formId.toUpperCase()} prescribed`), el('p', `The assessment is assigned to ${suggestion.patient.label}. Share the assessment link to begin.`));
    const actions = el('div', undefined, 'prescribed-actions');
    const url = new URL(`/assessment.html?prescriptionId=${encodeURIComponent(record.id)}`, location.href);
    const open = el('a', 'Open patient assessment', 'button primary');
    open.href = url.href;
    const copy = el('button', 'Copy patient link', 'button outline');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url.href); copy.textContent = 'Copied'; }
      catch { copy.textContent = 'Copy unavailable; open the link instead'; }
    });
    actions.append(open, copy);
    card.append(actions);
    $('prescription-result').append(card);
  } catch (error) {
    $('prescription-result').replaceChildren(notice(error.message, true));
    $('prescribe-button').disabled = false;
  }
}

async function loadReports(patientId) {
  const current = ++loadNumber;
  const area = $('report-content');
  if (!patientId) { area.replaceChildren(el('p', 'Choose a patient to view their test reports.', 'empty-state')); return; }
  area.replaceChildren(el('p', 'Loading reports…', 'empty-state'));
  try {
    const [prescriptionsResponse, reportsResponse] = await Promise.all([
      fetch(`/api/demo-patients/${encodeURIComponent(patientId)}/prescriptions`),
      fetch(`/api/demo-patients/${encodeURIComponent(patientId)}/reports`),
    ]);
    if (!prescriptionsResponse.ok || !reportsResponse.ok) throw new Error('Could not load patient reports.');
    const [prescriptions, reports] = await Promise.all([prescriptionsResponse.json(), reportsResponse.json()]);
    if (current !== loadNumber) return;
    area.replaceChildren(el('h2', `${reports.length} completed report${reports.length === 1 ? '' : 's'}`));
    const list = el('div', undefined, 'report-list');
    for (const report of reports) {
      const row = el('div', undefined, 'report-row');
      const info = el('div');
      info.append(el('strong', `${report.formId.toUpperCase()} · ${report.scores.rawTotal} / ${report.scores.maxTotal || 27}`), el('small', `Completed ${new Date(report.completedAt).toLocaleString()}`));
      const link = el('a', 'View report'); link.href = `/report.html?id=${encodeURIComponent(report.id)}`;
      row.append(info, link); list.append(row);
    }
    for (const record of prescriptions.filter((item) => item.status !== 'completed')) {
      const row = el('div', undefined, 'report-row');
      const info = el('div');
      info.append(el('strong', `${record.formId.toUpperCase()} · ${record.status === 'assigned' ? 'Assigned' : 'In progress'}`), el('small', `Prescribed ${new Date(record.createdAt).toLocaleString()}`));
      const link = el('a', 'Open patient assessment');
      link.href = `/assessment.html?prescriptionId=${encodeURIComponent(record.id)}`;
      row.append(info, link); list.append(row);
    }
    if (list.children.length) area.append(list);
    else area.append(el('p', 'No prescriptions or completed reports for this patient yet.', 'empty-state'));
  } catch (error) {
    if (current === loadNumber) area.replaceChildren(notice(error.message, true));
  }
}

$('nav-prescribe').addEventListener('click', () => setView('prescribe'));
$('nav-reports').addEventListener('click', () => setView('reports'));
$('nav-analytics').addEventListener('click', () => setView('analytics'));
$('nav-library').addEventListener('click', () => setView('library'));
$('patient-search').addEventListener('input', renderPatientList);
$('next-step').addEventListener('click', showConfirmation);
$('back-step').addEventListener('click', () => { ++loadNumber; setStep(1); });
$('clarification-focus').addEventListener('change', () => loadSuggestion($('clarification-focus').value));
$('assessment-select').addEventListener('change', updateSelectedChoice);
$('prescribe-button').addEventListener('click', prescribe);
$('report-patient').addEventListener('change', () => {
  const url = new URL(location.href);
  if ($('report-patient').value) url.searchParams.set('patient', $('report-patient').value);
  else url.searchParams.delete('patient');
  history.replaceState({}, '', url);
  loadReports($('report-patient').value);
});
window.addEventListener('popstate', () => setView(new URL(location.href).searchParams.get('view'), false));

try {
  const response = await fetch('/api/demo-patients');
  if (!response.ok) throw new Error('Could not load the patient list.');
  patients.push(...await response.json());
  for (const patient of patients) {
    const option = el('option', patient.label); option.value = patient.id; $('report-patient').append(option);
  }
  renderPatientList();
  const query = new URL(location.href).searchParams;
  const patientId = query.get('patient');
  if (patients.some((item) => item.id === patientId)) $('report-patient').value = patientId;
  setView(query.get('view'), false);
} catch (error) {
  $('patient-list').replaceChildren(notice(error.message, true));
  $('report-content').replaceChildren(notice(error.message, true));
}
