import { createHash } from "node:crypto";
import { answerType, answerError, isSkipped } from "../../public/shared/answers.js";

const finite = Number.isFinite;
const supported = new Set(["sum", "mean", "count_threshold", "weighted_sum"]);
const knownRuleKeys = new Set("id label item_ids method multiplier value_field minimum maximum severity_bands status enabled source missing_item_policy coverage reverse_scoring_handling threshold operator ineligible_item_policy item_thresholds item_coefficients applies_if option_value_overrides optional_item_ids item_transforms context_constraints bounds_basis".split(" "));
export function ruleIssue(d, r) {
  if (Object.keys(r).some(k => !knownRuleKeys.has(k))) return "Unsupported rule fields";
  if (!supported.has(r.method)) return `Unsupported calculation method: ${r.method}`;
  if (!Array.isArray(r.item_ids) || !r.item_ids.length || new Set(r.item_ids).size !== r.item_ids.length || r.item_ids.some(id => !d.questions.some(q => q.id === id))) return "Invalid item membership";
  if (!["printed_value", "score"].includes(r.value_field) || !finite(r.multiplier)) return "Missing explicit numeric encoding or multiplier";
  if (!finite(r.minimum) || !finite(r.maximum) || r.minimum > r.maximum) return "Missing or invalid result bounds";
  if (r.method === "count_threshold" && (!finite(r.threshold) || ![">=", "<="].includes(r.operator))) return "Unsupported threshold rule";
  if (r.ineligible_item_policy && !["zero", "exclude", "withhold"].includes(r.ineligible_item_policy)) return "Unsupported ineligible-item policy";
  const policy = r.missing_item_policy || d.scoring?.missing_item_policy?.action;
  if (!["withhold_if_any_required_answer_is_missing", "withhold_if_required_answer_or_eligibility_is_unknown", "withhold_result_if_any_required_response_is_missing"].includes(policy)) return "Unsupported missing-answer policy";
  for (const map of [r.item_coefficients, r.item_thresholds])
    if (map && Object.values(map).some(v => !finite(v))) return "Invalid coefficient or threshold";
  for (const t of Object.values(r.item_transforms || {}))
    if (!finite(t.scale) || !finite(t.offset) || Object.keys(t).some(k => !["scale", "offset"].includes(k))) return "Unsupported item transform";
  return null;
}

export function selectedValue(d, answers, id, field) {
  const i = d.questions.findIndex(q => q.id === id), q = d.questions[i], v = answers[i];
  if (!q || v == null || isSkipped(v) || answerError(q, v)) return null;
  const source = d.questionnaire?.items?.find(item => item.id === id);
  const convert = value => {
    if (["number", "integer"].includes(answerType(q))) return value;
    const o = q.options?.find(o => o.value === value);
    if (!o) return null;
    if (field === "answer_id") return o.id ?? null;
    // Item-specific encodings take precedence (including reversed printed values).
    const sourceOption = source?.options?.find(x => x.id === o.id);
    return sourceOption ? sourceOption[field] ?? null : o[field] ?? null;
  };
  return Array.isArray(v) ? v.map(convert) : convert(v);
}

export function reportCondition(c, d, answers, context = {}, seen = new Set()) {
  if (!c) return true;
  if (c.any || c.all) {
    const children = c.any || c.all;
    if (!Array.isArray(children) || !children.length) return null;
    const values = children.map(x => reportCondition(x, d, answers, context, seen));
    return c.any ? values.includes(true) ? true : values.includes(null) ? null : false
      : values.includes(false) ? false : values.includes(null) ? null : true;
  }
  let value;
  if (c.context_key) value = context[c.context_key] ?? null;
  else {
    const q = d.questions.find(q => q.id === c.item_id);
    if (!q || seen.has(q.id)) return null;
    const next = new Set(seen).add(q.id);
    const visible = reportCondition(q.display_if, d, answers, context, next);
    if (visible !== true) return visible;
    if (c.value_field && !["answer_id", "printed_value"].includes(c.value_field)) return null;
    value = selectedValue(d, answers, q.id, c.value_field || "answer_id");
  }
  if (value == null) return null;
  if (c.operator === "equals") return value === c.value;
  if (c.operator === "gt") return finite(value) && finite(c.value) ? value > c.value : null;
  if (c.operator === "contains_any" && Array.isArray(c.value)) return (Array.isArray(value) ? value : [value]).some(v => c.value.includes(v));
  return null;
}

export function responseStatus(d, answers, q, context = {}) {
  const eligible = reportCondition(q.display_if, d, answers, context);
  if (eligible === null) return "eligibility_unknown";
  if (!eligible) return "not_applicable";
  const v = answers[d.questions.indexOf(q)];
  if (v == null) return "unanswered";
  if (isSkipped(v)) return answerError(q, v) ? "invalid" : "skipped";
  return answerError(q, v) ? "invalid" : "answered";
}

export function calculateRule(d, answers, r, context = {}) {
  const unavailable = reason => ({ value: null, status: "unavailable", reason, descriptor: null });
  const issue = ruleIssue(d, r);
  if (issue) return unavailable(issue);
  const eligible = reportCondition(r.applies_if, d, answers, context);
  if (eligible !== true) return unavailable(eligible === false ? "Rule not applicable" : "Rule eligibility unknown");
  for (const c of r.context_constraints || []) {
    if (!c.allowed_values?.includes(context[c.context_key])) return unavailable(`Required context: ${c.context_key}`);
    for (const [id, allowed] of Object.entries(c.allowed_options || {})) {
      const value = selectedValue(d, answers, id, "answer_id"), list = Array.isArray(value) ? value : [value];
      if (!list.every(v => allowed[context[c.context_key]]?.includes(v))) return unavailable(`Response does not match required context: ${id}`);
    }
  }
  const values = [];
  for (const id of r.item_ids) {
    const q = d.questions.find(q => q.id === id);
    const status = responseStatus(d, answers, q, context);
    if (status === "unanswered" && r.optional_item_ids?.includes(id)) continue;
    if (["not_applicable", "skipped"].includes(status)) {
      if (r.ineligible_item_policy === "exclude") continue;
      if (r.ineligible_item_policy === "zero") { values.push(0); continue; }
    }
    if (status !== "answered") return unavailable(`${id}: ${status.replaceAll("_", " ")}`);
    const answerId = selectedValue(d, answers, id, "answer_id");
    let v = r.option_value_overrides?.[id]?.[answerId] ?? selectedValue(d, answers, id, r.value_field);
    if (!finite(v)) return unavailable(`${id}: explicit numeric value unavailable`);
    // Printed reverse encodings are already reversed. Only explicit transforms run here.
    const t = r.item_transforms?.[id];
    if (t) v = v * t.scale + t.offset;
    if (r.method === "count_threshold") {
      const threshold = r.item_thresholds?.[id] ?? r.threshold;
      v = Number(r.operator === ">=" ? v >= threshold : v <= threshold);
    }
    v *= r.item_coefficients?.[id] ?? 1;
    values.push(v);
  }
  if (!values.length) return unavailable("No eligible numeric responses");
  let value = values.reduce((a, b) => a + b, 0);
  if (r.method === "mean") value /= values.length;
  value *= r.multiplier;
  if (!finite(value) || value < r.minimum - 1e-8 || value > r.maximum + 1e-8) return unavailable("Calculated value falls outside configured bounds");
  value = Number(value.toFixed(8));
  const bands = r.severity_bands || [];
  const matching = bands.filter(b => finite(b.minimum_inclusive) && finite(b.maximum_inclusive) && value >= b.minimum_inclusive && value <= b.maximum_inclusive);
  return { value, status: "calculated", reason: null, descriptor: matching.length === 1 ? matching[0].label : null };
}

export function clinicalGate(d) {
  return d.scoring?.enabled === true && d.review?.readyForClinicalUse === true && d.review?.independent_clinical_review_completed === true && d.reporting?.clinical_scoring_enabled === true && d.reporting?.coverage?.clinical_review_complete === true;
}

export function calculateReportMetrics(d, answers, context = {}, { syntheticPreview = false, draftScores = false } = {}) {
  const enabled = clinicalGate(d);
  return (d.reporting?.metrics || []).map(m => {
    const r = d.scoring.rules?.find(r => r.id === m.rule_id);
    let result = { value: null, status: "unavailable", reason: "Clinical scoring disabled; independent validation pending", descriptor: null };
    if (!r) result.reason = "Referenced scoring rule unavailable";
    else if (m.minimum !== r.minimum || m.maximum !== r.maximum || m.calculation_method !== r.method || JSON.stringify(m.item_ids) !== JSON.stringify(r.item_ids)) result.reason = "Metric configuration does not match its rule";
    else if (syntheticPreview || draftScores || enabled && r.enabled === true) {
      result = calculateRule(d, answers, r, context);
      if (syntheticPreview && result.value !== null) result.status = "development_preview";
      else if (draftScores && !(enabled && r.enabled === true) && result.value !== null) {
        result.status = "draft_unvalidated";
        result.reason = "Draft score — not clinically validated";
        result.descriptor = null;
      }
    }
    return { id: m.rule_id, label: m.label || r?.label || m.rule_id, min: r?.minimum ?? m.minimum, max: r?.maximum ?? m.maximum, unit: m.axis_unit || "score", direction: m.favourable_direction, ...result };
  });
}

export function protocolResult(d, answers, context = {}, { syntheticPreview = false } = {}) {
  const p = d.scoring?.protocol;
  if (!p) return null;
  const unavailable = reason => ({ status: "unavailable", state: null, label: reason });
  if (!syntheticPreview && !clinicalGate(d)) return unavailable("Screening interpretation disabled; independent validation pending");
  if (p.kind !== "asq_source_screen" || !p.core_item_ids?.length || !p.acuity_item_id) return unavailable("Unsupported screening protocol");
  const core = p.core_item_ids.map(id => selectedValue(d, answers, id, "printed_value"));
  let state = "incomplete";
  if (core.every(v => [0, 1].includes(v))) {
    if (!core.includes(1)) state = "negative_core_screen";
    else {
      const acuity = selectedValue(d, answers, p.acuity_item_id, "printed_value");
      state = acuity === 1 ? "positive_core_screen_current_ideation" : acuity === 0 ? "positive_core_screen_no_current_ideation" : "positive_core_screen_acuity_unanswered";
    }
  }
  return { status: syntheticPreview ? "development_preview" : "calculated", state, label: d.reporting?.protocol?.state_labels?.[state] || state };
}

export function compatibilityKey(s) {
  return createHash("sha256").update(JSON.stringify([
    s.patientId, s.assessmentId, s.definition.version, s.language,
    s.respondentType ?? s.context?.respondent_type ?? "not_recorded", s.context || {},
    s.definition.questions, s.definition.scoring, s.definition.reporting, s.definition.localized || null,
  ])).digest("hex");
}

export function validateReporting(d) {
  const issues = [];
  const report = d.reporting;
  if (!report || !["numeric_scores", "descriptive_responses", "screening_protocol", "unavailable"].includes(report.mode)) return ["Unsupported reporting mode"];
  const rules = d.scoring.rules || [], ids = new Set(rules.map(r => r.id)), items = new Set(d.questions.map(q => q.id));
  if (ids.size !== rules.length) issues.push("Duplicate rule IDs");
  for (const r of rules) { const issue = ruleIssue(d, r); if (issue) issues.push(`${r.id}: ${issue}`); }
  for (const m of report.metrics || []) {
    const r = rules.find(r => r.id === m.rule_id);
    if (!r || JSON.stringify(m.item_ids) !== JSON.stringify(r.item_ids) || m.minimum !== r.minimum || m.maximum !== r.maximum || m.calculation_method !== r.method) issues.push(`Invalid metric reference: ${m.rule_id}`);
  }
  for (const group of report.response_groups || []) if (group.item_ids.some(id => !items.has(id))) issues.push(`Invalid response group: ${group.id}`);
  for (const field of report.item_history || []) if (!items.has(field.item_id)) issues.push(`Invalid history field: ${field.item_id}`);
  return issues;
}
