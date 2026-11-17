import {
  answerError,
  answerType,
  visibleQuestion,
  isSkipped,
  responseLabel,
} from "../../public/shared/answers.js";
import { createHash } from "node:crypto";
import { presentation } from "./presentation.js";
// Adapted from sagar: group repeat visits by instrument, version and language.
// Snapshot hashes also keep changed questionnaires and score scales separate.
export function groupPatientAssessments(states) {
  const groups = new Map();
  for (const s of states
    .filter((s) => s.status === "completed")
    .sort(
      (a, b) =>
        a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id),
    )) {
    const d = s.definition,
      rendered = presentation(d, s.language),
      scoring = d.scoring;
    const scored =
      scoring?.enabled === true &&
      Number.isFinite(scoring.min) &&
      Number.isFinite(scoring.max) &&
      scoring.max > scoring.min;
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([d.questions, d.scoring, d.localized || null]))
      .digest("hex");
    const key = JSON.stringify([
      s.assessmentId,
      d.version,
      s.language,
      fingerprint,
    ]);
    if (!groups.has(key))
      groups.set(key, {
        key,
        formId: s.assessmentId,
        title: rendered.title,
        version: d.version,
        formVersion: d.version,
        language: s.language,
        scored,
        metrics: scored
          ? [{ name: "Total score", min: scoring.min, max: scoring.max }]
          : [],
        results: [],
      });
    const score =
      scored &&
      Number.isFinite(s.score) &&
      s.score >= scoring.min &&
      s.score <= scoring.max
        ? s.score
        : null;
    const elapsed =
      (Date.parse(s.completedAt) - Date.parse(s.startedAt)) / 1000;
    groups.get(key).results.push({
      id: s.id,
      prescriptionId: s.prescriptionId,
      completedAt: s.completedAt,
      startedAt: s.startedAt,
      collectionMethod:
        s.sessionMode === "screen"
          ? "explicit_choice"
          : "conversational_inference",
      sessionMode: s.sessionMode,
      values: scored ? [score] : [],
      score,
      max: scored ? scoring.max : null,
      severity: score !== null ? s.severity : null,
      answers: s.answers,
      questionCount: d.questions.length,
      answeredCount: d.questions.filter(
        (q, i) =>
          visibleQuestion(d, s.answers, q) &&
          !isSkipped(s.answers[i]) &&
          !answerError(q, s.answers[i]),
      ).length,
      elapsedSeconds:
        Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : null,
      answerRevisions: s.answerRevisions || [],
      responses: rendered.questions.map((q, i) => ({
        id: q.id,
        summary: s.answerDetails?.[i]?.summary || null,
        question: [q.context_text, q.text].filter(Boolean).join(" — "),
        responseType: answerType(q),
        skipped: !visibleQuestion(d, s.answers, q) || isSkipped(s.answers[i]),
        feedback: answerType(q) === "text",
        response: visibleQuestion(d, s.answers, q)
          ? responseLabel(q, s.answers[i])
          : "Not applicable (condition)",
      })),
    });
  }
  return [...groups.values()].sort((a, b) =>
    b.results.at(-1).completedAt.localeCompare(a.results.at(-1).completedAt),
  );
}
