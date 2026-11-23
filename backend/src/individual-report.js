import { getCatalogEntry } from './assessment-catalog.js';
import { definitionVersion, getDefinition } from './definition-library.js';
import { conditionState, scoreDefinition } from './definition-scoring.js';
import { getLiveDraftForm } from './draft-library.js';
import { getAssessmentForm } from './forms.js';

const gad7Id = 'generalised-anxiety-disorder-assessment-gad-7--265a24c61d94';
const builtInDefinitions = {
  phq9: getCatalogEntry('phq9').catalogDraftId,
  gad7: gad7Id,
  pcl5: getCatalogEntry('pcl5').catalogDraftId,
};
const normalizedText = (text) => text.normalize('NFKC').toLowerCase().replace(/[\p{P}\s]/gu, '');

function matchImportedItem(questions, question) {
  const text = normalizedText(question.text);
  const matches = questions.filter((item) => normalizedText(item.text) === text);
  return matches.find(({ id }) => id === question.id) ?? (matches.length === 1 ? matches[0] : null);
}

function matchImportedOption(option, label) {
  if (!label) return false;
  if (normalizedText(option.text) === normalizedText(label)) return true;
  const numbered = /^(\d+)\s*[-–—]\s*(.+)$/.exec(label);
  return Boolean(numbered && option.printed_value === Number(numbered[1]) &&
    normalizedText(option.text) === normalizedText(numbered[2]));
}

function sourceAnswers(assessment, definition, kind) {
  if (kind === 'definition') return assessment.answers;
  const native = kind === 'built-in';
  const form = native ? getAssessmentForm(assessment.formId) : getLiveDraftForm(assessment.formId);
  const answers = {};
  for (const { number, value } of assessment.answers) {
    const question = form?.questions[number - 1];
    if (!question) continue;
    const item = native ? definition.questions.find(({ order }) => order === number) :
      matchImportedItem(definition.questions, question);
    if (!['choice', 'single_choice', 'multiple_choice'].includes(item?.responseType)) continue;
    const label = question.options?.find((option) => option.value === value)?.label;
    const matches = item.options.filter((option) => native ? option.printed_value === value : matchImportedOption(option, label));
    if (matches.length === 1) answers[item.id] = item.responseType === 'multiple_choice' ? [matches[0].id] : matches[0].id;
  }
  return answers;
}

function printedValue(item, answer) {
  return typeof answer === 'number' ? answer : item?.options.find(({ id }) => id === answer)?.printed_value;
}

function protocolResult(definition, answers) {
  const protocol = definition.protocol;
  if (protocol?.kind !== 'asq_source_screen') return null;
  const value = (id) => printedValue(definition.questions.find((item) => item.id === id), answers[id]);
  const core = protocol.core_item_ids.map(value);
  const acuity = value(protocol.acuity_item_id);
  let state = 'incomplete';
  if (core.includes(1)) {
    state = acuity === 1 ? 'positive_core_screen_current_ideation' :
      acuity === 0 ? 'positive_core_screen_no_current_ideation' : 'positive_core_screen_acuity_unanswered';
  } else if (core.every((answer) => answer === 0)) state = 'negative_core_screen';
  return definition.reporting.protocol?.state_labels[state] ?? null;
}

function pairedResult(profile, metrics) {
  if (!profile) return null;
  const values = profile.rule_ids.map((id) => metrics.get(id)?.value);
  if (!values.every(Number.isFinite)) return null;
  const elevated = values.map((value, index) => value >= profile.thresholds[index]);
  return profile.cells.find((cell) => cell.elevated.every((flag, index) => flag === elevated[index]))?.label ?? null;
}

function reportCharts(definition, answers, context, metrics) {
  const charts = [];
  for (const chart of definition.reporting.charts) {
    const series = chart.series.map(({ id, label, value_field: field }) => {
      if (field === 'rule_result') return { label, value: metrics.get(id)?.value };
      const item = definition.questions.find((question) => question.id === id);
      if (!item || field !== 'printed_value') return { label, value: null };
      const eligible = conditionState(item.displayIf, answers, definition.questions, context);
      return { label, value: eligible === false ? chart.ineligible_value :
        eligible === true ? printedValue(item, answers[id]) : null };
    }).filter(({ value }) => Number.isFinite(value) && !(chart.hide_series_when_all_observed_values_zero && value === 0));
    if (series.length && Number.isFinite(chart.minimum) && Number.isFinite(chart.maximum) && chart.minimum < chart.maximum) {
      charts.push({ title: chart.title, minimum: chart.minimum, maximum: chart.maximum,
        unit: chart.axis_unit, note: chart.note, series });
    }
  }
  return charts;
}

export function withIndividualReport(assessment, kind) {
  if (assessment.status !== 'completed') return assessment;
  const id = kind === 'built-in' ? builtInDefinitions[assessment.formId] :
    assessment.formId === 'GAD7' ? gad7Id : assessment.formId;
  const snapshot = kind === 'definition' ? assessment.formSnapshot : null;
  const definition = snapshot?.reporting ? snapshot : getDefinition(id);
  if (!definition) return { ...assessment, report: { mode: 'unavailable', metrics: [], charts: [] } };

  const answers = sourceAnswers(assessment, definition, kind);
  const context = assessment.context ?? {};
  const { reporting } = definition;
  const scores = new Map(scoreDefinition(definition, answers, context).metrics.map((metric) => [metric.id, metric]));
  const metrics = reporting.metrics.map((metric) => ({
    ...scores.get(metric.rule_id),
    id: metric.rule_id,
    label: metric.label,
    minimum: metric.minimum,
    maximum: metric.maximum,
  }));
  return { ...assessment, report: {
    mode: reporting.mode,
    sourceVersion: snapshot?.reporting ? assessment.formVersion : definitionVersion,
    sourceUrl: definition.sourceUrl,
    clinicallyApproved: definition.clinicallyApproved,
    overallMetricId: reporting.interpretation.overall_total,
    metrics,
    charts: reportCharts(definition, answers, context, scores),
    protocol: protocolResult(definition, answers),
    pairedProfile: pairedResult(definition.pairedProfile, scores),
    remainingWork: reporting.coverage.remaining_work,
  } };
}
