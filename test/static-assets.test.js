import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { STATIC_ASSETS } from '../src/http/static-assets.js';

test('canonical and compatibility URLs resolve to real public files after reorganization', () => {
  const root = new URL('../public/', import.meta.url);
  for (const [url, file] of Object.entries(STATIC_ASSETS)) {
    assert.ok(!file.includes('..') && !file.startsWith('/'), url);
    assert.ok(statSync(new URL(file, root)).isFile(), `${url} -> ${file}`);
    if (file.endsWith('.html')) {
      const html = readFileSync(new URL(file, root), 'utf8');
      for (const [, asset] of html.matchAll(/(?:src|href)="(\/[^"?#]+\.(?:js|css|svg))"/g))
        assert.ok(Object.hasOwn(STATIC_ASSETS, asset), `${file} references missing ${asset}`);
    }
  }
  assert.equal(STATIC_ASSETS['/'], 'workspace/index.html');
  assert.equal(STATIC_ASSETS['/workspace-session.html'], STATIC_ASSETS['/session/index.html']);
  for (const path of ['/.env', '/package.json', '/analytics.js', '/analytics.css', '/assessment-library.js'])
    assert.ok(!Object.hasOwn(STATIC_ASSETS, path), path);
});
