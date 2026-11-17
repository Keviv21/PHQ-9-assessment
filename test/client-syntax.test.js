import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { copy } from '../public/legacy/i18n.js';

test('browser scripts parse and the assessment screen has its referenced controls', () => {
  const publicRoot = new URL('../public/', import.meta.url);
  for (const name of readdirSync(publicRoot, { recursive: true }).filter(name => name.endsWith('.js'))) {
    const path = fileURLToPath(new URL(name, publicRoot));
    execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
  }
  const html = readFileSync(new URL('../public/legacy/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../public/legacy/app.js', import.meta.url), 'utf8');
  for (const [, id] of app.matchAll(/\$\('([^']+)'\)/g)) {
    assert.match(html, new RegExp(`id="${id}"`), `Missing control ${id}`);
  }
  for (const [, key] of html.matchAll(/data-i18n="([^"]+)"/g)) {
    assert.ok(copy.en[key], `Missing English text for ${key}`);
    assert.ok(copy.hi[key], `Missing Hindi text for ${key}`);
  }
  const clinicHtml = readFileSync(new URL('../public/workspace/index.html', import.meta.url), 'utf8');
  const clinic = readFileSync(new URL('../public/workspace/app.js', import.meta.url), 'utf8');
  for (const [, id] of clinic.matchAll(/\$\('([^']+)'\)/g)) {
    assert.match(clinicHtml, new RegExp(`id="${id}"`), `Missing clinic control ${id}`);
  }
  const analytics = readFileSync(new URL('../public/workspace/analytics.js', import.meta.url), 'utf8');
  for (const [, id] of analytics.matchAll(/find\(["']([^"']+)["']\)/g)) {
    assert.match(analytics, new RegExp(`data-part="${id}"`), `Missing analytics control ${id}`);
  }
  const draftHtml = readFileSync(new URL('../public/legacy/draft-live.html', import.meta.url), 'utf8');
  const draftScript = readFileSync(new URL('../public/legacy/draft-live.js', import.meta.url), 'utf8');
  for (const [, id] of draftScript.matchAll(/\$\('([^']+)'\)/g)) {
    assert.match(draftHtml, new RegExp(`id="${id}"`), `Missing live draft control ${id}`);
  }
  assert.match(html, /<option value="hi">हिन्दी<\/option>/);
});


test('patient assessment controls referenced by the script exist in its page', () => {
  const html = readFileSync(new URL('../public/session/index.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../public/session/app.js', import.meta.url), 'utf8');
  for (const [, id] of script.matchAll(/\$\(["']([^"']+)["']\)/g))
    assert.ok(html.includes(`id="${id}"`), `Missing assessment control ${id}`);
});
