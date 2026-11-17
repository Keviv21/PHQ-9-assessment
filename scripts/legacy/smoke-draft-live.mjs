import WebSocket from 'ws';

const port = Number(process.argv[2] || 4188);
const base = `http://127.0.0.1:${port}`;
const config = await (await fetch(`${base}/api/config`)).json();
if (!config.geminiConfigured) throw new Error('Gemini Live is not configured on the local server.');
const response = await fetch(`${base}/api/draft-sessions`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ draftId: 'brief-resilience-scale--cc5d54b07df8', mode: 'live' }),
});
if (!response.ok) throw new Error(`Could not create live review: ${response.status}`);
const session = await response.json();
const socket = new WebSocket(`ws://127.0.0.1:${port}/draft-ws?sessionId=${session.id}`);
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Gemini Live did not connect within 30 seconds.')), 30_000);
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'live_status' && message.status === 'connected') {
        clearTimeout(timeout);
        resolve();
      } else if (message.type === 'error' || (message.type === 'live_status' && message.status === 'error')) {
        clearTimeout(timeout);
        reject(new Error((message.message || message.detail || 'Gemini Live error').slice(0, 250)));
      }
    });
    socket.on('close', () => { clearTimeout(timeout); reject(new Error('Live session closed before connecting.')); });
    socket.on('error', (error) => { clearTimeout(timeout); reject(error); });
  });
  console.log('Gemini Live connected to an imported assessment.');
} finally { socket.close(); }
