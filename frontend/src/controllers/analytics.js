import { apiFetch as fetch } from '../api/client.js';
const byId = (id) => document.getElementById(id);
const formNames = { phq9: 'PHQ-9', gad7: 'GAD-7', pcl5: 'PCL-5', dass21: 'DASS-21' };
const colors = { phq9: '#1879dc', gad7: '#19a39a', pcl5: '#845ec2', dass21: '#d66a31',
  'dass21:depression': '#b54f6d', 'dass21:anxiety': '#6a64be', 'dass21:stress': '#d07924' };
let patients = [];
let overviewLoad = 0;
let patientLoad = 0;
let patientData = null;

function node(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function svg(tag, attributes = {}) {
  const item = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) item.setAttribute(name, String(value));
  return item;
}

function dateLabel(value) {
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formLabel(item) { return formNames[item.formId] || item.formTitle || item.formId; }
function seriesColor(item) { return colors[`${item.formId}:${item.metricId}`] || colors[item.formId] || '#607d9e'; }

function renderOverview(data) {
  const { totals } = data;
  const cards = [
    ['Prescribed tests', totals.prescribed, `${totals.notStarted} awaiting start`],
    ['Completed tests', totals.completed, `${totals.inProgress} in progress`],
    ['Completion rate', totals.completionRate === null ? '—' : `${totals.completionRate}%`, 'Of prescribed tests'],
    ['Median completion time', totals.medianCompletionHours === null ? '—' :
      totals.medianCompletionHours < 24 ? `${Math.round(totals.medianCompletionHours)} hr` :
        `${(totals.medianCompletionHours / 24).toFixed(1)} days`, 'From prescription to completed report'],
  ];
  byId('analytics-summary').replaceChildren(...cards.map(([label, value, detail]) => {
    const card = node('div', undefined, 'analytics-stat');
    card.append(node('span', label), node('strong', String(value)), node('small', detail));
    return card;
  }));

  const months = byId('analytics-months');
  months.replaceChildren();
  const maximum = Math.max(1, ...data.months.map((month) => month.completed));
  const bars = node('div', undefined, 'analytics-month-bars');
  for (const month of data.months) {
    const bar = node('div', undefined, 'analytics-month');
    const height = month.completed ? Math.max(8, (month.completed / maximum) * 100) : 2;
    const column = node('span', undefined, 'analytics-month-column');
    column.style.height = `${height}%`;
    column.title = `${month.month}: ${month.completed} completed`;
    bar.append(node('strong', String(month.completed)), column,
      node('small', new Date(`${month.month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short' })));
    bars.append(bar);
  }
  months.append(bars, node('p', 'Completed prescribed tests in the last six calendar months, in UTC.', 'analytics-caption'));

  const byForm = byId('analytics-by-form');
  byForm.replaceChildren();
  const activeForms = data.byForm.filter((form) => form.prescribed)
    .sort((a, b) => b.prescribed - a.prescribed || formLabel(a).localeCompare(formLabel(b)));
  if (!activeForms.length) byForm.append(node('p', 'Assignments will appear here after a test is prescribed.', 'empty-state'));
  for (const form of activeForms) {
    const row = node('div', undefined, 'analytics-form-row');
    const heading = node('div', undefined, 'analytics-form-heading');
    heading.append(node('strong', formLabel(form)), node('span', `${form.completed} of ${form.prescribed} completed`));
    const track = node('div', undefined, 'analytics-form-track');
    const fill = node('div', undefined, 'analytics-form-fill');
    fill.style.width = `${form.prescribed ? (form.completed / form.prescribed) * 100 : 0}%`;
    fill.style.background = seriesColor(form);
    track.append(fill);
    row.append(heading, track);
    byForm.append(row);
  }
}

function scoreChart(series) {
  const width = 680;
  const height = 250;
  const left = 48;
  const right = 18;
  const top = 20;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const points = series.points;
  const timestamps = points.map((point) => Date.parse(point.completedAt));
  const first = Math.min(...timestamps);
  const last = Math.max(...timestamps);
  const x = (point, index) => first === last ?
    (points.length === 1 ? left + plotWidth / 2 : left + (index / (points.length - 1)) * plotWidth) :
    left + ((Date.parse(point.completedAt) - first) / (last - first)) * plotWidth;
  const y = (score) => top + (1 - score / series.maxTotal) * plotHeight;
  const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img',
    'aria-label': `${formLabel(series)} ${series.metricName || 'total score'} over time, out of ${series.maxTotal}` });
  for (const fraction of [0, 0.5, 1]) {
    const score = Math.round(fraction * series.maxTotal);
    chart.append(svg('line', { x1: left, y1: y(score), x2: width - right, y2: y(score), class: 'analytics-gridline' }));
    const label = svg('text', { x: left - 10, y: y(score) + 4, 'text-anchor': 'end', class: 'analytics-axis-label' });
    label.textContent = String(score);
    chart.append(label);
  }
  if (points.length > 1) chart.append(svg('polyline', {
    points: points.map((point, index) => `${x(point, index)},${y(point.score)}`).join(' '),
    fill: 'none', stroke: seriesColor(series), 'stroke-width': 3,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));
  points.forEach((point, index) => {
    const marker = svg('circle', { cx: x(point, index), cy: y(point.score), r: 6,
      fill: seriesColor(series), stroke: '#fff', 'stroke-width': 2 });
    const title = svg('title');
    title.textContent = `${dateLabel(point.completedAt)}: ${point.score} of ${series.maxTotal}`;
    marker.append(title);
    chart.append(marker);
  });
  for (const [time, anchor] of [[points[0].completedAt, 'start'], [points.at(-1).completedAt, 'end']]) {
    if (anchor === 'end' && points.length === 1) continue;
    const label = svg('text', { x: anchor === 'start' ? left : width - right, y: height - 11,
      'text-anchor': anchor, class: 'analytics-axis-label' });
    label.textContent = dateLabel(time);
    chart.append(label);
  }
  return chart;
}

function renderPatient() {
  const area = byId('analytics-patient-content');
  if (!patientData) {
    area.replaceChildren(node('p', 'Choose a patient to see their score history.', 'empty-state'));
    return;
  }
  const days = byId('analytics-range').value;
  const cutoff = days === 'all' ? 0 : Date.now() - Number(days) * 86400000;
  const activity = (patientData.activity || []).filter((item) => Date.parse(item.completedAt) >= cutoff);
  const series = patientData.series.map((item) => ({ ...item,
    points: item.points.filter((point) => Date.parse(point.completedAt) >= cutoff),
  })).filter((item) => item.points.length);
  area.replaceChildren();
  if (activity.length) {
    const card = node('section', undefined, 'analytics-activity');
    card.append(node('h3', 'Completed assessments over time'),
      node('p', `${activity.length} completed · ${activity.filter((item) => item.score !== null).length} with scores`));
    const counts = new Map();
    for (const item of activity) {
      const month = item.completedAt.slice(0, 7);
      counts.set(month, (counts.get(month) || 0) + 1);
    }
    const months = [...counts].sort(([a], [b]) => a.localeCompare(b));
    const maximum = Math.max(...months.map(([, count]) => count));
    const scroll = node('div', undefined, 'analytics-activity-scroll');
    const bars = node('div', undefined, 'analytics-activity-bars');
    bars.style.gridTemplateColumns = `repeat(${months.length}, minmax(48px, 1fr))`;
    for (const [month, count] of months) {
      const bar = node('div', undefined, 'analytics-activity-month');
      const column = node('span', undefined, 'analytics-activity-column');
      column.style.height = `${Math.max(8, (count / maximum) * 100)}%`;
      column.title = `${month}: ${count} completed`;
      bar.append(node('strong', String(count)), column, node('small', month));
      bars.append(bar);
    }
    scroll.append(bars);
    card.append(scroll);
    const table = node('table', undefined, 'analytics-table');
    const head = node('tr');
    for (const label of ['Completed', 'Assessment', 'Result', 'Details']) head.append(node('th', label));
    const thead = node('thead'); thead.append(head);
    const tbody = node('tbody');
    for (const item of [...activity].reverse()) {
      const row = node('tr');
      const detail = node('td');
      const link = node('a', 'View answers'); link.href = item.detailUrl;
      detail.append(link);
      row.append(node('td', dateLabel(item.completedAt)), node('td', formLabel(item)),
        node('td', item.score === null ? 'Answers saved; no score available' : `${item.score} / ${item.maxTotal}`), detail);
      tbody.append(row);
    }
    table.append(thead, tbody);
    card.append(table);
    area.append(card);
  }
  if (!series.length) {
    area.append(node('p', activity.length ? 'These completed forms have no score trend. Their answers remain available above.' :
      'No completed assessments in this period. Choose All time to see earlier results.', 'empty-state'));
    return;
  }
  for (const item of series) {
    const card = node('section', undefined, 'analytics-series');
    const heading = node('div', undefined, 'analytics-series-heading');
    heading.append(node('h3', `${formLabel(item)}${item.metricId !== 'total' ? ` · ${item.metricName}` : ''} · ${item.language === 'hi' ? 'Hindi' : 'English'}`));
    const latest = item.points.at(-1);
    const previous = item.points.at(-2);
    const change = previous ? ` · Change from previous: ${latest.score - previous.score >= 0 ? '+' : ''}${latest.score - previous.score}` :
      ' · Complete it again to see change';
    heading.append(node('p', `Latest: ${latest.score} / ${item.maxTotal}${change}`));
    card.append(heading, scoreChart({ ...item, maxTotal: item.maxTotal }));
    const table = node('table', undefined, 'analytics-table');
    const thead = node('thead');
    const headRow = node('tr');
    for (const label of ['Completed', 'Score', 'Details']) headRow.append(node('th', label));
    thead.append(headRow);
    const tbody = node('tbody');
    for (const point of [...item.points].reverse()) {
      const row = node('tr');
      row.append(node('td', dateLabel(point.completedAt)),
        node('td', `${point.score} / ${item.maxTotal}${point.severity ? ` · ${point.severity}` : ''}`));
      const detail = node('td');
      const link = node('a', 'View report');
      link.href = point.detailUrl;
      detail.append(link);
      if (point.requiresHumanFollowUp) detail.append(node('span', 'Human follow-up required', 'analytics-follow-up'));
      row.append(detail);
      tbody.append(row);
    }
    table.append(thead, tbody);
    card.append(table);
    area.append(card);
  }
}

async function loadOverview() {
  const current = ++overviewLoad;
  byId('analytics-status').textContent = 'Loading analytics…';
  try {
    const response = await fetch('/api/analytics/overview');
    if (!response.ok) throw new Error('Could not load assessment analytics.');
    const data = await response.json();
    if (current !== overviewLoad) return;
    renderOverview(data);
    byId('analytics-status').textContent = data.totals.prescribed ? '' : 'No prescribed tests yet. Analytics will populate as sample patients complete assessments.';
  } catch (error) {
    if (current === overviewLoad) byId('analytics-status').textContent = error.message;
  }
}

async function loadPatient() {
  const current = ++patientLoad;
  const id = byId('analytics-patient').value;
  if (!id) { patientData = null; renderPatient(); return; }
  byId('analytics-patient-content').replaceChildren(node('p', 'Loading patient progress…', 'empty-state'));
  try {
    const response = await fetch(`/api/demo-patients/${encodeURIComponent(id)}/analytics`);
    if (!response.ok) throw new Error('Could not load patient progress.');
    const data = await response.json();
    if (current !== patientLoad) return;
    patientData = data;
    renderPatient();
  } catch (error) {
    if (current === patientLoad) byId('analytics-patient-content').replaceChildren(node('p', error.message, 'empty-state'));
  }
}

function showAnalytics() {
  if (byId('analytics-view').hidden) return;
  loadOverview();
  const patientId = new URL(location.href).searchParams.get('patient');
  if (patients.some((patient) => patient.id === patientId)) byId('analytics-patient').value = patientId;
  loadPatient();
}

byId('analytics-patient').addEventListener('change', () => {
  const url = new URL(location.href);
  if (byId('analytics-patient').value) url.searchParams.set('patient', byId('analytics-patient').value);
  else url.searchParams.delete('patient');
  history.replaceState({}, '', url);
  loadPatient();
});
byId('analytics-range').addEventListener('change', renderPatient);
window.addEventListener('clinic:analytics', showAnalytics);

try {
  const response = await fetch('/api/demo-patients');
  if (!response.ok) throw new Error('Could not load patients.');
  patients = await response.json();
  for (const patient of patients) byId('analytics-patient').add(new Option(patient.label, patient.id));
  showAnalytics();
} catch (error) {
  byId('analytics-patient-content').replaceChildren(node('p', error.message, 'empty-state'));
}
