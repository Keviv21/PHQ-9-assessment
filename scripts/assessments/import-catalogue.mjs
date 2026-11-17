import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { normalizeAssessment } from "../../src/workspace/normalize.js";
import { validateDefinition } from "../../src/workspace/definition.js";
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error(
    "Usage: node scripts/assessments/import-catalogue.mjs <source.json> <output.json>",
  );
const bytes = readFileSync(input),
  raw = JSON.parse(bytes);
if (
  !Array.isArray(raw.assessments) ||
  !raw.assessments.length ||
  (raw.assessment_count !== undefined &&
    raw.assessment_count !== raw.assessments.length) ||
  (raw.summary?.assessment_count !== undefined &&
    raw.summary.assessment_count !== raw.assessments.length)
)
  throw new Error("Invalid catalogue count.");
const records = raw.assessments.map((a) => ({
  ...normalizeAssessment(a),
  metadata: a.assessment,
}));
const ids = new Set(records.map((r) => r.definition.id));
if (ids.size !== records.length) throw new Error("Duplicate assessment IDs.");
for (const r of records)
  if (r.definition.runnable) validateDefinition(r.definition);
if (existsSync(output)) {
  const previous = JSON.parse(readFileSync(output));
  if (previous.records.some((r) => !ids.has(r.definition.id)))
    throw new Error(
      "The replacement would remove existing assessment IDs. Provide an explicit ID migration first.",
    );
}
writeFileSync(
  output,
  JSON.stringify({
    source: basename(input),
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    records,
  }) + "\n",
);
console.log(
  JSON.stringify({
    assessments: records.length,
    runnable: records.filter((r) => r.definition.runnable).length,
    questions: records.reduce((n, r) => n + r.definition.questions.length, 0),
    scored: records.filter((r) => r.definition.scoring.enabled).length,
  }),
);
