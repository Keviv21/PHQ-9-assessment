import { usePageController } from '../hooks/usePageController.js';
import '../styles/clinic.css';
import '../styles/clinic-recommend.css';
import '../styles/analytics.css';
import '../styles/doctor-chat.css';

const controllers = [() => import('../controllers/clinic.js'), () => import('../controllers/doctor-chat.js'), () => import('../controllers/analytics.js')];

export default function ClinicPage() {
  usePageController("NovoPsych Assessments | OpenMind", controllers);
  return (<>

  <svg className="icon-definitions" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <symbol id="icon-book" viewBox="0 0 24 24"><path d="M4 4.5h6.5A3.5 3.5 0 0 1 14 8v11H7a3 3 0 0 0-3 1V4.5Zm16 0h-3a3 3 0 0 0-3 3V19h3a3 3 0 0 1 3 1V4.5ZM4 20h16"/></symbol>
    <symbol id="icon-edit" viewBox="0 0 24 24"><path d="M4 20h16M5 16.5l.5-4L16.8 1.2l4 4L9.5 16.5l-4.5.5Zm9.5-13 4 4"/></symbol>
    <symbol id="icon-sliders" viewBox="0 0 24 24"><path d="M3 6h8m4 0h6M3 18h4m4 0h10M11 6a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM7 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"/></symbol>
    <symbol id="icon-clipboard" viewBox="0 0 24 24"><path d="M9 4H6a2 2 0 0 0-2 2v15h16V6a2 2 0 0 0-2-2h-3M9 2h6v4H9V2Zm-1 9h8M8 15h8"/></symbol>
    <symbol id="icon-add" viewBox="0 0 24 24"><path d="M5 3h9l4 4v5M5 3v18h8M14 3v5h4M18 15v7m-3.5-3.5h7"/></symbol>
    <symbol id="icon-chart" viewBox="0 0 24 24"><path d="M4 3v18h17M8 16v-5m5 5V7m5 9V4"/></symbol>
    <symbol id="icon-library" viewBox="0 0 24 24"><path d="M4 5h5v15H4zM10 3h5v17h-5zM16 7h4v13h-4z"/></symbol>
  </svg>
  <div className="clinic-app">
    <aside className="sidebar" aria-label="Main navigation">
      <div className="logo"><a className="logo-home" href="/" aria-label="OpenMind home" title="Go to home"><img className="logo-mark" src="/openmind-mark.svg" alt="" /><span className="logo-word">penMind</span></a><button id="sidebar-toggle" className="sidebar-toggle" type="button" aria-label="Collapse sidebar" aria-controls="sidebar-navigation" aria-expanded="true" title="Collapse sidebar"><svg className="collapse-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m14 5-7 7 7 7"/></svg></button></div>
      <nav id="sidebar-navigation" aria-label="Patient assessment navigation">
        <div className="nav-row muted" title="Deep Research"><svg className="nav-icon" aria-hidden="true"><use href="#icon-edit"></use></svg><span className="nav-label">Deep Research</span></div>
        <div className="nav-row muted" title="Patient Casebooks"><svg className="nav-icon" aria-hidden="true"><use href="#icon-book"></use></svg><span className="nav-label">Patient Casebooks</span></div>
        <div className="nav-row muted" title="MindScribe"><svg className="nav-icon" aria-hidden="true"><use href="#icon-sliders"></use></svg><span className="nav-label">MindScribe</span></div>
        <div className="nav-row section" title="Patient Assessments & Tests"><svg className="nav-icon" aria-hidden="true"><use href="#icon-clipboard"></use></svg><span className="nav-label">Patient Assessments &amp; Tests</span></div>
        <div className="nav-row subsection">NovoPsych Assessment</div>
        <button id="nav-prescribe" className="nav-row nav-action active" type="button" aria-label="Prescribe Test" title="Prescribe Test"><svg className="nav-icon" aria-hidden="true"><use href="#icon-add"></use></svg><span className="nav-label">Prescribe Test</span></button>
        <button id="nav-reports" className="nav-row nav-action" type="button" aria-label="View Test Reports" title="View Test Reports"><svg className="nav-icon" aria-hidden="true"><use href="#icon-chart"></use></svg><span className="nav-label">View Test Reports</span></button>
        <button id="nav-analytics" className="nav-row nav-action" type="button" aria-label="Analytics" title="Analytics"><svg className="nav-icon" aria-hidden="true"><use href="#icon-chart"></use></svg><span className="nav-label">Analytics</span></button>
      </nav>
      <div className="sidebar-footer"><span className="workspace-avatar" aria-hidden="true">OM</span><div className="footer-label"><strong>Assessment workspace</strong><small>Sample patient records</small></div></div>
    </aside>
    <div className="main-column">
      <header className="topbar"><span className="app-switcher">Open MindScribe</span><span className="topbar-caption">Patient Assessments &amp; Tests <span aria-hidden="true">/</span> NovoPsych Assessment</span></header>
      <main className="content">
        <section id="prescribe-view">
          <div className="page-heading"><div><p className="eyebrow">PATIENT ASSESSMENTS &amp; TESTS</p><h1>Prescribe Test</h1><p>Select a patient, review the summary-based suggestion, discuss other options, and choose an assessment.</p></div></div>
          <div className="steps" aria-label="Prescription progress"><div id="step-one" className="step current"><span>1</span>Patient details</div><div className="step-line"></div><div id="step-two" className="step"><span>2</span>Confirm &amp; Prescribe</div></div>
          <section id="choose-patient">
            <label className="search-label" htmlFor="patient-search">Filter by Patient Name</label>
            <div className="search-box"><span aria-hidden="true">⌕</span><input id="patient-search" type="search" placeholder="Search patient..." autoComplete="off" /></div>
            <div id="patient-list" className="patient-list" role="radiogroup" aria-label="Sample patients"></div>
            <div className="actions"><button id="next-step" className="button primary" type="button" disabled>Next</button></div>
          </section>
          <section id="confirm-step" hidden>
            <div className="detail-grid"><article className="panel"><h2>Patient summary</h2><div id="patient-summary"></div></article><article className="panel"><h2>Assessment shortlist</h2><div id="suggestion-output"></div></article></div>
            <section className="panel doctor-chat-panel">
              <h2>Doctor conversation</h2>
              <p>Describe additional current concerns to explore other relevant assessments. Use de-identified details only. The doctor makes the final choice.</p>
              <div id="doctor-chat-messages" className="doctor-chat-messages" aria-live="polite"><p className="doctor-chat-intro">Ask about another concern or assessment, for example: “The patient also reports difficulty sleeping. Which assessments should I consider?”</p></div>
              <form id="doctor-chat-form" className="doctor-chat-form"><label htmlFor="doctor-chat-input">Your message</label><textarea id="doctor-chat-input" maxLength="1200" rows="3" placeholder="Describe a current concern without names, contact details, or identifying notes"></textarea><button id="doctor-chat-send" className="button primary" type="submit">Send</button></form>
              <div id="doctor-chat-suggestions" className="doctor-chat-suggestions"></div>
            </section>
            <section className="panel assessment-library-panel" aria-labelledby="assessment-library-title">
              <div className="assessment-library-heading"><h2 id="assessment-library-title">Assessment Library</h2><p>Explore the assessment collection and select a measure for your patient.</p></div>
              <label className="assessment-library-search" htmlFor="assessment-library-search"><span className="visually-hidden">Search Assessment Library</span><input id="assessment-library-search" type="search" placeholder="Search Assessment Library" autoComplete="off" /><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 5 5"></path></svg></label>
              <div id="assessment-library-categories" className="assessment-library-categories" role="group" aria-label="Filter assessments by category"></div>
              <div className="assessment-library-results"><span id="assessment-library-count" aria-live="polite"></span><button id="assessment-library-suggested" type="button" className="assessment-library-suggested" aria-pressed="false">Suggested for this patient</button></div>
              <div id="assessment-library-grid" className="assessment-library-grid" aria-live="polite"></div>
              <div className="assessment-library-pagination"><button id="assessment-library-previous" className="button outline" type="button">Previous</button><span id="assessment-library-page"></span><button id="assessment-library-next" className="button outline" type="button">Next</button></div>
            </section>
            <section className="panel decision-panel">
              <h2>Doctor's final selection</h2>
              <label className="search-label" htmlFor="assessment-search">Assessment to prescribe</label>
              <div id="assessment-combobox" className="assessment-combobox">
                <input id="assessment-search" className="patient-picker assessment-search" type="search" role="combobox" aria-autocomplete="list" aria-controls="assessment-options" aria-expanded="false" placeholder="Search assessments" autoComplete="off" disabled />
                <button id="assessment-open" className="assessment-open" type="button" aria-label="Show assessments" disabled>⌄</button>
                <div id="assessment-options" className="assessment-options" role="listbox" hidden></div>
              </div>
              <div id="selection-details" aria-live="polite"></div>
            </section>
            <div className="actions"><button id="back-step" className="button outline" type="button">Back to patients</button><button id="prescribe-button" className="button primary" type="button" disabled>Confirm &amp; Prescribe</button></div>
            <div id="prescription-result" aria-live="polite"></div>
          </section>
        </section>
        <section id="reports-view" hidden>
          <div className="page-heading"><div><p className="eyebrow">PATIENT ASSESSMENTS &amp; TESTS</p><h1>View Test Reports</h1><p>Choose a patient to see assigned assessments and completed reports.</p></div></div>
          <label className="search-label" htmlFor="report-patient">Patient</label>
          <select id="report-patient" className="patient-picker"><option value="">Choose a patient</option></select>
          <div id="report-content" aria-live="polite"><p className="empty-state">Choose a patient to view their test reports.</p></div>
        </section>
        <section id="analytics-view" hidden>
          <div className="page-heading"><div><p className="eyebrow">PATIENT ASSESSMENTS &amp; TESTS</p><h1>Assessment Analytics</h1><p>Track assessment activity and patient progress over time.</p></div></div>
          <p className="analytics-note">Completed assessments appear in activity charts. Score trends are shown separately for each assessment and subscale.</p>
          <div id="analytics-status" className="analytics-status" role="status" aria-live="polite"></div>
          <div id="analytics-summary" className="analytics-summary"></div>
          <div className="analytics-grid">
            <section className="panel analytics-panel"><h2>Completed prescriptions by month</h2><div id="analytics-months"></div></section>
            <section className="panel analytics-panel"><h2>By assessment</h2><div id="analytics-by-form"></div></section>
          </div>
          <section className="panel analytics-patient-panel">
            <div className="analytics-patient-heading"><div><h2>Patient progress</h2><p>View every completed assessment and follow each available score over time.</p></div><div className="analytics-controls"><label htmlFor="analytics-patient">Patient<select id="analytics-patient" className="patient-picker"><option value="">Choose a patient</option></select></label><label htmlFor="analytics-assessment">Assessment<select id="analytics-assessment" className="patient-picker"><option value="all">All assessments</option></select></label></div></div>
            <div id="analytics-patient-content"><p className="empty-state">Choose a patient to see their score history.</p></div>
          </section>
        </section>
        <p className="clinical-note">Sample patient records.</p>
      </main>
    </div>
  </div>




  </>);
}
