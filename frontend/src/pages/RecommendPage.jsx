import { usePageController } from '../hooks/usePageController.js';
import '../styles/casebook.css';
import '../styles/assessment-polish.css';
import '../styles/recommend-page.css';

const controllers = [() => import('../controllers/recommend.js')];

export default function RecommendPage() {
  usePageController("Assessment Suggestions | OpenMind", controllers);
  return (<>

  <div className="app-shell">
    <header className="app-header"><div className="brand"><img className="brand-mark" src="/openmind-mark.svg" alt="" /><strong>OpenMind</strong><span className="header-divider"></span><span className="page-label">Assessment Suggestions</span></div><a href="/" className="button secondary">Back to assessments</a></header>
    <main className="recommend-shell">
      <div className="recommend-intro"><div className="breadcrumb">OpenMind <span aria-hidden="true">/</span> Assessments <span aria-hidden="true">/</span> Suggestions</div><h1>Which assessment fits this patient?</h1><p>Review current concerns and select the matching options below. Enter only de-identified information. A clinician decides which assessment to use.</p></div>
      <div className="recommend-layout">
        <form id="recommend-form" className="recommend-card">
          <h2>De-identified patient context</h2><p>These selections are used locally for a recommendation. They are not saved and are not sent to Gemini.</p>
          <div className="field"><label className="field-label" htmlFor="age-group">Age group</label><select id="age-group" required><option value="unknown">Not confirmed</option><option value="19to64">Adult, 19–64</option><option value="65plus">Adult, 65 or older</option><option value="under19">Under 19</option></select></div>
          <fieldset className="field" style={{"border": "0", "padding": "0", "marginLeft": "0", "marginRight": "0"}}><legend className="field-label">Current concerns documented or confirmed</legend><div className="check-list">
            <label className="check-row"><input type="checkbox" name="concern" value="depression" />Low mood, loss of interest, or other depression symptoms</label>
            <label className="check-row"><input type="checkbox" name="concern" value="anxiety" />Persistent worry or other anxiety symptoms</label>
            <label className="check-row"><input type="checkbox" name="concern" value="traumaSymptoms" />Trauma-related symptoms</label>
            <label className="check-row"><input type="checkbox" name="concern" value="stress" />Stress, tension, or difficulty relaxing</label>
          </div></fieldset>
          <div className="field"><label className="field-label" htmlFor="trauma-exposure">Qualifying trauma exposure</label><select id="trauma-exposure"><option value="notReported">Not reported</option><option value="uncertain">Uncertain / needs review</option><option value="confirmed">Confirmed by clinician</option></select><p>Confirm the event using an appropriate trauma history. Stressful experiences alone do not establish PTSD Criterion A.</p></div>
          <div className="field"><label className="field-label" htmlFor="safety-status">Immediate self-harm, suicide, or other safety concern</label><select id="safety-status"><option value="notReviewed">Not yet reviewed</option><option value="noneReported">No immediate concern reported after review</option><option value="concern">Concern present</option></select></div>
          <button className="button primary" type="submit">Suggest assessments</button>
        </form>
        <section className="recommend-card" aria-live="polite"><h2>Suggestions for clinician review</h2><div id="recommend-output"><p className="recommend-info">Select the context and click “Suggest assessments.”</p></div></section>
      </div>
    </main>
  </div>


  </>);
}
