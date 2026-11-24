// Offline preparation only. This module never opens a database or reads environment files.
import { contentHash, scoringRuntimeHash } from './assessment-content.js';
import { conditionState, scoreDefinition, validateAnswer } from './definition-scoring.js';
import { buildDefinitionReport } from './definition-report.js';

export const reviewSchemaVersion = 1;
const finite = Number.isFinite;
const methods = new Set(['sum', 'weighted_sum', 'mean', 'count_threshold']);
export function prepareReportDefinition(original) {
  const d = structuredClone(original);
  const metrics = d.reporting.metrics.map(m => ({
    id: m.rule_id, label: m.label, unit: m.axis_unit || 'score',
    minimum: m.minimum, maximum: m.maximum,
    ruleRef: `/rules/${d.rules.findIndex(r => r.id === m.rule_id)}`,
    favourableDirection: null, interpretationEnabled: false,
  }));
  const plottable = metrics.filter(m => finite(m.minimum) && finite(m.maximum) && m.maximum > m.minimum);
  const withheld = [
    { feature: 'normative_percentiles', reason: 'No approved population-matched lookup has been selected for this report.' },
    { feature: 'population_distributions', reason: 'Source graph equivalence and underlying distributions require individual review.' },
    { feature: 'severity_interpretation', reason: 'Extracted thresholds require clinical review before activation.' },
    { feature: 'reliable_change', reason: 'No approved instrument-specific reliable-change parameters.' },
  ];
  if (d.reporting.paired_profile) withheld.push({ feature: 'paired_profile', reason: 'Requires verified pairing and compatible administrations.' });
  if (d.reporting.mode === 'screening_protocol') withheld.push({ feature: 'screening_protocol_result', reason: 'Responses can be displayed; the clinical decision protocol is not approved.' });
  const sourceBands = d.rules.filter(r => r.severity_bands?.length).map(r => ({ ruleId: r.id, bands: r.severity_bands, enabled: false }));
  d.reporting.reportPlan = {
    schemaVersion: reviewSchemaVersion, version: '1.0.0-review.1', assessmentId: d.id,
    status: 'local_review_only', clinicalApproved: false, sourceReportEquivalence: 'not_verified',
    scoringHash: scoringRuntimeHash(d), mode: d.reporting.mode,
    metrics,
    charts: plottable.flatMap(m => [
      { id: `${m.id}:current`, kind: 'range_bar', metricId: m.id, title: m.label, unit: m.unit, minimum: m.minimum, maximum: m.maximum, source: 'saved_metric', missingValue: 'withhold', colour: 'neutral' },
      { id: `${m.id}:history`, kind: 'visit_trend', metricId: m.id, title: `${m.label} over time`, unit: m.unit, minimum: m.minimum, maximum: m.maximum, source: 'compatible_saved_metrics', minimumVisits: 2, missingValue: 'gap', colour: 'neutral' },
    ]),
    sections: ['assessment_summary', 'saved_results', 'charts', 'responses', 'limitations'],
    comparison: { identity: ['patient', 'assessment', 'definitionVersion', 'scoringHash', 'language', 'context', 'engineVersion'], change: 'current_minus_reference', clinicalMeaning: 'not_inferred', crossAssessmentComparison: false },
    candidateSeverityBands: sourceBands,
    supplementaryProfile: d.reporting.visualProfile ? { enabled: false, reason: 'Existing PHQ-9 research comparison uses different norms from the supplied sample; pending explicit reference selection.', profile: d.reporting.visualProfile } : null,
    withheld,
  };
  return d;
}

export function validateReportDefinition(d) {
  const errors = [];
  const p = d.reporting?.reportPlan;
  if (!p || p.schemaVersion !== reviewSchemaVersion || p.assessmentId !== d.id) return ['Missing or incompatible report plan.'];
  if (d.runtimeHash !== scoringRuntimeHash(d) || p.scoringHash !== d.runtimeHash) errors.push('Scoring fingerprint mismatch.');
  if (d.clinicallyApproved || p.clinicalApproved || p.status !== 'local_review_only') errors.push('Review package must not enable clinical use.');
  const questionIds = new Set(d.questions.map(q => q.id)), ruleIds = new Set(d.rules.map(r => r.id));
  if (questionIds.size !== d.questions.length || ruleIds.size !== d.rules.length) errors.push('Duplicate question or rule identity.');
  for (const r of d.rules) {
    if (!methods.has(r.method) || r.item_ids.some(id => !questionIds.has(id))) errors.push(`Unsupported rule or item membership: ${r.id}`);
    if (!finite(r.minimum) || !finite(r.maximum) || r.minimum > r.maximum) errors.push(`Invalid rule bounds: ${r.id}`);
  }
  if (new Set(p.charts.map(c => c.id)).size !== p.charts.length) errors.push('Duplicate chart identity.');
  if (new Set(p.metrics.map(m => m.id)).size !== p.metrics.length || p.metrics.length !== d.rules.length) errors.push('Metric coverage mismatch.');
  for (const m of p.metrics) {
    const r = d.rules.find(r => r.id === m.id);
    if (!r || m.minimum !== r.minimum || m.maximum !== r.maximum) errors.push(`Metric/rule mismatch: ${m.id}`);
  }
  for (const c of p.charts) {
    const m = p.metrics.find(m => m.id === c.metricId);
    if (!m || !['range_bar', 'visit_trend'].includes(c.kind) || c.minimum !== m.minimum || c.maximum !== m.maximum || c.unit !== m.unit) errors.push(`Invalid chart: ${c.id}`);
  }
  return errors;
}

export function sampleAnswers(d, variant = 'mixed', contextOverride = {}) {
  // These are synthetic valid input choices, NOT independently validated clinical cases.
  const context = Object.fromEntries((d.reporting.required_context || []).map(c => [c.key, c.type === 'boolean' ? true : c.allowed_values?.[0]]));
  Object.assign(context, contextOverride);
  const answers = {};
  for (let pass = 0; pass < d.questions.length + 1; pass++) {
    let changed = false;
    for (const [i, q] of d.questions.entries()) {
      if (Object.hasOwn(answers, q.id) || conditionState(q.displayIf, answers, d.questions, context) !== true) continue;
      let value;
      if (['choice', 'single_choice', 'multiple_choice'].includes(q.responseType)) {
        let opts = q.options.filter(o => !/^(?:N\/?A|NOT APPLICABLE)$/i.test(o.text?.trim() || ''));
        for (const r of d.rules) {
          const constraints = r.context_constraints ? (Array.isArray(r.context_constraints) ? r.context_constraints : [r.context_constraints]) : [];
          for (const c of constraints) {
            const allowed = c.allowed_options?.[q.id]?.[context[c.context_key]];
            if (allowed) opts = opts.filter(o => allowed.includes(o.id));
          }
        }
        if (!opts.length) continue;
        const index = variant === 'first' ? 0 : variant === 'last' ? opts.length - 1 : i % opts.length;
        value = q.responseType === 'multiple_choice' ? [opts[index].id] : opts[index].id;
      } else if (['integer', 'number'].includes(q.responseType)) {
        const s = q.inputSpec?.answer_schema || {};
        value = variant === 'last' ? (finite(s.maximum) ? s.maximum : (s.minimum ?? 0) + 1) : s.minimum ?? 0;
      } else if (q.responseType === 'text') value = 'Synthetic example response';
      else continue;
      try { validateAnswer(q, value); } catch { continue; }
      answers[q.id] = value; changed = true;
    }
    if (!changed) break;
  }
  if (variant === 'missing') for (const key of Object.keys(answers)) delete answers[key];
  return { answers, context };
}

export function sampleState(d, variant = 'mixed', ordinal = 0) {
  const { answers, context } = sampleAnswers(d, variant);
  return { id: `preview-${d.id}-${ordinal}`, demoPatientId: 'SYNTHETIC REVIEW EXAMPLE', formId: d.id,
    formVersion: d.versionId, formSnapshot: d, answers, context, status: 'completed',
    completedAt: `2026-11-${String(1 + ordinal * 7).padStart(2, '0')}T12:00:00.000Z`,
    scores: scoreDefinition(d, answers, context, { draftScores: true }) };
}
export function previewReport(d, scenario = 'single') {
  const states = scenario === 'repeated' ? ['first', 'last', 'mixed'].map((v, i) => sampleState(d, v, i)) : [sampleState(d, scenario === 'missing' ? 'missing' : 'mixed')];
  return buildDefinitionReport(states.at(-1), states.slice(0, -1));
}
export function definitionReview(d, raw, links = []) {
  const errors = validateReportDefinition(d);
  const cases = ['first', 'last', 'mixed', 'missing'].map(variant => {
    const state = sampleState(d, variant);
    return { variant, answered: Object.keys(state.answers).length, calculated: state.scores.calculatedCount,
      withheld: state.scores.metrics.filter(m => m.value === null).map(m => ({ metricId: m.id, reason: m.reason })),
      values: Object.fromEntries(state.scores.metrics.map(m => [m.id, m.value])) };
  });
  for (const c of cases) for (const r of d.rules) {
    const value = c.values[r.id];
    if (value !== null && (!finite(value) || value < r.minimum || value > r.maximum)) errors.push(`Out-of-range synthetic result: ${c.variant}/${r.id}`);
    if (c.variant === 'missing' && value !== null) errors.push(`Missing responses scored: ${r.id}`);
  }
  const empty = d.questions.length === 0;
  const gaps = [...new Set([
    ...(empty ? ['Questionnaire unavailable in extraction.'] : []),
    ...(d.remainingWork || []), ...(d.scoringLimitations || []), ...(d.verification?.remainingWork || []),
    ...(d.reporting.coverage?.remaining_work || []),
    ...d.reviewIssues.map(i => `${i.code}: ${i.detail}`),
    'Independent clinical review is pending.',
    'Graph selection and statistical equivalence to the source report are not verified.',
  ].filter(Boolean))];
  return { assessmentId: d.id, title: d.title, mode: d.reporting.mode, questionCount: d.questions.length, ruleCount: d.rules.length,
    technicalStatus: errors.length ? 'failed' : 'passed', errors, clinicalStatus: 'not_approved',
    reportStatus: empty ? 'questionnaire_unavailable' : d.rules.length ? 'draft_numeric_preview' : 'responses_only_preview',
    rulesExercised: d.rules.filter(r => cases.some(c => c.values[r.id] !== null)).length,
    unexercisedRuleIds: d.rules.filter(r => cases.every(c => c.values[r.id] === null)).map(r => r.id),
    charts: d.reporting.reportPlan.charts.length, sourceReportEquivalence: 'not_verified',
    referenceDocumentCount: raw.source_documents?.length || 0, extractedTableCount: d.tables.length,
    assetCount: links.length, missingAssetReferences: links.filter(l => !l.sha256).map(l => l.id),
    sourceReportAssets: links.filter(l => /sample.*(?:report|result)|report.*sample/i.test(`${l.metadata.title} ${l.metadata.role} ${l.metadata.source_section}`)).map(l => l.id),
    requiredContext: d.reporting.required_context, gaps, withheldFeatures: d.reporting.reportPlan.withheld, syntheticCases: cases,
    validationScope: 'Schema, scoring fingerprint, valid synthetic inputs, bounded arithmetic and missing-answer withholding. Not independent validation of extracted scoring rules.' };
}

export function versionPreparedDefinition(raw, definition) {
  const d = structuredClone(definition);
  const { versionId, sourceSha256, ...runtimeContent } = d;
  d.versionId = contentHash({ raw, displayAssets: [], runtimeContent });
  return d;
}
