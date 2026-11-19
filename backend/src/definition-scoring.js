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
  if (numeric(answer)) return answer;
  if (typeof answer !== 'string') return null;
  const option = item.options?.find(({ id }) => id === answer);
  if (!option) return null;
  const override = rule.option_value_overrides?.[item.id]?.[answer];
  const value = override ?? option[rule.value_field];
  if (!numeric(value)) return null;
  const transform = rule.item_transforms?.[item.id];
  return transform ? value * (transform.scale ?? 1) + (transform.offset ?? 0) : value;
}

function calculate(rule, questions, answers, context) {
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
    if (display === null || !Object.hasOwn(answers, id)) return { value: null, reason: `Required answer ${id} is missing.` };
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
    raw = values.filter(({ id, value }) => compare(value, rule.operator ?? '>=', rule.item_thresholds?.[id] ?? rule.threshold)).length;
  } else return { value: null, reason: `Unsupported method ${method}.` };
  const value = Math.round(raw * multiplier * 10000) / 10000;
  const band = (rule.severity_bands ?? []).find((entry) =>
    value >= entry.minimum_inclusive && value <= entry.maximum_inclusive);
  return { value, band: band?.label ?? null, reason: null };
}

export function scoreDefinition(definition, answers, context = {}) {
  const metrics = definition.rules.map((rule) => ({
    id: rule.id, label: rule.label ?? rule.id,
    method: rule.method, minimum: rule.minimum ?? null, maximum: rule.maximum ?? null,
    ...calculate(rule, definition.questions, answers, context),
  }));
  return {
    version: definition.version,
    status: 'source_draft_unapproved',
    metrics,
    calculatedCount: metrics.filter((metric) => metric.value !== null).length,
    withheldCount: metrics.filter((metric) => metric.value === null).length,
  };
}
