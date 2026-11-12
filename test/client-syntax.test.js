import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { copy } from '../public/i18n.js';

test('browser scripts parse and the assessment screen has its referenced controls', () => {
  for (const name of ['app.js', 'i18n.js', 'audio-worklet.js', 'report-view.js', 'report.js', 'recommend.js']) {
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
  assert.match(html, /<option value="hi">हिन्दी<\/option>/);
});
