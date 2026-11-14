import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { copy } from '../public/i18n.js';

test('browser scripts parse and the assessment screen has its referenced controls', () => {
  for (const name of ['app.js', 'i18n.js', 'audio-worklet.js', 'report-view.js', 'report.js', 'recommend.js', 'patient-suggest.js', 'clinic.js', 'analytics.js', 'workspace-analytics.js', 'workspace-session.js', 'workspace-answers.js', 'workspace-answer-input.js', 'workspace-media.js', 'workspace-library.js', 'workspace-audio.js', 'assessment-library.js', 'draft-live.js']) {
    const path = fileURLToPath(new URL(`../public/${name}`, import.meta.url));
    execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
  }
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const [, id] of app.matchAll(/\$\('([^']+)'\)/g)) {
    assert.match(html, new RegExp(`id="${id}"`), `Missing control ${id}`);
  }
  for (const [, key] of html.matchAll(/data-i18n="([^"]+)"/g)) {
    assert.ok(copy.en[key], `Missing English text for ${key}`);
    assert.ok(copy.hi[key], `Missing Hindi text for ${key}`);
  }
  const clinicHtml = readFileSync(new URL('../public/clinic.html', import.meta.url), 'utf8');
  const clinic = readFileSync(new URL('../public/clinic.js', import.meta.url), 'utf8');
  for (const [, id] of clinic.matchAll(/\$\('([^']+)'\)/g)) {
    assert.match(clinicHtml, new RegExp(`id="${id}"`), `Missing clinic control ${id}`);
  }
  const library = readFileSync(new URL('../public/assessment-library.js', import.meta.url), 'utf8');
  for (const [, id] of library.matchAll(/byId\('([^']+)'\)/g)) {
    assert.match(clinicHtml, new RegExp(`id="${id}"`), `Missing library control ${id}`);
  }
  const analytics = readFileSync(new URL('../public/workspace-analytics.js', import.meta.url), 'utf8');
  for (const [, id] of analytics.matchAll(/find\(["']([^"']+)["']\)/g)) {
    assert.match(analytics, new RegExp(`data-part="${id}"`), `Missing analytics control ${id}`);
  }
  const draftHtml = readFileSync(new URL('../public/draft-live.html', import.meta.url), 'utf8');
  const draftScript = readFileSync(new URL('../public/draft-live.js', import.meta.url), 'utf8');
  for (const [, id] of draftScript.matchAll(/\$\('([^']+)'\)/g)) {
    assert.match(draftHtml, new RegExp(`id="${id}"`), `Missing live draft control ${id}`);
  }
  assert.match(html, /<option value="hi">हिन्दी<\/option>/);
});
