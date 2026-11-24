import test from 'node:test';
import assert from 'node:assert/strict';
import { openReportProfileStore } from '../src/report-profile-store.js';

const record = {
  id: 'report_test', assessmentId: 'assessment-test', assessmentVersionId: 'definition-test',
  profileVersion: '1.0.0-review.1', scoringHash: 'a'.repeat(64), contentHash: 'b'.repeat(64),
  rendererVersion: 'analysis-report-2', status: 'source_defined_draft', clinicalApproved: false,
  sourceProfile: { assessmentId: 'assessment-test', sampleAnswers: { Q1: 'O1' } },
  runtimeProfile: { assessmentId: 'assessment-test', scoringHash: 'a'.repeat(64),
    layout: { sourcePageCount: 2 } },
  validation: { sampleAvailability: 'readable_pdf', sourceComparison: 'partially_compared',
    questions: 2, recoveredAnswers: 1, metrics: 1, matchedMetrics: 1, differences: 0,
    availableGraphs: 1, missingGraphs: 1, fullEquivalence: false, clinicalApproved: false },
};

test('stores immutable report profiles and exposes readiness exceptions', async () => {
  const store = openReportProfileStore({ path: ':memory:' });
  await store.initialize();
  assert.deepEqual(await store.importProfiles({ importHash: 'c'.repeat(64), manifest: {}, records: [record] }),
    { added: 1, unchanged: 0, active: 1 });
  assert.equal((await store.activeProfiles())[0].runtimeProfile.layout.sourcePageCount, 2);
  const readiness = await store.readiness();
  assert.equal(readiness.summary.assessments, 1);
  assert.deepEqual(readiness.assessments[0].exceptions, [
    'sample_answers_incomplete', 'source_graph_configuration_incomplete',
    'full_report_equivalence_not_verified', 'clinical_approval_pending',
  ]);
  await store.close();
});
