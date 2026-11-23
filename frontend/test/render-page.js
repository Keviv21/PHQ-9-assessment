import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export function renderPage(name) {
  const result = buildSync({
    entryPoints: [fileURLToPath(new URL(`../src/pages/${name}.jsx`, import.meta.url))],
    bundle: true, write: false, format: 'cjs', platform: 'node',
    jsx: 'automatic', packages: 'external', external: ['../controllers/*'], loader: { '.css': 'empty' },
    define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url) });
  return renderToStaticMarkup(createElement(module.exports.default));
}
