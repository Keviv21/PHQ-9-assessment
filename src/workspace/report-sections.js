import { plainSourceText } from "./report-model.js";
const esc = v => plainSourceText(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const date = v => Number.isFinite(Date.parse(v)) ? new Date(v).toISOString().slice(0, 10) : "Not recorded";
const table = (head, rows) => `<table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
export function metricChart(m) {
  if (!(m.max > m.min)) return "";
  const points = m.points || [];
  if (!points.some(p => Number.isFinite(p.value))) return "";
  const x = i => 60 + i * 580 / Math.max(1, points.length - 1);
  const y = v => 135 - (v - m.min) * 100 / (m.max - m.min);
  let drawing = "";
  if (points.length === 1) {
    const width = (points[0].value - m.min) * 580 / (m.max - m.min);
    drawing = `<rect x="60" y="60" width="580" height="24" fill="#e4edf7"/><rect x="60" y="60" width="${Math.max(0, width)}" height="24" fill="#2767aa"/><text x="60" y="48">Current result: ${esc(points[0].value)} ${esc(m.unit)}</text><text x="60" y="110">${m.min}</text><text x="640" y="110" text-anchor="end">${m.max}</text>`;
  } else {
    for (let i = 0; i < points.length; i++) {
      const p = points[i], prev = points[i - 1];
      if (!Number.isFinite(p.value)) continue;
      if (prev && Number.isFinite(prev.value)) drawing += `<line x1="${x(i - 1)}" y1="${y(prev.value)}" x2="${x(i)}" y2="${y(p.value)}" stroke="#2767aa" stroke-width="2"/>`;
      drawing += `<circle cx="${x(i)}" cy="${y(p.value)}" r="4" fill="#2767aa"><title>${esc(date(p.date))}: ${esc(p.value)}</title></circle>`;
    }
    drawing += `<text x="48" y="40" text-anchor="end">${m.max}</text><text x="48" y="140" text-anchor="end">${m.min}</text><text x="60" y="165">${date(points[0].date)}</text><text x="640" y="165" text-anchor="end">${date(points.at(-1).date)}</text>`;
  }
  return `<section class="metric-chart"><h3>${esc(m.label)}</h3><p>${esc(m.note || "")} ${esc(m.unit)} · range ${m.min}–${m.max}. Blue indicates a recorded value, not a clinical judgement.</p><svg viewBox="0 0 700 190" role="img" aria-label="${esc(m.label)}"><title>${esc(m.label)}</title>${drawing}</svg>${points.length > 1 ? table(["Visit date", m.unit], points.map(p => [date(p.date), p.value ?? "Unavailable"])) : ""}</section>`;
}
export function reportSections(r) {
  const parts = [];
  if (r.preview) parts.push('<p class="notice"><strong>DEVELOPMENT PREVIEW — SYNTHETIC DATA ONLY</strong></p>');
  parts.push(table(["Report property", "Value"], [["Patient ID", r.patient.id], ["Respondent", r.respondent], ["Status", r.status], ["Reporting mode", r.reportingMode], ["Reporting version", r.reportingVersion], ["Definition source", r.definitionSource], ["Review status", r.reviewStatus]]));
  if (r.metrics.length) parts.push("<h2>Configured results</h2>", table(["Metric", "Result", "Range / unit", "Calculation status"], r.metrics.map(m => [m.label, m.value === null ? "Unavailable" : `${m.value}${m.descriptor ? " · " + m.descriptor : ""}`, `${m.min}–${m.max} ${m.unit}`, m.reason || m.status.replaceAll("_", " ")])));
  if (r.protocol) parts.push(`<h2>Screening state</h2><p>${esc(r.protocol.label)}</p><p>No numeric total is defined.</p>`);
  parts.push(...r.metricHistory.map(metricChart));
  if (r.itemCharts?.length) parts.push("<h2>Configured item charts</h2>", ...r.itemCharts.map(c => metricChart(c) || `<p>${esc(c.label)}: unavailable — numeric item scoring is disabled or a required response is missing.</p>`));
  if (r.comparisons.length) parts.push("<h2>Previous and baseline comparisons</h2>", table(["Metric", "Reference", "Date", "Reference value", "Change"], r.comparisons.map(c => [c.metric, c.reference, date(c.date), c.value, `${c.delta > 0 ? "+" : ""}${c.delta} ${c.unit}`])));
  parts.push(`<p>${esc(r.historyNote)}</p>`);
  if (r.requiredContext.length) parts.push("<h2>Required context</h2>", table(["Context", "Recorded value"], r.requiredContext.map(c => [c.key, c.value])));
  if (r.responseGroups.length) parts.push("<h2>Configured response groups</h2>", ...r.responseGroups.map(g => `<h3>${esc(g.label)}</h3>${table(["Item", "Saved response", "Status"], g.responses.map(q => [q.questionId, q.response, q.status.replaceAll("_", " ")]))}`));
  if (r.responseHistory.length) parts.push("<h2>Response history</h2>", ...r.responseHistory.map(h => `<details open class="item-history"><summary>${esc(h.id)} · ${esc(h.question)}</summary>${table(["Completed", "Response", "Status"], h.visits.map(v => [date(v.date), v.response, v.status.replaceAll("_", " ")]))}</details>`));
  if (r.limitations.length) parts.push(`<h2>Limitations</h2><ul>${r.limitations.map(t => `<li>${esc(t)}</li>`).join("")}</ul>`);
  if (r.attribution.length) parts.push(`<details open class="attribution"><summary>Assessment attribution and source notices</summary>${r.attribution.map(t => `<p>${esc(t)}</p>`).join("")}</details>`);
  return parts.join("");
}
