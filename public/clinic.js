const $ = (id) => document.getElementById(id);
const patients = [];
const catalogue = [];
const definitions = [];
const scoredDraftIds = new Set([
  'patient-health-questionnaire-depression-phq-9--8f81b7b3270c',
  'GAD7',
  'ptsd-checklist-5-pcl-5--5a88422b610e',
]);
const retainedLegacyIds = new Set([...scoredDraftIds, 'depression-anxiety-stress-scales-short-form-dass-21--acf13d5bf87b']);
let selectedPatientId = '';
let suggestion = null;
let selectedFormId = '';
let loadNumber = 0;
let assessmentMatches = [];
let highlightedAssessment = -1;
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
  const analytics = view === 'analytics';
  $('prescribe-view').hidden = reports || analytics;
  $('reports-view').hidden = !reports;
  $('analytics-view').hidden = !analytics;
  $('nav-prescribe').classList.toggle('active', !reports && !analytics);
  $('nav-reports').classList.toggle('active', reports);
  $('nav-analytics').classList.toggle('active', analytics);
  if (updateUrl) {
    const url = new URL(location.href);
    if (reports || analytics) url.searchParams.set('view', view);
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
      window.dispatchEvent(new CustomEvent('clinic:patient-change', { detail: { patientId: selectedPatientId } }));
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

function defaultAssessmentId(result) {
  if (result.status !== 'suggestions') return '';
  if (result.primaryAssessmentId === 'dass21') {
    const draftId = result.recommendations.find((item) => item.id === 'dass21')?.catalogDraftId;
    return catalogue.some((item) => item.id === draftId && item.previewAvailable) ? `draft:${draftId}` : '';
  }
  const choice = result.prescriptionChoices.find((item) => item.id === result.primaryAssessmentId && item.availability === 'available');
  return choice?.id || '';
}

function assessmentChoices() {
  const scored = suggestion?.prescriptionChoices || [];
  return [
    ...scored.map((item) => ({ id: item.id, title: item.title, enabled: item.availability === 'available',
      label: `${item.title}${item.id === suggestion.primaryAssessmentId ? ' · Recommended' : ''}` })),
    ...catalogue.filter((item) => item.id === 'depression-anxiety-stress-scales-short-form-dass-21--acf13d5bf87b')
      .map((item) => ({ id: `draft:${item.id}`, title: item.title, enabled: item.previewAvailable,
        label: `${item.title}${suggestion?.primaryAssessmentId === 'dass21' ? ' · Recommended' : ''}` })),
    ...definitions.filter((item) => !retainedLegacyIds.has(item.id))
      .map((item) => ({ id: `definition:${item.id}`, title: item.title, enabled: item.available,
        label: item.title })),
  ].sort((a, b) => Number(b.id === selectedFormId) - Number(a.id === selectedFormId) ||
    a.title.localeCompare(b.title));
}

function closeAssessmentOptions() {
  $('assessment-options').hidden = true;
  $('assessment-search').setAttribute('aria-expanded', 'false');
  $('assessment-search').removeAttribute('aria-activedescendant');
  highlightedAssessment = -1;
}

function renderAssessmentOptions(query = '') {
  const area = $('assessment-options');
  const search = query.trim().toLowerCase();
  assessmentMatches = assessmentChoices().filter((item) => item.title.toLowerCase().includes(search));
  area.replaceChildren();
  highlightedAssessment = -1;
  if (!assessmentMatches.length) {
    area.append(el('p', 'No assessments match this search.', 'assessment-no-results'));
    return;
  }
  for (const [index, item] of assessmentMatches.entries()) {
    const option = el('button', item.label, 'assessment-option');
    option.type = 'button';
    option.id = `assessment-option-${index}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(item.id === selectedFormId));
    option.disabled = !item.enabled;
    if (item.id === selectedFormId) option.classList.add('selected');
    option.addEventListener('click', () => chooseAssessment(item.id));
    area.append(option);
  }
}

function openAssessmentOptions(query = '') {
  if (suggestion?.status !== 'suggestions') return;
  renderAssessmentOptions(query);
  $('assessment-options').hidden = false;
  $('assessment-search').setAttribute('aria-expanded', 'true');
}

function chooseAssessment(id) {
  const item = assessmentChoices().find((entry) => entry.id === id && entry.enabled);
  if (!item) return;
  selectedFormId = item.id;
  $('assessment-search').value = item.title;
  closeAssessmentOptions();
  updateSelectedChoice();
}

function highlightAssessment(direction) {
  const options = [...$('assessment-options').querySelectorAll('button:not(:disabled)')];
  if (!options.length) return;
  const current = options.findIndex((option) => option.classList.contains('highlighted'));
  options.forEach((option) => option.classList.remove('highlighted'));
  const next = current < 0 ? (direction > 0 ? 0 : options.length - 1) :
    (current + direction + options.length) % options.length;
  options[next].classList.add('highlighted');
  options[next].scrollIntoView({ block: 'nearest' });
  highlightedAssessment = Number(options[next].id.slice('assessment-option-'.length));
  $('assessment-search').setAttribute('aria-activedescendant', options[next].id);
}

function renderDecision(result) {
  selectedFormId = defaultAssessmentId(result);
  const canAssign = result.status === 'suggestions';
  $('assessment-search').disabled = !canAssign;
  $('assessment-open').disabled = !canAssign;
  $('assessment-search').value = assessmentChoices().find((item) => item.id === selectedFormId)?.title || '';
  renderAssessmentOptions();
  closeAssessmentOptions();
  updateSelectedChoice();
  window.dispatchEvent(new CustomEvent('clinic:patient-context', { detail: { patientId: result.patient.id, status: result.status } }));
}

function updateSelectedChoice() {
  const choice = suggestion?.prescriptionChoices.find((item) => item.id === selectedFormId && item.availability === 'available');
  const draft = selectedFormId.startsWith('draft:') ? catalogue.find((item) => item.id === selectedFormId.slice(6) && item.previewAvailable) : null;
  const definition = selectedFormId.startsWith('definition:') ? definitions.find((item) => item.id === selectedFormId.slice(11) && item.available) : null;
  const allowed = suggestion?.status === 'suggestions' && Boolean(choice || draft || definition);
  $('prescribe-button').disabled = !allowed;
  $('prescribe-button').textContent = allowed ? 'Confirm & Assign' : 'Confirm & Prescribe';
  const area = $('selection-details');
  if (draft) {
    area.replaceChildren(el('p', `${draft.title} · ${draft.extractedItemCount} questions${draft.scoringAvailable ? '' : ' · Answers only'}`));
    return;
  }
  if (definition) {
    area.replaceChildren(el('p', `${definition.title} · ${definition.questionCount} questions`));
    return;
  }
  if (!choice) {
    area.replaceChildren(notice(suggestion?.status === 'suggestions' ? 'Choose a test. The doctor makes the final assignment.' :
      'Complete the required safety or age review before assigning a test.', suggestion?.status !== 'suggestions'));
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
  if (!suggestion || suggestion.patient.id !== selectedPatientId || suggestion.status !== 'suggestions' ||
      !(suggestion.prescriptionChoices.some((item) => item.id === selectedFormId && item.availability === 'available') ||
        (selectedFormId.startsWith('draft:') && catalogue.some((item) => item.id === selectedFormId.slice(6) && item.previewAvailable)) ||
        (selectedFormId.startsWith('definition:') && definitions.some((item) => item.id === selectedFormId.slice(11) && item.available)))) return;
  $('prescribe-button').disabled = true;
  $('prescription-result').replaceChildren();
  try {
    const isDefinition = selectedFormId.startsWith('definition:');
    const response = await fetch(isDefinition ? `/api/definition-patients/${encodeURIComponent(selectedPatientId)}/prescriptions` :
      `/api/demo-patients/${encodeURIComponent(selectedPatientId)}/prescriptions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ formId: isDefinition ? selectedFormId.slice(11) : selectedFormId }),
    });
    const record = await response.json();
    if (!response.ok) throw new Error(record.error || 'Could not prescribe the test.');
    const card = el('div', undefined, 'prescribed-card');
    const title = record.kind === 'definition' ? definitions.find((item) => item.id === record.formId)?.title || record.formId :
      record.kind === 'draft' ? catalogue.find((item) => item.id === record.formId)?.title || record.formId : record.formId.toUpperCase();
    card.append(el('h3', `${title} assigned`), el('p', record.kind === 'definition' ?
      `${suggestion.patient.label} can complete the assessment by voice conversation or on screen.` : record.kind === 'draft' ?
      `${suggestion.patient.label} can complete the assessment by voice conversation or on screen.` :
      `The assessment is assigned to ${suggestion.patient.label}. Share the assessment link to begin.`));
    const actions = el('div', undefined, 'prescribed-actions');
    const selectedLang = $('clinic-language')?.value;
    const langParam = selectedLang && selectedLang !== 'en' ? `&language=${encodeURIComponent(selectedLang)}` : '';
    const url = new URL(`${record.kind === 'definition' ? '/definition.html' : record.kind === 'draft' ? '/draft-live.html' : '/assessment.html'}?prescriptionId=${encodeURIComponent(record.id)}${langParam}`, location.href);
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
    const completedDrafts = prescriptions.filter((item) => item.kind === 'draft' && item.status === 'completed');
    const completedDefinitions = prescriptions.filter((item) => item.kind === 'definition' && item.status === 'completed');
    const reportCount = reports.length + completedDrafts.length + completedDefinitions.length;
    area.replaceChildren(el('h2', `${reportCount} assessment report${reportCount === 1 ? '' : 's'}`));
    const list = el('div', undefined, 'report-list');
    for (const report of reports) {
      const row = el('div', undefined, 'report-row');
      const info = el('div');
      info.append(el('strong', `${report.formId.toUpperCase()} · ${report.scores.rawTotal} / ${report.scores.maxTotal || 27}`), el('small', `Completed ${new Date(report.completedAt).toLocaleString()}`));
      const link = el('a', 'View report'); link.href = `/report.html?id=${encodeURIComponent(report.id)}`;
      row.append(info, link); list.append(row);
    }
    for (const record of completedDrafts) {
      const row = el('div', undefined, 'report-row');
      const info = el('div');
      const title = catalogue.find((item) => item.id === record.formId)?.title || record.formId;
      info.append(el('strong', `${title} · ${record.unscored ? 'Answer report · No score' : 'Report'}`), el('small', `Assigned ${new Date(record.createdAt).toLocaleString()}`));
      const link = el('a', 'View report');
      link.href = `/report.html?draftSessionId=${encodeURIComponent(record.assessmentId)}`;
      row.append(info, link); list.append(row);
    }
    for (const record of completedDefinitions) {
      const row = el('div', undefined, 'report-row');
      const info = el('div');
      const title = definitions.find((item) => item.id === record.formId)?.title || record.formId;
      info.append(el('strong', `${title} · Report`), el('small', `Assigned ${new Date(record.createdAt).toLocaleString()}`));
      const link = el('a', 'View report'); link.href = `/report.html?definitionSessionId=${encodeURIComponent(record.assessmentId)}`;
      row.append(info, link); list.append(row);
    }
    for (const record of prescriptions.filter((item) => item.status !== 'completed')) {
      const row = el('div', undefined, 'report-row');
      const info = el('div');
      const title = record.kind === 'definition' ? definitions.find((item) => item.id === record.formId)?.title || record.formId :
        record.kind === 'draft' ? catalogue.find((item) => item.id === record.formId)?.title || record.formId : record.formId.toUpperCase();
      info.append(el('strong', `${title} · ${record.status === 'assigned' ? 'Assigned' : 'In progress'}`), el('small', `Assigned ${new Date(record.createdAt).toLocaleString()}`));
      const link = el('a', 'Open patient assessment');
      const selectedLang = $('clinic-language')?.value;
      const langParam = selectedLang && selectedLang !== 'en' ? `&language=${encodeURIComponent(selectedLang)}` : '';
      link.href = `${record.kind === 'definition' ? '/definition.html' : record.kind === 'draft' ? '/draft-live.html' : '/assessment.html'}?prescriptionId=${encodeURIComponent(record.id)}${langParam}`;
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
$('patient-search').addEventListener('input', renderPatientList);
$('next-step').addEventListener('click', showConfirmation);
$('back-step').addEventListener('click', () => { ++loadNumber; setStep(1); });
$('assessment-search').addEventListener('focus', () => {
  $('assessment-search').value = '';
  openAssessmentOptions();
});
$('assessment-search').addEventListener('input', () => {
  selectedFormId = '';
  updateSelectedChoice();
  openAssessmentOptions($('assessment-search').value);
});
$('assessment-search').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if ($('assessment-options').hidden) openAssessmentOptions();
    highlightAssessment(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Enter' && !$('assessment-options').hidden) {
    event.preventDefault();
    if (highlightedAssessment >= 0) chooseAssessment(assessmentMatches[highlightedAssessment]?.id);
    else if (assessmentMatches.filter((item) => item.enabled).length === 1) {
      chooseAssessment(assessmentMatches.find((item) => item.enabled).id);
    }
  } else if (event.key === 'Escape') {
    closeAssessmentOptions();
    $('assessment-search').value = assessmentChoices().find((item) => item.id === selectedFormId)?.title || '';
  }
});
$('assessment-open').addEventListener('click', () => {
  if ($('assessment-options').hidden) {
    $('assessment-search').value = '';
    openAssessmentOptions();
    $('assessment-search').focus();
  }
  else {
    closeAssessmentOptions();
    $('assessment-search').value = assessmentChoices().find((item) => item.id === selectedFormId)?.title || '';
  }
});
document.addEventListener('pointerdown', (event) => {
  if ($('assessment-combobox').contains(event.target)) return;
  closeAssessmentOptions();
  $('assessment-search').value = assessmentChoices().find((item) => item.id === selectedFormId)?.title || '';
});
window.addEventListener('clinic:select-assessment', (event) => {
  const id = event.detail?.id;
  if (!id || !suggestion || suggestion.status !== 'suggestions') return;
  chooseAssessment(id);
  $('assessment-search').scrollIntoView({ block: 'center', behavior: 'smooth' });
});
$('prescribe-button').addEventListener('click', prescribe);
$('report-patient').addEventListener('change', () => {
  const url = new URL(location.href);
  if ($('report-patient').value) url.searchParams.set('patient', $('report-patient').value);
  else url.searchParams.delete('patient');
  history.replaceState({}, '', url);
  loadReports($('report-patient').value);
});
window.addEventListener('popstate', () => setView(new URL(location.href).searchParams.get('view'), false));

let currentLanguage = 'en';
if ($('clinic-language')) {
  $('clinic-language').value = 'en';
  $('clinic-language').addEventListener('change', () => {
    currentLanguage = $('clinic-language').value;
  });
}

try {
  const [response, catalogueResponse, definitionResponse] = await Promise.all([fetch('/api/demo-patients'), fetch('/api/assessment-library'), fetch('/api/definitions')]);
  if (!response.ok || !catalogueResponse.ok || !definitionResponse.ok) throw new Error('Could not load the patient or assessment list.');
  patients.push(...await response.json());
  catalogue.push(...await catalogueResponse.json());
  definitions.push(...await definitionResponse.json());
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
