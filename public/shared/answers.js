// Shared by browser and server. null means unanswered, never zero or a skip.
export const answerType = (q) =>
  q.response_type === "choice" || !q.response_type
    ? q.selection_mode === "multiple"
      ? "multiple_choice"
      : "single_choice"
    : q.response_type;
export const isSkipped = (v) =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  v.skipped === true &&
  v.reason === "not_applicable";
export const canSkip = (q) =>
  q.allowSkip === true || q.input_spec?.allow_not_applicable === true;
export const numericSchema = (q) => {
  const s = q.input_spec?.answer_schema || {};
  return s.oneOf?.find((x) => ["integer", "number"].includes(x.type)) || s;
};
const schemaKeys = new Set([
  "type",
  "enum",
  "const",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "items",
  "oneOf",
  "not",
  "contains",
]);
function schemaIssue(s) {
  if (!s || typeof s !== "object" || Array.isArray(s))
    return "invalid answer schema";
  for (const k of Object.keys(s))
    if (!schemaKeys.has(k)) return `unsupported answer constraint ${k}`;
  if (
    s.type &&
    !["string", "integer", "number", "array", "boolean", "null"].includes(
      s.type,
    )
  )
    return `unsupported schema type ${s.type}`;
  for (const c of [s.items, s.not, s.contains, ...(s.oneOf || [])].filter(
    Boolean,
  )) {
    const issue = schemaIssue(c);
    if (issue) return issue;
  }
  return null;
}
export function matchesSchema(v, s = {}) {
  if (s.oneOf && s.oneOf.filter((x) => matchesSchema(v, x)).length !== 1)
    return false;
  if (s.not && matchesSchema(v, s.not)) return false;
  if (Object.hasOwn(s, "const") && v !== s.const) return false;
  if (s.enum && !s.enum.includes(v)) return false;
  if (s.type === "string" && typeof v !== "string") return false;
  if (s.type === "number" && (typeof v !== "number" || !Number.isFinite(v)))
    return false;
  if (s.type === "integer" && !Number.isSafeInteger(v)) return false;
  if (s.type === "array" && !Array.isArray(v)) return false;
  if (s.type === "boolean" && typeof v !== "boolean") return false;
  if (s.type === "null" && v !== null) return false;
  if (typeof v === "number") {
    if (
      (s.minimum != null && v < s.minimum) ||
      (s.maximum != null && v > s.maximum)
    )
      return false;
    if (
      (s.exclusiveMinimum != null && v <= s.exclusiveMinimum) ||
      (s.exclusiveMaximum != null && v >= s.exclusiveMaximum)
    )
      return false;
    if (
      s.multipleOf != null &&
      Math.abs(v / s.multipleOf - Math.round(v / s.multipleOf)) > 1e-9
    )
      return false;
  }
  if (
    typeof v === "string" &&
    ((s.minLength != null && [...v].length < s.minLength) ||
      (s.maxLength != null && [...v].length > s.maxLength))
  )
    return false;
  if (Array.isArray(v)) {
    if (
      (s.minItems != null && v.length < s.minItems) ||
      (s.maxItems != null && v.length > s.maxItems)
    )
      return false;
    if (s.uniqueItems && new Set(v).size !== v.length) return false;
    if (s.items && !v.every((x) => matchesSchema(x, s.items))) return false;
    if (s.contains && !v.some((x) => matchesSchema(x, s.contains)))
      return false;
  }
  return true;
}
export function questionIssue(q, questions) {
  const prefix = `${q.id || "(missing ID)"} (${q.response_type || "single_choice"})`;
  const fail = (msg) => `${prefix}: ${msg}.`;
  const type = answerType(q);
  if (
    !["single_choice", "multiple_choice", "text", "integer", "number"].includes(
      type,
    )
  )
    return fail("unsupported answer type");
  if (!q.text?.trim()) return fail("question text is missing");
  if (q.selection_mode && !["single", "multiple"].includes(q.selection_mode))
    return fail(`unsupported selection mode ${q.selection_mode}`);
  if (type.endsWith("choice")) {
    if (!Array.isArray(q.options) || !q.options.length)
      return fail("response options are missing");
    if (
      q.options.some(
        (o) =>
          !o.label?.trim() || !["number", "string"].includes(typeof o.value),
      ) ||
      new Set(q.options.map((o) => o.value)).size !== q.options.length
    )
      return fail("response labels or values are incomplete or ambiguous");
    if (
      q.options.some((o) => o.id) &&
      (q.options.some((o) => !o.id) ||
        new Set(q.options.map((o) => o.id)).size !== q.options.length)
    )
      return fail("option IDs are incomplete or duplicated");
  }
  if (q.input_spec?.answer_schema) {
    const issue = schemaIssue(q.input_spec.answer_schema);
    if (issue) return fail(issue);
  }
  function conditionIssue(c) {
    if (c.any || c.all) {
      const children = c.any || c.all;
      if (!Array.isArray(children) || !children.length)
        return "empty conditional rule";
      return children.map(conditionIssue).find(Boolean);
    }
    if (c.context_key)
      return `conditional rule requires unavailable context ${c.context_key}`;
    if (!["equals", "gt", "contains_any"].includes(c.operator))
      return `unsupported conditional operator ${c.operator}`;
    if (
      c.value_field &&
      !["answer_id", "printed_value"].includes(c.value_field)
    )
      return `unsupported condition value field ${c.value_field}`;
    const index = questions.findIndex((x) => x.id === c.item_id);
    if (index < 0 || index >= questions.indexOf(q))
      return `conditional rule requires an earlier question ${c.item_id}`;
    if (c.operator === "contains_any" && !Array.isArray(c.value))
      return "conditional selections are invalid";
    return null;
  }
  if (q.display_if) {
    const issue = conditionIssue(q.display_if);
    if (issue) return fail(issue);
  }
  return null;
}
export function answerError(q, value) {
  const fail = (msg) => `${q.id}: ${msg}`;
  if (isSkipped(value))
    return canSkip(q) && Object.keys(value).length === 2
      ? null
      : fail("This question cannot be skipped.");
  if (value == null) return fail("Provide an answer.");
  const type = answerType(q),
    spec = q.input_spec || {},
    schema = spec.answer_schema || {};
  let sourceValue = value;
  if (type.endsWith("choice")) {
    const values = type === "multiple_choice" ? value : [value];
    if (
      !Array.isArray(values) ||
      !values.length ||
      new Set(values).size !== values.length
    )
      return fail("Choose valid, distinct responses.");
    const options = values.map((v) => q.options.find((o) => o.value === v));
    if (options.some((o) => !o)) return fail("Choose a valid response.");
    const ids = options.map((o) => o.id ?? o.value);
    if (
      ids.some((id) => spec.exclusive_option_ids?.includes(id)) &&
      ids.length > 1
    )
      return fail("An exclusive response must be selected on its own.");
    sourceValue = type === "multiple_choice" ? ids : ids[0];
  } else if (type === "text") {
    if (typeof value !== "string" || !value.trim())
      return fail("Enter written feedback.");
  } else if (type === "integer" || type === "number") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (type === "integer" && !Number.isSafeInteger(value))
    )
      return fail(`Enter a valid ${type}.`);
  } else return fail(`Unsupported answer type ${type}.`);
  if (!matchesSchema(sourceValue, schema))
    return fail(
      "The answer does not meet the source-defined limits or selections.",
    );
  return null;
}
export function conditionState(
  condition,
  definition,
  answers,
  seen = new Set(),
) {
  if (!condition) return true;
  const children = condition.any || condition.all;
  if (children) {
    const states = children.map((c) =>
      conditionState(c, definition, answers, seen),
    );
    return condition.any
      ? states.includes(true)
        ? true
        : states.includes(null)
          ? null
          : false
      : states.includes(false)
        ? false
        : states.includes(null)
          ? null
          : true;
  }
  const i = definition.questions.findIndex((q) => q.id === condition.item_id);
  if (i < 0 || seen.has(i)) return null;
  const next = new Set(seen);
  next.add(i);
  const q = definition.questions[i],
    visible = conditionState(q.display_if, definition, answers, next);
  if (visible !== true) return visible;
  const value = answers[i];
  if (value == null) return null;
  if (isSkipped(value)) return false;
  const convert = (v) => {
    const option = q.options?.find((o) => o.value === v);
    return condition.value_field === "printed_value"
      ? (option?.printed_value ?? v)
      : (option?.id ?? v);
  };
  const actual = Array.isArray(value) ? value.map(convert) : convert(value);
  if (condition.operator === "equals") return actual === condition.value;
  if (condition.operator === "gt")
    return typeof actual === "number" && actual > condition.value;
  if (condition.operator === "contains_any")
    return (Array.isArray(actual) ? actual : [actual]).some((v) =>
      condition.value.includes(v),
    );
  return null;
}
export const visibleQuestion = (d, answers, q) =>
  conditionState(q.display_if, d, answers) === true;
export const currentQuestionIndex = (d, answers) =>
  d.questions.findIndex(
    (q, i) => visibleQuestion(d, answers, q) && answers[i] == null,
  );
export function responseLabel(q, value) {
  if (isSkipped(value)) return "Skipped — not applicable";
  if (value == null) return "Not recorded";
  if (answerType(q) === "text" || ["integer", "number"].includes(answerType(q)))
    return String(value);
  return (Array.isArray(value) ? value : [value])
    .map((v) => q.options.find((o) => o.value === v)?.label || "Not recorded")
    .join("; ");
}
