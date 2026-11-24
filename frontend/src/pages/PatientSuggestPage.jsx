import { usePageController } from '../hooks/usePageController.js';
import '../styles/casebook.css';
import '../styles/assessment-polish.css';
import '../styles/patient-suggest-page.css';

const controllers = [() => import('../controllers/patient-suggest.js')];

export default function PatientSuggestPage() {
  usePageController("Assessment Suggestions | OpenMind", controllers);
  return (<>

  <div className="app-shell">
    <header className="app-header"><div className="brand"><img className="brand-mark" src="/openmind-mark.svg" alt="" /><strong>OpenMind</strong><span className="header-divider"></span><span className="page-label">Assessment Suggestions</span></div></header>
    <main className="shell">
      <div className="intro"><div className="breadcrumb">OpenMind <span aria-hidden="true">/</span> Assessments <span aria-hidden="true">/</span> Patient suggestions</div><h1>Choose a patient to suggest an assessment</h1><p>Review a sample patient's current concerns and the evidence behind each suggestion. A clinician makes the final selection.</p></div>
      <div className="layout">
        <section className="card"><h2>Patient summary</h2><label className="field-label" htmlFor="patient-select">Select a patient</label><select id="patient-select"><option value="">Choose a patient</option></select><div id="patient-summary" aria-live="polite"><p>Choose a patient to view their summary.</p></div></section>
        <section className="card" aria-live="polite"><h2>Assessment suggestion</h2><div id="suggestion-output"><p className="info">Choose a patient to see a suggestion.</p></div></section>
      </div>
      <p className="support-note">Sample patient records are shown.</p>
    </main>
  </div>


  </>);
}
