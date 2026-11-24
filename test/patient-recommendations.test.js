import test from 'node:test';
import assert from 'node:assert/strict';
import { openPatientRecommendationService } from '../src/patient-recommendations.js';

const patient = {
  id: '594141ee-c454-4457-96d5-c61edb77288d',
  label: 'John Doe',
  summary: {
    ageGroup: '19to64', safetyStatus: 'notReviewed',
    observations: [
      { code: 'sleepDisruption', featureCode: 'sleep_disruption', status: 'current',
        description: 'Sleep fragmentation', evidenceText: 'Sleep fragmentation', source: 'clinical.sleep[0]' },
      { code: 'sleepDisruption', featureCode: 'sleep_disruption', status: 'current',
        description: 'Occasional delayed sleep onset', evidenceText: 'Occasional delayed sleep onset', source: 'clinical.sleep[1]' },
    ],
  },
};

test('ranks database assessments and returns patient-history evidence', async () => {
  const pool = { query: async (_sql, values) => {
    assert.deepEqual(values, [['sleep_disruption']]);
    return { rows: [{
      assessment_id: 'athens-insomnia-scale-ais--456d2e3fe9f5', indication_code: 'sleep_disruption', rank: 1,
      rationale: 'History documents insomnia symptoms.', title: 'Athens Insomnia Scale (AIS)',
      runtime: { description: 'Adult insomnia severity measure.', questions: Array(8).fill({}),
        referencePeriod: { instruction_claims: ['last month'] }, versionId: 'version-1', clinicallyApproved: false },
    }] };
  } };
  const result = await openPatientRecommendationService(pool).suggest(patient);
  assert.equal(result.status, 'suggestions');
  assert.equal(result.primaryAssessmentId, 'athens-insomnia-scale-ais--456d2e3fe9f5');
  assert.equal(result.recommendations[0].evidence.length, 2);
  assert.equal(result.recommendations[0].clinicallyApproved, false);
  assert.match(result.recommendations[0].note, /review draft/i);
});

test('does not infer an assessment when no current mapped feature exists', async () => {
  const result = await openPatientRecommendationService({ query: async () => assert.fail('database should not be queried') })
    .suggest({ ...patient, summary: { ...patient.summary, observations: [
      { code: 'stressMonitoring', status: 'monitoring', description: 'Monitor stress', source: 'clinical.priority' },
    ] } });
  assert.equal(result.status, 'no_match');
  assert.deepEqual(result.recommendations, []);
});
