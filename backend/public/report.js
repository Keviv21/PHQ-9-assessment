import { renderDefinitionReport, renderDraftReport, renderReport } from './report-view.js';

const container = document.getElementById('report');
const printButton = document.getElementById('print-report');
const backLink = document.getElementById('back-assessments');
printButton.addEventListener('click', () => window.print());

const params = new URLSearchParams(location.search);
const id = params.get('id');
const draftSessionId = params.get('draftSessionId');
const definitionSessionId = params.get('definitionSessionId');
if (definitionSessionId && /^[0-9a-f-]{36}$/i.test(definitionSessionId)) {
  try {
    const response = await fetch(`/api/definition-sessions/${encodeURIComponent(definitionSessionId)}`);
    if (!response.ok) throw new Error('Report not found.');
    const assessment = await response.json();
    if (assessment.demoPatientId) backLink.href = `/?view=reports&patient=${encodeURIComponent(assessment.demoPatientId)}`;
    renderDefinitionReport(container, assessment);
    document.title = `${assessment.formSnapshot.title} Report | OpenMind`;
    printButton.disabled = false;
  } catch (error) {
    container.textContent = error.message;
  }
} else if (draftSessionId && /^[0-9a-f-]{36}$/i.test(draftSessionId)) {
  try {
    const sessionResponse = await fetch(`/api/draft-sessions/${encodeURIComponent(draftSessionId)}`);
    if (!sessionResponse.ok) throw new Error('Report not found.');
    const assessment = await sessionResponse.json();
    const formResponse = await fetch(`/api/assessment-library/${encodeURIComponent(assessment.formId)}`);
    if (!formResponse.ok) throw new Error('Report form not found.');
    const form = await formResponse.json();
    if (assessment.demoPatientId) backLink.href = `/?view=reports&patient=${encodeURIComponent(assessment.demoPatientId)}`;
    renderDraftReport(container, assessment, form);
    document.title = `${form.title} Report | OpenMind`;
    printButton.disabled = false;
  } catch (error) {
    container.textContent = error.message;
  }
} else if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
  container.textContent = 'Choose a saved result from the assessment page.';
} else {
  try {
    const resultResponse = await fetch(`/api/results/${encodeURIComponent(id)}`);
    if (!resultResponse.ok) throw new Error('Report not found.');
    const assessment = await resultResponse.json();
    if (assessment.demoPatientId) backLink.href = `/?view=reports&patient=${encodeURIComponent(assessment.demoPatientId)}`;
    const formResponse = await fetch(`/api/form?formId=${encodeURIComponent(assessment.formId)}&language=${encodeURIComponent(assessment.language)}`);
    if (!formResponse.ok) throw new Error('Report form not found.');
    const form = await formResponse.json();
    document.title = `${assessment.formId.toUpperCase()} Report | OpenMind`;
    document.documentElement.lang = assessment.language;
    if (assessment.language === 'hi') {
      document.title = 'PHQ-9 रिपोर्ट | Casebook पूर्वावलोकन';
      backLink.textContent = '← आकलन पर वापस जाएँ';
      printButton.textContent = 'प्रिंट करें / PDF के रूप में सहेजें';
    }
    renderReport(container, assessment, form);
    printButton.disabled = false;
  } catch (error) {
    container.textContent = error.message;
  }
}
