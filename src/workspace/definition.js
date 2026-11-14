import {
  questionIssue,
  answerError,
  answerType,
  visibleQuestion,
  conditionState,
  isSkipped,
} from "../../public/workspace-answers.js";
// Definitions and answers share the browser/server contract; scoring stays explicit.
export function validateDefinition(d) {
  const fail = () => {
    throw new Error("Invalid or unsupported assessment definition.");
  };
  if (
    ![1, 2, 3].includes(d?.schemaVersion) ||
    !d.id ||
    !d.version ||
    !d.title ||
    !d.instructions ||
    !Array.isArray(d.questions) ||
    !d.questions.length ||
    d.questions.length > 250
  )
    fail();
  const ids = new Set();
  let min = 0,
    max = 0;
  for (const q of d.questions) {
    const issue = questionIssue(q, d.questions);
    if (!q.id || ids.has(q.id) || issue)
      throw new Error(issue || "Duplicate question ID.");
    ids.add(q.id);
    // Written feedback and numeric measurements have no implicit scoring rule.
    if (d.scoring?.enabled !== false && answerType(q) !== "text") {
      if (
        answerType(q) !== "single_choice" ||
        q.display_if ||
        q.allowSkip ||
        q.options.some((o) => !Number.isInteger(o.score))
      )
        fail();
      min += Math.min(...q.options.map((o) => o.score));
      max += Math.max(...q.options.map((o) => o.score));
    }
  }
  if (d.scoring?.enabled === false) return d;
  if (d.scoring?.method !== "sum") fail();
  if (
    d.scoring.min !== min ||
    d.scoring.max !== max ||
    max - min > 10000 ||
    !Array.isArray(d.scoring.bands) ||
    !d.scoring.bands.length
  )
    fail();
  let next = min;
  for (const band of d.scoring.bands) {
    if (
      band.min !== next ||
      !Number.isInteger(band.max) ||
      band.max < band.min ||
      !band.label
    )
      fail();
    next = band.max + 1;
  }
  if (next !== max + 1) fail();
  return d;
}

export function scoreDefinition(definition, answers) {
  validateDefinition(definition);
  if (!Array.isArray(answers) || answers.length !== definition.questions.length)
    throw new Error("Answer every question before saving.");
  const score = definition.questions.reduce((sum, question, index) => {
    const visibility = conditionState(question.display_if, definition, answers);
    if (visibility === null)
      throw new Error(`${question.id}: conditional dependency is unresolved.`);
    if (!visibleQuestion(definition, answers, question)) {
      if (answers[index] !== null)
        throw new Error(`${question.id}: hidden question has an answer.`);
      return sum;
    }
    const error = answerError(question, answers[index]);
    if (error) throw new Error(error);
    if (isSkipped(answers[index]) || answerType(question) === "text")
      return sum;
    const option = question.options.find((o) => o.value === answers[index]);
    return sum + (option?.score ?? 0);
  }, 0);
  if (definition.scoring.enabled === false)
    return { score: null, severity: null };
  const severity = definition.scoring.bands.find(
    (b) => score >= b.min && score <= b.max,
  ).label;
  return { score, severity };
}
