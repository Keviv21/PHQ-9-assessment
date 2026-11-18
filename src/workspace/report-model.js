import { calculateReportMetrics, protocolResult, compatibilityKey, responseStatus, selectedValue, clinicalGate } from "./report-calculation.js";
import { savedSessionMetrics, DRAFT_SCORE_LABEL } from "./session-results.js";
import { presentation } from "./presentation.js";
import { responseLabel } from "../../public/shared/answers.js";

export const plainSourceText = value => String(value ?? "").replace(/https?:\/\/[^\s<>]+/gi, "").trim();
export function enrichReport(report, state, history = [], options = {}) {
  const d = state.definition, config = d.reporting;
  const metricsFor = s => s.definition.reporting
    ? (options.syntheticPreview ? calculateReportMetrics(s.definition, s.answers, s.context, options) : savedSessionMetrics(s) ?? calculateReportMetrics(s.definition, s.answers, s.context))
    : s.definition.scoring?.enabled === true && Number.isFinite(s.score) && s.score >= s.definition.scoring.min && s.score <= s.definition.scoring.max
      ? [{ id: "saved_total", label: "Recorded total", value: s.score, min: s.definition.scoring.min, max: s.definition.scoring.max, unit: "score", status: "recorded_legacy", descriptor: s.severity, reason: null }]
      : [];
  report.metrics = metricsFor(state);
  report.draftScores = report.metrics.some(m => m.status === "draft_unvalidated");
  report.reportingMode = config?.mode || "legacy_snapshot";
  report.reportingVersion = config?.version || "Not recorded in saved definition";
  report.respondent = state.respondentType || state.context?.respondent_type || "Not recorded";
  report.status = state.status;
  report.preview = options.syntheticPreview === true;
  if (report.preview) report.note = "Draft formulas applied to synthetic responses only. Clinical scoring remains disabled; these are not patient results.";
  else if (report.draftScores) report.note = `${DRAFT_SCORE_LABEL}. Calculated from the saved JSON rules and answers at submission. Clinical interpretation remains disabled.`;
  else if (config) report.note = clinicalGate(d) ? "Results follow the reviewed rules saved with this administration." : "Saved responses are shown below. Clinical scoring and interpretation remain disabled pending independent validation.";
  report.protocol = protocolResult(d, state.answers, state.context, options);
  report.reviewStatus = d.review?.status || "Not recorded";
  report.definitionSource = config ? "Saved local JSON definition" : "Saved historical definition; detailed reporting rules were not captured";
  const issues = [...(d.scoring?.limitations || []), ...(config?.coverage?.remaining_work || []), ...(d.scoring?.remaining_work || [])];
  if (config?.coverage?.clinical_review_complete !== true) issues.unshift("Independent clinical validation is not complete. No diagnosis, percentile or reliable-change conclusion is inferred.");
  if (report.reportingMode === "unavailable") issues.unshift("Questionnaire unavailable in the supplied JSON. No assessment result can be generated.");
  if (report.reportingMode === "descriptive_responses") issues.unshift("Descriptive responses only; no numeric total is defined.");
  if (report.preview) issues.unshift("DEVELOPMENT PREVIEW — SYNTHETIC DATA. Draft arithmetic only; not a patient report or clinical result.");
  report.limitations = [...new Set(issues.map(plainSourceText).filter(Boolean))];
  report.attribution = (d.references || []).map(r => plainSourceText(r.citation)).filter(Boolean);
  if (d.rights?.note) report.attribution.push(plainSourceText(d.rights.note));
  report.requiredContext = (config?.required_context || []).map(c => ({ key: c.key, value: state.context?.[c.key] ?? "Not recorded" }));
  const key = compatibilityKey(state);
  const compatible = history.filter(s => s.id !== state.id && s.patientId === state.patientId && s.status === "completed" && s.completedAt <= state.completedAt && compatibilityKey(s) === key)
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id));
  const visits = [...compatible, state];
  const calculated = visits.map(s => ({ id: s.id, completedAt: s.completedAt, metrics: metricsFor(s) }));
  report.metricHistory = report.metrics.map(m => ({ ...m, points: calculated.map(v => ({ id: v.id, date: v.completedAt, value: v.metrics.find(x => x.id === m.id)?.value ?? null })) }));
  report.itemCharts = [];
  for (const chart of config?.charts || []) {
    if (chart.kind !== "item_trend") continue;
    for (const series of chart.series || []) {
      const sourceQuestion = d.questions.find(q => q.id === series.id);
      if (!sourceQuestion) continue;
      const rawNumeric = ["number", "integer"].includes(sourceQuestion.response_type);
      const permitted = rawNumeric || options.syntheticPreview || clinicalGate(d);
      report.itemCharts.push({ label: `${chart.title} · ${series.label}`, min: chart.minimum, max: chart.maximum, unit: chart.axis_unit,
        note: chart.note, points: visits.map(s => {
          const q = s.definition.questions.find(q => q.id === series.id);
          const v = permitted && responseStatus(s.definition, s.answers, q, s.context) === "answered"
            ? selectedValue(s.definition, s.answers, q.id, series.value_field) : null;
          return { id: s.id, date: s.completedAt, value: Number.isFinite(v) && v >= chart.minimum && v <= chart.maximum ? v : null };
        }) });
    }
  }
  if (config?.paired_profile) report.limitations.push("Paired-assessment profile unavailable: no verified compatible paired administration was selected.");
  report.comparisons = [];
  for (const m of report.metrics) {
    if (m.value === null) continue;
    const references = [{ label: "Previous visit", visit: calculated.at(-2) }, { label: "Baseline", visit: calculated[0] }];
    const seen = new Set([state.id]);
    for (const { label, visit } of references) {
      if (!visit || seen.has(visit.id)) continue;
      seen.add(visit.id);
      const value = visit.metrics.find(x => x.id === m.id)?.value;
      if (!Number.isFinite(value)) continue;
      report.comparisons.push({ metric: m.label, reference: label, date: visit.completedAt, value, delta: Number((m.value - value).toFixed(8)), unit: m.unit });
    }
  }
  report.historyNote = "Comparisons use only this patient's compatible definition, language, respondent and context. Numeric change does not establish treatment progress or clinical improvement.";
  report.responses.forEach((r, i) => {
    r.status = responseStatus(d, state.answers, d.questions[i], state.context);
    if (r.status === "eligibility_unknown") r.response = "Not available — eligibility information missing";
    if (r.status === "invalid") r.response = "Not available — saved answer does not match the definition";
  });
  const byId = new Map(report.responses.map(r => [r.questionId, r]));
  report.responseGroups = (config?.response_groups || []).map(g => ({ id: g.id, label: g.label, responses: g.item_ids.map(id => byId.get(id)).filter(Boolean) }));
  const historyIds = config?.item_history?.map(h => h.item_id) || d.questions.map(q => q.id);
  report.responseHistory = visits.length > 1 ? historyIds.map(id => ({
    id, question: byId.get(id)?.question || id,
    visits: visits.map(s => {
      const i = s.definition.questions.findIndex(q => q.id === id), q = s.definition.questions[i];
      const status = responseStatus(s.definition, s.answers, q, s.context);
      return { id: s.id, date: s.completedAt, status, response: status === "answered" ? responseLabel(presentation(s.definition, s.language).questions[i], s.answers[i]) : status.replaceAll("_", " ") };
    }),
  })) : [];
  return report;
}
