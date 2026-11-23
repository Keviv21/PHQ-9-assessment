import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const name of await readdir(new URL('../src/', import.meta.url))) {
  if (name.endsWith('.js')) execFileSync(process.execPath, ['--check', fileURLToPath(new URL(`../src/${name}`, import.meta.url))], { stdio: 'pipe' });
}
for (const name of await readdir(new URL('../data/', import.meta.url))) {
  if (name.endsWith('.json')) JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
}
console.log('Backend JavaScript and assessment JSON checks passed.');
