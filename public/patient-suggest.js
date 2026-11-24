const picker = document.getElementById('patient-select');
const summaryArea = document.getElementById('patient-summary');
const output = document.getElementById('suggestion-output');
let requestNumber = 0;

const availability = {
  available: 'Available to prescribe',
  not_implemented: 'Questionnaire not implemented here',
  requires_trauma_review: 'Review trauma exposure first',
};
const ageGroup = { under19: 'Under 19', '19to64': 'Adult, 19–64', '65plus': 'Adult, 65 or older', unknown: 'Unknown age' };
const safety = { notReviewed: 'Safety review needed', noneReported: 'No immediate concern reported after review', concern: 'Immediate concern present' };
const trauma = { confirmed: 'Qualifying exposure confirmed', uncertain: 'Trauma exposure needs review', notReported: 'Trauma exposure not reported' };

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderSummary(patient, context) {
  summaryArea.replaceChildren(element('h3', patient.label), element('p', patient.summary.overview));
  const meta = element('div', undefined, 'meta');
  for (const label of [ageGroup[context.ageGroup], safety[context.safetyStatus], trauma[context.traumaExposure]]) {
    meta.append(element('span', label));
  }
  summaryArea.append(meta, element('h3', 'Summary observations'));
  const list = element('ul', undefined, 'summary-list');
  for (const observation of patient.summary.observations) {
    const row = element('li', `${observation.description} (${observation.status})`);
    row.append(element('small', `Source: ${observation.source}`));
    list.append(row);
  }
  summaryArea.append(list);
}

function renderSuggestions(result) {
  output.replaceChildren();
  const message = element('p', result.message, result.status === 'safety_review' ? 'alert' : 'info');
  output.append(message);
  if (!result.primaryAssessmentId) return;
  const selected = result.recommendations.find((item) => item.id === result.primaryAssessmentId);
  output.append(element('h3', `Top suggestion: ${selected.title}`));
  for (const item of result.recommendations) {
    const card = element('article', undefined, `result${item.id === result.primaryAssessmentId ? ' primary' : ''}`);
    card.append(element('h3', item.title), element('span', availability[item.availability], 'tag'), element('p', item.reason));
    if (item.note) card.append(element('p', item.note));
    if (item.evidence.length) {
      card.append(element('strong', 'Evidence from this summary'));
      const list = element('ul', undefined, 'evidence-list');
      for (const evidence of item.evidence) list.append(element('li', `${evidence.description} — ${evidence.source}`));
      card.append(list);
    } else card.append(element('p', 'No specific current symptom matched; this is a general screening candidate.'));
    const source = element('a', 'Clinical routing source');
    source.href = item.source; source.target = '_blank'; source.rel = 'noopener noreferrer';
    card.append(source);
    if (item.availability === 'available') {
      const start = element('a', `Prescribe ${item.title} in clinician view`, 'button primary');
      start.href = '/';
      const action = element('p'); action.append(start); card.append(action);
    }
    output.append(card);
  }
}

picker.addEventListener('change', async () => {
  const currentRequest = ++requestNumber;
  if (!picker.value) {
    summaryArea.replaceChildren(element('p', 'Choose a patient to view their summary.'));
    output.replaceChildren(element('p', 'Choose a patient to see a suggestion.', 'info'));
    return;
  }
  summaryArea.replaceChildren(element('p', 'Loading patient summary…'));
  output.replaceChildren(element('p', 'Preparing suggestion…', 'info'));
  try {
    const response = await fetch(`/api/patients/${encodeURIComponent(picker.value)}/recommendations`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not prepare suggestion.');
    if (currentRequest !== requestNumber) return;
    renderSummary(result.patient, result.context);
    renderSuggestions(result);
  } catch (error) {
    if (currentRequest !== requestNumber) return;
    summaryArea.replaceChildren();
    output.replaceChildren(element('p', error.message, 'alert'));
  }
});

try {
  const response = await fetch('/api/patients');
  if (!response.ok) throw new Error('Could not load the patient list.');
  const patients = await response.json();
  for (const patient of patients) {
    const option = element('option', patient.label);
    option.value = patient.id;
    picker.append(option);
  }
} catch (error) {
  picker.disabled = true;
  output.replaceChildren(element('p', error.message, 'alert'));
}
