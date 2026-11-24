export function completedReportEntries(reports, prescriptions) {
  return [
    ...reports.map((report) => ({ kind: 'scored', report, completedAt: report.completedAt, id: report.id })),
    ...prescriptions
      .filter((record) => record.status === 'completed' && ['draft', 'definition'].includes(record.kind))
      .map((record) => ({ kind: record.kind, record, completedAt: record.completedAt, id: record.assessmentId })),
  ].sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '') || a.id.localeCompare(b.id));
}
