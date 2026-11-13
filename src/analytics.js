const forms = ['phq9', 'gad7', 'pcl5'];

export function buildPatientAnalytics(patientId, rows) {
  const groups = new Map();
  for (const row of rows) {
    const scores = typeof row.scores_json === 'string' ? JSON.parse(row.scores_json) : row.scores;
    if (!forms.includes(row.form_id) || !Number.isFinite(scores?.rawTotal) ||
        !Number.isFinite(scores?.maxTotal) || !Number.isFinite(Date.parse(row.completed_at))) continue;
    const key = `${row.form_id}:${row.form_version}:${row.language}`;
    if (!groups.has(key)) groups.set(key, {
      formId: row.form_id, formVersion: row.form_version, language: row.language,
      maxTotal: scores.maxTotal, points: [],
    });
    groups.get(key).points.push({
      id: row.id, completedAt: row.completed_at, score: scores.rawTotal,
      severity: scores.severity ?? null, language: row.language, mode: row.mode,
      requiresHumanFollowUp: scores.requiresHumanFollowUp === true,
    });
  }
  const series = [...groups.values()].map((group) => {
    group.points.sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id));
    const latest = group.points.at(-1);
    return { ...group, latest, changeFromPrevious: group.points.length > 1 ?
      latest.score - group.points.at(-2).score : null };
  }).sort((a, b) => forms.indexOf(a.formId) - forms.indexOf(b.formId) || a.formVersion.localeCompare(b.formVersion));
  return { patientId, totalCompleted: series.reduce((sum, item) => sum + item.points.length, 0), series };
}

export function buildOverview(rows, now = new Date()) {
  const byForm = forms.map((formId) => ({ formId, prescribed: 0, completed: 0 }));
  const counts = { prescribed: 0, completed: 0, inProgress: 0, notStarted: 0 };
  const durations = [];
  const months = [];
  for (let offset = 5; offset >= 0; offset--) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    months.push({ month: date.toISOString().slice(0, 7), completed: 0 });
  }
  for (const row of rows) {
    const form = byForm.find((item) => item.formId === row.form_id);
    if (!form) continue;
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
