import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDeploymentEnvironment } from '../src/deployment.js';

const root = fileURLToPath(new URL('..', import.meta.url));
validateDeploymentEnvironment();
assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Node.js 24 or newer is required.');

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  }))).flat();
}

const sources = (await Promise.all(['src', 'public', 'api'].map((name) => files(join(root, name))))).flat();
for (const path of sources.filter((path) => path.endsWith('.js'))) {
  execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
}
for (const path of await files(join(root, 'data'))) {
  if (path.endsWith('.json')) JSON.parse(await readFile(path, 'utf8'));
}

// Every local asset reference must exist before publishing the static output.
for (const path of sources.filter((path) => path.endsWith('.html'))) {
  const html = await readFile(path, 'utf8');
  for (const [, reference] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^(?:[a-z]+:|#|\/\/)/i.test(reference)) continue;
    const asset = reference.split(/[?#]/)[0];
    if (!asset || !/\.(?:js|css|svg|png|jpe?g|ico|webp)$/.test(asset)) continue;
    const target = asset.startsWith('/') ? resolve(root, 'public', `.${asset}`) : resolve(dirname(path), asset);
    assert.ok((await stat(target)).isFile(), `Missing asset: ${reference}`);
  }
}

const { listDefinitions } = await import('../src/definition-library.js');
const { listDraftAssessments } = await import('../src/draft-library.js');
assert.equal(listDefinitions().length, 186);
assert.equal(listDraftAssessments().length, 186);

const output = join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(root, 'public'), output, { recursive: true });
// Vercel resolves existing static files before fallback rewrites. Give both
// public entry points real files so / cannot accidentally serve the assessment.
await copyFile(join(root, 'public/index.html'), join(output, 'assessment.html'));
await copyFile(join(root, 'public/clinic.html'), join(output, 'index.html'));
console.log(`Build passed: ${sources.filter((path) => path.endsWith('.js')).length} JavaScript files checked; static assets copied to dist/.`);
console.log('Vercel will bundle api/server.js, src/, and the included assessment JSON files as a Node.js function.');
