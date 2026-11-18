import { definition } from "./catalogue.js";

// Dev's prescription overview, adapted to workspace sessions without loading answers.
export function prescriptionSummary(row) {
  const completed = row.status === "completed";
  const storedMetrics = typeof row.result_metrics === "string" ? JSON.parse(row.result_metrics) : row.result_metrics;
  const metrics = completed && Array.isArray(storedMetrics) ? storedMetrics.filter(m =>
    Number.isFinite(m.value) && Number.isFinite(m.min) && Number.isFinite(m.max) && m.value >= m.min && m.value <= m.max
    && ["draft_unvalidated", "calculated"].includes(m.status)) : [];
  const score = completed && (row.scoring_enabled === true || row.scoring_enabled === 1)
    && Number.isFinite(row.score) && Number.isFinite(row.score_min) && Number.isFinite(row.score_max)
    && row.score_max > row.score_min && row.score >= row.score_min && row.score <= row.score_max
      ? row.score : null;
  return {
    id: row.id, assessmentId: row.assessment_id,
    metrics,
    title: row.title || definition(row.assessment_id)?.title || row.assessment_id,
    createdAt: row.created_at, sessionId: row.session_id || null,
    status: completed ? "completed" : row.session_id ? "in-progress" : "assigned",
    startedAt: row.started_at || null, completedAt: row.completed_at || null,
    language: row.language || null, score, max: score === null ? null : row.score_max,
  };
}

export function buildOverview(rows, now = new Date()) {
  const totals = { prescribed: rows.length, completed: 0, inProgress: 0, notStarted: 0 };
  const forms = new Map(), durations = [];
  const months = Array.from({ length: 6 }, (_, i) => ({
    month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1)).toISOString().slice(0, 7),
    completed: 0,
  }));
  for (const row of rows) {
    if (!forms.has(row.assessmentId)) forms.set(row.assessmentId, {
      formId: row.assessmentId, title: row.title, prescribed: 0, completed: 0,
    });
    const form = forms.get(row.assessmentId);
    form.prescribed++;
    if (row.status === "completed") {
      totals.completed++; form.completed++;
      const completed = Date.parse(row.completedAt);
      if (Number.isFinite(completed)) {
        const month = months.find(m => m.month === new Date(completed).toISOString().slice(0, 7));
        if (month) month.completed++;
        const hours = (completed - Date.parse(row.createdAt)) / 3600000;
        if (Number.isFinite(hours) && hours >= 0) durations.push(hours);
      }
    } else if (row.status === "in-progress") totals.inProgress++;
    else totals.notStarted++;
  }
  durations.sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  return {
    totals: { ...totals,
      completionRate: rows.length ? Math.round(totals.completed / rows.length * 100) : null,
      medianCompletionHours: !durations.length ? null : durations.length % 2
        ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2,
    },
    byForm: [...forms.values()].sort((a, b) => b.prescribed - a.prescribed || a.title.localeCompare(b.title)),
    months,
  };
}
