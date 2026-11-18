import { records } from "../../src/workspace/catalogue.js";
import { validateReporting } from "../../src/workspace/report-calculation.js";
const errors = [], modes = {}, methods = {};
let rules = 0, remainingWork = 0;
for (const { definition: d } of records.values()) {
  for (const issue of validateReporting(d)) errors.push(`${d.id}: ${issue}`);
  modes[d.reporting.mode] = (modes[d.reporting.mode] || 0) + 1;
  for (const r of d.scoring.rules) { rules++; methods[r.method] = (methods[r.method] || 0) + 1; }
  if (d.scoring.remaining_work?.length) remainingWork++;
}
console.log(JSON.stringify({ assessments: records.size, rules, modes, methods, remainingWork, errors, clinicalValidation: "Not established by configuration checks" }, null, 2));
if (errors.length) process.exitCode = 1;
