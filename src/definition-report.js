import { contentHash, displayText, displayTitle, scoringRuntimeHash } from './assessment-content.js';
import { conditionState } from './definition-scoring.js';
import { phq9VisualData, phq9ReportHtml } from './phq9-report.js';
import { analysisVisualData, analysisReportHtml } from './analysis-report.js';
import { reportVisualSpecData, visualReportHtml } from './visual-report.js';
import { getDefinition } from './definition-library.js';

export const reportTemplateVersion = 'assessment-report-2';
export function withActiveReportVisualSpec(state, activeDefinition = getDefinition(state.formId)) {
  const savedVersionId = state.formSnapshot?.versionId ?? state.formVersion;
  const spec = activeDefinition?.reporting?.reportVisualSpec;
  if (!spec || activeDefinition.id !== state.formId || activeDefinition.versionId !== savedVersionId ||
      spec.assessmentId !== state.formId || spec.assessmentVersionId !== savedVersionId) return state;
  if (state.formSnapshot?.reporting?.reportVisualSpec?.visualSpecVersionId === spec.visualSpecVersionId) return state;
  return { ...state, formSnapshot: { ...state.formSnapshot,
    reporting: { ...state.formSnapshot.reporting, reportVisualSpec: spec } } };
}
export function comparisonKey(state) {
  return contentHash({ patient: state.demoPatientId, id: state.formId,
    version: state.formSnapshot.id.startsWith('patient-health-questionnaire-depression-phq-9--') && state.formSnapshot.runtimeHash === scoringRuntimeHash(state.formSnapshot)
      ? state.formSnapshot.runtimeHash : state.formSnapshot.versionId ?? state.formVersion,
    content: state.formSnapshot.runtimeHash ?? state.formSnapshot,
    reportProfileVersion: state.formSnapshot.reporting?.analysisProfile?.profileVersionId ?? null,
    reportVisualSpecVersion: state.formSnapshot.reporting?.reportVisualSpec?.visualSpecVersionId ?? null,
    language: state.formSnapshot.language || 'en', context: state.context || {},
    engine: state.scores?.engineVersion ?? 'legacy', status: state.scores?.status });
}
function responseLabel(state, item) {
  const visible = conditionState(item.displayIf, state.answers, state.formSnapshot.questions, state.context);
  if (visible === null) return 'Eligibility unknown';
  if (!visible) return 'Not applicable';
  if (!Object.hasOwn(state.answers, item.id)) return 'Unanswered';
  const label = answer => item.options?.find(o => o.id === answer)?.text ?? String(answer);
  const answer = state.answers[item.id];
  return Array.isArray(answer) ? answer.map(label).join(', ') : label(answer);
}
export function buildDefinitionReport(state, history = []) {
  state = withActiveReportVisualSpec(state);
  history = history.map(visit => withActiveReportVisualSpec(visit));
  if (state.status !== 'completed' || !state.scores) throw new RangeError('Complete the assessment before generating a report.');
  const d = state.formSnapshot;
  const earlier = history.filter(s => s.id !== state.id && s.status === 'completed' && s.completedAt <= state.completedAt && comparisonKey(s) === comparisonKey(state))
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id));
  const visits = [...earlier, state];
  const metrics = (state.scores.metrics || []).map(m => {
    const config = d.reporting?.metrics?.find(c => c.rule_id === m.id);
    const points = visits.map(s => ({ date: s.completedAt, value: s.scores?.metrics?.find(x => x.id === m.id)?.value ?? null }));
    const delta = point => Number.isFinite(m.value) && Number.isFinite(point?.value) ? Number((m.value - point.value).toFixed(4)) : null;
    return { ...m, label: displayText(config?.label || m.label), unit: config?.axis_unit || 'score',
      previousChange: delta(points.at(-2)), baselineChange: points.length > 1 ? delta(points[0]) : null, points };
  });
  const responses = d.questions.map(item => {
    const answer = state.answers[item.id];
    const selected = Array.isArray(answer) ? null : item.options?.find(option => option.id === answer);
    return { id: item.id, order: item.order, text: item.text,
      value: responseLabel(state, item), selectedOptionId: selected?.id ?? null,
      printedValue: Number.isFinite(selected?.printed_value) ? selected.printed_value : null,
      options: (item.options || []).map(option => ({ id: option.id, text: option.text,
        printedValue: Number.isFinite(option.printed_value) ? option.printed_value : null })),
      history: visits.map(s => ({ date: s.completedAt,
        value: responseLabel(s, s.formSnapshot.questions.find(q => q.id === item.id)) })) };
  });
  const groups = (d.reporting?.response_groups || []).map(g => ({ label: g.label, responses: g.item_ids.map(id => responses.find(r => r.id === id)).filter(Boolean) }));
  const limitations = [...new Set([
    'Draft results are not clinically validated. No diagnosis, percentile or reliable-change conclusion is inferred.',
    ...(d.scoringLimitations || []), ...(d.remainingWork || []), ...(d.reporting?.coverage?.remaining_work || []),
    ...(d.verification?.remainingWork || []),
    ...(d.reporting?.paired_profile ? ['Paired profile unavailable until compatible paired administrations and interpretation are verified.'] : []),
  ].map(displayText).filter(Boolean))];
  return { id: state.id, title: displayTitle(d.title), description: displayText(d.description), administration: displayText(d.administration),
    patient: state.patientDetails?.name || state.demoPatientId, patientId: state.demoPatientId,
    patientDetails: state.patientDetails || null, completedAt: state.completedAt, definitionVersion: d.version,
    definitionVersionId: d.versionId ?? state.formVersion, engineVersion: state.scores.engineVersion ?? 'Legacy saved result',
    reportVersion: reportTemplateVersion, mode: d.reporting?.mode ?? (metrics.length ? 'numeric_scores' : 'descriptive_responses'),
    reportProfileVersionId: d.reporting?.analysisProfile?.profileVersionId ?? null,
    draftLabel: state.scores.label || 'Draft score — not clinically validated',
    visualSpec: reportVisualSpecData(d, metrics, visits),
    analysis: analysisVisualData(d, metrics), phq9: d.reporting?.analysisProfile ? null : phq9VisualData(d, metrics, state.answers), metrics, responses, groups, context: state.context || {}, visits: visits.map(s => ({ id: s.id, date: s.completedAt })),
    limitations, references: d.references || [] };
}

const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const number = n => Number.isFinite(n) ? String(n) : '—';
const date = value => new Date(value).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC';
function chart(metric) {
  if (!Number.isFinite(metric.minimum) || !Number.isFinite(metric.maximum) || metric.maximum <= metric.minimum) return '';
  const valid = metric.points.filter(p => Number.isFinite(p.value));
  if (!valid.length) return '';
  const times = metric.points.map(p => Date.parse(p.date)), minTime = Math.min(...times), maxTime = Math.max(...times);
  const x = p => minTime === maxTime ? 320 : 50 + (Date.parse(p.date) - minTime) / (maxTime - minTime) * 550;
  const y = v => 170 - (v - metric.minimum) / (metric.maximum - metric.minimum) * 140;
  const ticks = [metric.minimum, (metric.minimum + metric.maximum) / 2, metric.maximum].map(v => `<line x1="50" x2="600" y1="${y(v)}" y2="${y(v)}" stroke="#dbe3ec"/><text x="42" y="${y(v) + 4}" text-anchor="end">${number(Number(v.toFixed(2)))}</text>`).join('');
  // A missing score breaks the line; it is never plotted as zero or bridged.
  const segments = []; let current = [];
  for (const p of metric.points) { if (Number.isFinite(p.value)) current.push(p); else { if (current.length) segments.push(current); current = []; } }
  if (current.length) segments.push(current);
  return `<figure><figcaption>${esc(metric.label)} · ${esc(metric.unit)} · ${number(metric.minimum)} to ${number(metric.maximum)}</figcaption><svg viewBox="0 0 640 215" role="img" aria-label="${esc(metric.label)} across saved visits">${ticks}${segments.filter(s => s.length > 1).map(s => `<polyline points="${s.map(p => `${x(p)},${y(p.value)}`).join(' ')}" fill="none" stroke="#506b8c" stroke-width="2"/>`).join('')}${valid.map(p => `<circle cx="${x(p)}" cy="${y(p.value)}" r="4" fill="#506b8c"><title>${esc(date(p.date))}: ${number(p.value)}</title></circle>`).join('')}<text x="50" y="202">${esc(metric.points[0].date.slice(0, 10))}</text><text x="600" y="202" text-anchor="end">${metric.points.length > 1 ? esc(metric.points.at(-1).date.slice(0, 10)) : 'Current visit'}</text></svg></figure>`;
}
function responseTable(responses) {
  return `<table><thead><tr><th>Item</th><th>Question</th><th>Response</th></tr></thead><tbody>${responses.map(r => `<tr><td>${esc(r.order ?? r.id)}</td><td>${esc(r.text)}</td><td>${esc(r.value)}</td></tr>`).join('')}</tbody></table>`;
}
export function definitionReportHtml(report, { printControls = true } = {}) {
  if (report.visualSpec) return visualReportHtml(report, { printControls });
  if (report.analysis) return analysisReportHtml(report, { printControls });
  if (report.phq9) return phq9ReportHtml(report, { printControls });
  const metricRows = report.metrics.map(m => `<tr><td>${esc(m.label)}</td><td>${m.value === null ? esc(m.reason || 'Unavailable') : number(m.value)}</td><td>${number(m.minimum)}–${number(m.maximum)}</td><td>${number(m.previousChange)}</td><td>${number(m.baselineChange)}</td></tr>`).join('');
  const history = report.visits.length > 1 ? `<h2>Response history</h2><p>Only compatible saved definitions, respondent context and scoring engines are compared. Numeric changes are not improvement claims.</p>${report.responses.map(r => `<details open><summary>${esc(r.text)}</summary><table><tbody>${r.history.map(v => `<tr><td>${esc(date(v.date))}</td><td>${esc(v.value)}</td></tr>`).join('')}</tbody></table></details>`).join('')}` : '<p>One completed visit is available. Complete a compatible assessment again to see change over time.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(report.title)} | OpenMind</title><style>
body{font:15px/1.55 system-ui,sans-serif;color:#24334b;background:#f2f5fa;margin:0}main{max-width:1000px;margin:24px auto;padding:36px;background:white;border-radius:12px}h1{font-size:28px;line-height:1.2}h2{font-size:20px;margin-top:32px}h3{font-size:16px}p{white-space:pre-line}table{width:100%;overflow-wrap:anywhere;border-collapse:collapse;margin:12px 0 24px;font-size:13px}td,th{border-bottom:1px solid #dbe3ec;text-align:left;padding:9px;vertical-align:top}th{background:#edf2f8}figure{margin:20px 0;break-inside:avoid}figcaption{font-weight:600}svg{width:100%;max-height:260px;font-size:12px}.notice{padding:14px;background:#fff5df;border-left:4px solid #ca8f1c}.meta{overflow-wrap:anywhere;color:#5e6d82;font-size:13px}.toolbar{display:flex;gap:18px;flex-wrap:wrap}a{color:#235d98}details{margin:12px 0}summary{font-weight:600}tr{break-inside:avoid}@media(max-width:600px){main{margin:0;padding:18px}table{font-size:12px}td,th{padding:5px}}@media print{body{background:white}main{margin:0;padding:0;max-width:none}.toolbar{display:none}thead{display:table-header-group}h2,h3{break-after:avoid}}
</style></head><body><main>${printControls ? `<nav class="toolbar"><a href="/?view=reports&amp;patient=${encodeURIComponent(report.patient)}">Back to reports</a><a href="/api/definition-sessions/${encodeURIComponent(report.id)}/report.pdf">Download PDF</a></nav>` : ''}<p class="meta">OPENMIND · ASSESSMENT REPORT</p><h1>${esc(report.title)}</h1><p class="meta">Patient: ${esc(report.patient)} · Completed: ${esc(date(report.completedAt))}</p><p class="notice">${esc(report.draftLabel)}</p><h2>Assessment information</h2><p>${esc(report.description)}</p><h3>Administration</h3><p>${esc(report.administration)}</p>${Object.keys(report.context).length ? `<p>Respondent context: ${esc(Object.entries(report.context).map(([k,v]) => `${k}: ${v}`).join('; '))}</p>` : ''}<h2>Results</h2>${report.mode === 'screening_protocol' ? '<p>Screening responses recorded. Protocol interpretation requires review; no numeric total is generated.</p>' : ''}${metricRows ? `<table><thead><tr><th>Measure</th><th>Result</th><th>Range</th><th>Change from previous</th><th>Change from baseline</th></tr></thead><tbody>${metricRows}</tbody></table>${report.metrics.map(chart).join('')}` : '<p>Responses are shown individually; no numeric total is defined.</p>'}<h2>Responses</h2>${report.groups.length ? report.groups.map(g => `<h3>${esc(g.label)}</h3>${responseTable(g.responses)}`).join('') : responseTable(report.responses)}${history}<h2>Limitations</h2><ul>${report.limitations.map(l => `<li>${esc(l)}</li>`).join('')}</ul>${report.references.length ? `<h2>Instrument references</h2>${report.references.map(r => `<p>${esc(r)}</p>`).join('')}` : ''}<p class="meta">Definition: ${esc(report.definitionVersion)} · Scoring: ${esc(report.engineVersion)} · Report: ${esc(report.reportVersion)}<br>Saved version: ${esc(report.definitionVersionId)}</p></main></body></html>`;
}
