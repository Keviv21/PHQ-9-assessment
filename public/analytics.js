const byId = (id) => document.getElementById(id);
const formNames = { phq9: 'PHQ-9', gad7: 'GAD-7', pcl5: 'PCL-5' };
const colors = { phq9: '#1879dc', gad7: '#19a39a', pcl5: '#845ec2' };
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
  for (const form of data.byForm) {
    const row = node('div', undefined, 'analytics-form-row');
    const heading = node('div', undefined, 'analytics-form-heading');
    heading.append(node('strong', formNames[form.formId]), node('span', `${form.completed} of ${form.prescribed} completed`));
    const track = node('div', undefined, 'analytics-form-track');
    const fill = node('div', undefined, 'analytics-form-fill');
    fill.style.width = `${form.prescribed ? (form.completed / form.prescribed) * 100 : 0}%`;
    fill.style.background = colors[form.formId];
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
    'aria-label': `${formNames[series.formId]} scores over time, out of ${series.maxTotal}` });
  for (const fraction of [0, 0.5, 1]) {
    const score = Math.round(fraction * series.maxTotal);
    chart.append(svg('line', { x1: left, y1: y(score), x2: width - right, y2: y(score), class: 'analytics-gridline' }));
    const label = svg('text', { x: left - 10, y: y(score) + 4, 'text-anchor': 'end', class: 'analytics-axis-label' });
    label.textContent = String(score);
    chart.append(label);
  }
  if (points.length > 1) chart.append(svg('polyline', {
    points: points.map((point, index) => `${x(point, index)},${y(point.score)}`).join(' '),
    fill: 'none', stroke: colors[series.formId], 'stroke-width': 3,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));
  points.forEach((point, index) => {
    const marker = svg('circle', { cx: x(point, index), cy: y(point.score), r: 6,
      fill: colors[series.formId], stroke: '#fff', 'stroke-width': 2 });
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
  const series = patientData.series.map((item) => ({ ...item,
    points: item.points.filter((point) => Date.parse(point.completedAt) >= cutoff),
  })).filter((item) => item.points.length);
  area.replaceChildren();
  if (!series.length) {
    area.append(node('p', patientData.totalCompleted ? 'No completed scored assessments in this period. Choose All time to see earlier results.' :
      'No completed scored assessments yet. Prescribe and complete a test to start this timeline.', 'empty-state'));
    return;
  }
  for (const item of series) {
    const card = node('section', undefined, 'analytics-series');
    const heading = node('div', undefined, 'analytics-series-heading');
    heading.append(node('h3', `${formNames[item.formId]} · ${item.language === 'hi' ? 'Hindi' : 'English'} · ${item.formVersion.replace(/-prototype$/, '')}`));
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
      link.href = `/report.html?id=${encodeURIComponent(point.id)}`;
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
