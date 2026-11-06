import { renderReport } from './report-view.js';

const container = document.getElementById('report');
const printButton = document.getElementById('print-report');
printButton.addEventListener('click', () => window.print());

const id = new URLSearchParams(location.search).get('id');
if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
  container.textContent = 'Choose a saved result from the assessment page.';
} else {
  try {
    const [resultResponse, formResponse] = await Promise.all([
      fetch(`/api/results/${encodeURIComponent(id)}`), fetch('/api/form'),
    ]);
    if (!resultResponse.ok || !formResponse.ok) throw new Error('Report not found.');
    const [assessment, form] = await Promise.all([resultResponse.json(), formResponse.json()]);
    renderReport(container, assessment, form);
    printButton.disabled = false;
  } catch (error) {
    container.textContent = error.message;
  }
}
