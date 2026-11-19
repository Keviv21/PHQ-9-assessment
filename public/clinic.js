import { assessmentInformation } from './definition-information.js';
const $ = (id) => document.getElementById(id);
const patients = [];
const catalogue = [];
const definitions = [];
const scoredDraftIds = new Set([
  'patient-health-questionnaire-depression-phq-9--8f81b7b3270c',
  'GAD7',
  'ptsd-checklist-5-pcl-5--5a88422b610e',
]);
const legacyDraftIds = {
  phq9: 'patient-health-questionnaire-depression-phq-9--8f81b7b3270c',
  gad7: 'GAD7',
  pcl5: 'ptsd-checklist-5-pcl-5--5a88422b610e',
  dass21: 'depression-anxiety-stress-scales-short-form-dass-21--acf13d5bf87b',
};
const retainedLegacyIds = new Set([...scoredDraftIds, 'depression-anxiety-stress-scales-short-form-dass-21--acf13d5bf87b']);
let selectedPatientId = '';
let suggestion = null;
let selectedFormId = '';
let loadNumber = 0;
let assessmentMatches = [];
let highlightedAssessment = -1;
let libraryPage = 1;
const libraryPageSize = 12;
const libraryCategoryOrder = ['Addiction', 'ADHD', 'Adolescent', 'Anxiety', 'Autism', 'Bipolar',
  'Body Image & Eating', 'Child', 'Clinician self-assessment', 'Cognition & Memory',
  'Depression', 'Diagnosis', 'Disability', 'Feedback-informed', 'Formulation', 'Health',
  'OCD', 'Outcome Monitoring', 'Personality', 'Sleep', 'Sport', 'Trauma', 'Well-being', 'Other'];
const libraryCategoryMap = {
  "adult-adhd-self-report-scale-asrs--814829bfeff1": [
    "ADHD",
    "Diagnosis"
  ],
  "adult-adhd-observer-report-scale-asrs-o--327f8833bed5": [
    "ADHD",
    "Diagnosis"
  ],
  "depression-anxiety-stress-scales-short-form-dass-21--acf13d5bf87b": [
    "Anxiety",
    "Depression",
    "Outcome Monitoring"
  ],
  "multilevel-assessment-of-psychopathology-mapsy--b575b63dbe1c": [
    "Formulation"
  ],
  "ptsd-checklist-5-pcl-5--5a88422b610e": [
    "Diagnosis",
    "Trauma"
  ],
  "generalised-anxiety-disorder-assessment-gad-7--265a24c61d94": [
    "Anxiety",
    "Outcome Monitoring"
  ],
  "patient-health-questionnaire-depression-phq-9--8f81b7b3270c": [
    "Depression",
    "Outcome Monitoring"
  ],
  "autism-spectrum-quotient--a7efe89776be": [
    "Autism",
    "Diagnosis"
  ],
  "executive-skills-questionnaire-revised-esq-r--f39ae41829fa": [
    "ADHD",
    "Autism",
    "Formulation"
  ],
  "athens-insomnia-scale-ais--456d2e3fe9f5": [
    "Sleep"
  ],
  "crafft-substance-use-assessment-crafft-2-1-n--74bd92c2de16": [
    "Addiction",
    "Adolescent"
  ],
  "alexian-brothers-urge-to-self-injure-scale-abusi--438bc2df7997": [
    "Adolescent",
    "Outcome Monitoring"
  ],
  "why-have-sex-questionnaire-short-form-ysex-sf--1aa70b3ea658": [
    "Formulation"
  ],
  "brief-addiction-monitor-bam--dce6e8665d04": [
    "Addiction",
    "Outcome Monitoring"
  ],
  "mascc-unmet-needs-assessment-for-cancer-related-cognitive-impairment-impact-mascc-cog--b844d496fd9b": [
    "Health"
  ],
  "manic-and-depression-symptoms-paired-screening-pmq-9-and-phq-9--d03a749c0f38": [
    "Bipolar",
    "Outcome Monitoring"
  ],
  "fatigue-assessment-scale-fas--4da3697fad5d": [
    "Health"
  ],
  "comprehensive-autistic-trait-inventory-cati--bd94ab5d6261": [
    "Autism",
    "Diagnosis"
  ],
  "mood-disorder-questionnaire-mdq--b485da334e8a": [
    "Bipolar",
    "Diagnosis",
    "Formulation"
  ],
  "extreme-demand-avoidance-questionnaire-adult-eda-qa--ccfe55a2495b": [
    "Autism",
    "Formulation"
  ],
  "extreme-demand-avoidance-8-eda-8--5c05748e0c96": [
    "Autism",
    "Adolescent",
    "Child",
    "Formulation"
  ],
  "dar-5--5adc584d7917": [
    "Trauma"
  ],
  "meno-d--0011882ab4fb": [
    "Depression"
  ],
  "death-anxiety-beliefs-and-behaviours-scale-dabbs--f3239193019f": [
    "Formulation"
  ],
  "couples-satisfaction-index-csi-16--9c69dc027c1c": [
    "Well-being"
  ],
  "herth-hope-index-hhi--50cd05c27f9d": [
    "Well-being"
  ],
  "drug-use-disorders-identification-test-dudit--399903a6348d": [
    "Addiction"
  ],
  "brief-resilience-scale--cc5d54b07df8": [
    "Formulation"
  ],
  "life-orientation-test-revised--919614ebc68b": [
    "Formulation"
  ],
  "brief-hierarchical-taxonomy-of-psychopathology-b-hitop--9a03347893c5": [
    "Formulation"
  ],
  "brief-2-way-social-support-scale--2bae3b03aa75": [
    "Formulation"
  ],
  "leadership-scale-for-sports-lss-15--053274805a74": [
    "Sport"
  ],
  "child-dissociative-checklist-scale-cdc--8ff8f11fd11c": [
    "Child",
    "Trauma"
  ],
  "digital-stress-scale--a523bd676177": [
    "Formulation"
  ],
  "international-trauma-questionnaire-child-and-adolescent-version-itq-ca--869ed5b93581": [
    "Adolescent",
    "Child",
    "Diagnosis",
    "Trauma"
  ],
  "international-trauma-questionnaire-itq--720bec686a03": [
    "Diagnosis",
    "Trauma"
  ],
  "gender-preoccupation-stability-questionnaire-2--6299a80a040e": [
    "Formulation"
  ],
  "brief-emotional-intelligence-scale--71e06748d4fe": [
    "Formulation"
  ],
  "general-behaviour-inventory-gbi--b12d8c551a7c": [
    "Bipolar",
    "Formulation"
  ],
  "flourishing-scale-fs--36825cb5960c": [
    "Well-being"
  ],
  "clinical-outcomes-in-routine-evaluation-core-om--40df925f6cec": [
    "Outcome Monitoring"
  ],
  "clinical-outcomes-in-routine-evaluation-10-core-10--2cb1074a1a81": [
    "Outcome Monitoring"
  ],
  "camouflaging-autistic-traits-questionnaire-cat-q--a3551a0ae362": [
    "Adolescent",
    "Autism",
    "Formulation"
  ],
  "maladaptive-schema-scale-mss--eeb9310268c2": [
    "Formulation"
  ],
  "mss-ysq-young-schema-questionnaire--0eb54fbe44ea": [
    "Formulation"
  ],
  "brief-experiential-avoidance-questionnaire-beaq--619fc855c180": [
    "Formulation"
  ],
  "brief-early-schema-questionnaire-besq--2c077599d64b": [
    "Formulation"
  ],
  "childhood-autism-spectrum-test-cast--ea08b0a813c3": [
    "Autism",
    "Child",
    "Diagnosis"
  ],
  "mental-health-literacy-scale-mhls--e2b1069216a6": [
    "Clinician self-assessment",
    "Formulation"
  ],
  "buss-perry-aggression-questionnaire-bpaq--de56900b41f4": [
    "Formulation",
    "Personality"
  ],
  "brief-emotional-distress-scale-for-youth-bedsy--65f320b5b2b8": [
    "Adolescent",
    "Outcome Monitoring"
  ],
  "geriatric-depression-scale-15-gds--a1ef7075a9d0": [
    "Depression",
    "Diagnosis"
  ],
  "indigenous-risk-impact-screen--b882ecf7bcbd": [
    "Addiction",
    "Outcome Monitoring"
  ],
  "children-eating-attitudes-test-cheat--2088aadb3275": [
    "Adolescent",
    "Body Image & Eating",
    "Child"
  ],
  "eating-disorder-15ed-15--c8ca6c162a50": [
    "Body Image & Eating",
    "Outcome Monitoring"
  ],
  "aggression-scale-for-autism--d6a56deea55d": [
    "Autism",
    "Child"
  ],
  "kessler-psychological-distress-scale-5--49d6b06b14d0": [
    "Anxiety",
    "Depression",
    "Outcome Monitoring"
  ],
  "male-depression-risk-scale-mdrs-22--6274aa5a66f0": [
    "Depression",
    "Formulation"
  ],
  "empathy-quotient-40-item-version--b54fdd8fd587": [
    "Autism",
    "Formulation"
  ],
  "life-events-checklist-5-lec-5--a26ee0fc9afc": [
    "Diagnosis",
    "Trauma"
  ],
  "the-montgomery-asberg-rating-scale-madrs--87bdd7875dc7": [
    "Depression",
    "Outcome Monitoring"
  ],
  "kessler-psychological-distress-scale-plus-k10--13aea23eea71": [
    "Outcome Monitoring"
  ],
  "life-skills-profile-16-item-version--16e3384c0fb9": [
    "Disability"
  ],
  "novopsych-five-factor-personality-scale-30-item-version-nffps-30--7c4367c7997e": [
    "Formulation",
    "Personality"
  ],
  "international-personality-item-pool-neo-120-item-version-ipip-neo-120--06ddfa9e85c9": [
    "Adolescent",
    "Formulation",
    "Personality"
  ],
  "multidimensional-inventory-of-dissociation-60-item-adolescent-version-mid-60-a--67327718a38d": [
    "Adolescent",
    "Formulation",
    "Trauma"
  ],
  "difficulties-in-emotion-regulation-scale-16-item-version-ders-16--c5536e3def4b": [
    "Formulation"
  ],
  "clinical-impairment-assessment-questionnaire-cia--7b34a9aaf9f4": [
    "Adolescent",
    "Body Image & Eating",
    "Diagnosis"
  ],
  "depression-anxiety-stress-scale-youth-version-dass-y--2604ab8d4694": [
    "Adolescent",
    "Anxiety",
    "Child",
    "Depression",
    "Outcome Monitoring"
  ],
  "composite-caregiving-questionnaire-ccq--f9389578f2e8": [
    "Child"
  ],
  "obsessional-compulsive-inventory-revised-oci-r--4782afc23338": [
    "Diagnosis",
    "OCD"
  ],
  "multidimensional-inventory-of-dissociation-60-item-version-mid-60--6fe20374d0c2": [
    "Formulation",
    "Trauma"
  ],
  "mclean-screening-instrument-for-bpd-msi-bpd--cfae059062bb": [
    "Adolescent",
    "Diagnosis",
    "Personality"
  ],
  "mindfulness-based-self-efficacy-scale-mses-r--afdc37419a72": [
    "Adolescent",
    "Formulation"
  ],
  "equanimity-scale-es-16--ea501ffc20ec": [
    "Formulation"
  ],
  "multidimensional-assessment-of-interoceptive-awareness-youth-version-maia-y--15b36559af92": [
    "Adolescent",
    "Autism",
    "Child"
  ],
  "multidimensional-assessment-of-interoceptive-awareness-version-2-maia-2--13c5b369ef78": [
    "Autism",
    "Body Image & Eating",
    "Formulation",
    "Well-being"
  ],
  "borderline-symptom-list-bsl-23--8c1defb2159d": [
    "Diagnosis",
    "Formulation",
    "Personality"
  ],
  "compassion-motivation-and-action-scales-self-compassion-cmas-self--749b02174491": [
    "Formulation"
  ],
  "compassion-motivation-and-action-scales-compassion-cmas-other--4a884a66799a": [
    "Formulation"
  ],
  "cognitive-flexibility-inventory-cfi--8703ad6e433e": [
    "Formulation"
  ],
  "ask-suicide-screening-questionnaire-asq--738914ed7416": [
    "Formulation"
  ],
  "strengths-and-difficulties-questionnaire-sdq--ae888b36225d": [
    "Child",
    "Outcome Monitoring"
  ],
  "ruminative-responses-scale-rrs--0fe47bb082be": [
    "Formulation",
    "Depression"
  ],
  "work-and-social-adjustment-scale--35083c2245b6": [
    "Disability",
    "Health",
    "Outcome Monitoring"
  ],
  "reflective-practice-questionnaire-extended--d0c3b6e259e0": [
    "Clinician self-assessment"
  ],
  "penn-alcohol-craving-scale-pacs--7dc3b08407b5": [
    "Addiction",
    "Outcome Monitoring"
  ],
  "pica-arfid-and-rumination-disorder-interview-arfid-questionnaire-informant-report-par--1bbd19da573d": [
    "Body Image & Eating"
  ],
  "pardi-ar-q-arfid-questionnaire--318b4e3a1f26": [
    "Body Image & Eating"
  ],
  "attachment-style-questionnaire-short-form-asq-sf--422178493154": [
    "Formulation"
  ],
  "pain-self-efficacy-questionnaire-pseq--46e2f9c59622": [
    "Health"
  ],
  "autism-treatment-evaluation-checklist-atec--45f7ca5c94cc": [
    "Autism"
  ],
  "state-difficulties-in-emotion-regulation-scale-s-ders--69ced1964654": [
    "Formulation"
  ],
  "perfectionistic-cognitions-inventory-pci--fbd3ad4e2b23": [
    "Formulation",
    "Adolescent"
  ],
  "phobic-stimuli-response-scale-psrs--ccbb4d992047": [
    "Anxiety"
  ],
  "athlete-psychological-strain-questionnaire--e14b8a4d4416": [
    "Sport"
  ],
  "strengths-and-stressors--d6f1eabe97eb": [
    "Child"
  ],
  "protective-factors-of-resilience-scale--d80af8b839be": [
    "Formulation"
  ],
  "team-psychological-safety-tps-7--86510a92b6ff": [
    "Sport"
  ],
  "screen-for-child-anxiety-related-emotional-disorders-parent-version-scared-parent--b7c48838f49d": [
    "Child",
    "Adolescent",
    "Anxiety"
  ],
  "screen-for-child-anxiety-related-emotional-disorders-child-version-scared-child--133bf4ea4682": [
    "Child",
    "Adolescent",
    "Anxiety"
  ],
  "who-quality-of-life-brief-whoqol-bref--376334616502": [
    "Formulation",
    "Health",
    "Well-being"
  ],
  "young-persons-core-yp-core--2b7fb1486364": [
    "Outcome Monitoring",
    "Adolescent",
    "Child"
  ],
  "thought-action-fusion-scale-revised-tafs-r--b5eb0430c1eb": [
    "Formulation",
    "OCD"
  ],
  "athletic-coping-skills-inventory-acsi-28--7f2fb9189c36": [
    "Sport"
  ],
  "wender-utah-rating-scale-25-item-version-wurs-25--a9fb5add572f": [
    "ADHD",
    "Diagnosis",
    "Formulation"
  ],
  "personality-inventory-for-dsm-5-short-form-pid-5-sf--c5b933c37b51": [
    "Diagnosis",
    "Formulation",
    "Personality"
  ],
  "trauma-recovery-measure-trm--f4e0d7cce7e4": [
    "Outcome Monitoring",
    "Trauma"
  ],
  "zung-self-rating-depression-scale--0b256bfe5e0d": [
    "Adolescent",
    "Depression",
    "Outcome Monitoring"
  ],
  "adolescent-dissociative-experiences-scale-a-des--3f3e763d3d96": [
    "Diagnosis"
  ],
  "positive-childhood-experiences-pces-scale--a1798fe04223": [
    "Formulation",
    "Trauma"
  ],
  "benevolent-childhood-experiences-bces-scale--77c29f4f387a": [
    "Formulation",
    "Trauma"
  ],
  "repetitive-behaviours-questionnaire-3--5ea1225093e8": [
    "Autism",
    "Formulation"
  ],
  "autism-spectrum-quotient-adolescent--89b2fc47c006": [
    "Adolescent",
    "Autism",
    "Diagnosis"
  ],
  "autism-spectrum-quotient-child--9c9252442609": [
    "Autism",
    "Child",
    "Diagnosis"
  ],
  "adult-separation-anxiety-questionnaire--fa5fa6f7448f": [
    "Anxiety",
    "Diagnosis",
    "Formulation"
  ],
  "adhd-clinical-outcome-scale-acos-self-report-version--96bf1d88cb47": [
    "ADHD",
    "Outcome Monitoring"
  ],
  "adhd-clinical-outcome-scale-acos-clinician-version--de39a2c838f5": [
    "ADHD",
    "Outcome Monitoring"
  ],
  "binge-eating-scale-bes--e2aaed92c6e4": [
    "Body Image & Eating"
  ],
  "anxiety-depression-mood-scale-adams--6071c8716f16": [
    "Disability"
  ],
  "weiss-symptom-record-ii-wsr-ii--eddc170fac3b": [
    "Formulation"
  ],
  "oldenburg-burnout-inventory-olbi--95cb8dc3dd29": [
    "Outcome Monitoring",
    "Well-being"
  ],
  "alcohol-addiction-questionnaire--52726a095031": [
    "Addiction",
    "Diagnosis",
    "Health"
  ],
  "toronto-alexithymia-scale--11427c6a7ae5": [
    "Formulation"
  ],
  "the-world-health-organisation-disability-assessment-schedule-whodas-child--ba92f6f5986e": [
    "Adolescent",
    "Child",
    "Disability",
    "Health"
  ],
  "problem-gambling-severity-index-pgsi--07d00657e0c3": [
    "Addiction",
    "Health"
  ],
  "session-reactions-scale-3-brief-srs-3-b--72adc7da7ddf": [
    "Feedback-informed"
  ],
  "your-experience-of-service-yes--29de2c8cbc9b": [
    "Feedback-informed"
  ],
  "acceptance-and-action-questionnaire-version-2-aaq-2--b79868e1db62": [
    "Formulation"
  ],
  "short-health-anxiety-inventory-shai--1295bbae11bd": [
    "Anxiety",
    "Health"
  ],
  "regensburg-insomnia-scale-ris--3e3ecac36f30": [
    "Sleep"
  ],
  "personal-wellbeing-index-adult-5-pwi-a--c1b63b0adf2c": [
    "Formulation",
    "Well-being"
  ],
  "pediatric-symptom-checklist-17-psc-17--e2242cd736c6": [
    "Adolescent",
    "Child"
  ],
  "vanderbilt-adhd-diagnostic-teacher-rating-scale-vadtrs--32823f81d3df": [
    "ADHD",
    "Child",
    "Diagnosis"
  ],
  "positive-and-negative-affect-schedule-panas--a8754da2630c": [
    "Formulation",
    "Outcome Monitoring"
  ],
  "tinnitus-handicap-inventory-thi--fa3776effc43": [
    "Diagnosis",
    "Formulation"
  ],
  "ritvo-autism-asperger-diagnostic-scale-revised-raads-r--3bbda7fdf460": [
    "Autism",
    "Diagnosis",
    "Formulation"
  ],
  "vanderbilt-adhd-diagnostic-parent-rating-scale-vadprs--e090ce5482b0": [
    "ADHD",
    "Child",
    "Diagnosis"
  ],
  "adverse-childhood-experiences-questionnaire-ace-q--e0ab8a5b8f82": [
    "Trauma",
    "Formulation"
  ],
  "automatic-thoughts-questionnaire-believability-atq-b--7d498a17dd25": [
    "Depression",
    "Formulation"
  ],
  "world-health-organisation-disability-assessment-schedule-2-0-interview-whodas-intervi--a836c2e2fbf5": [
    "Disability",
    "Formulation",
    "Health"
  ],
  "world-health-organisation-disability-assessment-schedule-2-0-proxy-whodas-proxy--18dff5cd93b2": [
    "Disability",
    "Formulation",
    "Health"
  ],
  "the-world-health-organisation-disability-assessment-schedule-whodas-2-0-self-report-v--d1cbf0de489d": [
    "Disability",
    "Formulation",
    "Health"
  ],
  "self-compassion-scale-short-form-scs-sf--57918c65c5ed": [
    "Formulation",
    "Well-being"
  ]
};
let libraryCategory = 'All';
let librarySuggestedOnly = false;
const sidebar = document.querySelector('.sidebar');
const clinicApp = document.querySelector('.clinic-app');
const sidebarToggle = $('sidebar-toggle');
const sidebarStorageKey = 'openmind-assessment-sidebar-collapsed';
let sidebarPinnedClosed = false;
let sidebarHovered = false;
try { sidebarPinnedClosed = localStorage.getItem(sidebarStorageKey) === 'true'; } catch { /* Storage may be unavailable. */ }

function renderSidebar() {
  const collapsed = sidebarPinnedClosed && !sidebarHovered;
  clinicApp.classList.toggle('sidebar-collapsed', collapsed);
  sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  const action = collapsed ? 'Expand sidebar' : sidebarPinnedClosed ? 'Keep sidebar expanded' : 'Collapse sidebar';
  sidebarToggle.setAttribute('aria-label', action);
  sidebarToggle.title = action;
}

sidebarToggle.addEventListener('click', () => {
  sidebarPinnedClosed = !sidebarPinnedClosed;
  sidebarHovered = false;
  try { localStorage.setItem(sidebarStorageKey, String(sidebarPinnedClosed)); } catch { /* Storage may be unavailable. */ }
  renderSidebar();
});
sidebar.addEventListener('mouseenter', () => {
  if (window.matchMedia('(min-width: 651px)').matches && sidebarPinnedClosed) {
    sidebarHovered = true;
    renderSidebar();
  }
});
sidebar.addEventListener('mouseleave', () => {
  sidebarHovered = false;
  renderSidebar();
});
sidebar.addEventListener('focusin', () => {
  if (window.matchMedia('(min-width: 651px)').matches && sidebarPinnedClosed) { sidebarHovered = true; renderSidebar(); }
});
sidebar.addEventListener('focusout', (event) => {
  if (!sidebar.contains(event.relatedTarget)) { sidebarHovered = false; renderSidebar(); }
});
renderSidebar();

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function notice(message, alert = false) {
  return el('p', message, `notice${alert ? ' alert' : ''}`);
}

function sourceLabel(source) {
  const labels = {
    'recent_clinician_summary.mood': 'Recent clinician summary · Mood',
    'recent_clinician_summary.function': 'Recent clinician summary · Function',
    'recent_clinician_summary.anxiety': 'Recent clinician summary · Anxiety',
    'recent_clinician_summary.stress': 'Recent clinician summary · Stress',
    'recent_clinician_summary.trauma_symptoms': 'Recent clinician summary · Trauma symptoms',
    'clinical__notes_summary.longitudinal_summary': 'Longitudinal clinical notes',
    'clinical__notes_summary.clinical_inference.aura_analysis': 'Neurological history · Aura',
    'clinical__notes_summary.clinical_inference.sleep_analysis': 'Neurological history · Sleep',
  };
  return labels[source] || 'Clinical summary';
}

function assessmentInfo(id) {
  const definition = id.startsWith('definition:') ? definitions.find((item) => item.id === id.slice(11)) : null;
  const draftId = id.startsWith('draft:') ? id.slice(6) : legacyDraftIds[id];
  const draft = draftId ? catalogue.find((item) => item.id === draftId) : null;
  const legacyDefinition = draftId ? definitions.find((item) => item.id === draftId) : null;
  const core = suggestion?.prescriptionChoices.find((item) => item.id === id);
  const recommendation = suggestion?.recommendations.find((item) => item.id === id);
  const referencePeriod = core?.referencePeriod || definition?.referencePeriod || legacyDefinition?.referencePeriod || draft?.referencePeriod || '';
  return {
    title: core?.title || recommendation?.title || definition?.title || draft?.title || id,
    description: (definition?.description || draft?.description || recommendation?.purpose || '').replace(/\s+/g, ' ').trim(),
    questionCount: core?.questionCount ?? definition?.questionCount ?? draft?.extractedItemCount ?? null,
    referencePeriod: typeof referencePeriod === 'string' && referencePeriod !== '[object Object]' ? referencePeriod.trim() : '',
    responseTypes: definition?.responseTypes || (draft ? ['choice'] : []),
    categories: definition?.categories || libraryCategoryMap[definition?.id] ||
      legacyDefinition?.categories || libraryCategoryMap[legacyDefinition?.id] || ({
      phq9: ['Depression', 'Outcome Monitoring'], gad7: ['Anxiety', 'Outcome Monitoring'],
      pcl5: ['Diagnosis', 'Trauma'],
    })[id] || ['Other'],
  };
}

function assessmentFacts(info) {
  const facts = el('div', undefined, 'assessment-facts');
  if (Number.isInteger(info.questionCount) && info.questionCount > 0) facts.append(el('span', `${info.questionCount} questions`));
  if (info.referencePeriod) facts.append(el('span', `Reference period: ${info.referencePeriod}`));
  const formats = [...new Set(info.responseTypes.map((type) => ({
    choice: 'Selection', single_choice: 'Selection', multiple_choice: 'Multiple choice',
    integer: 'Number', number: 'Number', text: 'Text',
  })[type]).filter(Boolean))];
  if (formats.length) facts.append(el('span', `Answers: ${formats.join(', ')}`));
  return facts;
}

function appendOverview(card, description, fallback = '') {
  const text = description || fallback;
  if (!text) return;
  card.append(el('strong', 'Overview', 'assessment-info-label'));
  if (text.length <= 260) { card.append(el('p', text, 'assessment-overview')); return; }
  const preview = text.slice(0, 258).replace(/\s+\S*$/, '');
  card.append(el('p', `${preview}…`, 'assessment-overview'));
  const more = el('details', undefined, 'assessment-more');
  more.append(el('summary', 'Read full overview'), el('p', text));
  card.append(more);
}

function setView(view, updateUrl = true) {
  const reports = view === 'reports';
  const analytics = view === 'analytics';
  $('prescribe-view').hidden = reports || analytics;
  $('reports-view').hidden = !reports;
  $('analytics-view').hidden = !analytics;
  $('nav-prescribe').classList.toggle('active', !reports && !analytics);
  $('nav-reports').classList.toggle('active', reports);
  $('nav-analytics').classList.toggle('active', analytics);
  if (updateUrl) {
    const url = new URL(location.href);
    if (reports || analytics) url.searchParams.set('view', view);
    else url.searchParams.delete('view');
    if (!reports && !analytics) url.searchParams.delete('patient');
    history.pushState({}, '', url);
  }
  if (reports && $('report-patient').value) loadReports($('report-patient').value);
  if (analytics) window.dispatchEvent(new Event('clinic:analytics'));
}

function setStep(number) {
  $('choose-patient').hidden = number !== 1;
  $('confirm-step').hidden = number !== 2;
  $('step-one').className = `step ${number === 1 ? 'current' : 'done'}`;
  $('step-two').className = `step ${number === 2 ? 'current' : ''}`;
}

function renderPatientList() {
  const query = $('patient-search').value.trim().toLowerCase();
  const list = $('patient-list');
  list.replaceChildren();
  for (const patient of patients.filter((item) => item.label.toLowerCase().includes(query))) {
    const row = el('label', undefined, `patient-row${patient.id === selectedPatientId ? ' selected' : ''}`);
    const radio = el('input');
    radio.type = 'radio'; radio.name = 'demo-patient'; radio.value = patient.id;
    radio.checked = patient.id === selectedPatientId;
    radio.addEventListener('change', () => {
      selectedPatientId = patient.id;
      suggestion = null;
      selectedFormId = '';
      window.dispatchEvent(new CustomEvent('clinic:patient-change', { detail: { patientId: selectedPatientId } }));
      $('prescription-result').replaceChildren();
      $('next-step').disabled = false;
      renderPatientList();
    });
    const avatar = el('span', patient.id.slice(-1).toUpperCase(), 'patient-avatar');
    const name = el('span', patient.label, 'patient-name');
    name.append(el('small', 'Patient summary available', 'patient-subtitle'));
    row.append(radio, avatar, name);
    list.append(row);
  }
  if (!list.children.length) list.append(el('p', 'No patients match this search.', 'empty-state'));
}

function renderSummary(result) {
  const area = $('patient-summary');
  area.replaceChildren(el('h3', result.patient.label), el('p', result.patient.summary.overview));
  const meta = el('div', undefined, 'meta');
  const age = { under19: 'Under 19', '19to64': 'Adult 19–64', '65plus': 'Adult 65+', unknown: 'Age unknown' };
  const safety = { notReviewed: 'Safety review needed', noneReported: 'Safety reviewed', concern: 'Immediate safety concern' };
  meta.append(el('span', age[result.context.ageGroup]), el('span', safety[result.context.safetyStatus]));
  area.append(meta, el('h3', 'Summary observations'));
  const list = el('ul', undefined, 'summary-list');
  for (const observation of result.patient.summary.observations) {
    const item = el('li', `${observation.description} (${observation.status})`);
    item.append(el('small', sourceLabel(observation.source)));
    list.append(item);
  }
  area.append(list);
  if (result.ignoredObservations?.length) {
    area.append(el('h3', 'Additional context'));
    const ignored = el('ul', undefined, 'summary-list');
    for (const item of result.ignoredObservations) {
      const line = el('li', `${item.description} — ${item.reason}`);
      line.append(el('small', sourceLabel(item.source)));
      ignored.append(line);
    }
    area.append(ignored);
  }
}

function renderSuggestions(result) {
  const area = $('suggestion-output');
  area.replaceChildren(notice(result.message, result.status !== 'suggestions'));
  const selected = result.recommendations.find((item) => item.id === result.primaryAssessmentId);
  if (selected) area.append(el('h3', `Suggested first: ${selected.title}`));
  for (const item of result.recommendations) {
    const info = assessmentInfo(item.id);
    const card = el('div', undefined, `result${item.id === result.primaryAssessmentId ? ' primary' : ''}`);
    card.append(el('h3', item.title), el('span', item.availability === 'available' ? 'Available to prescribe' : item.availability === 'requires_trauma_review' ? 'Needs trauma review' : 'Not available for prescription', 'tag'));
    card.append(assessmentFacts(info));
    appendOverview(card, info.description, item.purpose);
    card.append(el('strong', 'Why suggested for this patient', 'assessment-info-label'), el('p', item.reason));
    if (item.note) card.append(el('p', item.note));
    for (const missing of item.missingInformation || []) card.append(notice(missing, true));
    if (item.evidence.length) {
      card.append(el('strong', 'Matched summary observations'));
      const list = el('ul', undefined, 'evidence-list');
      for (const evidence of item.evidence) list.append(el('li', `${evidence.description} — ${sourceLabel(evidence.source)}`));
      card.append(list);
    }
    const source = el('a', 'Clinical reference');
    source.href = item.source; source.target = '_blank'; source.rel = 'noopener noreferrer';
    card.append(source);
    area.append(card);
  }
  if (selected && selected.availability !== 'available') area.append(notice(`${selected.title} is relevant but cannot be prescribed here. Review the eligible tests below before making a selection.`));
}

function defaultAssessmentId(result) {
  if (result.status !== 'suggestions') return '';
  if (definitions.some(item => item.versionId)) {
    const match = definitions.find(item => item.available && item.id === legacyDraftIds[result.primaryAssessmentId]);
    if (match) return `definition:${match.id}`;
  }
  if (result.primaryAssessmentId === 'dass21') {
    const draftId = result.recommendations.find((item) => item.id === 'dass21')?.catalogDraftId;
    return catalogue.some((item) => item.id === draftId && item.previewAvailable) ? `draft:${draftId}` : '';
  }
  const choice = result.prescriptionChoices.find((item) => item.id === result.primaryAssessmentId && item.availability === 'available');
  return choice?.id || '';
}

function assessmentChoices() {
  if (definitions.some(item => item.versionId)) return definitions.map(item => ({
    id: `definition:${item.id}`, title: item.title, enabled: item.available, label: item.title,
  })).sort((a, b) => a.title.localeCompare(b.title));
  const scored = ['phq9', 'gad7', 'pcl5'].map((id) => suggestion?.prescriptionChoices.find((item) => item.id === id) ||
    { id, title: id.toUpperCase(), availability: 'patient_review_required' });
  return [
    ...scored.map((item) => ({ id: item.id, title: item.title, enabled: item.availability === 'available',
      label: `${item.title}${item.id === suggestion?.primaryAssessmentId ? ' · Recommended' : ''}` })),
    ...catalogue.filter((item) => item.id === 'depression-anxiety-stress-scales-short-form-dass-21--acf13d5bf87b')
      .map((item) => ({ id: `draft:${item.id}`, title: item.title, enabled: item.previewAvailable,
        label: `${item.title}${suggestion?.primaryAssessmentId === 'dass21' ? ' · Recommended' : ''}` })),
    ...definitions.filter((item) => !retainedLegacyIds.has(item.id))
      .map((item) => ({ id: `definition:${item.id}`, title: item.title, enabled: item.available,
        label: item.title })),
  ].sort((a, b) => Number(b.id === selectedFormId) - Number(a.id === selectedFormId) ||
    a.title.localeCompare(b.title));
}

function suggestedLibraryIds() {
  return new Set((suggestion?.recommendations || []).map((item) => {
    const definition = definitions.find(entry => entry.versionId && entry.id === legacyDraftIds[item.id]);
    return definition ? `definition:${definition.id}` : item.id === 'dass21' ? `draft:${legacyDraftIds.dass21}` : item.id;
  }));
}

function renderLibraryCategories() {
  const container = $('assessment-library-categories');
  if (!container.childElementCount) {
    const presentCategories = new Set(assessmentChoices().flatMap((item) => assessmentInfo(item.id).categories));
    for (const category of ['All', ...libraryCategoryOrder.filter((name) => presentCategories.has(name))]) {
      const chip = el('button', category, 'assessment-library-category');
      chip.type = 'button';
      chip.dataset.category = category;
      chip.addEventListener('click', () => {
        libraryCategory = category;
        librarySuggestedOnly = false;
        $('assessment-library-search').value = '';
        libraryPage = 1;
        renderAssessmentLibrary();
      });
      container.append(chip);
    }
  }
  for (const chip of container.children) {
    const selected = chip.dataset.category === libraryCategory;
    chip.classList.toggle('active', selected);
    chip.setAttribute('aria-pressed', String(selected));
  }
  const suggestedButton = $('assessment-library-suggested');
  suggestedButton.classList.toggle('active', librarySuggestedOnly);
  suggestedButton.setAttribute('aria-pressed', String(librarySuggestedOnly));
}

function renderAssessmentLibrary() {
  renderLibraryCategories();
  const grid = $('assessment-library-grid');
  const search = $('assessment-library-search').value.trim().toLocaleLowerCase();
  const suggested = suggestedLibraryIds();
  const matches = assessmentChoices().filter((item) => {
    const info = assessmentInfo(item.id);
    return (!librarySuggestedOnly || suggested.has(item.id)) &&
      (libraryCategory === 'All' || info.categories.includes(libraryCategory)) &&
      (!search || `${item.title} ${info.description} ${info.categories.join(' ')}`.toLocaleLowerCase().includes(search));
  }).sort((a, b) => Number(suggested.has(b.id)) - Number(suggested.has(a.id)) || a.title.localeCompare(b.title));
  const pages = Math.max(1, Math.ceil(matches.length / libraryPageSize));
  libraryPage = Math.min(libraryPage, pages);
  const start = (libraryPage - 1) * libraryPageSize;
  const visible = matches.slice(start, start + libraryPageSize);
  $('assessment-library-count').textContent = matches.length ?
    `Showing ${start + 1}–${start + visible.length} of ${matches.length} assessments` : 'No matching assessments';
  $('assessment-library-page').textContent = `Page ${libraryPage} of ${pages}`;
  $('assessment-library-previous').disabled = libraryPage === 1;
  $('assessment-library-next').disabled = libraryPage === pages;
  grid.replaceChildren();
  if (!visible.length) {
    grid.append(el('p', 'No assessments match this search.', 'empty-state'));
    return;
  }
  for (const item of visible) {
    const info = assessmentInfo(item.id);
    const card = el('article', undefined, `assessment-library-card${item.id === selectedFormId ? ' selected' : ''}`);
    const categoryTags = el('div', undefined, 'assessment-library-tags');
    for (const category of info.categories) categoryTags.append(el('span', category));
    card.append(categoryTags, el('h3', info.title));
    appendOverview(card, info.description);
    card.append(assessmentFacts(info));
    if (suggested.has(item.id)) card.append(el('span', 'Suggested for this patient', 'assessment-library-recommended'));
    const action = el('button', item.id === selectedFormId ? 'Selected for review' : 'Select assessment', 'button outline');
    action.type = 'button';
    action.setAttribute('aria-label', `${item.id === selectedFormId ? 'Selected for review' : 'Select assessment'}: ${info.title}`);
    action.disabled = !item.enabled || suggestion?.status !== 'suggestions';
    if (!item.enabled) action.textContent = 'Unavailable';
    else if (suggestion?.status !== 'suggestions') action.textContent = 'Patient review required';
    action.addEventListener('click', () => {
      chooseAssessment(item.id);
      $('assessment-search').scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    card.append(action);
    grid.append(card);
  }
}

function closeAssessmentOptions() {
  $('assessment-options').hidden = true;
  $('assessment-search').setAttribute('aria-expanded', 'false');
  $('assessment-search').removeAttribute('aria-activedescendant');
  highlightedAssessment = -1;
}

function renderAssessmentOptions(query = '') {
  const area = $('assessment-options');
  const search = query.trim().toLowerCase();
  assessmentMatches = assessmentChoices().filter((item) => item.title.toLowerCase().includes(search));
  area.replaceChildren();
  highlightedAssessment = -1;
  if (!assessmentMatches.length) {
    area.append(el('p', 'No assessments match this search.', 'assessment-no-results'));
    return;
  }
  for (const [index, item] of assessmentMatches.entries()) {
    const option = el('button', undefined, 'assessment-option');
    const info = assessmentInfo(item.id);
    option.append(el('span', item.label));
    if (info.questionCount || info.referencePeriod) {
      option.append(el('small', [info.questionCount ? `${info.questionCount} questions` : '', info.referencePeriod]
        .filter(Boolean).join(' · ')));
    }
    option.type = 'button';
    option.id = `assessment-option-${index}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(item.id === selectedFormId));
    option.disabled = !item.enabled;
    if (item.id === selectedFormId) option.classList.add('selected');
    option.addEventListener('click', () => chooseAssessment(item.id));
    area.append(option);
  }
}

function openAssessmentOptions(query = '') {
  if (suggestion?.status !== 'suggestions') return;
  renderAssessmentOptions(query);
  $('assessment-options').hidden = false;
  $('assessment-search').setAttribute('aria-expanded', 'true');
}

function chooseAssessment(id) {
  const item = assessmentChoices().find((entry) => entry.id === id && entry.enabled);
  if (!item) return;
  selectedFormId = item.id;
  $('assessment-search').value = item.title;
  closeAssessmentOptions();
  updateSelectedChoice();
  renderAssessmentLibrary();
}

function highlightAssessment(direction) {
  const options = [...$('assessment-options').querySelectorAll('button:not(:disabled)')];
  if (!options.length) return;
  const current = options.findIndex((option) => option.classList.contains('highlighted'));
  options.forEach((option) => option.classList.remove('highlighted'));
  const next = current < 0 ? (direction > 0 ? 0 : options.length - 1) :
    (current + direction + options.length) % options.length;
  options[next].classList.add('highlighted');
  options[next].scrollIntoView({ block: 'nearest' });
  highlightedAssessment = Number(options[next].id.slice('assessment-option-'.length));
  $('assessment-search').setAttribute('aria-activedescendant', options[next].id);
}

function renderDecision(result) {
  selectedFormId = defaultAssessmentId(result);
  const canAssign = result.status === 'suggestions';
  $('assessment-search').disabled = !canAssign;
  $('assessment-open').disabled = !canAssign;
  $('assessment-search').value = assessmentChoices().find((item) => item.id === selectedFormId)?.title || '';
  renderAssessmentOptions();
  closeAssessmentOptions();
  updateSelectedChoice();
  libraryPage = 1;
  $('assessment-library-search').value = '';
  libraryCategory = 'All';
  librarySuggestedOnly = false;
  renderAssessmentLibrary();
  window.dispatchEvent(new CustomEvent('clinic:patient-context', { detail: { patientId: result.patient.id, status: result.status } }));
}

function updateSelectedChoice() {
  const choice = suggestion?.prescriptionChoices.find((item) => item.id === selectedFormId && item.availability === 'available');
  const draft = selectedFormId.startsWith('draft:') ? catalogue.find((item) => item.id === selectedFormId.slice(6) && item.previewAvailable) : null;
  const definition = selectedFormId.startsWith('definition:') ? definitions.find((item) => item.id === selectedFormId.slice(11) && item.available) : null;
  const allowed = suggestion?.status === 'suggestions' && Boolean(choice || draft || definition);
  $('prescribe-button').disabled = !allowed;
  $('prescribe-button').textContent = allowed ? 'Confirm & Assign' : 'Confirm & Prescribe';
  const area = $('selection-details');
  if (!allowed) {
    area.replaceChildren(notice(suggestion?.status === 'suggestions' ? 'Choose a test. The doctor makes the final assignment.' :
      'Complete the required safety or age review before assigning a test.', suggestion?.status !== 'suggestions'));
    return;
  }
  const info = assessmentInfo(selectedFormId);
  const matched = suggestion?.recommendations.find((item) => item.id === (draft ? 'dass21' : selectedFormId));
  const card = el('article', undefined, 'selected-assessment-card');
  card.append(el('h3', info.title), assessmentFacts(info));
  appendOverview(card, info.description, matched?.purpose);
  const reason = choice?.reason || matched?.reason;
  if (reason) card.append(el('strong', 'Why it fits this patient', 'assessment-info-label'), el('p', reason));
  const evidence = choice?.evidence || matched?.evidence || [];
  if (evidence.length) card.append(el('p', `Summary evidence: ${evidence.map((item) => item.description).join('; ')}`));
  if (choice?.note || matched?.note) card.append(notice(choice?.note || matched.note));
  area.replaceChildren(card);
  if (definition) {
    const selected = selectedFormId;
    fetch(`/api/definitions/${encodeURIComponent(definition.id)}`).then(async response => {
      if (!response.ok) throw new Error('Assessment information unavailable.');
      const form = await response.json();
      if (selectedFormId === selected) area.append(assessmentInformation(form));
    }).catch(error => { if (selectedFormId === selected) area.append(el('p', error.message)); });
  }
}

async function loadSuggestion(focus = '') {
  const current = ++loadNumber;
  $('patient-summary').replaceChildren(el('p', 'Loading summary…'));
  $('suggestion-output').replaceChildren(el('p', 'Preparing suggestion…'));
  $('prescribe-button').disabled = true;
  $('prescription-result').replaceChildren();
  try {
    const query = focus ? `?focus=${encodeURIComponent(focus)}` : '';
    const response = await fetch(`/api/demo-patients/${encodeURIComponent(selectedPatientId)}/recommendations${query}`);
    if (!response.ok) throw new Error('Could not load this patient summary.');
    const result = await response.json();
    if (current !== loadNumber) return;
    suggestion = result;
    renderSummary(result);
    renderSuggestions(result);
    renderDecision(result);
  } catch (error) {
    if (current !== loadNumber) return;
    $('patient-summary').replaceChildren();
    $('suggestion-output').replaceChildren(notice(error.message, true));
  }
}

async function showConfirmation() {
  if (!selectedPatientId) return;
  setStep(2);
  await loadSuggestion();
}

async function prescribe() {
  if (!suggestion || suggestion.patient.id !== selectedPatientId || suggestion.status !== 'suggestions' ||
      !(suggestion.prescriptionChoices.some((item) => item.id === selectedFormId && item.availability === 'available') ||
        (selectedFormId.startsWith('draft:') && catalogue.some((item) => item.id === selectedFormId.slice(6) && item.previewAvailable)) ||
        (selectedFormId.startsWith('definition:') && definitions.some((item) => item.id === selectedFormId.slice(11) && item.available)))) return;
  $('prescribe-button').disabled = true;
  $('prescription-result').replaceChildren();
  try {
    const isDefinition = selectedFormId.startsWith('definition:');
    const response = await fetch(isDefinition ? `/api/definition-patients/${encodeURIComponent(selectedPatientId)}/prescriptions` :
      `/api/demo-patients/${encodeURIComponent(selectedPatientId)}/prescriptions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ formId: isDefinition ? selectedFormId.slice(11) : selectedFormId }),
    });
    const record = await response.json();
    if (!response.ok) throw new Error(record.error || 'Could not prescribe the test.');
    const card = el('div', undefined, 'prescribed-card');
    const title = record.kind === 'definition' ? definitions.find((item) => item.id === record.formId)?.title || record.formId :
      record.kind === 'draft' ? catalogue.find((item) => item.id === record.formId)?.title || record.formId : record.formId.toUpperCase();
    card.append(el('h3', `${title} assigned`), el('p', record.kind === 'definition' ?
      `${suggestion.patient.label} can complete the assessment by voice conversation or on screen.` : record.kind === 'draft' ?
      `${suggestion.patient.label} can complete the assessment by voice conversation or on screen.` :
      `The assessment is assigned to ${suggestion.patient.label}. Share the assessment link to begin.`));
    const actions = el('div', undefined, 'prescribed-actions');
    const url = new URL(`${record.kind === 'definition' ? '/definition.html' : record.kind === 'draft' ? '/draft-live.html' : '/assessment.html'}?prescriptionId=${encodeURIComponent(record.id)}`, location.href);
    const open = el('a', 'Open patient assessment', 'button primary');
    open.href = url.href;
    const copy = el('button', 'Copy patient link', 'button outline');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url.href); copy.textContent = 'Copied'; }
      catch { copy.textContent = 'Copy unavailable; open the link instead'; }
    });
    actions.append(open, copy);
    card.append(actions);
    $('prescription-result').append(card);
  } catch (error) {
    $('prescription-result').replaceChildren(notice(error.message, true));
    $('prescribe-button').disabled = false;
  }
}

async function loadReports(patientId) {
  const current = ++loadNumber;
  const area = $('report-content');
  if (!patientId) { area.replaceChildren(el('p', 'Choose a patient to view their test reports.', 'empty-state')); return; }
  area.replaceChildren(el('p', 'Loading reports…', 'empty-state'));
  try {
    const [prescriptionsResponse, reportsResponse] = await Promise.all([
      fetch(`/api/demo-patients/${encodeURIComponent(patientId)}/prescriptions`),
      fetch(`/api/demo-patients/${encodeURIComponent(patientId)}/reports`),
    ]);
    if (!prescriptionsResponse.ok || !reportsResponse.ok) throw new Error('Could not load patient reports.');
    const [prescriptions, reports] = await Promise.all([prescriptionsResponse.json(), reportsResponse.json()]);
    if (current !== loadNumber) return;
    const completedDrafts = prescriptions.filter((item) => item.kind === 'draft' && item.status === 'completed');
    const completedDefinitions = prescriptions.filter((item) => item.kind === 'definition' && item.status === 'completed');
    const reportCount = reports.length + completedDrafts.length + completedDefinitions.length;
    area.replaceChildren(el('h2', `${reportCount} assessment report${reportCount === 1 ? '' : 's'}`));
    const list = el('div', undefined, 'report-list');
    for (const report of reports) {
      const row = el('div', undefined, 'report-row');
      const info = el('div');
      info.append(el('strong', `${report.formId.toUpperCase()} · ${report.scores.rawTotal} / ${report.scores.maxTotal || 27}`), el('small', `Completed ${new Date(report.completedAt).toLocaleString()}`));
      const link = el('a', 'View report'); link.href = `/report.html?id=${encodeURIComponent(report.id)}`;
      row.append(info, link); list.append(row);
    }
    for (const record of completedDrafts) {
      const row = el('div', undefined, 'report-row');
      const info = el('div');
      const title = catalogue.find((item) => item.id === record.formId)?.title || record.formId;
      info.append(el('strong', `${title} · ${record.unscored ? 'Answer report · No score' : 'Report'}`), el('small', `Assigned ${new Date(record.createdAt).toLocaleString()}`));
      const link = el('a', 'View report');
      link.href = `/report.html?draftSessionId=${encodeURIComponent(record.assessmentId)}`;
      row.append(info, link); list.append(row);
    }
    for (const record of completedDefinitions) {
      const row = el('div', undefined, 'report-row');
      const info = el('div');
      const title = definitions.find((item) => item.id === record.formId)?.title || record.formId;
      info.append(el('strong', `${title} · Report`), el('small', `Assigned ${new Date(record.createdAt).toLocaleString()}`));
      const link = el('a', 'View report'); link.href = `/report.html?definitionSessionId=${encodeURIComponent(record.assessmentId)}`;
      row.append(info, link); list.append(row);
    }
    for (const record of prescriptions.filter((item) => item.status !== 'completed')) {
      const row = el('div', undefined, 'report-row');
      const info = el('div');
      const title = record.kind === 'definition' ? definitions.find((item) => item.id === record.formId)?.title || record.formId :
        record.kind === 'draft' ? catalogue.find((item) => item.id === record.formId)?.title || record.formId : record.formId.toUpperCase();
      info.append(el('strong', `${title} · ${record.status === 'assigned' ? 'Assigned' : 'In progress'}`), el('small', `Assigned ${new Date(record.createdAt).toLocaleString()}`));
      const link = el('a', 'Open patient assessment');
      link.href = `${record.kind === 'definition' ? '/definition.html' : record.kind === 'draft' ? '/draft-live.html' : '/assessment.html'}?prescriptionId=${encodeURIComponent(record.id)}`;
      row.append(info, link); list.append(row);
    }
    if (list.children.length) area.append(list);
    else area.append(el('p', 'No prescriptions or completed reports for this patient yet.', 'empty-state'));
  } catch (error) {
    if (current === loadNumber) area.replaceChildren(notice(error.message, true));
  }
}

$('nav-prescribe').addEventListener('click', () => setView('prescribe'));
$('nav-reports').addEventListener('click', () => setView('reports'));
$('nav-analytics').addEventListener('click', () => setView('analytics'));
$('patient-search').addEventListener('input', renderPatientList);
$('next-step').addEventListener('click', showConfirmation);
$('back-step').addEventListener('click', () => { ++loadNumber; setStep(1); });
$('assessment-search').addEventListener('focus', () => {
  $('assessment-search').value = '';
  openAssessmentOptions();
});
$('assessment-search').addEventListener('input', () => {
  selectedFormId = '';
  updateSelectedChoice();
  renderAssessmentLibrary();
  openAssessmentOptions($('assessment-search').value);
});
$('assessment-library-search').addEventListener('input', () => { libraryPage = 1; renderAssessmentLibrary(); });
$('assessment-library-suggested').addEventListener('click', () => {
  librarySuggestedOnly = !librarySuggestedOnly;
  if (librarySuggestedOnly) {
    libraryCategory = 'All';
    $('assessment-library-search').value = '';
  }
  libraryPage = 1;
  renderAssessmentLibrary();
});
$('assessment-library-previous').addEventListener('click', () => { libraryPage -= 1; renderAssessmentLibrary(); });
$('assessment-library-next').addEventListener('click', () => { libraryPage += 1; renderAssessmentLibrary(); });
$('assessment-search').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if ($('assessment-options').hidden) openAssessmentOptions();
    highlightAssessment(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Enter' && !$('assessment-options').hidden) {
    event.preventDefault();
    if (highlightedAssessment >= 0) chooseAssessment(assessmentMatches[highlightedAssessment]?.id);
    else if (assessmentMatches.filter((item) => item.enabled).length === 1) {
      chooseAssessment(assessmentMatches.find((item) => item.enabled).id);
    }
  } else if (event.key === 'Escape') {
    closeAssessmentOptions();
    $('assessment-search').value = assessmentChoices().find((item) => item.id === selectedFormId)?.title || '';
  }
});
$('assessment-open').addEventListener('click', () => {
  if ($('assessment-options').hidden) {
    $('assessment-search').value = '';
    openAssessmentOptions();
    $('assessment-search').focus();
  }
  else {
    closeAssessmentOptions();
    $('assessment-search').value = assessmentChoices().find((item) => item.id === selectedFormId)?.title || '';
  }
});
document.addEventListener('pointerdown', (event) => {
  if ($('assessment-combobox').contains(event.target)) return;
  closeAssessmentOptions();
  $('assessment-search').value = assessmentChoices().find((item) => item.id === selectedFormId)?.title || '';
});
window.addEventListener('clinic:select-assessment', (event) => {
  const id = event.detail?.id;
  if (!id || !suggestion || suggestion.status !== 'suggestions') return;
  chooseAssessment(id);
  $('assessment-search').scrollIntoView({ block: 'center', behavior: 'smooth' });
});
$('prescribe-button').addEventListener('click', prescribe);
$('report-patient').addEventListener('change', () => {
  const url = new URL(location.href);
  if ($('report-patient').value) url.searchParams.set('patient', $('report-patient').value);
  else url.searchParams.delete('patient');
  history.replaceState({}, '', url);
  loadReports($('report-patient').value);
});
window.addEventListener('popstate', () => setView(new URL(location.href).searchParams.get('view'), false));

try {
  const [response, catalogueResponse, definitionResponse] = await Promise.all([
    fetch('/api/demo-patients'), fetch('/api/assessment-library'), fetch('/api/definitions'),
  ]);
  if (!response.ok || !catalogueResponse.ok || !definitionResponse.ok) throw new Error('Could not load the patient or assessment list.');
  patients.push(...await response.json());
  catalogue.push(...await catalogueResponse.json());
  definitions.push(...await definitionResponse.json());
  for (const patient of patients) {
    const option = el('option', patient.label); option.value = patient.id; $('report-patient').append(option);
  }
  renderPatientList();
  const query = new URL(location.href).searchParams;
  const patientId = query.get('patient');
  if (patients.some((item) => item.id === patientId)) $('report-patient').value = patientId;
  setView(query.get('view'), false);
} catch (error) {
  $('patient-list').replaceChildren(notice(error.message, true));
  $('report-content').replaceChildren(notice(error.message, true));
}
