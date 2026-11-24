import { usePageController } from '../hooks/usePageController.js';
import '../styles/casebook.css';
import '../styles/assessment-polish.css';
import '../styles/report-view.css';
import '../styles/draft-live.css';
import '../styles/assessment-unified.css';

const controllers = [() => import('../controllers/draft-live.js')];

export default function DraftPage() {
  usePageController("Patient Assessment | OpenMind", controllers);
  return (<>

  <div className="app-shell">
    <header className="app-header"><div className="brand"><img className="brand-mark" src="/openmind-mark.svg" alt="" /><strong>OpenMind</strong><span className="header-divider"></span><span className="page-label">Patient Assessment</span></div><span id="draft-status" className="status" role="status">Loading…</span></header>
    <div className="workspace draft-layout">
      <aside className="context-panel draft-context" aria-label="Assessment setup">
        <div className="breadcrumb"><a href="/">Patient Assessments</a><span aria-hidden="true">/</span><strong>Assessments</strong></div>
        <div className="assessment-identity"><div className="assessment-avatar">AS</div><div><h1 id="draft-title">Loading assessment…</h1><p id="draft-period">ASSESSMENT</p></div></div>
        <p id="draft-patient" className="context-summary"></p>
        <div className="context-meta"><div><span>Questions</span><strong id="draft-count">—</strong></div></div>
        <a className="button secondary assessment-back" href="/">Back to assessments</a><div className="mode-actions" id="draft-start"><button id="draft-start-live" className="button primary" type="button" disabled>Start voice conversation</button><button id="draft-start-screen" className="button secondary" type="button" disabled>Complete on screen</button></div>
        <a id="draft-source" className="draft-source" href="#" target="_blank" rel="noopener noreferrer">Questionnaire source</a>
      </aside>
      <main className="conversation-panel draft-main">
        <div className="conversation-header"><div className="assistant-avatar" aria-hidden="true"><span></span></div><div><h2>Assessment conversation</h2><p>Share your experience in your own words. Review your answers before generating the report.</p></div><span id="draft-mode" className="live-badge">OFF</span></div>
        <div className="conversation-body">
          <div id="draft-controls" className="definition-assessment-controls draft-assessment-controls" aria-label="Assessment settings"><div className="definition-setting-pickers"><label className="inline-mode-picker" htmlFor="draft-mode-select"><span>Mode:</span><select id="draft-mode-select"><option value="live">Voice conversation</option><option value="demo">Complete on screen</option></select></label><label className="inline-language-picker" htmlFor="draft-language-select" aria-describedby="draft-language-note"><span>Language:</span><select id="draft-language-select"><option value="en">English</option></select></label></div><p id="draft-language-note" className="muted definition-language-note" role="status"></p></div>
          <section id="draft-question-card" className="assessment-card draft-card" aria-label="Current question"><div className="assessment-topline"><span>CURRENT QUESTION</span><span id="draft-progress">0 / 0</span></div><div className="progress-track"><div id="draft-progress-bar"></div></div><div className="question-area"><span id="draft-question-number" className="question-number">ASSESSMENT</span><h2 id="draft-question">Choose a mode to begin</h2><p id="draft-question-help">Use the controls in the assessment setup panel to start.</p></div><div id="draft-options" className="draft-options answer-options"></div><div id="draft-confirmation" className="draft-confirmation confirmation" hidden><div><span className="eyebrow">IS THIS WHAT YOU MEANT?</span><strong id="draft-proposal"></strong></div><div className="draft-actions confirm-actions"><button id="draft-cancel" className="button secondary" type="button">Let me clarify</button><button id="draft-confirm" className="button primary" type="button">Yes, that's right</button></div></div></section>
          <section id="draft-review" className="assessment-card draft-card" hidden><h2>Final answer review</h2><p id="draft-review-help">Check each selected response before saving.</p><div id="draft-review-items"></div><div className="draft-actions"><button id="draft-finish" className="button primary" type="button">Generate report</button></div></section>
          <section id="draft-complete" className="assessment-card draft-card" hidden><div id="draft-inline-report"></div><a id="draft-report-link" className="button primary" href="#" hidden>Open printable report</a></section>
          <section id="draft-transcript" className="transcript draft-transcript" aria-label="Conversation" aria-live="polite"><p className="empty draft-muted">The conversation will appear here.</p></section>
        </div>
        <form id="draft-text-form" className="composer draft-text-form"><input id="draft-text" type="text" maxLength="1000" placeholder="Type a response during a live conversation" disabled aria-label="Type a response" /><button id="draft-send" className="button primary" type="submit" disabled>Send</button></form>
      </main>
      <aside className="session-panel draft-side" aria-label="Session controls"><section className="session-card"><div className="session-heading"><h2>LIVE SESSION</h2><span id="draft-session-mode">OFF</span></div><div className="camera-box draft-camera"><video id="draft-video" autoPlay muted playsInline></video><span id="draft-camera-off">Camera is off</span><span className="camera-badge">CAMERA PREVIEW</span></div><div className="media-actions"><button id="draft-mic" className="button secondary" type="button" disabled>Turn microphone off</button><button id="draft-camera-toggle" className="button secondary" type="button" disabled>Turn camera on</button></div><p className="support-note">Recorded answers and available scores are saved. Audio and camera frames are used during a live conversation.</p></section><section className="session-card guide"><h2>How this works</h2><ol><li>Describe your experience in your own words.</li><li>If an answer is unclear, the assistant may ask a short follow-up.</li><li>Review your answers before generating the report.</li></ol></section></aside>
    </div>
  </div>


  </>);
}
