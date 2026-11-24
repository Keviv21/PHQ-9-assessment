import test from 'node:test';
import assert from 'node:assert/strict';
import { completedReportEntries } from '../src/controllers/report-order.js';

test('completed reports are ordered by completion time across assessment types', () => {
  const reports = [{ id: 'phq', completedAt: '2026-11-20T10:00:00.000Z' }];
  const prescriptions = [
    { kind: 'draft', status: 'completed', assessmentId: 'dass', completedAt: '2026-11-24T10:00:00.000Z' },
    { kind: 'definition', status: 'completed', assessmentId: 'asrs', completedAt: '2026-11-22T10:00:00.000Z' },
    { kind: 'definition', status: 'assigned', assessmentId: null, createdAt: '2026-11-25T10:00:00.000Z' },
  ];
  assert.deepEqual(completedReportEntries(reports, prescriptions).map((item) => item.id), ['dass', 'asrs', 'phq']);
});
