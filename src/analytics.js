const forms = ['phq9', 'gad7', 'pcl5'];

export function buildPatientAnalytics(patientId, rows) {
  const groups = new Map();
  const activity = [];
  for (const row of rows) {
    const scores = typeof row.scores_json === 'string' ? JSON.parse(row.scores_json) : row.scores;
    if (!Number.isFinite(Date.parse(row.completed_at))) continue;
    const isImported = Boolean(row.prescription_id);
    const detailUrl = row.kind === 'definition' ? `/definition.html?prescriptionId=${encodeURIComponent(row.prescription_id)}` :
      isImported ? `/draft-live.html?prescriptionId=${encodeURIComponent(row.prescription_id)}` :
      `/report.html?id=${encodeURIComponent(row.id)}`;
    const draftMetrics = scores?.metrics?.filter((metric) => Number.isFinite(metric.value) &&
      Number.isFinite(metric.maximum) && metric.maximum > 0 && (metric.minimum ?? 0) >= 0) ?? [];
    const displayMetric = draftMetrics.find((metric) => /total/i.test(metric.id)) ?? draftMetrics[0];
    const maxTotal = displayMetric?.maximum ?? scores?.maxTotal ?? (row.form_id === 'dass21' ? 63 : null);
    activity.push({ id: row.id, formId: row.form_id, formTitle: row.form_title || null,
      completedAt: row.completed_at, score: displayMetric?.value ?? (Number.isFinite(scores?.rawTotal) ? scores.rawTotal : null),
      maxTotal, detailUrl });
    if ((!Number.isFinite(scores?.rawTotal) || !Number.isFinite(maxTotal)) && !draftMetrics.length) continue;
    const metrics = draftMetrics.length ? draftMetrics.map((metric) => ({ id: metric.id,
      name: metric.label, score: metric.value, maxTotal: metric.maximum, severity: metric.band })) :
      [{ id: 'total', name: 'Total score', score: scores.rawTotal,
      maxTotal, severity: typeof scores.severity === 'string' ? scores.severity : scores.severity?.total ?? null }];
    if (row.form_id === 'dass21') for (const name of ['depression', 'anxiety', 'stress']) {
      const value = scores.rawSubscales?.[name];
      if (Number.isFinite(value)) metrics.push({ id: name, name: `${name[0].toUpperCase()}${name.slice(1)}`,
        score: value, maxTotal: 21, severity: scores.severity?.[name] ?? null });
    }
    for (const metric of metrics) {
      const key = `${row.form_id}:${row.form_version}:${row.language}:${metric.id}`;
      if (!groups.has(key)) groups.set(key, {
        formId: row.form_id, formTitle: row.form_title || null,
        formVersion: row.form_version, language: row.language,
        metricId: metric.id, metricName: metric.name, maxTotal: metric.maxTotal, points: [],
      });
      groups.get(key).points.push({
        id: row.id, completedAt: row.completed_at, score: metric.score,
        severity: metric.severity, language: row.language, mode: row.mode,
        detailUrl, requiresHumanFollowUp: scores?.requiresHumanFollowUp === true,
      });
    }
  }
  const series = [...groups.values()].map((group) => {
    group.points.sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id));
    const latest = group.points.at(-1);
    return { ...group, latest, changeFromPrevious: group.points.length > 1 ?
      latest.score - group.points.at(-2).score : null };
  }).sort((a, b) => {
    const order = [...forms, 'dass21'];
    const aIndex = order.indexOf(a.formId);
    const bIndex = order.indexOf(b.formId);
    return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex) ||
      a.formVersion.localeCompare(b.formVersion) ||
      ['total', 'depression', 'anxiety', 'stress'].indexOf(a.metricId) -
      ['total', 'depression', 'anxiety', 'stress'].indexOf(b.metricId);
  });
  activity.sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id));
  return { patientId, totalCompleted: activity.length,
    totalScored: activity.filter((item) => item.score !== null).length, activity, series };
}

export function buildOverview(rows, now = new Date()) {
  const byForm = forms.map((formId) => ({ formId, formTitle: null, prescribed: 0, completed: 0 }));
  const counts = { prescribed: 0, completed: 0, inProgress: 0, notStarted: 0 };
  const durations = [];
  const months = [];
  for (let offset = 5; offset >= 0; offset--) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    months.push({ month: date.toISOString().slice(0, 7), completed: 0 });
  }
  for (const row of rows) {
    let form = byForm.find((item) => item.formId === row.form_id);
    if (!form) {
      form = { formId: row.form_id, formTitle: row.form_title || null, prescribed: 0, completed: 0 };
      byForm.push(form);
    }
    counts.prescribed += 1;
    form.prescribed += 1;
    if (row.assessment_status === 'completed' && row.completed_at) {
      counts.completed += 1;
      form.completed += 1;
      const month = months.find((item) => item.month === row.completed_at.slice(0, 7));
      if (month) month.completed += 1;
      const hours = (Date.parse(row.completed_at) - Date.parse(row.created_at)) / 3600000;
      if (Number.isFinite(hours) && hours >= 0) durations.push(hours);
    } else if (row.assessment_id) counts.inProgress += 1;
    else counts.notStarted += 1;
  }
  durations.sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  const medianCompletionHours = durations.length ?
    (durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2) : null;
  return {
    totals: { ...counts, completionRate: counts.prescribed ?
      Math.round((counts.completed / counts.prescribed) * 100) : null,
    medianCompletionHours },
    byForm, months,
  };
}
