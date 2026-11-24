import { getCatalogEntry, retrieveAssessmentCandidates } from './assessment-catalog.js';

export const recommendationSources = Object.freeze({
  depression: getCatalogEntry('phq9').source,
  anxiety: getCatalogEntry('gad7').source,
  ptsd: getCatalogEntry('pcl5').source,
  dass: getCatalogEntry('dass21').source,
});

// IDs point to the supplied 186-item draft export. The draft questions/scoring are not used here.
export const catalogDraftIds = Object.freeze({
  phq9: getCatalogEntry('phq9').catalogDraftId,
  gad7: getCatalogEntry('gad7').catalogDraftId,
  pcl5: getCatalogEntry('pcl5').catalogDraftId,
  dass21: getCatalogEntry('dass21').catalogDraftId,
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

  const recommendations = retrieveAssessmentCandidates(context.concerns, context.ageGroup).map((entry) => {
    const missingInformation = [];
    let availability = entry.availability;
    let priority = entry.preventive ? 2 : entry.priority;
    let note = entry.note || '';
    let reason = entry.preventive ? entry.preventiveReason : entry.reason;
    if (entry.requiresConfirmedTraumaExposure && context.traumaExposure !== 'confirmed') {
      availability = 'requires_trauma_review';
      priority = 3;
      reason = 'Current trauma-related symptoms match PCL-5, but qualifying trauma exposure and an index event must be confirmed first.';
      missingInformation.push('Clinician confirmation of qualifying trauma exposure and an index event.');
    }
    if (entry.ageCaveats?.[context.ageGroup]) note = [note, entry.ageCaveats[context.ageGroup]].filter(Boolean).join(' ');
    return {
      id: entry.id, title: entry.title, purpose: entry.purpose, priority,
      reason,
      source: entry.source, availability, note, catalogDraftId: entry.catalogDraftId,
      matchedConcerns: entry.matchedConcerns, missingInformation, languages: entry.languages,
      metadataStatus: 'prototype_curated',
    };
  });
  recommendations.sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title));
  return {
    status: 'suggestions',
    message: 'Suggested assessments based on the current patient summary. Select a test to assign.',
    recommendations,
  };
}
