import { renderReport } from './report-view.js';

const container = document.getElementById('report');
const printButton = document.getElementById('print-report');
const backLink = document.getElementById('back-assessments');
printButton.addEventListener('click', () => window.print());

const id = new URLSearchParams(location.search).get('id');
if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
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
