import { writeFile } from "node:fs/promises";
import { definition, catalogue } from "../../src/workspace/catalogue.js";
import { syntheticReport } from "../../src/workspace/report-preview.js";
import { reportHtml } from "../../src/workspace/report.js";
import { reportPdf } from "../../src/workspace/report-pdf.js";
const [id, output] = process.argv.slice(2);
if (!id || !output) {
  console.log('Usage: npm run reports:preview -- <assessment-id> <output.html|output.pdf>');
  console.log(catalogue().map(d => `${d.id}\t${d.title}`).join("\n"));
  process.exitCode = 1;
} else {
  const d = definition(id);
  if (!d) throw new Error("Unknown assessment ID");
  const report = syntheticReport(d);
  await writeFile(output, output.endsWith(".pdf") ? await reportPdf(report) : reportHtml(report), { mode: 0o600 });
  console.log(`Synthetic development preview saved to ${output}. No patient data was read or changed.`);
}
