import {
  recommendAssessments,
  validateRecommendationContext,
} from "../clinical/recommendation.js";
import { suggestForDemoPatient } from "../legacy/demo-patients.js";
import { definition } from "./catalogue.js";
import { HttpError } from "./errors.js";

const labels = {
  depression: "Low mood or reduced interest",
  anxiety: "Worry or anxiety",
  traumaSymptoms: "Trauma-related symptoms",
  stress: "Stress",
};
// Reuse main's structured routing rules. Free-text symptoms are handled by Gemini,
// never guessed or converted into structured clinical observations here.
export function doctorGuidance(patient, input) {
  if (
    input !== undefined &&
    (!input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      !input.context ||
      Object.keys(input).some((k) => !["context", "focus"].includes(k)))
  )
    throw new HttpError(400, "Provide structured doctor review details.");
  const sample =
    patient.source === "Sample" ? suggestForDemoPatient(patient.id) : null;
  const age = patient.recordedAge;
  const defaults = sample?.context || {
    ageGroup:
      age == null
        ? "unknown"
        : age < 19
          ? "under19"
          : age >= 65
            ? "65plus"
            : "19to64",
    concerns: [],
    traumaExposure: "notReported",
    safetyStatus: "notReviewed",
  };
  let context;
  try {
    context = validateRecommendationContext(input?.context ?? defaults);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  const focus = input?.focus ?? "";
  if (typeof focus !== "string" || (focus && !context.concerns.includes(focus)))
    throw new HttpError(
      400,
      "Choose a priority from the selected current concerns.",
    );
  const result = recommendAssessments(context);
  const suggestions = result.recommendations
    .map((item) => {
      const assessment = definition(item.catalogDraftId);
      const evidence =
        sample?.recommendations.find((r) => r.id === item.id)?.evidence || [];
      const eligible = item.availability !== "requires_trauma_review";
      return {
        assessmentId: item.catalogDraftId,
        title: assessment?.title || item.title,
        purpose: item.purpose,
        reason: item.reason,
        caution: [item.note, ...(item.missingInformation || [])]
          .filter(Boolean)
          .join(" "),
        source: item.source,
        evidence,
        available: eligible && !!assessment?.runnable,
        availability: !eligible
          ? "Review trauma exposure first"
          : !assessment?.runnable
            ? "Questionnaire content needs review"
            : "Available to prescribe",
        focusMatch: !!focus && item.matchedConcerns.includes(focus),
        priority: item.priority,
      };
    })
    .sort(
      (a, b) =>
        Number(b.focusMatch) - Number(a.focusMatch) || a.priority - b.priority,
    );
  return {
    method: "structured",
    status: result.status,
    context,
    focus,
    reply: result.message,
    suggestions,
    primaryAssessmentId:
      suggestions.find((s) => s.available)?.assessmentId || null,
    clarificationOptions: context.concerns.map((value) => ({
      value,
      label: labels[value],
    })),
    ignoredObservations: sample?.ignoredObservations || [],
    contextSource: sample ? "Sample patient summary" : "Clinician review",
  };
}
