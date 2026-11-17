import {
  answerType,
  answerError,
  numericSchema,
  canSkip,
  isSkipped,
} from "../shared/answers.js";
import { el } from "../shared/api.js";

export function answerInput(
  q,
  { value = null, disabled = false, labels, onSave },
) {
  const form = el("form", undefined, "typed-answer"),
    type = answerType(q);
  const fieldset = el("fieldset");
  fieldset.disabled = disabled;
  fieldset.append(el("legend", labels.response));
  const message = el("p", undefined, "answer-validation");
  message.setAttribute("role", "alert");
  let read;
  const submit = (answer) => {
    const problem = answerError(q, answer);
    if (problem) {
      message.textContent = problem;
      return;
    }
    onSave(answer);
  };
  if (type.endsWith("choice")) {
    const multiple = type === "multiple_choice",
      inputs = [];
    for (const option of q.options) {
      const row = el("label", undefined, "workspace-option"),
        input = el("input");
      input.type = multiple ? "checkbox" : "radio";
      input.name = `answer-${q.id}`;
      input.value = String(option.value);
      input.checked = multiple
        ? Array.isArray(value) && value.includes(option.value)
        : value === option.value;
      inputs.push({ input, option });
      input.onchange = () => {
        message.textContent = "";
        if (!multiple) {
          submit(option.value);
          return;
        }
        if (input.checked) {
          const exclusive = q.input_spec?.exclusive_option_ids || [];
          for (const other of inputs)
            if (
              other.input !== input &&
              (exclusive.includes(option.id) ||
                exclusive.includes(other.option.id))
            )
              other.input.checked = false;
        }
      };
      row.append(input, el("span", option.label));
      fieldset.append(row);
    }
    read = () =>
      inputs.filter((x) => x.input.checked).map((x) => x.option.value);
    if (multiple) fieldset.append(el("p", labels.multipleHint, "muted-text"));
  } else {
    const input = el(type === "text" ? "textarea" : "input");
    input.setAttribute("aria-label", q.text);
    input.name = q.id;
    if (type === "text") {
      input.rows = 4;
      const schema = q.input_spec?.answer_schema || {};
      if (schema.maxLength != null) input.maxLength = schema.maxLength;
      if (schema.minLength != null) input.minLength = schema.minLength;
      fieldset.append(el("p", labels.textHint, "muted-text"));
    } else {
      const schema = numericSchema(q);
      input.type = "number";
      input.step =
        type === "integer" ? "1" : String(schema.multipleOf || "any");
      if (schema.minimum != null) input.min = String(schema.minimum);
      if (schema.maximum != null) input.max = String(schema.maximum);
      fieldset.append(el("p", labels.numberHint, "muted-text"));
      const limits = [
        schema.minimum != null ? `≥ ${schema.minimum}` : null,
        schema.maximum != null ? `≤ ${schema.maximum}` : null,
      ].filter(Boolean);
      if (limits.length)
        fieldset.append(el("p", limits.join(" · "), "muted-text"));
      if (q.input_spec?.unit)
        fieldset.append(el("p", q.input_spec.unit, "muted-text"));
    }
    input.required = true;
    input.value = value == null || isSkipped(value) ? "" : String(value);
    input.oninput = () => {
      message.textContent = "";
    };
    read = () =>
      type === "text"
        ? input.value
        : input.value.trim() === ""
          ? null
          : input.valueAsNumber;
    fieldset.append(input);
  }
  if (type !== "single_choice") {
    const save = el("button", labels.saveResponse, "button primary");
    save.type = "submit";
    fieldset.append(save);
  }
  if (canSkip(q)) {
    const skip = el("button", labels.skip, "button outline");
    skip.type = "button";
    skip.onclick = () => submit({ skipped: true, reason: "not_applicable" });
    fieldset.append(skip);
    if (isSkipped(value))
      fieldset.append(el("p", labels.skipped, "muted-text"));
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    if (type !== "single_choice") submit(read());
  };
  form.append(fieldset, message);
  return form;
}
