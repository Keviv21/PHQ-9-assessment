import { scoringRuntimeHash } from './assessment-content.js';
export const scoringEngineVersion = 'definition-engine-2';
const numeric = (value) => typeof value === 'number' && Number.isFinite(value);
const compare = (left, operator, right) => {
  if (operator === 'equals') return left === right;
  if (operator === 'gt') return numeric(left) && left > right;
  if (operator === '>=') return numeric(left) && left >= right;
  if (operator === '>') return numeric(left) && left > right;
  if (operator === '<') return numeric(left) && left < right;
  if (operator === '<=') return numeric(left) && left <= right;
  if (operator === 'contains_any') return Array.isArray(left) && right.some((value) => left.includes(value));
  return null;
};

export function conditionState(condition, answers, questions, context = {}) {
  if (!condition) return true;
  if (Array.isArray(condition.any)) {
    const states = condition.any.map((entry) => conditionState(entry, answers, questions, context));
    return states.includes(true) ? true : states.includes(null) ? null : false;
  }
  if (Array.isArray(condition.all)) {
    const states = condition.all.map((entry) => conditionState(entry, answers, questions, context));
    return states.includes(false) ? false : states.includes(null) ? null : true;
  }
  if (condition.context_key) {
    if (!Object.hasOwn(context, condition.context_key)) return null;
    return compare(context[condition.context_key], condition.operator, condition.value);
  }
  const item = questions.find(({ id }) => id === condition.item_id);
  if (!item || !Object.hasOwn(answers, item.id)) return null;
  const answer = answers[item.id];
  let value = answer;
  if (condition.value_field && condition.value_field !== 'answer_id' && typeof answer === 'string') {
    const option = item.options?.find(({ id }) => id === answer);
    value = option?.[condition.value_field];
  }
  return compare(value, condition.operator, condition.value);
}

export function validateAnswer(item, value) {
  const kind = item.responseType;
  const schema = item.inputSpec?.answer_schema ?? {};
  if (['choice', 'single_choice'].includes(kind)) {
    if (!item.options?.some((option) => option.id === value)) throw new RangeError(`Invalid choice for ${item.id}.`);
  } else if (kind === 'multiple_choice') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 1) ||
        new Set(value).size !== value.length || value.some((id) => !item.options?.some((option) => option.id === id))) {
      throw new RangeError(`Invalid choices for ${item.id}.`);
    }
    const exclusive = item.inputSpec?.exclusive_option_ids ?? [];
    if (value.length > 1 && value.some((id) => exclusive.includes(id))) throw new RangeError(`Exclusive choice for ${item.id}.`);
  } else if (kind === 'integer' || kind === 'number') {
    if (!numeric(value) || (kind === 'integer' && !Number.isInteger(value)) ||
        (numeric(schema.minimum) && value < schema.minimum) ||
        (numeric(schema.maximum) && value > schema.maximum)) throw new RangeError(`Invalid number for ${item.id}.`);
  } else if (kind === 'text') {
    if (typeof value !== 'string' || value.trim().length < (schema.minLength ?? 1) || value.length > 4000) {
      throw new RangeError(`Invalid text for ${item.id}.`);
    }
  } else throw new RangeError(`Unsupported answer type for ${item.id}.`);
  return value;
}

function itemValue(item, answer, rule) {
  const option = item.options?.find(({ id }) => id === answer);
  const override = rule.option_value_overrides?.[item.id]?.[answer];
  if (override === undefined && /^(?:N\/?A|NOT APPLICABLE)$/i.test(option?.text?.trim() || '')) return null;
  const value = numeric(answer) ? answer : override ?? option?.[rule.value_field];
  if (!numeric(value)) return null;
  const transform = rule.item_transforms?.[item.id];
  return transform ? value * (transform.scale ?? 1) + (transform.offset ?? 0) : value;
}

function calculate(rule, questions, answers, context) {
  if (rule.missing_item_policy && !['withhold_if_any_required_answer_is_missing', 'withhold_if_required_answer_or_eligibility_is_unknown'].includes(rule.missing_item_policy)) return { value: null, reason: 'Unsupported missing-answer policy.' };
  if (rule.context_constraints) {
    for (const constraint of Array.isArray(rule.context_constraints) ? rule.context_constraints : [rule.context_constraints]) {
      const category = context[constraint.context_key];
      if (!constraint.allowed_values?.includes(category)) return { value: null, reason: 'Required source scoring context was not provided.' };
      for (const [itemId, allowed] of Object.entries(constraint.allowed_options ?? {})) {
        if (!allowed[category]?.includes(answers[itemId])) return { value: null, reason: `Answer ${itemId} conflicts with selected source scoring context.` };
      }
    }
  }
  const applies = conditionState(rule.applies_if, answers, questions, context);
  if (applies === false) return { value: null, reason: 'Rule does not apply to these answers.' };
  if (applies === null) return { value: null, reason: 'Rule eligibility is unknown.' };
  const values = [];
  for (const id of rule.item_ids ?? []) {
    const item = questions.find((candidate) => candidate.id === id);
    if (!item) return { value: null, reason: `Source item ${id} is missing.` };
    const display = conditionState(item.displayIf, answers, questions, context);
    if (display === false && rule.ineligible_item_policy === 'zero') { values.push({ id, value: 0 }); continue; }
    if (display === false && (rule.ineligible_item_policy === 'exclude' || rule.optional_item_ids?.includes(id))) continue;
    if (display === false) return { value: null, reason: `Required item ${id} was not shown.` };
    if (display === true && !Object.hasOwn(answers, id) && rule.optional_item_ids?.includes(id)) continue;
    if (display === null || !Object.hasOwn(answers, id)) return { value: null, reason: `Required answer ${id} is missing.` };
    try { validateAnswer(item, answers[id]); } catch { return { value: null, reason: `Invalid saved answer ${id}.` }; }
    const value = itemValue(item, answers[id], rule);
    if (!numeric(value)) return { value: null, reason: `No source numeric value for ${id}.` };
    values.push({ id, value });
  }
  if (!values.length) return { value: null, reason: 'No scoreable answers.' };
  const method = rule.method;
  const multiplier = numeric(rule.multiplier) ? rule.multiplier : 1;
  let raw;
  if (method === 'sum' || method === 'weighted_sum') {
    raw = values.reduce((total, { id, value }) => total + value * (rule.item_coefficients?.[id] ?? 1), 0);
  } else if (method === 'mean') raw = values.reduce((total, { value }) => total + value, 0) / values.length;
  else if (method === 'count_threshold') {
    const compared = values.map(({ id, value }) => compare(value, rule.operator ?? '>=', rule.item_thresholds?.[id] ?? rule.threshold));
    if (compared.includes(null)) return { value: null, reason: 'Unsupported threshold comparison.' };
    raw = compared.filter(Boolean).length;
  } else return { value: null, reason: `Unsupported method ${method}.` };
  const value = Math.round(raw * multiplier * 10000) / 10000;
  if (!numeric(value) || (numeric(rule.minimum) && value < rule.minimum) || (numeric(rule.maximum) && value > rule.maximum)) return { value: null, reason: 'Calculated result is outside the configured bounds.' };
  const band = (rule.severity_bands ?? []).find((entry) =>
    value >= entry.minimum_inclusive && value <= entry.maximum_inclusive);
  return { value, band: band?.label ?? null, reason: null };
}

export function scoreDefinition(definition, answers, context = {}, { draftScores = process.env.ASSESSMENT_DRAFT_SCORES === 'true' } = {}) {
  // Historical definitions retain their original draft behavior. Newly imported versions
  // require an explicit development setting and verified, unchanged content.
  const imported = Boolean(definition.versionId);
  const gate = imported && (!draftScores ? 'Draft scoring is disabled.' :
    !definition.verification?.contentVerified || definition.runtimeHash !== scoringRuntimeHash(definition) ? 'Scoring evidence is stale or missing.' : null);
  const metrics = definition.rules.map((rule) => ({
    id: rule.id, label: rule.label ?? rule.id,
    method: rule.method, minimum: rule.minimum ?? null, maximum: rule.maximum ?? null,
    ...(gate ? { value: null, band: null, reason: gate } : calculate(rule, definition.questions, answers, context)),
    ...(imported ? { band: null } : {}),
  }));
  return {
    version: definition.version,
    status: 'source_draft_unapproved',
    label: 'Draft score — not clinically validated', engineVersion: scoringEngineVersion,
    definitionVersionId: definition.versionId ?? null, runtimeHash: definition.runtimeHash ?? null,
    metrics,
    calculatedCount: metrics.filter((metric) => metric.value !== null).length,
    withheldCount: metrics.filter((metric) => metric.value === null).length,
  };
}
