import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../src/store.js';
import { openDraftStore } from '../src/draft-store.js';

test('synthetic demo database combines score trends and answer-only activity', () => {
  const directory = mkdtempSync(join(tmpdir(), 'assessment-analytics-'));
  const path = join(directory, 'sample.sqlite');
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/seed-analytics-demo.mjs', import.meta.url)), path],
      { stdio: 'pipe' });
    const main = openStore(path);
    const imported = openDraftStore(path);
    try {
      const overview = main.analyticsOverview(imported.analyticsPrescriptionRows());
      assert.equal(overview.totals.prescribed, 8);
      assert.equal(overview.totals.completed, 8);
      assert.equal(overview.byForm.filter((item) => item.prescribed).length, 4);
      const patient = main.patientAnalytics('demo-b', imported.patientAnalyticsRows('demo-b'));
      assert.equal(patient.totalCompleted, 8);
      assert.equal(patient.totalScored, 7);
      assert.equal(patient.series.filter((item) => item.formId === 'dass21').length, 4);
      assert.ok(patient.activity.some((item) => item.score === null && item.formTitle === 'Flourishing Scale (FS)'));
    } finally { main.close(); imported.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
