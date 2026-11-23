import { spawn } from 'node:child_process';
import WebSocket from 'ws';

if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured.');

const port = 4199;
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['src/server.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port), DATABASE_URL: '', DB_PATH: ':memory:' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let childOutput = '';
child.stdout.on('data', (chunk) => { childOutput += chunk.toString(); });
child.stderr.on('data', (chunk) => { childOutput += chunk.toString(); });

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited before startup: ${childOutput.slice(-400)}`);
    try { if ((await fetch(`${base}/api/config`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not start: ${childOutput.slice(-400)}`);
}

let socket;
try {
  await waitForServer();
  const assigned = await fetch(`${base}/api/definition-patients/demo-a/prescriptions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ formId: 'adult-adhd-self-report-scale-asrs--814829bfeff1' }),
  });
  if (!assigned.ok) throw new Error(`Assignment failed: ${assigned.status}`);
  const prescription = await assigned.json();
  const started = await fetch(`${base}/api/definition-prescriptions/${prescription.id}/start`, { method: 'POST' });
  if (!started.ok) throw new Error(`Session start failed: ${started.status}`);
  const session = await started.json();
  socket = new WebSocket(`ws://127.0.0.1:${port}/definition-ws?sessionId=${session.id}`);
  await new Promise((resolve, reject) => {
    let stateSeen = false;
    let connected = false;
    let audioSeen = false;
    const timeout = setTimeout(() => reject(new Error('Gemini Live did not connect within 45 seconds.')), 45_000);
    const done = (error) => { clearTimeout(timeout); error ? reject(error) : resolve(); };
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'state' && message.question?.id === 'Q1') stateSeen = true;
      if (message.type === 'live_status' && message.status === 'connected') connected = true;
      if (message.type === 'audio' && message.data) audioSeen = true;
      if (message.type === 'error' || message.type === 'live_status' && message.status === 'error') {
        done(new Error((message.message || message.detail || 'Gemini Live error').slice(0, 250)));
      } else if (stateSeen && connected && audioSeen) done();
    });
    socket.on('close', () => done(new Error('Voice session closed before connecting.')));
    socket.on('error', done);
  });
  console.log('Definition assessment opened, Gemini Live connected, and the first spoken prompt arrived.');
} finally {
  socket?.close();
  child.kill();
}
