import { readFileSync } from 'node:fs';
import { recommendAssessments } from './recommendation.js';
import { getCatalogEntry } from './assessment-catalog.js';
import { getAssessmentForm } from './forms.js';

// Synthetic, de-identified summaries. No clinical text from the supplied Digital Twin report is copied here.
const patients = JSON.parse(readFileSync(new URL('../data/demo-patients.json', import.meta.url), 'utf8'));
const concernForCode = Object.freeze({
  lowMood: 'depression', lossOfInterest: 'depression', persistentWorry: 'anxiety',
  traumaIntrusions: 'traumaSymptoms', highStress: 'stress',
});
const observationCodes = new Set([...Object.keys(concernForCode), 'ictalFear', 'sleepDisruption']);

if (new Set(patients.map((patient) => patient.id)).size !== patients.length ||
    patients.some((patient) => !/^demo-[a-z]$/.test(patient.id) || !patient.label || !patient.summary?.overview ||
      !['under19', '19to64', '65plus', 'unknown'].includes(patient.summary.ageGroup) ||
      !['notReported', 'uncertain', 'confirmed'].includes(patient.summary.traumaExposure) ||
      !['notReviewed', 'noneReported', 'concern'].includes(patient.summary.safetyStatus) ||
      !Array.isArray(patient.summary.observations) || patient.summary.observations.some((item) =>
        !observationCodes.has(item.code) || !['current', 'historical'].includes(item.status) ||
        !item.description || !item.source))) {
  throw new Error('Demo patient summaries are invalid.');
}

export function listDemoPatients() {
  return patients.map(({ id, label }) => ({ id, label }));
}

export function getDemoPatient(id) {
  const patient = patients.find((entry) => entry.id === id);
  return patient ? structuredClone(patient) : null;
}

const runnableFormIds = ['phq9', 'gad7', 'pcl5'];

export function suggestForDemoPatient(id, focus = '') {
  const patient = getDemoPatient(id);
  if (!patient) return null;
  const current = patient.summary.observations.filter((item) => item.status === 'current');
  const concerns = [...new Set(current.map((item) => concernForCode[item.code]).filter(Boolean))];
  const context = {
    ageGroup: patient.summary.ageGroup,
    concerns,
    traumaExposure: patient.summary.traumaExposure,
    safetyStatus: patient.summary.safetyStatus,
  };
  if (typeof focus !== 'string' || (focus && !concerns.includes(focus))) {
    throw new RangeError('Choose a current concern from this patient summary.');
  }
  const result = recommendAssessments(context);
  const recommendations = result.recommendations.map((item) => ({
    ...item,
    evidence: current.filter((observation) => item.matchedConcerns.includes(concernForCode[observation.code]))
      .map(({ description, source }) => ({ description, source })),
  }));
  const primary = recommendations.find((item) => item.availability === 'available') || null;
  const prescriptionChoices = result.status === 'suggestions' ? runnableFormIds.map((id) => {
    const entry = getCatalogEntry(id);
    const form = getAssessmentForm(id, 'en');
    const match = recommendations.find((item) => item.id === id);
    const traumaReady = id !== 'pcl5' || (match?.availability === 'available' && context.traumaExposure === 'confirmed');
    const availability = traumaReady ? 'available' : 'requires_trauma_review';
    const priority = availability !== 'available' ? 4 : match ? (focus && !entry.concerns.includes(focus) ? 2 : 1) : 3;
    const reason = match?.reason || (id === 'pcl5'
      ? 'PCL-5 needs a documented current trauma-related concern and confirmed qualifying exposure before it can be selected.'
      : 'No matching current concern appears in the summary. The clinician may still choose this test if appropriate.');
    return {
      id, title: entry.title, priority, availability, reason,
      questionCount: form.questions.length, referencePeriod: form.referencePeriod,
      selectionBasis: match ? 'summary_match' : 'clinician_option',
      evidence: match?.evidence || [],
      note: match?.note || entry.ageCaveats?.[context.ageGroup] || '',
    };
  }).sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title)) : [];
  const clarificationQuestion = result.status === 'suggestions' && concerns.length > 1 ? {
    prompt: 'Which documented current concern is the priority for this assessment?',
    options: concerns.map((concern) => ({ value: concern, label: {
      depression: 'Low mood or reduced interest', anxiety: 'Worry or anxiety',
      traumaSymptoms: 'Trauma-related symptoms', stress: 'Stress',
    }[concern] })),
  } : null;
  const ignoredObservations = patient.summary.observations
    .filter((item) => item.status !== 'current' || !concernForCode[item.code])
    .map(({ description, source, status }) => ({
      description, source,
      reason: status === 'historical' ? 'Historical; not treated as a current concern.' : 'No reviewed assessment mapping for this observation.',
    }));
  return {
    patient,
    context,
    status: result.status,
    message: result.message,
    primaryAssessmentId: primary?.id || null,
    recommendations,
    prescriptionChoices,
    clarification: { focus, question: clarificationQuestion },
    ignoredObservations,
  };
}
