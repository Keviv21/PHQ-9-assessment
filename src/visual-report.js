const finite = Number.isFinite;
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const shown = value => finite(value) ? String(Math.round(value * 100) / 100) : '—';
const date = value => new Date(value).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
});

export function reportVisualSpecData(definition, metrics, visits) {
  const spec = definition.reporting?.reportVisualSpec;
  if (!spec || spec.schemaVersion !== 'report-visual-spec/1.0.0' || spec.assessmentId !== definition.id ||
      spec.assessmentVersionId !== definition.versionId ||
      spec.definitionRef?.questionnaireItemCount !== definition.questions.length) return null;
  const byRule = new Map(metrics.map(metric => [metric.id, metric]));
  let bound = (spec.metricBindings || []).map(binding => {
    const metric = byRule.get(binding.ruleId);
    return { ...binding, value: finite(metric?.value) ? metric.value : null,
      reason: metric?.reason ?? null, points: metric?.points ?? [],
      previousChange: metric?.previousChange ?? null,
      baselineChange: metric?.baselineChange ?? null };
  });
  const deriveValue = (derive, values) => {
    const get = id => values.get(id);
    if (derive?.type === 'weighted_sum') {
      const terms = derive.terms || [];
      return terms.every(term => finite(get(term.metricId)))
        ? terms.reduce((sum, term) => sum + get(term.metricId) * term.weight, 0) : null;
    }
    if (derive?.type === 'divide') {
      const value = get(derive.metricId);
      return finite(value) && finite(derive.divisor) && derive.divisor !== 0 ? value / derive.divisor : null;
    }
    if (derive?.type === 'normal_cdf') {
      const value = get(derive.metricId);
      if (!finite(value) || !finite(derive.mean) || !finite(derive.standardDeviation) || derive.standardDeviation <= 0) return null;
      const z = (value - derive.mean) / derive.standardDeviation;
      const sign = z < 0 ? -1 : 1, x = Math.abs(z) / Math.sqrt(2);
      const t = 1 / (1 + 0.3275911 * x);
      const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
      return 50 * (1 + erf);
    }
    if (derive?.type === 'lookup') {
      const value = get(derive.metricId);
      if (!finite(value)) return null;
      const entries = (derive.values || []).map(entry => Array.isArray(entry)
        ? { score: Number(entry[0]), value: Number(entry[1]) }
        : { score: Number(entry.score), value: Number(entry.value) })
        .filter(entry => finite(entry.score) && finite(entry.value))
        .sort((a, b) => a.score - b.score);
      if (!entries.length) return null;
      const exact = entries.find(entry => entry.score === value);
      if (exact) return exact.value;
      if (value <= entries[0].score) return entries[0].value;
      if (value >= entries.at(-1).score) return entries.at(-1).value;
      const upperIndex = entries.findIndex(entry => entry.score > value);
      const lower = entries[upperIndex - 1], upper = entries[upperIndex];
      if (derive.interpolation !== 'linear') return lower.value;
      return lower.value + (value - lower.score) / (upper.score - lower.score) * (upper.value - lower.value);
    }
    return null;
  };
  const rounded = (value, precision = 4) => finite(value) ? Number(value.toFixed(precision)) : null;
  for (const binding of spec.metricBindings || []) {
    if (!binding.derive) continue;
    const currentValues = new Map(bound.map(metric => [metric.id, metric.value]));
    const dependencies = binding.derive.terms?.map(term => term.metricId) ||
      (binding.derive.metricId ? [binding.derive.metricId] : []);
    const dates = [...new Set(dependencies.flatMap(id =>
      bound.find(metric => metric.id === id)?.points?.map(point => point.date) || []))].sort();
    const points = dates.map(date => {
      const values = new Map(bound.map(metric => [metric.id,
        metric.points?.find(point => point.date === date)?.value ?? null]));
      return { date, value: rounded(deriveValue(binding.derive, values), binding.precision) };
    });
    const value = rounded(deriveValue(binding.derive, currentValues), binding.precision);
    const baseline = points[0]?.value, previous = points.at(-2)?.value;
    bound = bound.map(metric => metric.id === binding.id ? { ...metric, value, points,
      reason: finite(value) ? null : 'Required component scores are unavailable.',
      previousChange: finite(value) && finite(previous) ? rounded(value - previous, binding.precision) : null,
      baselineChange: points.length > 1 && finite(value) && finite(baseline) ? rounded(value - baseline, binding.precision) : null } : metric);
  }
  const variantId = visits.length >= 2 ? 'repeat_administration' : 'first_administration';
  const variant = (spec.variants || []).find(item => item.id === variantId);
  if (!variant) return null;
  return { ...spec, activeVariant: variant, metrics: bound,
    charts: variant.chartIds.map(id => spec.charts.find(chart => chart.id === id)).filter(Boolean) };
}

function metricMap(visual) { return new Map(visual.metrics.map(metric => [metric.id, metric])); }
function bandFor(chart, value) {
  if (!finite(value)) return null;
  return chart.bands.find(band =>
    (band.includeFrom ? value >= band.from : value > band.from) &&
    (band.includeTo ? value <= band.to : value < band.to)) ?? null;
}
function chartSvg(chart, metrics) {
  const sourceSized = finite(chart.widthPt) && finite(chart.heightPt);
  const width = sourceSized ? chart.widthPt : 590;
  const height = sourceSized ? chart.heightPt - 22 : 225;
  const firstTotal = chart.id === 'chart_total_first';
  const firstDomains = chart.id === 'chart_domains_first';
  const left = firstTotal ? 30 : firstDomains ? 30 : 52;
  const right = firstTotal ? 34 : firstDomains ? 6 : 55;
  const top = firstTotal ? 8 : firstDomains ? 5 : 27;
  const bottom = firstTotal ? 33 : firstDomains ? 29 : 38;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const y = value => top + plotHeight - (value - chart.yAxis.minimum) /
    (chart.yAxis.maximum - chart.yAxis.minimum) * plotHeight;
  const tick = chart.yAxis.tickInterval || (chart.yAxis.maximum - chart.yAxis.minimum) / 5;
  const ticks = [];
  for (let value = chart.yAxis.minimum; value <= chart.yAxis.maximum + tick / 10; value += tick) {
    ticks.push(`<text x="${left - 8}" y="${y(value) + 4}" text-anchor="end">${shown(value)}</text>`);
  }
  const bands = (chart.bands || []).map(band => `<rect x="${left}" y="${y(band.to)}" width="${plotWidth}" height="${y(band.from) - y(band.to)}" fill="${esc(band.fill)}" fill-opacity="${band.opacity}"/><text class="zone" x="${width - right - 8}" y="${(y(band.to) + y(band.from)) / 2 + 4}" text-anchor="end">${esc(band.label)}</text>`).join('');
  const gradientId = `gradient-${chart.id}`;
  const gradient = chart.gradient ? `<defs><linearGradient id="${gradientId}" x1="0" y1="1" x2="0" y2="0">${chart.gradient.stops.map((stop, index) => `<stop offset="${index / (chart.gradient.stops.length - 1) * 100}%" stop-color="${esc(stop.color)}" stop-opacity="${stop.opacity}"/>`).join('')}</linearGradient></defs><rect x="${left}" y="${y(chart.gradient.to)}" width="${plotWidth}" height="${y(chart.gradient.from) - y(chart.gradient.to)}" fill="url(#${gradientId})"/>` : '';
  const annotations = (chart.annotations || []).map(annotation => annotation.type === 'threshold_line' && finite(annotation.value)
    ? `<line x1="${left}" x2="${width - right}" y1="${y(annotation.value)}" y2="${y(annotation.value)}" stroke="${esc(annotation.color)}" stroke-width="1.5" stroke-dasharray="6 5"/><rect x="${width - right + 2}" y="${y(annotation.value) - 12}" width="48" height="22" fill="#FFFFFF" stroke="#A0A0A0"/><text x="${width - right + 26}" y="${y(annotation.value) + 4}" text-anchor="middle">${esc(annotation.label)}</text>` : '').join('');
  let marks = '';
  if (chart.type === 'vertical_bar') {
    const values = chart.series.map(series => ({ series, metric: metrics.get(series.metricId) }));
    const step = plotWidth / Math.max(values.length, 1);
    const barWidth = Math.min(firstTotal || firstDomains ? 56 : 88, step * 0.42);
    marks = values.map(({ series, metric }, index) => {
      const center = left + step * (index + .5), value = metric?.value;
      return `${finite(value) ? `<rect x="${center - barWidth / 2}" y="${y(value)}" width="${barWidth}" height="${y(chart.yAxis.minimum) - y(value)}" fill="${esc(series.color)}" stroke="#202020" stroke-width="1.2"/>` : ''}<text x="${center}" y="${height - 12}" text-anchor="middle">${esc(series.label)}</text>${series.valueLabel && finite(value) ? `<text x="${center}" y="${y(value) - 7}" text-anchor="middle">${shown(value)}</text>` : ''}`;
    }).join('');
  } else {
    marks = chart.series.map(series => {
      const metric = metrics.get(series.metricId), points = metric?.points?.filter(point => finite(point.value)) ?? [];
      if (!points.length) return '';
      const times = points.map(point => Date.parse(point.date)), start = Math.min(...times), end = Math.max(...times);
      const x = point => start === end ? left + plotWidth / 2 : left + (Date.parse(point.date) - start) / (end - start) * plotWidth;
      const polyline = points.length > 1 ? `<polyline points="${points.map(point => `${x(point)},${y(point.value)}`).join(' ')}" fill="none" stroke="${esc(series.color)}" stroke-width="${series.lineWidthPt}"/>` : '';
      const marker = points.map(point => series.marker === 'square'
        ? `<rect x="${x(point) - 4}" y="${y(point.value) - 4}" width="8" height="8" fill="${esc(series.color)}"/>`
        : `<circle cx="${x(point)}" cy="${y(point.value)}" r="4.5" fill="${esc(series.color)}"/>`).join('');
      const labels = series.valueLabel ? points.map(point => `<text x="${x(point) + 7}" y="${y(point.value) - 7}">${shown(point.value)}</text>`).join('') : '';
      const dates = points.map(point => `<text x="${x(point)}" y="${height - 10}" text-anchor="middle" transform="rotate(32 ${x(point)} ${height - 10})">${esc(date(point.date))}</text>`).join('');
      return polyline + marker + labels + dates;
    }).join('');
  }
  const legend = chart.legend?.show ? `<g transform="translate(${width - 185} 7)">${chart.series.map((series, index) => `<line x1="0" x2="20" y1="${index * 18}" y2="${index * 18}" stroke="${esc(series.color)}" stroke-width="3"/><text x="26" y="${index * 18 + 4}">${esc(series.label)}</text>`).join('')}</g>` : '';
  const figureWidth = sourceSized ? ` style="width:${chart.widthPt}pt"` : '';
  return `<figure data-chart="${esc(chart.id)}"${figureWidth}><figcaption>${esc(chart.title)}</figcaption><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(chart.title)}">${gradient}${bands}${ticks.join('')}<line x1="${left}" x2="${left}" y1="${top}" y2="${height - bottom}" stroke="#333333" stroke-width="2"/><line x1="${left}" x2="${width - right}" y1="${height - bottom}" y2="${height - bottom}" stroke="#333333" stroke-width="2"/>${annotations}${marks}${legend}</svg></figure>`;
}
function section(title) { return `<h2 class="section-title">${esc(title)}</h2>`; }
function footer(page, total, patient) { return `<footer><span class="mini-brand">◯ OpenMind</span><span>${esc(patient)}</span><span>Page ${page} of ${total}</span></footer>`; }
function descriptor(chart, value) { return bandFor(chart, value)?.label ?? 'Unavailable'; }
function interpretation(report, total, sleep, daytime, totalChart) {
  const desc = descriptor(totalChart, total.value);
  const totalText = finite(total.value)
    ? `The Athens Insomnia Scale was completed on ${date(report.completedAt)}, with a total score of ${shown(total.value)} out of 24. This falls in the ${desc.toLowerCase()} range relative to the clinical cut-off of 6.`
    : 'A complete total score is unavailable.';
  const domainText = finite(sleep.value) && finite(daytime.value)
    ? `The Sleep Difficulty average item score is ${shown(sleep.value)} out of 3. The Daytime Consequences average item score is ${shown(daytime.value)} out of 3. ${daytime.value > sleep.value ? 'Daytime impact is reported at a higher level than night-time sleep difficulty.' : sleep.value > daytime.value ? 'Night-time sleep difficulty is reported at a higher level than daytime impact.' : 'Night-time difficulty and daytime impact are reported at the same level.'}`
    : 'Complete domain scores are unavailable.';
  const change = report.visits.length > 1 && finite(total.baselineChange)
    ? `Across compatible administrations, the current total differs from baseline by ${total.baselineChange > 0 ? '+' : ''}${shown(total.baselineChange)} points. This is a raw-score difference; no reliable-change classification is applied.` : '';
  return [totalText, domainText, change].filter(Boolean).map(text => `<p>${esc(text)}</p>`).join('');
}

function genericVisualReportHtml(report, { printControls = true } = {}) {
  const visual = report.visualSpec;
  const metrics = metricMap(visual);
  const controls = printControls ? `<nav class="toolbar"><a href="/?view=reports&amp;patient=${encodeURIComponent(report.patient)}">Back to reports</a><a href="${esc(report.downloadUrl || `/api/definition-sessions/${encodeURIComponent(report.id)}/report.pdf`)}">Download PDF</a><button onclick="window.print()">Print</button></nav>` : '';
  const resultRows = visual.metrics.map(metric => `<tr><td>${esc(metric.label)}</td><td>${shown(metric.value)}</td><td>${shown(metric.minimum)}–${shown(metric.maximum)}</td><td>${esc(metric.unit || 'score')}</td><td>${shown(metric.previousChange)}</td><td>${shown(metric.baselineChange)}</td></tr>`).join('');
  const charts = visual.charts.map(chart => chartSvg(chart, metrics)).join('');
  const groups = report.groups.length ? report.groups : [{ label: 'Responses', responses: report.responses }];
  const responseTables = groups.map(group => `<h3>${esc(group.label)}</h3><table class="responses generic-responses"><thead><tr><th>#</th><th>Question</th><th>Response</th></tr></thead><tbody>${group.responses.map(response => `<tr><td>${esc(response.order ?? response.id)}</td><td>${esc(response.text)}</td><td>${esc(response.value)}</td></tr>`).join('')}</tbody></table>`).join('');
  const observed = visual.observedLayout || {};
  const evidence = `<p class="evidence">Source layout inventory: ${shown(observed.pageCount)} page(s), ${shown(observed.chartCount)} observed chart candidate(s), and ${shown(observed.tableCount)} observed table(s). Patient values are always calculated from the saved assessment responses.</p>`;
  const limitations = [...new Set([...(report.limitations || []), ...(visual.exceptions || [])])];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(report.title)} | OpenMind report</title><style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;background:#dfe5eb;color:#172338;font:10pt/1.45 Arial,Helvetica,sans-serif}.toolbar{position:sticky;top:0;z-index:2;display:flex;gap:18px;align-items:center;padding:12px 20px;background:#173d66;color:white}.toolbar a{color:white}.toolbar button{padding:6px 12px}.generic-document{width:210mm;min-height:297mm;margin:10mm auto;padding:14mm;background:white}.generic-brand{display:flex;align-items:center;gap:8px;color:#087ba5;border-bottom:2px solid #087ba5;padding-bottom:5mm}.generic-brand strong{font-size:20pt}.generic-document h1{font-size:18pt;line-height:1.2}.meta,.evidence{color:#52647a}.notice{padding:10px 12px;background:#fff5df;border-left:4px solid #ca8f1c}.section-title{font-size:13pt;margin:7mm 0 2mm;padding:1.5mm 2mm;background:#edf7fc;border-top:1px solid #555;border-bottom:1px solid #555}.summary,.responses{border-collapse:collapse;width:100%;margin-bottom:5mm}.summary th,.summary td,.responses th,.responses td{padding:2mm;border-bottom:1px solid #c5ced8;text-align:left;vertical-align:top}.summary th,.responses th{background:#edf7fc}.generic-responses{font-size:8.5pt}figure{margin:5mm auto;width:88%;break-inside:avoid}figcaption{text-align:center;font-size:11pt;font-weight:bold;margin-bottom:1mm}svg{display:block;width:100%;height:auto;overflow:visible;font-size:8pt}.zone{fill:#756969;font-size:7pt}.limitations{font-size:8.5pt}.report-status{font-size:8pt;color:#65758a}@media(max-width:850px){.generic-document{width:auto;margin:0;padding:18px}figure{width:100%}}@media print{body{background:white}.toolbar{display:none}.generic-document{width:auto;min-height:auto;margin:0;padding:0}thead{display:table-header-group}h2,h3{break-after:avoid}}
</style></head><body>${controls}<main class="generic-document"><header class="generic-brand"><span>◯</span><strong>OpenMind</strong></header><h1>${esc(report.title)}</h1><p class="meta">Patient: ${esc(report.patient)} · Completed: ${esc(date(report.completedAt))}</p><p class="notice">${esc(report.draftLabel)}</p>${section('Results')}${resultRows ? `<table class="summary"><thead><tr><th>Measure</th><th>Result</th><th>Range</th><th>Unit</th><th>Previous change</th><th>Baseline change</th></tr></thead><tbody>${resultRows}</tbody></table>` : '<p>No numeric result is defined for this assessment.</p>'}${charts ? `${section(report.visits.length > 1 ? 'Scores Across Administrations' : 'Score Graphs')}${charts}` : ''}${section('Interpretation')}<p>Results are generated from the active assessment definition and the patient’s saved responses. Numeric changes describe score differences and do not by themselves indicate clinical improvement or deterioration.</p>${evidence}${section('Client Responses')}${responseTables}${section('Limitations')}<ul class="limitations">${limitations.map(item => `<li>${esc(item)}</li>`).join('')}</ul><p class="report-status">Visual specification: ${esc(visual.visualSpecVersionId || 'draft')} · Definition: ${esc(report.definitionVersionId)}</p></main></body></html>`;
}

function risVisualReportHtml(report, { printControls = true } = {}) {
  const visual = report.visualSpec, metrics = metricMap(visual);
  const total = metrics.get('metric_total'), percentile = metrics.get('metric_clinical_percentile');
  const depth = metrics.get('metric_poor_sleep_depth'), quantity = metrics.get('metric_poor_sleep_quantity');
  const focus = metrics.get('metric_fearful_focus'), functioning = metrics.get('metric_poor_functioning');
  if (![total, percentile, depth, quantity, focus, functioning].every(Boolean)) {
    throw new Error('RIS report metrics are incomplete.');
  }
  const charts = new Map(visual.charts.map(chart => [chart.id, chart]));
  const selectedCharts = visual.activeVariant.id === 'first_administration'
    ? [charts.get('chart_clinical_percentile'), charts.get('chart_average_scores')]
    : [charts.get('chart_total_history'), charts.get('chart_factor_history')];
  const raw = (metric, itemCount) => finite(metric.value) ? Math.round(metric.value * itemCount) : null;
  const above = finite(total.value) ? total.value > 12 : null;
  const interpretation = above === null ? 'A complete RIS total score is unavailable.' : above
    ? `The total score is above the RIS cutoff of 12. The response pattern is consistent with clinically relevant cognitive, emotional, and behavioural features of insomnia and warrants further assessment.`
    : `The total score is at or below the RIS cutoff of 12. The result does not cross the screening threshold for clinically significant insomnia features.`;
  const controls = printControls ? `<nav class="toolbar"><a href="/?view=reports&amp;patient=${encodeURIComponent(report.patientId || report.patient)}">Back to reports</a><a href="${esc(report.downloadUrl || `/api/definition-sessions/${encodeURIComponent(report.id)}/report.pdf`)}">Download PDF</a><button onclick="window.print()">Print</button></nav>` : '';
  const page = (number, body) => `<section class="report-page ris-page">${body}${footer(number, 4, report.patient)}</section>`;
  const brand = `<header class="brand"><span class="brand-mark">◯</span><span><small>Assessment powered by</small><strong>OpenMind</strong></span></header>`;
  const scoreRows = [[depth, 3, 'Poor Sleep Depth'], [quantity, 3, 'Poor Sleep Quantity'], [focus, 2, 'Fearful Focus'], [functioning, 2, 'Hypnotics & Poor Daytime Functioning']]
    .map(([metric, count, label]) => `<tr><td>${esc(label)}</td><td>${shown(raw(metric, count))}</td><td>${shown(metric.value)}</td></tr>`).join('');
  const responseTable = responses => `<table class="responses ris-responses"><thead><tr><th>#</th><th>Question</th><th>Selected response</th><th>0</th><th>1</th><th>2</th><th>3</th><th>4</th></tr></thead><tbody>${responses.map(response => `<tr><td>${esc(response.order)}</td><td>${esc(response.text)}</td><td>${esc(response.value)}</td>${[0,1,2,3,4].map(value => `<td class="choice ${response.printedValue === value ? 'selected' : ''}">${value}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const firstChart = selectedCharts[0] ? chartSvg(selectedCharts[0], metrics) : '';
  const secondChart = selectedCharts[1] ? chartSvg(selectedCharts[1], metrics) : '';
  const html = `${controls}<main class="report-document">
  ${page(1, `${brand}<h1>${esc(report.title)}</h1>${section('Client Information')}<table class="metadata"><tr><th>Client Name</th><td>${esc(report.patient)}</td><th>Age</th><td>${esc(report.patientDetails?.age ?? 'Not recorded')}</td></tr></table>${section('Assessment Information')}<table class="metadata"><tr><th>Assessment</th><td>${esc(report.title)}</td><th>Date administered</th><td>${esc(date(report.completedAt))}</td></tr><tr><th>Assessor</th><td>Not recorded</td><th>Time taken</th><td>Not recorded</td></tr></table>${section('Results')}<table class="summary"><thead><tr><th></th><th>Raw Score (0–40)</th><th>Clinical Percentile</th><th>Insomnia Cutoff?</th></tr></thead><tbody><tr><td>Total Score</td><td>${shown(total.value)}</td><td>${shown(percentile.value)}</td><td>${above === null ? 'Unavailable' : above ? 'Yes' : 'No'}</td></tr></tbody></table><h3>Interpretive Text</h3><p>${esc(interpretation)}</p>${section('Sleep Factors')}<table class="summary"><thead><tr><th></th><th>Raw Score</th><th>Average Score</th></tr></thead><tbody>${scoreRows}</tbody></table>${firstChart}`)}
  ${page(2, `<div class="continuation">Client Name ${esc(report.patient)}</div>${secondChart}${section('Scoring and Interpretation Information')}<p>The ten RIS responses are summed to produce a total from 0 to 40. Higher scores indicate greater cognitive, behavioural and emotional difficulty associated with insomnia.</p><p>Scores from 0 to 12 are below the screening cutoff. Scores of 13 or higher cross the cutoff and support further assessment; the result does not establish a diagnosis.</p><p>The clinical percentile compares the total with the clinical insomnia sample reported by Crönlein and colleagues. The four factor averages share a 0–4 scale so relative areas of difficulty can be compared despite different item counts.</p>`)}
  ${page(3, `<div class="continuation">Client Name ${esc(report.patient)}</div>${section('Scoring and Interpretation Information (cont.)')}<ol><li><strong>Poor Sleep Depth</strong> uses items 3–5 and reflects sleep continuity and awakening.</li><li><strong>Poor Sleep Quantity</strong> uses items 1, 2 and 6 and reflects latency, duration and perceived sleeplessness.</li><li><strong>Fearful Focus on Insomnia</strong> uses items 7–8 and reflects sleep-related thinking and fear.</li><li><strong>Hypnotics and Poor Daytime Functioning</strong> uses items 9–10 and reflects daytime fitness and sleep-medication use.</li></ol><p>The RIS can be repeated to monitor raw-score change over time. Change is shown descriptively; no reliable-change classification is applied.</p>${section('Client Responses')}${responseTable(report.responses.slice(0, 8))}`)}
  ${page(4, `<div class="continuation">Client Name ${esc(report.patient)}</div>${section('Client Responses (cont.)')}${responseTable(report.responses.slice(8))}`)}
  </main>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(report.title)} | OpenMind report</title><style>
@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;background:#dfe5eb;color:#000;font:9.5pt/1.35 Arial,Helvetica,sans-serif}.toolbar{position:sticky;top:0;z-index:2;display:flex;gap:18px;align-items:center;padding:12px 20px;background:#173d66;color:white}.toolbar a{color:white}.toolbar button{padding:6px 12px}.report-document{width:210mm;margin:10mm auto;background:white}.report-page{position:relative;width:210mm;height:297mm;padding:10mm 12.5mm 13mm;background:white;overflow:hidden;break-after:page}.brand{height:25mm;display:flex;justify-content:center;align-items:center;gap:8px;color:#087ba5}.brand-mark{font-size:32pt;font-weight:bold}.brand small{display:block;color:#666;font-size:7pt}.brand strong{font-size:21pt}.report-page h1{font-size:14pt;text-align:center;margin:0;background:#edf7fc;border-top:1px solid #555;border-bottom:1px solid #555}.continuation{text-align:right;font-size:8pt;border-bottom:1px solid #777;margin-bottom:4mm}.section-title{font-size:12.5pt;margin:4mm 0 2mm;padding:1mm 2mm;background:#edf7fc;border-top:1px solid #555;border-bottom:1px solid #555}.metadata,.summary,.responses{border-collapse:collapse;width:100%}.metadata th{font-style:italic;text-align:right;font-weight:normal;background:#edf7fc}.metadata td,.metadata th,.summary th,.summary td{border-bottom:1px solid #777;padding:1.2mm 2mm}.summary th,.summary td{text-align:center}.summary th,.summary td:first-child{background:#edf7fc}.ris-page figure{width:72%;margin:2mm auto}.ris-page figcaption{text-align:center;font-size:11pt;font-weight:bold}.ris-page svg{display:block;width:100%;height:auto;font-size:8pt}.ris-responses{font-size:7.4pt;table-layout:fixed}.ris-responses th,.ris-responses td{border:1px solid #aaa;padding:1mm;vertical-align:middle}.ris-responses th:nth-child(1){width:5%}.ris-responses th:nth-child(2){width:35%}.ris-responses th:nth-child(3){width:25%}.choice{text-align:center}.choice.selected{background:#222;color:white;font-weight:bold}.references{font-size:7.5pt}footer{position:absolute;left:12.5mm;right:12.5mm;bottom:5mm;display:flex;justify-content:space-between;border-top:1px solid #999;padding-top:1mm;font-size:7.5pt;color:#555}@media print{body{background:white}.toolbar{display:none}.report-document{margin:0}}
</style></head><body>${html}</body></html>`;
}

function dass21VisualReportHtml(report, { printControls = true } = {}) {
  const visual = report.visualSpec, metrics = metricMap(visual);
  const total = metrics.get('metric_total_raw'), depression = metrics.get('metric_depression_raw');
  const anxiety = metrics.get('metric_anxiety_raw'), stress = metrics.get('metric_stress_raw');
  const totalPercentile = metrics.get('metric_total_percentile');
  const depressionPercentile = metrics.get('metric_depression_percentile');
  const anxietyPercentile = metrics.get('metric_anxiety_percentile');
  const stressPercentile = metrics.get('metric_stress_percentile');
  if (![total, depression, anxiety, stress, totalPercentile, depressionPercentile, anxietyPercentile, stressPercentile].every(Boolean)) {
    throw new Error('DASS-21 report metrics are incomplete.');
  }
  const severity = (value, ranges) => {
    if (!finite(value)) return 'Unavailable';
    return ranges.find(range => value >= range.from && (range.to == null || value <= range.to))?.label || 'Unavailable';
  };
  const totalSeverity = severity(total.value, [
    { from: 0, to: 16, label: 'Normal' }, { from: 17, to: 20, label: 'Mild' },
    { from: 21, to: 25, label: 'Moderate' }, { from: 26, to: 29, label: 'Severe' },
    { from: 30, to: null, label: 'Extremely Severe' },
  ]);
  const depressionSeverity = severity(depression.value, [
    { from: 0, to: 4, label: 'Normal' }, { from: 5, to: 6, label: 'Mild' },
    { from: 7, to: 10, label: 'Moderate' }, { from: 11, to: 13, label: 'Severe' },
    { from: 14, to: null, label: 'Extremely Severe' },
  ]);
  const anxietySeverity = severity(anxiety.value, [
    { from: 0, to: 3, label: 'Normal' }, { from: 4, to: 4, label: 'Mild' },
    { from: 5, to: 7, label: 'Moderate' }, { from: 8, to: 9, label: 'Severe' },
    { from: 10, to: null, label: 'Extremely Severe' },
  ]);
  const stressSeverity = severity(stress.value, [
    { from: 0, to: 7, label: 'Normal' }, { from: 8, to: 9, label: 'Mild' },
    { from: 10, to: 12, label: 'Moderate' }, { from: 13, to: 16, label: 'Severe' },
    { from: 17, to: null, label: 'Extremely Severe' },
  ]);
  const charts = new Map(visual.charts.map(chart => [chart.id, chart]));
  const chartIds = visual.activeVariant.id === 'first_administration'
    ? ['chart_percentiles_first'] : ['chart_total_history', 'chart_symptom_percentiles_history'];
  const renderedCharts = chartIds.map(id => charts.get(id)).filter(Boolean).map(chart => chartSvg(chart, metrics));
  const controls = printControls ? `<nav class="toolbar"><a href="/?view=reports&amp;patient=${encodeURIComponent(report.patientId || report.patient)}">Back to reports</a><a href="${esc(report.downloadUrl || `/api/definition-sessions/${encodeURIComponent(report.id)}/report.pdf`)}">Download PDF</a><button onclick="window.print()">Print</button></nav>` : '';
  const page = (number, body) => `<section class="report-page dass-page">${body}${footer(number, 5, report.patient)}</section>`;
  const brand = `<header class="brand"><span class="brand-mark">◯</span><span><small>Assessment powered by</small><strong>OpenMind</strong></span></header>`;
  const resultRows = [
    ['Total Distress', total, totalPercentile, totalSeverity],
    ['Depression', depression, depressionPercentile, depressionSeverity],
    ['Anxiety', anxiety, anxietyPercentile, anxietySeverity],
    ['Stress', stress, stressPercentile, stressSeverity],
  ].map(([label, metric, percentile, descriptor]) => `<tr><td>${esc(label)}</td><td>${shown(metric.value)}</td><td>${shown(percentile.value)}</td><td class="descriptor descriptor-${esc(descriptor.toLowerCase().replaceAll(' ', '-'))}">${esc(descriptor)}</td></tr>`).join('');
  const elevated = [['Depression', depressionSeverity], ['Anxiety', anxietySeverity], ['Stress', stressSeverity]]
    .filter(([, descriptor]) => descriptor !== 'Normal' && descriptor !== 'Unavailable');
  const currentInterpretation = finite(total.value)
    ? `The current DASS-21 results indicate ${totalSeverity === 'Normal' ? 'no clinically significant overall elevation in psychological distress' : `an ${totalSeverity.toLowerCase()} level of overall psychological distress`}. ${elevated.length ? `${elevated.map(([label, descriptor]) => `${label} is in the ${descriptor.toLowerCase()} range`).join(', ')}.` : 'All three symptom subscales are in the normal range.'}`
    : 'A complete DASS-21 result is unavailable.';
  const changeText = report.visits.length > 1 && finite(total.baselineChange)
    ? `Compared with the first compatible administration, Total Distress changed by ${total.baselineChange > 0 ? '+' : ''}${shown(total.baselineChange)} raw points. ${Math.abs(total.baselineChange) >= 7 ? 'This meets the seven-point threshold used to flag significant overall change.' : Math.abs(total.baselineChange) >= 2 ? 'This falls in the two-to-six-point range used to flag slight overall change.' : 'This does not reach the threshold used to flag overall change.'}` : '';
  const responseTable = responses => `<table class="responses dass-responses"><thead><tr><th>#</th><th>Question</th><th>Never</th><th>Sometimes</th><th>Often</th><th>Almost Always</th></tr></thead><tbody>${responses.map(response => `<tr><td>${esc(response.order)}</td><td>${esc(response.text)}</td>${[0, 1, 2, 3].map(value => `<td class="choice ${response.printedValue === value ? 'selected' : ''}">${value}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const continuation = `<div class="continuation">Client Name&nbsp;&nbsp; ${esc(report.patient)}</div>`;
  const firstCharts = visual.activeVariant.id === 'first_administration'
    ? renderedCharts[0] : renderedCharts[0];
  const secondCharts = visual.activeVariant.id === 'repeat_administration'
    ? renderedCharts[1] : '';
  const html = `${controls}<main class="report-document">
  ${page(1, `${brand}<h1>${esc(report.title)}</h1><table class="metadata"><tr><th>Client Name</th><td>${esc(report.patient)}</td><th>Date administered</th><td>${esc(date(report.completedAt))}</td></tr><tr><th>Date of birth (age)</th><td>${esc(report.patientDetails?.age ?? 'Not recorded')}</td><th>Time taken</th><td>Not recorded</td></tr><tr><th>Assessor</th><td colspan="3">Not recorded</td></tr></table>${section('Results')}<table class="summary"><thead><tr><th></th><th>Raw Score</th><th>Percentile</th><th>Descriptor</th></tr></thead><tbody>${resultRows}</tbody></table>${firstCharts || ''}`)}
  ${page(2, `${continuation}${secondCharts || ''}${section('Interpretation')}<p>${esc(currentInterpretation)}</p>${changeText ? `<p>${esc(changeText)}</p>` : ''}${section('Scoring and Interpretation Information')}<p>Scores are reported as Total Distress from 0 to 63 and three seven-item subscales from 0 to 21. Percentiles compare the result with non-clinical adult reference samples.</p><p>The displayed subscale raw scores are not doubled. For classification, each DASS-21 subscale is doubled and compared with the DASS-42 severity bands. The equivalent undoubled score bands are used in the Results table.</p><p>Severity labels describe position in the population distribution. They support clinical communication but do not establish a diagnosis.</p>`)}
  ${page(3, `${continuation}${section('Scoring and Interpretation Information (cont.)')}<p><strong>Depression</strong> uses items 3, 5, 10, 13, 16, 17 and 21. It covers dysphoria, hopelessness, devaluation of life, self-deprecation, lack of interest, anhedonia and inertia.</p><p><strong>Anxiety</strong> uses items 2, 4, 7, 9, 15, 19 and 20. It covers autonomic arousal, trembling, panic and fear-related symptoms.</p><p><strong>Stress</strong> uses items 1, 6, 8, 11, 12, 14 and 18. It covers difficulty relaxing, nervous arousal, agitation, irritability and impatience.</p><p>On a first administration, the chart presents Total Distress and the three subscales as percentiles. With repeat administrations, the report presents Total Distress raw scores over time and the three subscale percentiles over time.</p><p>For repeated administrations, a change of seven or more raw Total Distress points is flagged as significant and a change of two to six points as slight. For each subscale, four or more raw points is flagged as significant and two or three points as slight.</p><p>Changes and severity classifications should be considered alongside the client’s circumstances, individual responses and clinical assessment.</p>`)}
  ${page(4, `${continuation}${section('Client Responses')}${responseTable(report.responses.slice(0, 19))}`)}
  ${page(5, `${continuation}${section('Client Responses (cont.)')}${responseTable(report.responses.slice(19))}`)}
  </main>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(report.title)} | OpenMind report</title><style>
@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;background:#dfe5eb;color:#000;font:9.3pt/1.34 Arial,Helvetica,sans-serif}.toolbar{position:sticky;top:0;z-index:2;display:flex;gap:18px;align-items:center;padding:12px 20px;background:#173d66;color:white}.toolbar a{color:white}.toolbar button{padding:6px 12px}.report-document{width:210mm;margin:10mm auto;background:white}.report-page{position:relative;width:210mm;height:297mm;padding:9mm 10mm 13mm;background:white;overflow:hidden;break-after:page}.brand{height:24mm;display:flex;justify-content:center;align-items:center;gap:8px;color:#087ba5}.brand-mark{font-size:32pt;font-weight:bold}.brand small{display:block;color:#666;font-size:7pt}.brand strong{font-size:21pt}.report-page h1{font-size:13pt;text-align:center;margin:0 0 2mm;background:#edf7fc;border-top:1px solid #555;border-bottom:1px solid #555}.continuation{text-align:right;font-size:8pt;border-bottom:1px solid #777;margin-bottom:4mm}.section-title{font-size:12pt;margin:4mm 0 2mm;padding:1mm 2mm;background:#edf7fc;border-top:1px solid #555;border-bottom:1px solid #555}.metadata,.summary,.responses{border-collapse:collapse;width:100%}.metadata th{font-style:italic;text-align:right;font-weight:normal;background:#edf7fc}.metadata td,.metadata th{border-bottom:1px solid #777;padding:1mm 2mm}.summary{margin-bottom:2mm}.summary th,.summary td{padding:1mm 2mm;border-bottom:1px solid #777;text-align:center}.summary th,.summary td:first-child{background:#edf7fc}.descriptor-normal{background:#dbead4}.descriptor-mild{background:#fff3a8}.descriptor-moderate{background:#ffd397}.descriptor-severe{background:#f5aaa4}.descriptor-extremely-severe{background:#df8585}.dass-page figure{width:82%;margin:2mm auto}.dass-page figcaption{text-align:center;font-size:11pt;font-weight:bold}.dass-page svg{display:block;width:100%;height:auto;font-size:8pt}.zone{fill:#665a5a;font-size:7pt}.dass-responses{font-size:7.1pt;table-layout:fixed}.dass-responses th,.dass-responses td{border-bottom:1px solid #aaa;padding:.8mm;vertical-align:middle}.dass-responses th:nth-child(1){width:5%}.dass-responses th:nth-child(2){width:55%}.dass-responses th:nth-child(n+3){width:10%;text-align:center}.choice{text-align:center;font-weight:bold}.choice.selected{background:#222;color:white}p{margin:2.5mm 0}footer{position:absolute;left:10mm;right:10mm;bottom:5mm;display:flex;justify-content:space-between;border-top:1px solid #999;padding-top:1mm;font-size:7.5pt;color:#555}@media print{body{background:white}.toolbar{display:none}.report-document{margin:0}}
</style></head><body>${html}</body></html>`;
}

export function visualReportHtml(report, { printControls = true } = {}) {
  const visual = report.visualSpec, metrics = metricMap(visual);
  if (visual.layoutTemplate === 'generic_assessment') {
    return genericVisualReportHtml(report, { printControls });
  }
  if (visual.layoutTemplate === 'ris_source_layout') {
    return risVisualReportHtml(report, { printControls });
  }
  if (visual.layoutTemplate === 'dass21_source_layout') {
    return dass21VisualReportHtml(report, { printControls });
  }
  const total = metrics.get('metric_total'), sleep = metrics.get('metric_sleep_difficulty');
  const daytime = metrics.get('metric_daytime_consequences');
  if (!total || !sleep || !daytime) throw new Error('AIS report metrics are incomplete.');
  const allCharts = new Map(visual.charts.map(chart => [chart.id, chart]));
  const totalChart = visual.activeVariant.id === 'first_administration'
    ? allCharts.get('chart_total_first') : allCharts.get('chart_total_history');
  const domainChart = visual.activeVariant.id === 'first_administration'
    ? allCharts.get('chart_domains_first') : allCharts.get('chart_domains_history');
  const selected = report.responses.filter(response => finite(response.printedValue) && response.printedValue >= 2);
  const responseRow = response => `<tr><td class="number">${esc(response.order)}</td><td>${esc(response.text)}</td>${[0, 1, 2, 3].map(value => `<td class="choice ${response.printedValue === value ? 'selected' : ''}">${value}</td>`).join('')}</tr>`;
  const responseRows = report.responses.map(responseRow);
  const descriptorRows = visual.tables.find(table => table.id === 'table_descriptor_lookup')?.staticRows ?? [];
  const controls = printControls ? `<nav class="toolbar"><a href="/">Open app</a><a href="${esc(report.downloadUrl || `/api/definition-sessions/${encodeURIComponent(report.id)}/report.pdf`)}">Download PDF</a><button onclick="window.print()">Print</button></nav>` : '';
  const page = (number, body) => `<section class="report-page">${body}${footer(number, 4, report.patient)}</section>`;
  const brand = `<header class="brand"><span class="brand-mark">◯</span><span><small>Assessment powered by</small><strong>OpenMind</strong></span></header>`;
  const html = `${controls}<main class="report-document">
  ${page(1, `${brand}<h1>${esc(report.title)}</h1><table class="metadata"><tr><th>Client</th><td>${esc(report.patient)}</td><th>Date administered</th><td>${esc(date(report.completedAt))}</td></tr><tr><th>Date of birth (age)</th><td>Not recorded</td><th>Time taken</th><td>Not recorded</td></tr><tr><th>Assessor</th><td colspan="3">Not recorded</td></tr></table>${section('Total Score')}<table class="summary"><thead><tr><th></th><th>Raw Score (0-24)</th><th>Descriptor</th></tr></thead><tbody><tr><td>Total Score</td><td>${shown(total.value)}</td><td class="descriptor">${esc(descriptor(totalChart, total.value))}</td></tr></tbody></table>${chartSvg(totalChart, metrics)}${section('Domains')}<table class="summary"><thead><tr><th></th><th>Average Score</th></tr></thead><tbody><tr><td>Sleep Difficulty (0-3)</td><td>${shown(sleep.value)}</td></tr><tr><td>Daytime Consequences (0-3)</td><td>${shown(daytime.value)}</td></tr></tbody></table>${chartSvg(domainChart, metrics)}${section('Interpretation')}`)}
  ${page(2, `<div class="continuation">Client ${esc(report.patient)}</div>${section('Interpretation')}${interpretation(report, total, sleep, daytime, totalChart)}${selected.length ? `<p><strong>Items endorsed at a marked or higher level:</strong></p><ul>${selected.map(item => `<li>${esc(item.order)}. ${esc(item.text)} (${esc(item.value)})</li>`).join('')}</ul>` : ''}${section('Scoring and Interpretation Information')}<p>Each AIS item is scored from 0 to 3. The eight item values are summed to produce a total from 0 to 24.</p><p>Two domain results are also shown as average item scores: Sleep Difficulty uses items 1–5 and Daytime Consequences uses items 6–8. The domain averages share a 0–3 scale.</p><p>A total of 6 or above is a positive screen. Screening results support further assessment and do not establish a diagnosis.</p><p>The two domains do not have validated independent cut-offs or percentiles. They are compared descriptively, while the total score remains the primary interpretation index.</p>`)}
  ${page(3, `<div class="continuation">Client ${esc(report.patient)}</div>${section('AIS Total Score Cut-Off and Descriptors')}<table class="lookup"><thead><tr><th>Total Score</th><th>Descriptor</th><th>Interpretation</th></tr></thead><tbody>${descriptorRows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>${section('AIS Domain Interpretation')}<p>Review Sleep Difficulty and Daytime Consequences relative to each other. A higher daytime score can indicate that the functional impact is greater than the reported night-time disturbance. Individual responses should also be reviewed because each item represents a distinct aspect of sleep or daytime functioning.</p>${section('AIS Graphs and Change Over Time')}<p>On the first administration, the report shows the total as a 0–24 bar against the descriptor zones and both domain averages on a 0–3 chart. With repeat administrations, these are replaced by dated trajectories using the same scales.</p><p>Changes are reported as raw-score differences. Crossing the cut-off of 6 changes screening status and is highlighted separately. No reliable-change estimate is applied.</p>${section('References')}<p class="references">${report.references.map(reference => esc(reference)).join('<br><br>')}</p>`)}
  ${page(4, `<div class="continuation">Client ${esc(report.patient)}</div>${section('Client Responses')}<h3>Sleep Difficulty</h3><table class="responses"><thead><tr><th>#</th><th>Question</th><th>0</th><th>1</th><th>2</th><th>3</th></tr></thead><tbody>${responseRows.slice(0, 5).join('')}</tbody></table><h3>Daytime Consequences</h3><table class="responses"><thead><tr><th>#</th><th>Question</th><th>0</th><th>1</th><th>2</th><th>3</th></tr></thead><tbody>${responseRows.slice(5).join('')}</tbody></table><p class="response-note">Selected responses are shown with a dark background. Full option wording is retained in the assessment definition and the saved administration.</p>`)}
  </main>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(report.title)} | OpenMind report</title><style>
@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;background:#dfe5eb;color:#000;font:10pt/1.35 Arial,Helvetica,sans-serif}.toolbar{position:sticky;top:0;z-index:2;display:flex;gap:18px;align-items:center;padding:12px 20px;background:#173d66;color:white}.toolbar a{color:white}.toolbar button{padding:6px 12px}.report-document{width:210mm;margin:10mm auto;background:white}.report-page{position:relative;width:210mm;height:297mm;padding:10mm 12.5mm 13mm;background:white;overflow:hidden;break-after:page}.brand{height:28mm;display:flex;justify-content:center;align-items:center;gap:8px;color:#087ba5}.brand-mark{font-size:34pt;font-weight:bold}.brand small{display:block;color:#666;font-size:7pt}.brand strong{font-size:22pt}.report-page h1{font-size:14pt;text-align:center;margin:0;background:#edf7fc;border-top:1px solid #555;border-bottom:1px solid #555}.continuation{text-align:right;font-size:8pt;border-bottom:1px solid #777;margin-bottom:5mm}.section-title{font-size:13pt;margin:5mm 0 2mm;padding:1mm 2mm;background:#edf7fc;border-top:1px solid #555;border-bottom:1px solid #555}.metadata,.summary,.lookup,.responses{border-collapse:collapse;width:100%}.metadata th{font-style:italic;text-align:right;font-weight:normal;background:#edf7fc}.metadata td,.metadata th{border-bottom:1px solid #777;padding:1mm 2mm}.summary{margin-bottom:2mm}.summary th,.summary td{padding:1mm 2mm;border-bottom:1px solid #555;text-align:center}.summary th{font-weight:normal;background:#edf7fc}.summary td:first-child{background:#edf7fc}.summary .descriptor{background:#efb1b5}figure{margin:2mm auto 1mm;width:82%;max-width:100%;break-inside:avoid}figure+.section-title{margin-top:1mm}figcaption{text-align:center;font-size:12pt;font-weight:bold;margin-bottom:1mm}svg{display:block;width:100%;height:auto;overflow:visible;font-size:9pt}.zone{fill:#8a7777;font-size:8pt}p{margin:2.5mm 0}li{margin:1mm 0}.lookup th,.lookup td{border:1px solid #777;padding:2mm;vertical-align:top}.lookup th{background:#edf7fc}.references{font-size:7.5pt;line-height:1.25}.responses{font-size:8pt;table-layout:fixed}.responses th,.responses td{border-bottom:1px solid #bbb;padding:1.5mm;vertical-align:middle}.responses th{background:#edf7fc}.responses th:nth-child(1),.responses td:nth-child(1){width:6%}.responses th:nth-child(n+3),.responses td:nth-child(n+3){width:8%;text-align:center}.choice{font-weight:bold}.choice.selected{background:#4e79a7;color:white}.response-note{font-size:8pt;color:#555}footer{position:absolute;left:12.5mm;right:12.5mm;bottom:5mm;display:flex;justify-content:space-between;border-top:1px solid #888;padding-top:2mm;font-size:8pt}.mini-brand{color:#087ba5;font-weight:bold}@media(max-width:850px){.report-document{margin:0;transform-origin:top left}}@media print{body{background:white}.toolbar{display:none}.report-document{margin:0}.report-page{break-after:page}}
footer span:first-child,footer span:last-child{width:25%}footer span:nth-child(2){width:50%;text-align:center}footer span:last-child{text-align:right;white-space:nowrap}
  </style></head><body>${html}</body></html>`;
}
