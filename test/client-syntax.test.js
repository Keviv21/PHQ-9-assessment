import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { copy } from '../public/i18n.js';

test('browser scripts parse and the assessment screen has its referenced controls', () => {
  for (const name of ['app.js', 'i18n.js', 'audio-worklet.js', 'report-view.js', 'report.js', 'recommend.js', 'patient-suggest.js', 'clinic.js', 'doctor-chat.js', 'analytics.js', 'assessment-library.js', 'draft-live.js', 'definition.js', 'definition-voice.js']) {
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
  assert.match(clinicHtml, /id="assessment-search"[^>]*role="combobox"/);
  assert.match(clinicHtml, /id="assessment-options"[^>]*role="listbox"/);
  assert.ok(clinicHtml.indexOf('id="doctor-chat-form"') < clinicHtml.indexOf('id="assessment-search"'));
  assert.ok(clinicHtml.indexOf('class="panel doctor-chat-panel"') < clinicHtml.indexOf('class="panel assessment-library-panel"'));
  assert.ok(clinicHtml.indexOf('class="panel assessment-library-panel"') < clinicHtml.indexOf('class="panel decision-panel"'));
  assert.match(clinicHtml, /id="assessment-library-categories"/);
  assert.match(clinicHtml, /id="assessment-library-suggested"[^>]*aria-pressed="false"/);
  const categoryMap = JSON.parse(readFileSync(new URL('../data/assessment-library-categories.json', import.meta.url), 'utf8'));
  const embeddedMap = clinic.match(/const libraryCategoryMap = (\{[\s\S]*?\n\});/);
  assert.ok(embeddedMap, 'The clinic must contain categories even when a local server is not restarted');
  assert.deepEqual(JSON.parse(embeddedMap[1]), categoryMap);
  assert.doesNotMatch(clinicHtml, /id="library-view"/);
  const analytics = readFileSync(new URL('../public/analytics.js', import.meta.url), 'utf8');
  for (const [, id] of analytics.matchAll(/byId\('([^']+)'\)/g)) {
    assert.match(clinicHtml, new RegExp(`id="${id}"`), `Missing analytics control ${id}`);
  }
  const doctorChat = readFileSync(new URL('../public/doctor-chat.js', import.meta.url), 'utf8');
  for (const [, id] of doctorChat.matchAll(/byId\('([^']+)'\)/g)) {
    assert.match(clinicHtml, new RegExp(`id="${id}"`), `Missing doctor conversation control ${id}`);
  }
  const draftHtml = readFileSync(new URL('../public/draft-live.html', import.meta.url), 'utf8');
  const draftScript = readFileSync(new URL('../public/draft-live.js', import.meta.url), 'utf8');
  for (const [, id] of draftScript.matchAll(/\$\('([^']+)'\)/g)) {
    assert.match(draftHtml, new RegExp(`id="${id}"`), `Missing live draft control ${id}`);
  }
  const definitionHtml = readFileSync(new URL('../public/definition.html', import.meta.url), 'utf8');
  const definitionScript = readFileSync(new URL('../public/definition.js', import.meta.url), 'utf8');
  for (const [, id] of definitionScript.matchAll(/\$\('([^']+)'\)/g)) {
    assert.match(definitionHtml, new RegExp(`id="${id}"`), `Missing catalogue assessment control ${id}`);
  }
  assert.doesNotMatch(definitionHtml, /id="voice-(?:toggle|stop)"/);
  assert.ok(definitionHtml.indexOf('id="definition-start"') < definitionHtml.indexOf('class="conversation-panel definition-main"'));
  assert.doesNotMatch(definitionHtml, /source drafts awaiting independent clinical review/);
  for (const page of [html, draftHtml, definitionHtml]) {
    assert.match(page, /href="\/assessment-unified\.css"/);
    for (const layout of ['app-header', 'context-panel', 'conversation-panel', 'session-panel']) {
      assert.match(page, new RegExp(`class="[^"]*\\b${layout}\\b`), `Assessment page missing ${layout}`);
    }
    for (const element of ['assessment-card', 'assessment-topline', 'progress-track', 'question-area', 'transcript', 'composer', 'camera-box', 'media-actions']) {
      assert.match(page, new RegExp(`class="[^"]*\\b${element}\\b`), `Assessment page missing ${element}`);
    }
    for (const label of ['IS THIS WHAT YOU MEANT?', 'Let me clarify', "Yes, that's right"]) {
      assert.ok(page.includes(label), `Assessment confirmation missing ${label}`);
    }
  }
  assert.match(html, /<option value="hi">हिन्दी<\/option>/);
});
