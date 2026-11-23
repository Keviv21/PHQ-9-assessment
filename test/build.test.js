import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('static deployment opens the clinic at home and the patient screen at assessment.html', () => {
  execFileSync(process.execPath, ['scripts/build.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, VERCEL: '', DATABASE_URL: '' },
    stdio: 'pipe',
  });
  const home = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const assessment = readFileSync(new URL('../dist/assessment.html', import.meta.url), 'utf8');
  const detail = readFileSync(new URL('../dist/assessment-detail.html', import.meta.url), 'utf8');
  assert.match(home, /<h1>Prescribe Test<\/h1>/);
  assert.match(home, /src="\/clinic\.js"/);
  assert.match(home, /class="logo-home" href="\/"/);
  assert.doesNotMatch(home, /sidebar-language-section/);
  assert.match(assessment, /id="assessment-title"/);
  assert.match(assessment, /src="\/app\.js"/);
  assert.match(detail, /id="assessment-title"/);
  assert.match(detail, /src="\/assessment-detail\.js"/);
});
