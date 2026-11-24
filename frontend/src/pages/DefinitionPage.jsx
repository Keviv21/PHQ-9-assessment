import { usePageController } from '../hooks/usePageController.js';
import '../styles/casebook.css';
import '../styles/assessment-polish.css';
import '../styles/report-view.css';
import '../styles/definition.css';
import '../styles/assessment-unified.css';

const controllers = [() => import('../controllers/definition.js')];

export default function DefinitionPage() {
  usePageController("Patient assessment | OpenMind", controllers);
  return (<>

  <div className="app-shell">
  <header className="app-header"><div className="brand"><img className="brand-mark" src="/openmind-mark.svg" alt="" /><strong>OpenMind</strong><span className="header-divider"></span><span className="page-label">Patient Assessment</span></div><span id="voice-status" className="status" role="status">Assessment session</span></header>
  <div className="workspace definition-layout">
    <aside className="context-panel definition-context" aria-label="Assessment setup">
      <div className="breadcrumb"><a href="/">Patient Assessments</a><span aria-hidden="true">/</span><strong>Assessments</strong></div>
      <div className="assessment-identity"><div className="assessment-avatar">AS</div><div><h1 id="side-title">Loading assessment…</h1><p>ASSESSMENT</p></div></div>
      <p id="side-description" className="context-summary"></p>
      <div className="context-meta"><div><span>Questions</span><strong id="side-count">—</strong></div></div>
      <div id="definition-start" className="definition-start"><div id="context-fields"></div></div><a className="button secondary assessment-back" href="/">Back to assessments</a><div className="mode-actions" id="definition-modes"><button id="start-selected" className="button primary" type="button">Start voice conversation</button></div>
      <p id="side-patient" className="support-note"></p>
    </aside>
  <main className="conversation-panel definition-main">
    <div className="conversation-header"><div className="assistant-avatar" aria-hidden="true"><span></span></div><div><h2>Assessment conversation</h2><p>Share your experience in your own words. Review your answers before generating the report.</p></div><span id="definition-live-label" className="live-badge">OFF</span></div>
    <div className="conversation-body definition-body">
    <div id="error" className="error" hidden></div>
    <div id="definition-controls" className="definition-assessment-controls" aria-label="Assessment settings"><div className="definition-setting-pickers"><label className="inline-mode-picker" htmlFor="definition-mode"><span>Mode:</span><select id="definition-mode"><option value="voice">Voice conversation</option><option value="screen">Complete on screen</option></select></label><label className="inline-language-picker" htmlFor="definition-language"><span>Language:</span><select id="definition-language" aria-describedby="definition-language-note"><option value="en">English</option></select></label></div><p id="definition-language-note" className="muted definition-language-note" role="status"></p></div>
    <section id="intro" className="panel assessment-card" hidden><div className="assessment-topline"><span>CURRENT QUESTION</span><span id="intro-count">0 / 0</span></div><div className="progress-track"><div></div></div><div className="question-area"><span className="question-number">ASSESSMENT</span><h2>Choose a mode to begin</h2><p>Choose a mode and language, then start your assessment.</p></div></section>
    <section id="questionnaire" className="panel assessment-card" hidden>
      <div className="assessment-topline"><span>CURRENT QUESTION</span><span id="progress-text"></span></div><div className="progress-track"><div id="progress-fill"></div></div>
      <div className="question-area"><span className="question-number" id="question-number">QUESTION 1</span><h2 id="question"></h2><p id="reference" className="reference-period"></p></div>
      <div id="input-area" className="answer-options"></div>
      <div id="voice-answer-guide" className="voice-answer-guide" hidden></div>
      <div id="screen-actions" className="actions"><button id="back" className="secondary">Previous</button><button id="next" className="primary">Save &amp; continue</button></div>
      <p id="save-status" className="muted"></p>
    </section>
    <section id="review" className="panel assessment-card" hidden>
      <p className="eyebrow">Final review</p><h1>Review your answers</h1>
      <p>You can change any response before generating the report.</p><div id="review-list"></div>
      <div className="actions"><button id="review-back" className="secondary">Back to questions</button><button id="finish" className="primary">Generate report</button></div>
    </section>
    <section id="report" className="panel assessment-card" hidden><div id="definition-inline-report"></div><a id="open-report" className="button primary" href="#">Open printable report</a></section>
    <section id="voice-transcript" className="transcript voice-transcript" aria-label="Conversation" aria-live="polite"><p className="empty">The conversation will appear here.</p></section>
    </div>
    <form id="voice-text-form" className="composer voice-text-form"><input id="voice-text" type="text" maxLength="1000" placeholder="You can type a response here during a Live session" aria-label="Type a response" disabled /><button id="voice-send" className="button primary" type="submit" disabled>Send</button></form>
  </main>
  <aside className="session-panel definition-side" aria-label="Session controls"><section className="session-card"><div className="session-heading"><h2>LIVE SESSION</h2><span id="definition-mode-label">OFF</span></div><div className="camera-box voice-session-box"><video id="voice-preview" autoPlay muted playsInline></video><div id="voice-camera-placeholder">Camera is off</div><span className="camera-badge">CAMERA PREVIEW</span></div><div className="media-actions"><button id="voice-mute" className="button secondary" type="button" disabled>Turn microphone off</button><button id="voice-camera-toggle" className="button secondary" type="button" disabled>Turn camera on</button></div><p className="support-note">Recorded answers and available scores are saved. Audio and optional camera frames are used during a live conversation.</p></section><section className="session-card guide"><h2>How this works</h2><ol><li>Describe your experience in your own words.</li><li>If an answer is unclear, the assistant may ask a short follow-up.</li><li>Review your answers before generating the report.</li></ol></section></aside>
  </div>
  </div>


  </>);
}
