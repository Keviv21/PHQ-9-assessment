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

const reportCopy = {
  en: {
    eyebrow: 'ASSESSMENT REPORT', completed: 'Completed', conversation: 'AI-assisted conversation', form: 'Direct form responses', demoPatient: 'Sample patient',
    scoreSummary: 'Score summary', total: 'TOTAL SCORE', severity: 'SEVERITY BAND', scale: 'Score on the 0–27 scale',
    scoreOutOf: (score) => `Score ${score} out of 27`, responses: 'Confirmed responses', period: 'Reference period: the past two weeks.',
    headers: ['#', 'PHQ-9 item', 'Response'],
    liveNote: 'Gemini inferred response values from conversation and the participant confirmed them. This conversational method has not been clinically validated. The score is not a diagnosis.',
    formNote: 'This score summarizes the nine confirmed PHQ-9 responses. It is not a diagnosis.',
    revision: (count) => `${count} answer${count === 1 ? '' : 's'} changed during final review. The responses shown above are the final choices.`,
    norms: 'Percentile comparisons are not included in this report.',
    source: 'Questionnaire source', printable: 'Open printable report',
    safety: 'Item 9 was answered positively. Please contact a qualified clinician promptly for follow-up. This assessment does not send an alert. If you may not be able to stay safe, seek immediate local emergency help.',
    bands: severityNames,
  },
  hi: {
    eyebrow: 'आकलन रिपोर्ट', completed: 'पूरा हुआ', conversation: 'AI की सहायता से बातचीत', form: 'फ़ॉर्म में दिए गए उत्तर', demoPatient: 'नमूना मरीज़',
    scoreSummary: 'अंकों का सारांश', total: 'कुल अंक', severity: 'गंभीरता का स्तर', scale: '0–27 अंक का पैमाना',
    scoreOutOf: (score) => `27 में से ${score} अंक`, responses: 'पुष्टि किए गए उत्तर', period: 'संदर्भ अवधि: पिछले दो सप्ताह।',
    headers: ['#', 'PHQ-9 प्रश्न', 'उत्तर'],
    liveNote: 'Gemini ने बातचीत से उत्तर का अनुमान लगाया और प्रतिभागी ने उसकी पुष्टि की। बातचीत का यह तरीका चिकित्सकीय रूप से प्रमाणित नहीं है। यह अंक निदान नहीं है।',
    formNote: 'ये अंक PHQ-9 के नौ पुष्टि किए गए उत्तरों का सारांश हैं। ये निदान नहीं हैं।',
    revision: (count) => `अंतिम समीक्षा में ${count} उत्तर बदले गए। ऊपर अंतिम उत्तर दिखाए गए हैं।`,
    norms: 'इस रिपोर्ट में प्रतिशतक तुलना शामिल नहीं है।',
    source: 'प्रश्नावली का स्रोत', printable: 'प्रिंट करने योग्य रिपोर्ट खोलें',
    safety: 'प्रश्न 9 का उत्तर सकारात्मक है। कृपया जल्द किसी योग्य चिकित्सक से संपर्क करें। यह आकलन किसी को सूचना नहीं भेजता। यदि आप अपनी सुरक्षा को लेकर आश्वस्त नहीं हैं, तो तुरंत स्थानीय आपातकालीन सहायता लें।',
    bands: { minimal: 'न्यूनतम या नहीं', mild: 'हल्का', moderate: 'मध्यम', 'moderately severe': 'मध्यम से गंभीर', severe: 'गंभीर' },
  },
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderAdditionalReport(container, assessment, form, printableLink) {
  if (assessment.status !== 'completed' || !['gad7', 'pcl5'].includes(assessment.formId) ||
      !Array.isArray(assessment.answers) || assessment.answers.length !== form.questions.length || !assessment.scores) {
    throw new Error('A completed assessment result is required.');
  }
  const report = element('article', 'phq-report');
  const header = element('header', 'phq-report-header');
  header.append(element('p', 'phq-report-eyebrow', 'ASSESSMENT REPORT'), element('h2', '', form.title),
    element('p', 'phq-report-meta', `Completed ${new Date(assessment.completedAt).toLocaleString()} · ${assessment.collectionMethod === 'conversational_inference' ? 'AI-assisted conversation' : 'Direct form responses'} · Sample patient ${assessment.demoPatientId?.slice(-1).toUpperCase() || 'unknown'}`));
  report.append(header);
  const summary = element('section', 'phq-report-summary');
  const score = element('div', 'phq-report-score');
  score.append(element('span', '', 'TOTAL SCORE'), element('strong', '', `${assessment.scores.rawTotal} / ${assessment.scores.maxTotal}`));
  summary.append(score);
  if (assessment.formId === 'gad7') {
    const severity = element('div', 'phq-report-severity');
    severity.append(element('span', '', 'SCORE BAND'), element('strong', '', assessment.scores.severity));
    summary.append(severity);
  }
  report.append(summary);
  const responses = element('section', 'phq-report-responses');
  responses.append(element('h3', '', 'Confirmed responses'), element('p', '', `Reference period: ${form.referencePeriod.toLowerCase()}.`));
  const table = element('table', 'phq-report-table');
  const heading = element('tr');
  for (const label of ['#', 'Item', 'Response']) heading.append(element('th', '', label));
  const thead = element('thead'); thead.append(heading);
  const tbody = element('tbody');
  for (const answer of assessment.answers) {
    const row = element('tr');
    row.append(element('td', '', String(answer.number)), element('td', '', form.questions[answer.number - 1].text),
      element('td', '', `${form.options[answer.value].label} (${answer.value})`));
    tbody.append(row);
  }
  table.append(thead, tbody); responses.append(table); report.append(responses);
  const notes = element('section', 'phq-report-notes');
  notes.append(element('p', '', assessment.formId === 'pcl5'
    ? 'PCL-5 has no established severity bands. This symptom total is not a diagnosis and requires clinician interpretation.'
    : 'GAD-7 score bands summarize symptoms. This screening result is not a diagnosis.'));
  if (assessment.collectionMethod === 'conversational_inference') notes.append(element('p', '', 'Gemini suggested response values from conversation; the participant confirmed each answer. This administration method has not been clinically validated here.'));
  if (assessment.reviewChangeCount) notes.append(element('p', '', `${assessment.reviewChangeCount} answer(s) changed during final review.`));
  const source = element('a', '', 'Questionnaire source'); source.href = form.source; source.target = '_blank'; source.rel = 'noopener noreferrer';
  notes.append(source);
  if (form.scoringSource) {
    const scoringSource = element('a', '', 'Scoring guidance');
    scoringSource.href = form.scoringSource; scoringSource.target = '_blank'; scoringSource.rel = 'noopener noreferrer';
    notes.append(element('span', '', ' · '), scoringSource);
  }
  report.append(notes);
  if (printableLink) {
    const link = element('a', 'button primary phq-report-link', 'Open printable report');
    link.href = `/report.html?id=${encodeURIComponent(assessment.id)}`;
    report.append(link);
  }
  container.replaceChildren(report);
}

export function renderReport(container, assessment, form, { printableLink = false } = {}) {
  if (assessment.formId !== 'phq9') return renderAdditionalReport(container, assessment, form, printableLink);
  if (assessment.status !== 'completed' || assessment.formId !== 'phq9' ||
      !Array.isArray(assessment.answers) || assessment.answers.length !== 9 || !assessment.scores) {
    throw new Error('A completed PHQ-9 result is required.');
  }

  if (form.language !== assessment.language) throw new Error('Report language does not match the saved result.');
  const labels = reportCopy[assessment.language] || reportCopy.en;

  const report = element('article', 'phq-report');
  const header = element('header', 'phq-report-header');
  const eyebrow = element('p', 'phq-report-eyebrow', labels.eyebrow);
  const title = element('h2', '', form.title);
  const when = new Date(assessment.completedAt).toLocaleString(assessment.language === 'hi' ? 'hi-IN' : 'en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const method = assessment.collectionMethod === 'conversational_inference' ? labels.conversation : labels.form;
  const patientLabel = assessment.demoPatientId ? ` · ${labels.demoPatient} ${assessment.demoPatientId.slice(-1).toUpperCase()}` : '';
  const metadata = element('p', 'phq-report-meta', `${labels.completed} ${when} · ${method}${patientLabel}`);
  header.append(eyebrow, title, metadata);

  const summary = element('section', 'phq-report-summary');
  summary.setAttribute('aria-label', labels.scoreSummary);
  const scoreBlock = element('div', 'phq-report-score');
  scoreBlock.append(element('span', '', labels.total), element('strong', '', `${assessment.scores.rawTotal} / 27`));
  const severityBlock = element('div', 'phq-report-severity');
  severityBlock.append(element('span', '', labels.severity),
    element('strong', '', labels.bands[assessment.scores.severity] || assessment.scores.severity));
  summary.append(scoreBlock, severityBlock);

  const scale = element('section', 'phq-report-scale');
  scale.setAttribute('aria-label', 'PHQ-9 score scale');
  scale.append(element('h3', '', labels.scale));
  const track = element('div', 'phq-report-track');
  const marker = element('span', 'phq-report-marker');
  marker.style.left = `${Math.min(100, Math.max(0, assessment.scores.rawTotal / 27 * 100))}%`;
  marker.setAttribute('aria-label', labels.scoreOutOf(assessment.scores.rawTotal));
  track.append(marker);
  scale.append(track);
  const bandList = element('div', 'phq-report-bands');
  for (const band of severityBands) {
    const bandNode = element('div', `phq-report-band${assessment.scores.severity === band.key ? ' active' : ''}`);
    bandNode.append(element('strong', '', labels.bands[band.key]), element('span', '', band.range));
    bandList.append(bandNode);
  }
  scale.append(bandList);

  const responses = element('section', 'phq-report-responses');
  responses.append(element('h3', '', labels.responses));
  const period = element('p', '', labels.period);
  responses.append(period);
  const table = element('table', 'phq-report-table');
  const thead = element('thead');
  const headingRow = element('tr');
  for (const label of labels.headers) headingRow.append(element('th', '', label));
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
    safetyNotice = element('p', 'phq-report-alert', labels.safety);
    safetyNotice.setAttribute('role', 'alert');
  }
  notes.append(element('p', '', assessment.collectionMethod === 'conversational_inference' ? labels.liveNote : labels.formNote));
  if (assessment.reviewChangeCount) {
    notes.append(element('p', '', labels.revision(assessment.reviewChangeCount)));
  }
  notes.append(element('p', '', labels.norms));
  const source = element('a', '', labels.source);
  source.href = form.source;
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  notes.append(source);

  report.append(header);
  if (safetyNotice) report.append(safetyNotice);
  report.append(summary, scale, responses, notes);
  if (printableLink) {
    const link = element('a', 'button primary phq-report-link', labels.printable);
    link.href = `/report.html?id=${encodeURIComponent(assessment.id)}`;
    report.append(link);
  }
  container.replaceChildren(report);
}
