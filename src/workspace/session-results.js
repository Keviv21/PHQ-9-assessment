import { createHash } from "node:crypto";
import { calculateReportMetrics } from "./report-calculation.js";

export const DRAFT_SCORE_LABEL = "Draft score — not clinically validated";
// Bind the stored calculation to the exact saved definition, answers and context.
function inputHash(s) {
  return createHash("sha256").update(JSON.stringify([
    s.definition, s.answers, s.context || {}, s.language,
  ], (_, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
    : value)).digest("hex");
}
export function calculateSessionResults(s) {
  return {
    version: 1,
    calculationVersion: "json-rules-1",
    definitionVersion: s.definition.version,
    calculatedAt: s.completedAt,
    inputHash: inputHash(s),
    mode: "draft_enabled",
    label: DRAFT_SCORE_LABEL,
    metrics: calculateReportMetrics(s.definition, s.answers, s.context, { draftScores: true }),
  };
}
export function savedSessionMetrics(s) {
  const result = s.calculatedResults;
  if (s.status !== "completed" || result?.version !== 1 || result.inputHash !== inputHash(s)) return null;
  return structuredClone(result.metrics);
}
