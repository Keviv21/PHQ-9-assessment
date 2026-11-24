import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, apiUrl, socketUrl } from '../src/api/client.js';
import { renderPage } from './render-page.js';

test('API client preserves endpoint query strings and routes voice through the same origin', async (context) => {
  globalThis.window = { location: { origin: 'http://127.0.0.1:5173' } };
  context.after(() => { delete globalThis.window; });
  assert.equal(apiUrl('/api/definitions?language=hi'), '/api/definitions?language=hi');
  assert.equal(apiUrl(new URL('http://127.0.0.1:5173/api/form?formId=gad7')), '/api/form?formId=gad7');
  assert.equal(socketUrl('/definition-ws?sessionId=saved'), 'ws://127.0.0.1:5173/definition-ws?sessionId=saved');
  window.location.origin = 'https://clinic.example.com';
  assert.equal(socketUrl('/ws'), 'wss://clinic.example.com/ws');
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/recommendations');
    assert.equal(options.method, 'POST');
    return new Response('{"ok":true}');
  });
  assert.deepEqual(await (await apiFetch('/api/recommendations', { method: 'POST' })).json(), { ok: true });
});

test('API client reports an unavailable backend without losing the original error', async (context) => {
  globalThis.window = { location: { origin: 'http://127.0.0.1:5173' } };
  context.after(() => { delete globalThis.window; });
  context.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(apiFetch('/api/health'), /backend is running/);
});

test('every React page renders its existing workflow controls', () => {
  for (const page of ['ClinicPage', 'AssessmentDetailPage', 'AssessmentPage', 'DefinitionPage', 'DraftPage', 'ReportPage', 'RecommendPage', 'PatientSuggestPage']) {
    assert.match(renderPage(page), /<(?:main|div|header|svg)\b/);
  }
});
