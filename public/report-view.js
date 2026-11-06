const severityNames = {
  minimal: 'No or minimal',
  mild: 'Mild',
  moderate: 'Moderate',
  'moderately severe': 'Moderate–severe',
  severe: 'Severe',
};

const severityBands = [
  { name: 'No or minimal', range: '0–4', key: 'minimal' },
  { name: 'Mild', range: '5–9', key: 'mild' },
  { name: 'Moderate', range: '10–14', key: 'moderate' },
  { name: 'Moderate–severe', range: '15–19', key: 'moderately severe' },
  { name: 'Severe', range: '20–27', key: 'severe' },
];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderReport(container, assessment, form, { printableLink = false } = {}) {
  if (assessment.status !== 'completed' || assessment.formId !== 'phq9' ||
      !Array.isArray(assessment.answers) || assessment.answers.length !== 9 || !assessment.scores) {
    throw new Error('A completed PHQ-9 result is required.');
  }

  const report = element('article', 'phq-report');
  const header = element('header', 'phq-report-header');
  const eyebrow = element('p', 'phq-report-eyebrow', 'ASSESSMENT REPORT');
  const title = element('h2', '', 'Patient Health Questionnaire – Depression (PHQ-9)');
  const when = new Date(assessment.completedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const method = assessment.collectionMethod === 'conversational_inference' ? 'AI-assisted conversation' : 'Direct form responses';
  const metadata = element('p', 'phq-report-meta', `Completed ${when} · ${method}`);
  header.append(eyebrow, title, metadata);

  const summary = element('section', 'phq-report-summary');
  summary.setAttribute('aria-label', 'Score summary');
  const scoreBlock = element('div', 'phq-report-score');
  scoreBlock.append(element('span', '', 'TOTAL SCORE'), element('strong', '', `${assessment.scores.rawTotal} / 27`));
  const severityBlock = element('div', 'phq-report-severity');
  severityBlock.append(element('span', '', 'SEVERITY BAND'),
    element('strong', '', severityNames[assessment.scores.severity] || assessment.scores.severity));
  summary.append(scoreBlock, severityBlock);

  const scale = element('section', 'phq-report-scale');
  scale.setAttribute('aria-label', 'PHQ-9 score scale');
  scale.append(element('h3', '', 'Score on the 0–27 scale'));
  const track = element('div', 'phq-report-track');
  const marker = element('span', 'phq-report-marker');
  marker.style.left = `${Math.min(100, Math.max(0, assessment.scores.rawTotal / 27 * 100))}%`;
  marker.setAttribute('aria-label', `Score ${assessment.scores.rawTotal} out of 27`);
  track.append(marker);
  scale.append(track);
  const bandList = element('div', 'phq-report-bands');
  for (const band of severityBands) {
    const bandNode = element('div', `phq-report-band${assessment.scores.severity === band.key ? ' active' : ''}`);
    bandNode.append(element('strong', '', band.name), element('span', '', band.range));
    bandList.append(bandNode);
  }
  scale.append(bandList);

  const responses = element('section', 'phq-report-responses');
  responses.append(element('h3', '', 'Confirmed responses'));
  const period = element('p', '', 'Reference period: the past two weeks.');
  responses.append(period);
  const table = element('table', 'phq-report-table');
  const thead = element('thead');
  const headingRow = element('tr');
  for (const label of ['#', 'PHQ-9 item', 'Response']) headingRow.append(element('th', '', label));
  thead.append(headingRow);
  const tbody = element('tbody');
  for (const answer of assessment.answers) {
    const question = form.questions[answer.number - 1];
    const option = form.options[answer.value];
    const row = element('tr');
    row.append(element('td', '', String(answer.number)), element('td', '', question.text),
      element('td', '', `${option.label} (${answer.value})`));
    tbody.append(row);
  }
  table.append(thead, tbody);
  responses.append(table);

  const notes = element('section', 'phq-report-notes');
  let safetyNotice = null;
  if (assessment.scores.requiresHumanFollowUp) {
    safetyNotice = element('p', 'phq-report-alert',
      'Item 9 was answered positively. Please contact a qualified clinician promptly for follow-up. This prototype does not notify anyone. If you may not be able to stay safe, seek immediate local emergency help.');
    safetyNotice.setAttribute('role', 'alert');
  }
  notes.append(element('p', '', assessment.collectionMethod === 'conversational_inference'
    ? 'Gemini inferred response values from conversation and the participant confirmed them. This conversational method has not been clinically validated. The score is not a diagnosis.'
    : 'This score summarizes the nine confirmed PHQ-9 responses. It is not a diagnosis.'));
  if (assessment.reviewChangeCount) {
    notes.append(element('p', '', `${assessment.reviewChangeCount} answer${assessment.reviewChangeCount === 1 ? '' : 's'} changed during final review. The responses shown above are the final choices.`));
  }
  notes.append(element('p', '', 'Community percentiles and comparison graphs are omitted because this prototype does not have the underlying normative dataset.'));
  const source = element('a', '', 'Questionnaire source');
  source.href = form.source;
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  notes.append(source);

  report.append(header);
  if (safetyNotice) report.append(safetyNotice);
  report.append(summary, scale, responses, notes);
  if (printableLink) {
    const link = element('a', 'button primary phq-report-link', 'Open printable report');
    link.href = `/report.html?id=${encodeURIComponent(assessment.id)}`;
    report.append(link);
  }
  container.replaceChildren(report);
}
