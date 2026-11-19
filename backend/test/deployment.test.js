import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import WebSocket from 'ws';
import { isAllowedWebSocketOrigin, validateDeploymentEnvironment } from '../src/deployment.js';

test('Vercel rejects ephemeral SQLite and invalid PostgreSQL configuration', () => {
  assert.throws(() => validateDeploymentEnvironment({ VERCEL: '1' }), /requires DATABASE_URL/);
  assert.throws(() => validateDeploymentEnvironment({ DATABASE_URL: 'invalid' }), /valid PostgreSQL URL/);
  assert.throws(() => validateDeploymentEnvironment({ DATABASE_URL: 'postgresql://db/app?sslmode=require' }), /verify-full/);
  assert.doesNotThrow(() => validateDeploymentEnvironment({ VERCEL: '1', DATABASE_URL: 'postgresql://db/app?sslmode=verify-full' }));
  assert.doesNotThrow(() => validateDeploymentEnvironment({}));
});

test('WebSockets accept HTTPS deployment origins and reject cross-origin requests', () => {
  const allowed = (origin, host, forwardedHost, env = {}) => isAllowedWebSocketOrigin({
    headers: { origin, host, 'x-forwarded-host': forwardedHost },
  }, env);
  assert.equal(allowed('https://clinic.example.com', 'clinic.example.com'), true);
  assert.equal(allowed('https://preview-123.vercel.app', 'internal', 'preview-123.vercel.app', { VERCEL: '1' }), true);
  assert.equal(allowed('https://clinic.example.com', 'internal', 'clinic.example.com'), false);
  assert.equal(allowed('https://attacker.example', 'clinic.example.com'), false);
  assert.equal(allowed('http://clinic.example.com', 'clinic.example.com'), false);
  assert.equal(allowed('https://clinic.example.com.attacker.example', 'clinic.example.com'), false);
  assert.equal(allowed('null', 'clinic.example.com'), false);
  assert.equal(allowed('https://clinic.example.com/path', 'clinic.example.com'), false);
  assert.equal(allowed('http://127.0.0.1:4174', '127.0.0.1:4174'), true);
  assert.equal(allowed(undefined, '127.0.0.1:4174'), true);
});

test('draft assessment enables the matching resume control after a function disconnect', () => {
  const source = readFileSync(new URL('../public/draft-live.js', import.meta.url), 'utf8');
  const connect = source.slice(source.indexOf('function connect() {'), source.indexOf('\nasync function start(mode)'));
  for (const mode of ['demo', 'live']) {
    const controls = new Map();
    const $ = (id) => {
      if (!controls.has(id)) controls.set(id, { disabled: true, hidden: true });
      return controls.get(id);
    };
    const context = {
      $, location: { protocol: 'https:', host: 'clinic.example.com' },
      sessionId: 'saved-session', socket: null, state: { status: 'in_progress', mode },
      config: { geminiConfigured: true }, stopMedia() {}, setStatus() {},
      WebSocket: class { constructor(url) { this.url = url; } },
    };
    runInNewContext(`${connect}\nconnect(); socket.onclose();`, context);
    assert.equal($('draft-start').hidden, false);
    assert.equal($('draft-start-live').disabled, mode !== 'live');
    assert.equal($('draft-start-screen').disabled, mode !== 'demo');
  }
});

test('exported Vercel server serves HTTP and resumes a saved assessment with an HTTPS origin', { timeout: 15000 }, async () => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import server from './api/server.js';
    assert.equal(server.listening, false);
    server.listen(0, '127.0.0.1', () => console.log(server.address().port));
  `], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, VERCEL: '', DATABASE_URL: '', DB_PATH: ':memory:', GEMINI_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let socket;
  const errors = [];
  child.stderr.on('data', (data) => errors.push(data.toString()));
  try {
    const port = await new Promise((resolve, reject) => {
      child.stdout.once('data', (data) => resolve(Number(data.toString().trim())));
      child.once('exit', (code) => reject(new Error(`Server exited ${code}: ${errors.join('')}`)));
      child.once('error', reject);
    });
    const base = `http://127.0.0.1:${port}`;
    const options = { headers: { host: 'clinic.example.com', origin: 'https://clinic.example.com' } };
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await fetch(`${base}/clinic.js`)).status, 200);
    const prescription = await (await fetch(`${base}/api/demo-patients/demo-a/prescriptions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ formId: 'phq9' }),
    })).json();
    const url = `ws://127.0.0.1:${port}/ws?mode=demo&language=en&prescriptionId=${prescription.id}`;
    socket = new WebSocket(url, options);
    let message = JSON.parse((await once(socket, 'message'))[0].toString());
    const sessionId = message.assessment.id;
    socket.send(JSON.stringify({ type: 'select', value: 1 }));
    await once(socket, 'message');
    socket.send(JSON.stringify({ type: 'confirm' }));
    message = JSON.parse((await once(socket, 'message'))[0].toString());
    assert.equal(message.assessment.answers.length, 1);
    socket.close();
    await once(socket, 'close');
    socket = new WebSocket(url, options);
    message = JSON.parse((await once(socket, 'message'))[0].toString());
    assert.equal(message.assessment.id, sessionId);
    assert.equal(message.assessment.currentNumber, 2);
    socket.close();
    await once(socket, 'close');
    for (const path of ['/ws', '/draft-ws', '/definition-ws']) {
      socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
        headers: { host: 'clinic.example.com', origin: 'https://attacker.example' },
      });
      const [code] = await once(socket, 'close');
      assert.equal(code, 1008, `${path} rejects an unexpected origin`);
    }
  } finally {
    socket?.terminate();
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'exit');
      child.kill('SIGTERM');
      await closed;
    }
  }
});
