import {
  answerError,
  answerType,
  currentQuestionIndex,
  visibleQuestion,
  responseLabel,
} from "../../public/workspace-answers.js";
import { presentation } from "./presentation.js";
import { randomUUID } from "node:crypto";
import { scoreDefinition } from "./definition.js";
import { HttpError } from "./errors.js";
export function createPatientRecord(input) {
  if (
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 150
  )
    throw new HttpError(400, "Enter a patient name (up to 150 characters).");
  if (
    typeof input.historySummary !== "string" ||
    !input.historySummary.trim() ||
    input.historySummary.length > 24000
  )
    throw new HttpError(
      400,
      "Enter a patient history summary (up to 24,000 characters).",
    );
  const age = input.age === "" || input.age == null ? null : Number(input.age);
  if (age !== null && (!Number.isInteger(age) || age < 0 || age > 130))
    throw new HttpError(400, "Enter a valid age.");
  if (
    input.email &&
    (typeof input.email !== "string" ||
      input.email.length > 254 ||
      !/^\S+@\S+\.\S+$/.test(input.email))
  )
    throw new HttpError(400, "Enter a valid email address.");
  if (
    input.gender &&
    !["Male", "Female", "Other", "Prefer not to say"].includes(input.gender)
  )
    throw new HttpError(400, "Choose a gender from the list.");
  return {
    id: randomUUID(),
    name: input.name.trim(),
    label: input.name.trim(),
    recordedAge: age,
    gender: input.gender || null,
    email: input.email || null,
    historySummary: input.historySummary.trim(),
    source: "Added by clinician",
    createdAt: new Date().toISOString(),
  };
}

export function answerState(
  state,
  { questionId, value, revision, summary },
  method = "screen",
) {
  const s = structuredClone(state);
  if (s.status !== "draft" || revision !== s.revision)
    throw new HttpError(
      409,
      "The answer changed. Refresh this session before trying again.",
    );
  const index = s.definition.questions.findIndex((q) => q.id === questionId);
  if (index < 0) throw new HttpError(400, "Unknown question.");
  const question = s.definition.questions[index];
  if (!visibleQuestion(s.definition, s.answers, question))
    throw new HttpError(
      400,
      `${questionId}: this conditional question is not currently applicable.`,
    );
  const invalid = answerError(question, value);
  if (invalid) throw new HttpError(400, invalid);
  const current = currentQuestionIndex(s.definition, s.answers);
  if (current !== -1 && index > current)
    throw new HttpError(409, "Answer the current question first.");
  if (
    method === "gemini" &&
    (typeof summary !== "string" || !summary.trim() || summary.length > 240)
  )
    throw new HttpError(400, "Provide a brief response summary.");
  const rendered = presentation(s.definition, s.language).questions[index];
  const at = new Date().toISOString();
  s.answerDetails ||= s.answers.map(() => null);
  s.answerRevisions ||= [];
  if (
    s.answers[index] !== null &&
    JSON.stringify(s.answers[index]) !== JSON.stringify(value)
  ) {
    s.answerRevisions.push({
      questionId,
      previousValue: s.answers[index],
      value,
      previousLabel: responseLabel(rendered, s.answers[index]),
      responseLabel: responseLabel(rendered, value),
      method,
      at,
      revision: s.revision + 1,
    });
  }
  s.answerDetails[index] = {
    method,
    at,
    summary: method === "gemini" ? summary.trim() : null,
    feedback: answerType(question) === "text",
  };
  s.answers[index] = value;
  // Re-evaluate in source order; changing a parent clears newly inapplicable descendants.
  s.definition.questions.forEach((q, i) => {
    if (s.answers[i] !== null && !visibleQuestion(s.definition, s.answers, q)) {
      s.answerRevisions.push({
        questionId: q.id,
        previousValue: s.answers[i],
        value: null,
        previousLabel: responseLabel(
          presentation(s.definition, s.language).questions[i],
          s.answers[i],
        ),
        responseLabel: "Not applicable (condition)",
        method: "condition",
        at,
        revision: s.revision + 1,
      });
      s.answers[i] = null;
      s.answerDetails[i] = null;
    }
  });
  s.revision++;
  return s;
}

export function finalizeState(state, revision) {
  const s = structuredClone(state);
  if (s.status === "completed") return s;
  if (s.revision !== revision)
    throw new HttpError(409, "Answers changed; review them again.");
  if (currentQuestionIndex(s.definition, s.answers) !== -1)
    throw new HttpError(400, "Answer every question before saving.");
  let result;
  try {
    result = scoreDefinition(s.definition, s.answers);
  } catch (error) {
    throw new HttpError(400, error.message);
  }
  Object.assign(s, result, {
    status: "completed",
    completedAt: new Date().toISOString(),
  });
  s.revision++;
  return s;
}
