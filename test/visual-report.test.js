import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDefinitionReport, definitionReportHtml, withActiveReportVisualSpec } from '../src/definition-report.js';
import { sampleState } from '../src/assessment-review.js';
import { openReportVisualSpecStore } from '../src/report-visual-spec-store.js';
import { scoreDefinition } from '../src/definition-scoring.js';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const library = read('../local-data/assessment-reports-all/assessment-library.json');
const sourceSpec = read('../data/report-profiles/ais-report-visual-spec.json');
const risSpec = read('../data/report-profiles/ris-report-visual-spec.json');
const dass21Spec = read('../data/report-profiles/dass21-report-visual-spec.json');
const allSpecs = read('../data/report-profiles/all-assessment-report-visual-specs.json');
const ais = structuredClone(library.records.find(record => record.id === sourceSpec.assessmentId));
ais.reporting.reportVisualSpec = { ...sourceSpec,
  visualSpecVersionId: 'visual_test', assessmentVersionId: ais.versionId };

test('application-owned AIS visual configuration contains no external URLs or extraction paths', () => {
  assert.doesNotMatch(JSON.stringify(sourceSpec),
    /https?:\/\/|\/home\/|assessment-url-preview|assessment-exports\/|artifacts\/batches\//i);
});

test('the self-contained visual bundle covers every assessment without source URLs or paths', () => {
  assert.equal(allSpecs.schemaVersion, 'report-visual-spec-bundle/1.0.0');
  assert.equal(allSpecs.assessmentCount, 186);
  assert.equal(allSpecs.assessments.length, library.records.length);
  assert.equal(new Set(allSpecs.assessments.map(spec => spec.assessmentId)).size, 186);
  assert.deepEqual(new Set(allSpecs.assessments.map(spec => spec.assessmentId)),
    new Set(library.records.map(record => record.id)));
  assert.doesNotMatch(JSON.stringify(allSpecs),
    /https?:\/\/|\/home\/|assessment-url-preview|assessment-exports\/|artifacts\/batches\//i);
});

test('a compiled GAD-7 specification renders its database-driven score graph', () => {
  const gadSpec = allSpecs.assessments.find(spec =>
    spec.assessmentId.startsWith('generalised-anxiety-disorder-assessment-gad-7--'));
  const gad = structuredClone(library.records.find(record => record.id === gadSpec.assessmentId));
  gad.reporting.reportVisualSpec = { ...gadSpec,
    visualSpecVersionId: 'visual_gad_test', assessmentVersionId: gad.versionId };
  const report = buildDefinitionReport(sampleState(gad, 'mixed'));
  assert.equal(report.visualSpec.layoutTemplate, 'generic_assessment');
  assert.equal(report.visualSpec.activeVariant.id, 'first_administration');
  const html = definitionReportHtml(report);
  assert.match(html, /Generalised Anxiety Disorder/);
  assert.match(html, /data-chart="chart_total_raw_first"/);
  assert.match(html, /Client Responses/);
  assert.doesNotMatch(html, /novopsych|https?:\/\//i);
});

test('RIS renders its derived total, clinical percentile, factor table and four-page layout', () => {
  const ris = structuredClone(library.records.find(record => record.id === risSpec.assessmentId));
  ris.reporting.reportVisualSpec = { ...risSpec,
    visualSpecVersionId: 'visual_ris_test', assessmentVersionId: ris.versionId };
  const state = sampleState(ris, 'mixed');
  state.patientDetails = { name: 'Example Patient', age: 34 };
  const report = buildDefinitionReport(state);
  const values = Object.fromEntries(report.visualSpec.metrics.map(metric => [metric.id, metric.value]));
  assert.ok(Number.isFinite(values.metric_total));
  assert.ok(Number.isFinite(values.metric_total_average));
  assert.ok(Number.isFinite(values.metric_clinical_percentile));
  assert.equal(report.visualSpec.activeVariant.id, 'first_administration');
  const html = definitionReportHtml(report);
  assert.equal((html.match(/class="report-page ris-page"/g) || []).length, 4);
  assert.match(html, /data-chart="chart_clinical_percentile"/);
  assert.match(html, /data-chart="chart_average_scores"/);
  assert.match(html, /Insomnia Cutoff\?/);
  assert.match(html, /Example Patient/);
  assert.doesNotMatch(html, /novopsych|https?:\/\//i);
});

test('DASS-21 renders the source-specific five-page first-administration layout', () => {
  const dass21 = structuredClone(library.records.find(record => record.id === dass21Spec.assessmentId));
  dass21.reporting.reportVisualSpec = { ...dass21Spec,
    visualSpecVersionId: 'visual_dass21_test', assessmentVersionId: dass21.versionId };
  const state = sampleState(dass21, 'mixed');
  state.patientDetails = { name: 'Example Patient', age: 34 };
  const report = buildDefinitionReport(state);
  const values = Object.fromEntries(report.visualSpec.metrics.map(metric => [metric.id, metric.value]));
  assert.ok(Number.isFinite(values.metric_total_raw));
  assert.ok(Number.isFinite(values.metric_total_percentile));
  assert.ok(Number.isFinite(values.metric_depression_percentile));
  assert.equal(report.visualSpec.activeVariant.id, 'first_administration');
  const html = definitionReportHtml(report);
  assert.equal((html.match(/class="report-page dass-page"/g) || []).length, 5);
  assert.match(html, /data-chart="chart_percentiles_first"/);
  assert.doesNotMatch(html, /data-chart="chart_total_raw_first"/);
  assert.match(html, /Total Distress/);
  assert.match(html, /Example Patient/);
  assert.doesNotMatch(html, /novopsych|https?:\/\//i);
});

test('DASS-21 reproduces the supplied report benchmark scores and percentiles', () => {
  const dass21 = structuredClone(library.records.find(record => record.id === dass21Spec.assessmentId));
  dass21.reporting.reportVisualSpec = { ...dass21Spec,
    visualSpecVersionId: 'visual_dass21_benchmark', assessmentVersionId: dass21.versionId };
  const state = sampleState(dass21, 'first');
  state.answers = Object.fromEntries(dass21.questions.map(question => [question.id, 'O1']));
  Object.assign(state.answers, { Q1: 'O4', Q6: 'O2', Q2: 'O4', Q4: 'O2', Q3: 'O4', Q5: 'O4' });
  state.scores = scoreDefinition(dass21, state.answers, state.context, { draftScores: true });
  const report = buildDefinitionReport(state);
  const values = Object.fromEntries(report.visualSpec.metrics.map(metric => [metric.id, metric.value]));
  assert.deepEqual({
    total: values.metric_total_raw,
    depression: values.metric_depression_raw,
    anxiety: values.metric_anxiety_raw,
    stress: values.metric_stress_raw,
    totalPercentile: values.metric_total_percentile,
    depressionPercentile: values.metric_depression_percentile,
    anxietyPercentile: values.metric_anxiety_percentile,
    stressPercentile: values.metric_stress_percentile,
  }, { total: 14, depression: 6, anxiety: 4, stress: 4,
    totalPercentile: 68, depressionPercentile: 85, anxietyPercentile: 83, stressPercentile: 44 });
});

test('AIS source visual spec renders the four-page first-administration report', () => {
  const report = buildDefinitionReport(sampleState(ais, 'mixed'));
  const values = Object.fromEntries(report.visualSpec.metrics.map(metric => [metric.id, metric.value]));
  assert.deepEqual(values, {
    metric_total: 12,
    metric_sleep_difficulty: 1.2,
    metric_daytime_consequences: 2,
  });
  assert.equal(report.visualSpec.activeVariant.id, 'first_administration');
  const html = definitionReportHtml(report);
  assert.equal((html.match(/class="report-page"/g) || []).length, 4);
  assert.match(html, /data-chart="chart_total_first"/);
  assert.match(html, /data-chart="chart_domains_first"/);
  assert.match(html, /data-chart="chart_total_first" style="width:285pt"/);
  assert.match(html, /data-chart="chart_domains_first" style="width:366pt"/);
  assert.match(html, /Highly elevated/);
  assert.match(html, /Page 4 of 4/);
  assert.doesNotMatch(html, /novopsych|https?:\/\//i);
});

test('AIS repeat administration replaces both bar charts with dated trajectories', () => {
  const states = [sampleState(ais, 'first', 0), sampleState(ais, 'last', 1), sampleState(ais, 'mixed', 2)];
  const report = buildDefinitionReport(states[2], states.slice(0, 2));
  assert.equal(report.visualSpec.activeVariant.id, 'repeat_administration');
  const html = definitionReportHtml(report);
  assert.match(html, /data-chart="chart_total_history"/);
  assert.match(html, /data-chart="chart_domains_history"/);
  assert.doesNotMatch(html, /data-chart="chart_total_first"/);
  assert.match(html, /raw-score difference/);
});

test('a compatible saved AIS session can receive the active versioned visual spec at report time', () => {
  const saved = sampleState(structuredClone(ais), 'mixed');
  delete saved.formSnapshot.reporting.reportVisualSpec;
  const enriched = withActiveReportVisualSpec(saved, ais);
  assert.equal(saved.formSnapshot.reporting.reportVisualSpec, undefined);
  assert.equal(enriched.formSnapshot.reporting.reportVisualSpec.visualSpecVersionId, 'visual_test');
  const report = buildDefinitionReport(enriched);
  assert.equal(report.visualSpec.activeVariant.id, 'first_administration');
});

test('a compatible saved session replaces a stale visual spec with the active database version', () => {
  const saved = sampleState(structuredClone(ais), 'mixed');
  saved.formSnapshot.reporting.reportVisualSpec = {
    ...saved.formSnapshot.reporting.reportVisualSpec,
    visualSpecVersionId: 'visual_stale',
    layoutTemplate: 'generic_assessment',
  };
  const enriched = withActiveReportVisualSpec(saved, ais);
  assert.equal(saved.formSnapshot.reporting.reportVisualSpec.visualSpecVersionId, 'visual_stale');
  assert.equal(enriched.formSnapshot.reporting.reportVisualSpec.visualSpecVersionId, 'visual_test');
  assert.equal(enriched.formSnapshot.reporting.reportVisualSpec.layoutTemplate, sourceSpec.layoutTemplate);
});

test('visual spec store keeps immutable source and runtime documents separate', async () => {
  const store = openReportVisualSpecStore({ path: ':memory:' });
  await store.initialize();
  const record = {
    id: 'visual_test', assessmentId: sourceSpec.assessmentId,
    assessmentVersionId: ais.versionId, schemaVersion: sourceSpec.schemaVersion,
    contentHash: 'a'.repeat(64), status: sourceSpec.status, clinicalApproved: false,
    sourceSpec, runtimeSpec: ais.reporting.reportVisualSpec, validation: sourceSpec.validation,
  };
  assert.deepEqual(await store.importSpecs({ importHash: 'b'.repeat(64), manifest: {}, records: [record] }),
    { added: 1, unchanged: 0, active: 1 });
  const active = await store.activeSpecs();
  assert.equal(active[0].runtimeSpec.visualSpecVersionId, 'visual_test');
  assert.equal((await store.readiness()).summary.assessments, 1);
  await store.close();
});
