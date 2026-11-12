// Clinician-reviewed routing aid. Keep this independent of Gemini and patient identifiers.
export const recommendationSources = Object.freeze({
  depression: 'https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/screening-depression-suicide-risk-adults',
  anxiety: 'https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/anxiety-adults-screening',
  ptsd: 'https://www.ptsd.va.gov/Professional/Assessment/Adult-Sr/Ptsd-Checklist.Asp',
  dass: 'https://dass.psy.unsw.edu.au/DASSFAQ.htm',
});

const allowedConcerns = new Set(['depression', 'anxiety', 'traumaSymptoms', 'stress']);
const ageGroups = new Set(['under19', '19to64', '65plus', 'unknown']);
const traumaExposure = new Set(['confirmed', 'uncertain', 'notReported']);
const safetyStatuses = new Set(['notReviewed', 'noneReported', 'concern']);
const allowedKeys = new Set(['ageGroup', 'concerns', 'traumaExposure', 'safetyStatus']);

export function validateRecommendationContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Provide a structured patient context.');
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new Error('Only de-identified structured fields are accepted. Remove names, IDs, dates, and notes.');
  if (!ageGroups.has(value.ageGroup)) throw new Error('Select an age group.');
  if (!Array.isArray(value.concerns) || value.concerns.some((item) => !allowedConcerns.has(item)) || new Set(value.concerns).size !== value.concerns.length) throw new Error('Choose valid concerns.');
  if (!traumaExposure.has(value.traumaExposure)) throw new Error('Select a trauma exposure status.');
  if (!safetyStatuses.has(value.safetyStatus)) throw new Error('Select a safety review status.');
  return {
    ageGroup: value.ageGroup,
    concerns: value.concerns,
    traumaExposure: value.traumaExposure,
    safetyStatus: value.safetyStatus,
  };
}

export function recommendAssessments(input) {
  const context = validateRecommendationContext(input);
  const concerns = new Set(context.concerns);
  if (context.safetyStatus === 'concern') return {
    status: 'safety_review',
    message: 'Immediate clinician safety review is needed. Follow your local urgent assessment protocol before choosing a questionnaire.',
    recommendations: [],
  };
  if (context.safetyStatus === 'notReviewed') return {
    status: 'needs_review',
    message: 'Review immediate safety concerns before selecting a questionnaire.',
    recommendations: [],
  };
  if (context.ageGroup === 'under19' || context.ageGroup === 'unknown') return {
    status: 'needs_review',
    message: context.ageGroup === 'under19'
      ? 'These routing rules cover adults only. Use an age-appropriate assessment pathway.'
      : 'Confirm that the patient is an adult before using these recommendations.',
    recommendations: [],
  };

  const recommendations = [];
  const add = (id, title, priority, reason, source, availability, note = '') => recommendations.push({
    id, title, priority, reason, source, availability, note,
  });

  if (concerns.has('depression')) add('phq9', 'PHQ-9', 1,
    'Depressive symptoms or low mood were selected. PHQ-9 measures recent depression symptoms and can support clinician follow-up.',
    recommendationSources.depression, 'available');
  if (concerns.has('anxiety')) add('gad7', 'GAD-7', 1,
    'Anxiety or persistent worry was selected. GAD-7 focuses on generalized anxiety symptoms.',
    recommendationSources.anxiety, 'not_implemented',
    context.ageGroup === '65plus' ? 'Routine anxiety screening evidence is insufficient for adults 65 or older; clinician judgment is needed.' : '');
  if (concerns.has('traumaSymptoms') && context.traumaExposure === 'confirmed') add('pcl5', 'PCL-5', 1,
    'Trauma-related symptoms and a clinician-confirmed qualifying trauma exposure were selected. PCL-5 measures PTSD symptoms.',
    recommendationSources.ptsd, 'not_implemented', 'Use a specific index event and clinician interpretation.');
  if (concerns.has('traumaSymptoms') && context.traumaExposure !== 'confirmed') add('pcl5', 'PCL-5', 3,
    'Trauma-related symptoms were selected, but qualifying exposure has not been confirmed. Review the trauma history before using PCL-5.',
    recommendationSources.ptsd, 'requires_trauma_review');
  if (concerns.has('stress') || (concerns.has('depression') && concerns.has('anxiety'))) add('dass21', 'DASS-21', 2,
    'Stress or overlapping depression and anxiety concerns were selected. DASS-21 measures three symptom dimensions over the past week.',
    recommendationSources.dass, 'separate_prototype', 'DASS-21 is not a diagnostic instrument.');

  if (!recommendations.length) {
    add('phq9', 'PHQ-9', 2, 'No specific concern was selected. Adult depression screening can be considered with a plan for follow-up.',
      recommendationSources.depression, 'available');
    if (context.ageGroup === '19to64') add('gad7', 'GAD-7', 2,
      'No specific concern was selected. Adult anxiety screening can be considered with a plan for follow-up.',
      recommendationSources.anxiety, 'not_implemented');
  }

  recommendations.sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title));
  return {
    status: 'suggestions',
    message: 'Suggested for clinician review. These questionnaires screen or measure symptoms; they do not establish a diagnosis or assign a test automatically.',
    recommendations,
  };
}
