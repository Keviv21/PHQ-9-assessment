import { categorizeAssessment } from "./categories.js";
import { readFileSync } from "node:fs";
const bundle = JSON.parse(
  readFileSync(
    new URL("../../data/assessments/catalogue.json", import.meta.url),
    "utf8",
  ),
);
export const records = new Map(bundle.records.map((r) => [r.definition.id, r]));
export function catalogue() {
  return [...records.values()]
    .map(({ definition: d, metadata }) => ({
      id: d.id,
      title: d.title,
      category: categorizeAssessment(d.title, d.description),
      description: d.description,
      questionCount: d.questions.length,
      runnable: d.runnable,
      reason: d.availabilityReason,
      scoringEnabled: d.scoring.enabled,
      draftScoringAvailable: d.reporting?.mode === "numeric_scores" && d.scoring.rules?.length > 0,
      version: d.version,
      metadata,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
export function definition(id) {
  return records.get(id)?.definition;
}
