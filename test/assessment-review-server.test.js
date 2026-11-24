import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

test('dedicated review server serves previews and blocks mutations and private source artifacts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'assessment-review-server-'));
  let child;
  try {
    await writeFile(join(directory, 'readiness.json'), JSON.stringify({ manifest: { databaseAccess: 'none', assessments: 186 } }));
    await writeFile(join(directory, 'index.html'), '<h1>Offline catalogue</h1>');
    await writeFile(join(directory, 'import-candidate.json'), '{"private":true}');
    const probe = createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    child = spawn(process.execPath, ['scripts/preview-assessment-review.mjs', '--dir', directory, '--port', String(port)], {
      env: { PATH: process.env.PATH, DATABASE_URL: 'this-must-never-be-opened' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Preview startup timed out.')), 10000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('Offline assessment review:')) { clearTimeout(timer); resolve(); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited ${code}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const home = await fetch(base);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Offline catalogue/);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}/import-candidate.json`)).status, 404);
    assert.equal((await fetch(`${base}/.env`)).status, 404);
    assert.equal((await fetch(`${base}/%2e%2e%2fpackage.json`)).status, 404);
    const head = await fetch(base, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  } finally {
    if (child && child.exitCode === null) {
      const stopped = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM'); await stopped;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
