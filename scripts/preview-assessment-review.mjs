// Dedicated read-only local server. Never imports the app, any store, pg, or .env.
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
const options = new Map();
for (let i = 0; i < args.length; i += 2) {
  if (!['--dir', '--port'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node scripts/preview-assessment-review.mjs [--dir <review-directory>] [--port <port>]');
  options.set(args[i], args[i + 1]);
}
const root = await realpath(resolve(options.get('--dir') || fileURLToPath(new URL('../local-data/assessment-review', import.meta.url))));
const port = Number(options.get('--port') || 4188);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port.');
const manifest = JSON.parse(await readFile(join(root, 'readiness.json'), 'utf8')).manifest;
if (manifest.databaseAccess !== 'none') throw new Error('Not an offline review package.');
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end('Read-only preview'); return; }
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
    // Deliberately exclude the raw extraction/import candidate and private asset manifest.
    if (!/^(?:index\.html|README\.md|readiness\.(?:json|csv)|import-plan\.json|(?:definitions|profiles|reviews)\/[a-z0-9-]+\.json|previews\/[a-z0-9-]+\.(?:single|repeated|missing)\.html)$/.test(path)) throw new Error('Not found');
    const file = await realpath(join(root, path));
    const rel = relative(root, file);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Not found');
    const body = await readFile(file);
    const type = { '.html': 'text/html', '.json': 'application/json', '.csv': 'text/csv', '.md': 'text/plain' }[extname(file)];
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Choose another --port; no existing server was stopped.` : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Offline assessment review: http://127.0.0.1:${port} (${manifest.assessments} assessments; no database connection)`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
