import { usePageController } from '../hooks/usePageController.js';
import '../styles/casebook.css';
import '../styles/report-view.css';
import '../styles/assessment-polish.css';
import '../styles/assessment-unified.css';

const controllers = [() => import('../controllers/app.js')];

export default function AssessmentPage() {
  usePageController("Patient Assessment | OpenMind", controllers);
  return (<>

  <div className="app-shell">
    <header className="app-header">
      <div className="brand"><img className="brand-mark" src="/openmind-mark.svg" alt="" /><strong>OpenMind</strong><span className="header-divider"></span><span className="page-label">Patient Assessment</span></div>
      <span id="connection" className="status">Ready to begin</span>
    </header>

    <div className="workspace">
      <aside className="context-panel" aria-label="Assessment setup">
        <div className="breadcrumb"><a href="/">Patient Assessments</a> <span aria-hidden="true">/</span> <strong>Assessments</strong></div>
        <div className="assessment-identity"><div id="assessment-avatar" className="assessment-avatar">PH</div><div><h1 id="assessment-title">PHQ-9</h1><p id="assessment-period">ASSESSMENT · PAST TWO WEEKS</p></div></div>
        <p id="assessment-intro" className="context-summary">Discuss nine symptoms from the past two weeks.</p>
        <div className="context-meta"><div><span>Questions</span><strong id="question-count">9</strong></div></div>
        <div className="mode-actions"><a href="/" className="button secondary" style={{"textAlign": "center"}}>Back to assessments</a><button id="start-live" className="button primary">Start voice conversation</button><button id="start-demo" className="button secondary">Complete on screen</button></div>
        <p id="patient-context" className="support-note" hidden></p>
        <p id="key-note" className="support-note"></p>
        <div className="side-divider"></div>
        <section className="recent-section"><h2>SAVED RESULTS</h2><div id="recent-results" className="recent-results"><p className="empty">No completed assessments yet.</p></div></section>
      </aside>

      <main className="conversation-panel">
        <div className="conversation-header"><div className="assistant-avatar" aria-hidden="true"><span></span></div><div><h2>Assessment conversation</h2><p>Share your experience in your own words. The assistant will check its understanding.</p></div><span id="live-label" className="live-badge">OFF</span></div>
        <div className="conversation-body">
          <section className="assessment-card" aria-label="Current question">
            <div className="assessment-topline">
              <span className="topline-label">CURRENT QUESTION</span>
              <div className="topline-right">
                <label className="inline-mode-picker" htmlFor="conversation-mode"><span>Mode:</span><select id="conversation-mode" defaultValue="voice">
                  <option value="voice">Voice conversation</option>
                  <option value="text">Text conversation</option>
                </select></label>
                <span id="progress-label">0 / 9</span>
                <label className="inline-language-picker" htmlFor="language"><span>Language:</span><select id="language" aria-describedby="assessment-language-note" defaultValue="en">
                <option value="en">English</option>
                <option value="hi">हिन्दी</option>
                <option value="mr">मराठी (Marathi)</option>
                <option value="es">Español (Spanish)</option>
                <option value="bn">বাংলা (Bengali)</option>
                <option value="te">తెలుగు (Telugu)</option>
                <option value="ta">தமிழ் (Tamil)</option>
                <option value="gu">ગુજરાતી (Gujarati)</option>
                <option value="kn">ಕನ್ನಡ (Kannada)</option>
                <option value="ml">മലയാളം (Malayalam)</option>
                <option value="pa">ਪੰਜਾਬੀ (Punjabi)</option>
                <option value="or">ଓଡ଼ିଆ (Odia)</option>
                <option value="ur">اردو (Urdu)</option>
                <option value="as">অসমীয়া (Assamese)</option>
                <option value="ar">العربية (Arabic)</option>
                <option value="zh">简体中文 (Chinese Simplified)</option>
                <option value="zh-TW">繁體中文 (Chinese Traditional)</option>
                <option value="cs">Čeština (Czech)</option>
                <option value="da">Dansk (Danish)</option>
                <option value="nl">Nederlands (Dutch)</option>
                <option value="fil">Filipino (Tagalog)</option>
                <option value="fi">Suomi (Finnish)</option>
                <option value="fr">Français (French)</option>
                <option value="de">Deutsch (German)</option>
                <option value="el">Ελληνικά (Greek)</option>
                <option value="he">עברית (Hebrew)</option>
                <option value="hu">Magyar (Hungarian)</option>
                <option value="id">Bahasa Indonesia (Indonesian)</option>
                <option value="it">Italiano (Italian)</option>
                <option value="ja">日本語 (Japanese)</option>
                <option value="ko">한국어 (Korean)</option>
                <option value="ms">Bahasa Melayu (Malay)</option>
                <option value="no">Norsk (Norwegian)</option>
                <option value="fa">فارسی (Persian)</option>
                <option value="pl">Polski (Polish)</option>
                <option value="pt">Português (Portuguese)</option>
                <option value="ro">Română (Romanian)</option>
                <option value="ru">Русский (Russian)</option>
                <option value="sv">Svenska (Swedish)</option>
                <option value="th">ไทย (Thai)</option>
                <option value="tr">Türkçe (Turkish)</option>
                <option value="uk">Українська (Ukrainian)</option>
                <option value="vi">Tiếng Việt (Vietnamese)</option>
              </select></label>
              </div>
            </div>
            <p id="assessment-language-note" className="muted definition-language-note" role="status"></p>
            <div className="progress-track"><div id="progress-bar"></div></div>
            <div id="question-area" className="question-area"><span className="question-number">PHQ-9</span><h2>Choose a mode to begin</h2><p>Gemini Live uses your microphone and, if enabled, camera frames for conversational context. The camera does not determine scores.</p></div>
            <div id="answer-options" className="answer-options" aria-label="Form test response choices"></div>
            <div id="results" className="results hidden"></div>
          </section>
          <section id="transcript" className="transcript" aria-label="Conversation" aria-live="polite"><p className="empty">The conversation will appear here.</p></section>
        </div>
        <form id="text-form" className="composer"><input id="text-input" type="text" maxLength="1000" autoComplete="off" disabled aria-label="Type a response" placeholder="You can type a response here during a Live session" /><button id="send-text" className="button primary" type="submit" disabled>Send</button></form>
      </main>

      <aside className="session-panel" aria-label="Session controls"><section className="session-card"><div className="session-heading"><h2>LIVE SESSION</h2><span id="mode-label">OFF</span></div><div className="camera-box"><video id="preview" autoPlay muted playsInline></video><div id="camera-placeholder">Camera is off</div><span className="camera-badge">CAMERA PREVIEW</span></div><div className="media-actions"><button id="mic-toggle" className="button secondary" disabled>Turn microphone off</button><button id="camera-toggle" className="button secondary" disabled>Turn camera on</button></div><p className="support-note">Answers and scores are saved for this assessment. Audio and camera frames are used only during a live conversation.</p></section><section className="session-card guide"><h2>How this works</h2><ol><li>Describe your experience in your own words.</li><li>Gemini may ask a short follow-up.</li></ol><p id="footer-note">Review your answers before generating the report.</p></section></aside>
    </div>
  </div>


  </>);
}
