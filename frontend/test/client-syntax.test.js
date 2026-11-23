import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderPage } from './render-page.js';
import { copy } from '../src/controllers/i18n.js';
import { answerSelection } from '../src/controllers/answer-selection.js';

test('an answer stays highlighted long enough to see and blocks a second selection', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const selection = answerSelection();
  const button = {
    classList: { add(name) { assert.equal(name, 'selected'); }, remove(name) { assert.equal(name, 'selected'); } },
    setAttribute(name, value) { assert.equal(name, 'aria-pressed'); this.pressed = value; },
  };
  assert.equal(selection.show(button), true);
  assert.equal(button.pressed, 'true');
  assert.equal(selection.show(button), false);
  let ready = false;
  const highlighted = selection.visible.then(() => { ready = true; });
  context.mock.timers.tick(399);
  await Promise.resolve();
  assert.equal(ready, false);
  context.mock.timers.tick(1);
  await highlighted;
  assert.equal(selection.show(button), false);
  selection.clear();
  assert.equal(button.pressed, 'false');
  assert.equal(selection.visible, null);
});

test('browser scripts parse and the assessment screen has its referenced controls', () => {
  for (const name of ['app.js', 'i18n.js', 'questionnaire-language.js', 'answer-selection.js', 'audio-worklet.js', 'report-view.js', 'report.js', 'recommend.js', 'patient-suggest.js', 'clinic.js', 'doctor-chat.js', 'analytics.js', 'assessment-library.js', 'assessment-detail.js', 'draft-live.js', 'definition.js', 'definition-voice.js']) {
    const path = fileURLToPath(new URL(name === 'audio-worklet.js' ? `../public/${name}` : `../src/controllers/${name}`, import.meta.url));
    execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
  }
  const html = renderPage('AssessmentPage');
  const app = readFileSync(new URL('../src/controllers/app.js', import.meta.url), 'utf8');
  for (const [, id] of app.matchAll(/\$\('([^']+)'\)/g)) {
    assert.match(html, new RegExp(`id="${id}"`), `Missing control ${id}`);
  }
  for (const [, key] of html.matchAll(/data-i18n="([^"]+)"/g)) {
    assert.ok(copy.en[key], `Missing English text for ${key}`);
    assert.ok(copy.hi[key], `Missing Hindi text for ${key}`);
  }
  const clinicHtml = renderPage('ClinicPage');
  const clinic = readFileSync(new URL('../src/controllers/clinic.js', import.meta.url), 'utf8');
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
  const categoryMap = JSON.parse(readFileSync(new URL('../../backend/data/all-assessments.json', import.meta.url), 'utf8')).appMetadata.categories;
  const embeddedMap = clinic.match(/const libraryCategoryMap = (\{[\s\S]*?\n\});/);
  assert.ok(embeddedMap, 'The clinic must contain categories even when a local server is not restarted');
  assert.deepEqual(JSON.parse(embeddedMap[1]), categoryMap);
  assert.doesNotMatch(clinicHtml, /id="library-view"/);
  assert.match(clinic, /assessment-detail\.html/);
  const detailHtml = renderPage('AssessmentDetailPage');
  const detailScript = readFileSync(new URL('../src/controllers/assessment-detail.js', import.meta.url), 'utf8');
  for (const [, id] of detailScript.matchAll(/byId\('([^']+)'\)/g)) {
    assert.match(detailHtml, new RegExp(`id="${id}"`), `Missing assessment detail control ${id}`);
  }
  const analytics = readFileSync(new URL('../src/controllers/analytics.js', import.meta.url), 'utf8');
  for (const [, id] of analytics.matchAll(/byId\('([^']+)'\)/g)) {
    assert.match(clinicHtml, new RegExp(`id="${id}"`), `Missing analytics control ${id}`);
  }
  const doctorChat = readFileSync(new URL('../src/controllers/doctor-chat.js', import.meta.url), 'utf8');
  for (const [, id] of doctorChat.matchAll(/byId\('([^']+)'\)/g)) {
    assert.match(clinicHtml, new RegExp(`id="${id}"`), `Missing doctor conversation control ${id}`);
  }
  const draftHtml = renderPage('DraftPage');
  const draftScript = readFileSync(new URL('../src/controllers/draft-live.js', import.meta.url), 'utf8');
  for (const [, id] of draftScript.matchAll(/\$\('([^']+)'\)/g)) {
    assert.match(draftHtml, new RegExp(`id="${id}"`), `Missing live draft control ${id}`);
  }
  const definitionHtml = renderPage('DefinitionPage');
  const definitionScript = readFileSync(new URL('../src/controllers/definition.js', import.meta.url), 'utf8');
  for (const [, id] of definitionScript.matchAll(/\$\('([^']+)'\)/g)) {
    assert.match(definitionHtml, new RegExp(`id="${id}"`), `Missing catalogue assessment control ${id}`);
  }
  assert.doesNotMatch(definitionHtml, /id="voice-(?:toggle|stop)"/);
  assert.ok(definitionHtml.indexOf('id="definition-start"') < definitionHtml.indexOf('class="conversation-panel definition-main"'));
  assert.doesNotMatch(definitionHtml, /source drafts awaiting independent clinical review/);
  for (const page of [html, draftHtml, definitionHtml]) {
    for (const layout of ['app-header', 'context-panel', 'conversation-panel', 'session-panel']) {
      assert.match(page, new RegExp(`class="[^"]*\\b${layout}\\b`), `Assessment page missing ${layout}`);
    }
    for (const element of ['assessment-card', 'assessment-topline', 'progress-track', 'question-area', 'transcript', 'composer', 'camera-box', 'media-actions']) {
      assert.match(page, new RegExp(`class="[^"]*\\b${element}\\b`), `Assessment page missing ${element}`);
    }
  }
  assert.doesNotMatch(definitionHtml, /IS THIS WHAT YOU MEANT\?|Let me clarify|Yes, that's right/);
  assert.doesNotMatch(html, /IS THIS WHAT YOU MEANT\?|Let me clarify|Yes, that's right/);
  assert.match(draftHtml, /IS THIS WHAT YOU MEANT\?/); // On-screen draft mode retains confirmation.
  assert.doesNotMatch(html, /id="confirmation"/);
  assert.match(html, /<option value="hi">हिन्दी<\/option>/);
});
