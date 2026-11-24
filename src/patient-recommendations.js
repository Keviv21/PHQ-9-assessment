const schema = 'pod_assessment_prototype';

const featureForObservation = Object.freeze({
  sleepDisruption: 'sleep_disruption',
});

function evidenceFor(patient, featureCode) {
  return patient.summary.observations
    .filter((item) => item.status === 'current' &&
      (item.featureCode || featureForObservation[item.code]) === featureCode)
    .map(({ description, source, evidenceText }) => ({ description, source, evidenceText }));
}

export function openPatientRecommendationService(pool) {
  return {
    async suggest(patient) {
      const featureCodes = [...new Set(patient.summary.observations
        .filter((item) => item.status === 'current')
        .map((item) => item.featureCode || featureForObservation[item.code])
        .filter(Boolean))];
      if (!featureCodes.length) return {
        patient,
        context: { ageGroup: patient.summary.ageGroup, safetyStatus: patient.summary.safetyStatus, features: [] },
        status: 'no_match',
        message: 'No assessment indication is mapped to a current finding in this patient history.',
        primaryAssessmentId: null,
        recommendations: [],
        prescriptionChoices: [],
        ignoredObservations: patient.summary.observations.map(({ description, source, status }) => ({
          description, source, reason: status === 'current'
            ? 'No active database indication mapping matches this finding.'
            : 'This is monitoring or historical context, not a current finding.',
        })),
      };

      const { rows } = await pool.query(`SELECT i.assessment_id, i.indication_code, i.rank,
          i.rationale, a.title, v.runtime
        FROM ${schema}.assessment_indications i
        JOIN ${schema}.assessment_library a ON a.id = i.assessment_id
        JOIN ${schema}.assessment_versions v ON v.id = a.active_version_id
        WHERE i.active AND i.match_status = 'current' AND i.indication_code = ANY($1::text[])
        ORDER BY i.rank, a.title`, [featureCodes]);

      const recommendations = rows.map((row) => {
        const definition = row.runtime;
        const evidence = evidenceFor(patient, row.indication_code);
        return {
          id: row.assessment_id,
          title: row.title,
          purpose: definition.description,
          availability: definition.questions?.length ? 'available' : 'unavailable',
          reason: row.rationale,
          matchedFeatures: [row.indication_code],
          evidence,
          note: 'This definition is a review draft. Its questionnaire and scoring require independent clinical approval before production clinical use.',
          source: `/api/definitions/${encodeURIComponent(row.assessment_id)}`,
          questionCount: definition.questions?.length ?? 0,
          referencePeriod: definition.referencePeriod,
          definitionVersionId: definition.versionId,
          clinicallyApproved: definition.clinicallyApproved === true,
        };
      });
      const primary = recommendations.find((item) => item.availability === 'available') || null;
      const prescriptionChoices = recommendations.map((item) => ({
        id: item.id,
        title: item.title,
        priority: rows.find((row) => row.assessment_id === item.id)?.rank ?? 99,
        availability: item.availability,
        reason: item.reason,
        questionCount: item.questionCount,
        referencePeriod: item.referencePeriod,
        selectionBasis: 'patient_history_database_match',
        evidence: item.evidence,
        note: item.note,
      }));
      return {
        patient,
        context: { ageGroup: patient.summary.ageGroup, safetyStatus: patient.summary.safetyStatus, features: featureCodes },
        status: recommendations.length ? 'suggestions' : 'no_match',
        message: recommendations.length
          ? 'Assessment suggestions are matched to current findings in the patient history stored in PostgreSQL.'
          : 'No assessment indication is mapped to a current finding in this patient history.',
        primaryAssessmentId: primary?.id || null,
        recommendations,
        prescriptionChoices,
        clarification: { focus: '', question: null },
        ignoredObservations: patient.summary.observations
          .filter((item) => item.status !== 'current' || !featureCodes.includes(item.featureCode || featureForObservation[item.code]))
          .map(({ description, source, status }) => ({
            description, source, reason: status === 'current'
              ? 'No active database indication mapping matches this finding.'
              : 'This is monitoring or historical context, not a current finding.',
          })),
      };
    },
  };
}
