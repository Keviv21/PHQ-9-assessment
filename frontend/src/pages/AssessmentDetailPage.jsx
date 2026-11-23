import { usePageController } from '../hooks/usePageController.js';
import '../styles/assessment-detail.css';

const controllers = [() => import('../controllers/assessment-detail.js')];

export default function AssessmentDetailPage() {
  usePageController("Assessment details | OpenMind", controllers);
  return (<>

  <header className="site-header">
    <a className="brand" href="/clinic.html" aria-label="OpenMind assessments home"><img src="/openmind-mark.svg" alt="" /><span>OpenMind</span></a>
    <nav aria-label="Assessment navigation"><a href="/clinic.html">Patient Assessments &amp; Tests</a></nav>
  </header>
  <main className="detail-shell">
    <a id="back-link" className="back-link" href="/clinic.html"><span aria-hidden="true">←</span> Back to assessments</a>
    <div id="detail-status" className="detail-status" role="status" aria-live="polite">Loading assessment details…</div>
    <div id="detail-content" hidden>
      <div className="detail-layout">
        <div className="detail-main">
          <p className="eyebrow">ASSESSMENT LIBRARY</p>
          <h1 id="assessment-title"></h1>
          <p id="assessment-description" className="lead"></p>
          <div id="assessment-facts" className="facts" aria-label="Assessment facts"></div>
          <div id="assessment-categories" className="categories"></div>
          <div className="tabs" role="tablist" aria-label="Assessment information">
            <button id="tab-overview" className="tab active" type="button" role="tab" aria-selected="true" aria-controls="detail-tab-panel" data-tab="overview">Overview</button>
            <button id="tab-scoring" className="tab" type="button" role="tab" aria-selected="false" aria-controls="detail-tab-panel" data-tab="scoring">Scoring &amp; interpretation</button>
            <button id="tab-psychometrics" className="tab" type="button" role="tab" aria-selected="false" aria-controls="detail-tab-panel" data-tab="psychometrics">Psychometrics</button>
            <button id="tab-references" className="tab" type="button" role="tab" aria-selected="false" aria-controls="detail-tab-panel" data-tab="references">References</button>
          </div>
          <section id="detail-tab-panel" className="tab-panel" role="tabpanel" aria-labelledby="tab-overview"></section>
        </div>
        <aside className="detail-aside" aria-label="Questionnaire and assignment">
          <div className="preview-card"><div className="preview-heading"><span className="preview-mark">OM</span><span>QUESTIONNAIRE PREVIEW</span></div><h2 id="preview-title"></h2><div id="preview-questions"></div></div>
          <div className="report-preview"><h2>Report structure</h2><p>Score components included in the supplied definition</p><div id="preview-metrics"></div></div>
          <div className="aside-actions"><a id="select-assessment" className="select-button" href="/clinic.html">Select for final review <span aria-hidden="true">→</span></a><p>Return to the patient's assessment plan to confirm the assignment.</p></div>
        </aside>
      </div>
    </div>
  </main>


  </>);
}
