import { usePageController } from '../hooks/usePageController.js';
import '../styles/report.css';
import '../styles/report-polish.css';

const controllers = [() => import('../controllers/report.js')];

export default function ReportPage() {
  usePageController("Assessment Report | OpenMind", controllers);
  return (<>

  <header className="report-toolbar">
    <a id="back-assessments" href="/">← Back to assessments</a>
    <button id="print-report" type="button" disabled>Print / Save as PDF</button>
  </header>
  <main id="report" className="report-page" aria-live="polite">
    <p>Loading report…</p>
  </main>


  </>);
}
