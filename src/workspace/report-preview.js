import { answerType, answerError, numericSchema } from "../../public/shared/answers.js";
import { reportCondition } from "./report-calculation.js";
import { assessmentReport } from "./report.js";

// Deliberately accepts a definition, never a patient/session or supplied answers.
// This developer-only helper is not exposed through the workspace API.
export function syntheticReport(d) {
  const answers = Array(d.questions.length).fill(null), context = {};
  for (const c of d.reporting?.required_context || []) context[c.key] = c.type === "boolean" ? false : c.allowed_values?.[0];
  for (const [i, q] of d.questions.entries()) {
    if (reportCondition(q.display_if, d, answers, context) !== true) continue;
    const type = answerType(q);
    const candidates = type === "text" ? ["Synthetic fixture response"] : ["integer", "number"].includes(type)
      ? [numericSchema(q).minimum ?? 0, 1, 5, 10]
      : q.options.map(o => type === "multiple_choice" ? [o.value] : o.value);
    answers[i] = candidates.find(v => !answerError(q, v)) ?? null;
  }
  return assessmentReport({ id: `synthetic-${d.id}`, patientId: "synthetic-development-preview", synthetic: true,
    assessmentId: d.id, definition: d, context, language: d.language || "en", sessionMode: "screen", status: "completed",
    startedAt: "2000-01-01T00:00:00.000Z", completedAt: "2000-01-01T00:01:00.000Z", answers,
  }, { id: "synthetic-development-preview", name: "SYNTHETIC DEVELOPMENT FIXTURE", recordedAge: null }, [], { syntheticPreview: true });
}
