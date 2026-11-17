// Adapted from sagar:public/clinical-analytics-view.js (score range and bar chart design).
// All plotted data comes from saved workspace sessions; no inferred norms or scores.
function svgEl(tag) {
  return typeof document?.createElementNS === 'function'
    ? document.createElementNS('http://www.w3.org/2000/svg', tag)
    : document.createElement(tag);
}

export function createDistributionChartSvg(chart) {
  if (!chart || !Number.isFinite(chart.patientScore) || !(chart.max > chart.min)) return null;
  const { title, axisLabel, min = 0, max = 24, patientScore = 0, patientScoreLabel, zones = [], markers = [] } = chart;
  const width = 760;
  const height = 195;
  const left = 55;
  const right = 720;
  const chartWidth = right - left;
  const scale = (val) => left + Math.max(0, Math.min(1, (val - min) / (max - min))) * chartWidth;

  const svg = svgEl('svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'clinical-distribution-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title || 'Distribution Comparison Chart');

  if (title) {
    const titleNode = svgEl('text');
    titleNode.setAttribute('x', width / 2);
    titleNode.setAttribute('y', '22');
    titleNode.setAttribute('text-anchor', 'middle');
    titleNode.setAttribute('class', 'chart-title-svg');
    titleNode.textContent = title;
    svg.append(titleNode);
  }

  markers.forEach((marker) => {
    const x = scale(marker.value);
    const line = svgEl('line');
    line.setAttribute('x1', x);
    line.setAttribute('x2', x);
    line.setAttribute('y1', '35');
    line.setAttribute('y2', '135');
    line.setAttribute('stroke', marker.color || '#64748b');
    line.setAttribute('stroke-width', marker.style === 'dashed' ? '1.5' : '1.2');
    if (marker.style === 'dashed') line.setAttribute('stroke-dasharray', '4,3');
    svg.append(line);

    const label = svgEl('text');
    label.setAttribute('x', x);
    label.setAttribute('y', '46');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'marker-label-svg');
    label.setAttribute('fill', marker.color || '#475569');
    label.textContent = marker.label;
    svg.append(label);
  });

  const barY = 70;
  const barHeight = 28;
  const barWidth = Math.max(0, scale(patientScore) - left);
  const patientBar = svgEl('rect');
  patientBar.setAttribute('x', left);
  patientBar.setAttribute('y', barY);
  patientBar.setAttribute('width', barWidth);
  patientBar.setAttribute('height', barHeight);
  patientBar.setAttribute('fill', '#475569');
  patientBar.setAttribute('stroke', '#1e293b');
  patientBar.setAttribute('stroke-width', '1.2');
  patientBar.setAttribute('rx', '3');
  svg.append(patientBar);

  const patientText = svgEl('text');
  patientText.setAttribute('x', left);
  patientText.setAttribute('y', barY - 9);
  patientText.setAttribute('text-anchor', 'start');
  patientText.setAttribute('class', 'patient-bar-text-svg');
  patientText.textContent = patientScoreLabel || `Score: ${patientScore}`;
  svg.append(patientText);

  const zoneY = 104;
  const zoneHeight = 24;
  zones.forEach((zone) => {
    const zLeft = scale(zone.min);
    const zRight = scale(zone.max);
    const zWidth = Math.max(1, zRight - zLeft);
    const rect = svgEl('rect');
    rect.setAttribute('x', zLeft);
    rect.setAttribute('y', zoneY);
    rect.setAttribute('width', zWidth);
    rect.setAttribute('height', zoneHeight);
    rect.setAttribute('fill', zone.color);
    rect.setAttribute('stroke', '#cbd5e1');
    rect.setAttribute('stroke-width', '0.8');
    svg.append(rect);

    if (zWidth > 38) {
      const zText = svgEl('text');
      zText.setAttribute('x', zLeft + zWidth / 2);
      zText.setAttribute('y', zoneY + 16);
      zText.setAttribute('text-anchor', 'middle');
      zText.setAttribute('class', 'zone-text-svg');
      zText.setAttribute('fill', zone.textColor || '#334155');
      zText.textContent = zone.label;
      svg.append(zText);
    }
  });

  for (let index = 0; index <= 6; index++) {
    const tick = Number((min + (max - min) * index / 6).toFixed(2));
    const tx = scale(tick);
    const tickLine = svgEl('line');
    tickLine.setAttribute('x1', tx);
    tickLine.setAttribute('x2', tx);
    tickLine.setAttribute('y1', zoneY + zoneHeight);
    tickLine.setAttribute('y2', zoneY + zoneHeight + 5);
    tickLine.setAttribute('stroke', '#64748b');
    svg.append(tickLine);

    const tickText = svgEl('text');
    tickText.setAttribute('x', tx);
    tickText.setAttribute('y', zoneY + zoneHeight + 17);
    tickText.setAttribute('text-anchor', 'middle');
    tickText.setAttribute('class', 'tick-text-svg');
    tickText.textContent = String(tick);
    svg.append(tickText);
  }

  if (axisLabel) {
    const axisText = svgEl('text');
    axisText.setAttribute('x', left + chartWidth / 2);
    axisText.setAttribute('y', zoneY + zoneHeight + 35);
    axisText.setAttribute('text-anchor', 'middle');
    axisText.setAttribute('class', 'axis-label-svg');
    axisText.textContent = axisLabel;
    svg.append(axisText);
  }

  return svg;
}


const colors = ["#245bd5", "#087b70", "#9844a8", "#c27712", "#64748b"];
function svgNode(tag, attrs = {}, text) {
  const node = svgEl(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
// Sagar's bar chart style, with count units and full labels for arbitrary catalogues.
export function createResponseChartSvg(bars, title = "Saved response distribution") {
  if (!bars.length) return null;
  const width = 760, left = 22, right = 710, rowHeight = 66;
  const max = Math.max(1, ...bars.map(bar => bar.count));
  const svg = svgNode("svg", {
    viewBox: `0 0 ${width} ${55 + bars.length * rowHeight}`,
    class: "clinical-response-svg", role: "img", "aria-label": title,
  });
  svg.append(svgNode("title", {}, title));
  svg.append(svgNode("desc", {}, bars.map(b => `${b.label}: ${b.count}`).join("; ")));
  bars.forEach((bar, i) => {
    const y = 25 + i * rowHeight;
    const group = svgNode("g");
    group.append(svgNode("title", {}, `${bar.label}: ${bar.count} responses`));
    // Full text also appears in the accessible table below the graph.
    group.append(svgNode("text", { x: left, y, class: "bar-lbl-svg" },
      bar.label.length > 85 ? bar.label.slice(0, 82) + "…" : bar.label));
    group.append(svgNode("rect", { x: left, y: y + 10, width: right - left, height: 20, rx: 4, fill: "#edf2f7" }));
    group.append(svgNode("rect", { x: left, y: y + 10, width: (right - left) * bar.count / max,
      height: 20, rx: 4, fill: colors[i % colors.length], "data-count": bar.count }));
    group.append(svgNode("text", { x: right + 12, y: y + 26, class: "bar-val-text-svg" }, String(bar.count)));
    svg.append(group);
  });
  svg.append(svgNode("text", { x: width / 2, y: 45 + bars.length * rowHeight,
    "text-anchor": "middle", class: "axis-label-svg" }, "Number of saved responses"));
  return svg;
}
export function responseCounts(responses) {
  const counts = new Map();
  for (const response of responses) {
    if (response.feedback || response.skipped ||
      (response.responseType && !response.responseType.endsWith("choice"))) continue;
    counts.set(response.response, (counts.get(response.response) || 0) + 1);
  }
  return [...counts].map(([label, count]) => ({ label, count }));
}
export function trendData(group) {
  if (group.scored && group.metrics.length) return group;
  return {
    ...group,
    metrics: [{ name: "Answered questions", min: 0,
      max: Math.max(1, ...group.results.map(r => r.questionCount)) }],
    results: group.results.map(r => ({ ...r, values: [r.answeredCount] })),
  };
}
