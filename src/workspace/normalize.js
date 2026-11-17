import { createHash } from "node:crypto";
import { questionIssue } from "../../public/shared/answers.js";
import { validateDefinition } from "./definition.js";
// Preserve the application's existing identifier when the source bundle renames GAD-7.
const sourceAliases = {
  "generalised-anxiety-disorder-assessment-gad-7--265a24c61d94": "GAD7",
};
const text = (value) => (typeof value === "string" ? value.trim() : "");
export function normalizeAssessment(raw) {
  if (!raw || !text(raw.assessment_id) || !text(raw.assessment?.name))
    throw new Error("Assessment ID and name are required.");
  const warnings = [];
  const sets = new Map(
    (raw.questionnaire?.response_sets || []).map((s) => [
      s.id,
      s.options || [],
    ]),
  );
  const items = raw.questionnaire?.items || [];
  const order = raw.administration?.item_order || items.map((q) => q.id);
  if (
    new Set(order).size !== order.length ||
    order.length !== items.length ||
    order.some((id) => !items.some((q) => q.id === id))
  )
    warnings.push("Question order is incomplete or ambiguous.");
  const questions = items
    .map((q) => {
      const sourceOptions = sets.get(q.response_set_id) || q.options || [];
      const values = sourceOptions.map((o) =>
        Object.hasOwn(o, "response_value") ? o.response_value : o.printed_value,
      );
      const retainValues =
        values.every(Number.isInteger) &&
        new Set(values).size === values.length;
      return {
        id: q.id,
        text: text(q.text),
        context_text: text(q.context_text),
        context_source: q.context_source || null,
        response_type: q.response_type || "choice",
        selection_mode:
          q.selection_mode || q.input_spec?.selection_mode || null,
        input_spec: q.input_spec || null,
        display_if: q.display_if || null,
        allowSkip:
          q.input_spec?.allow_not_applicable === true ||
          /\bskip if not applicable\b/i.test(q.text),
        options: sourceOptions.map((o, i) => ({
          id: o.id,
          value: retainValues ? values[i] : o.id,
          printed_value: o.printed_value ?? null,
          label: text(o.display_label) || text(o.label) || text(o.text),
          score: Number.isInteger(o.score) ? o.score : null,
        })),
        source: q.source || null,
      };
    })
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  if (!questions.length) warnings.push("No captured questions are available.");
  if (questions.length > 250)
    warnings.push(
      "This questionnaire exceeds the supported 250-question limit.",
    );
  if (
    questions.length !== raw.questionnaire?.item_count ||
    new Set(questions.map((q) => q.id)).size !== questions.length
  )
    warnings.push("Question count or identifiers need review.");
  for (const q of questions) {
    const issue = questionIssue(q, questions);
    if (issue) warnings.push(issue);
  }
  if (!text(raw.administration?.instructions))
    warnings.push("Administration instructions are missing.");
  const period = raw.assessment.reference_period;
  const definition = {
    schemaVersion: 3,
    id: sourceAliases[raw.assessment_id] || raw.assessment_id,
    version: raw.definition_version || "unversioned",
    title: raw.assessment.name,
    shortTitle: raw.assessment.short_name || raw.assessment.name,
    description: text(raw.assessment.description),
    language: raw.assessment.language || "en",
    referencePeriod:
      text(period?.structured?.label) ||
      text(period?.label) ||
      text(period) ||
      (period?.instruction_claims?.length === 1
        ? text(period.instruction_claims[0])
        : null) ||
      null,
    instructions: text(raw.administration?.instructions),
    questions: [...questions].sort(
      (a, b) => order.indexOf(a.id) - order.indexOf(b.id),
    ),
    scoring: {
      enabled: false,
      method: null,
      reason:
        raw.scoring?.disabled_reason ||
        raw.scoring?.reason ||
        "Scoring rules are not validated in the supplied catalogue.",
    },
    runnable: warnings.length === 0,
    availabilityReason: warnings.join(" "),
    review: {
      status:
        raw.review?.questionnaire_status ||
        raw.review?.status ||
        "needs_review",
      issues: raw.review?.issues || [],
      readyForClinicalUse: raw.review?.ready_for_clinical_use === true,
      questionnaireCompletenessVerified:
        raw.review?.questionnaire_completeness_verified === true,
    },
    provenance: {
      sourceAssessmentId: raw.assessment_id,
      sourceUrl:
        raw.provenance?.source_url ||
        raw.administration?.selected_form_url ||
        questions[0]?.source?.url ||
        null,
    },
  };
  if (
    raw.scoring?.method === "sum" &&
    raw.scoring.enabled !== false &&
    questions.every((q) => q.options.every((o) => Number.isInteger(o.score)))
  ) {
    const scoring = {
      enabled: true,
      method: "sum",
      min: raw.scoring.minimum_score,
      max: raw.scoring.maximum_score,
      bands: (raw.scoring.severity_bands || []).map((b) => ({
        min: b.minimum_inclusive,
        max: b.maximum_inclusive,
        label: b.label === "None-Minimal" ? "Minimal" : b.label,
      })),
    };
    try {
      validateDefinition({ ...definition, scoring });
      definition.scoring = scoring;
    } catch {
      definition.scoring.reason =
        "Structured scoring rules did not pass validation.";
    }
  }
  return {
    definition,
    sourceHash: createHash("sha256")
      .update(JSON.stringify({ importerVersion: 3, raw }))
      .digest("hex"),
  };
}
