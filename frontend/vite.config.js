import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.BACKEND_URL || 'http://127.0.0.1:4174';
  const proxy = Object.fromEntries(['/api', '/ws', '/draft-ws', '/definition-ws'].map((path) => [path, {
    target,
    ws: path !== '/api',
    // Preserve the browser's Host/Origin pair for backend WebSocket validation.
    changeOrigin: false,
  }]));
  return {
    esbuild: { jsx: 'automatic' },
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
    preview: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
    plugins: [{
      name: 'assessment-page-reload',
      handleHotUpdate({ file, server }) {
        // The preserved media/controllers use document-scoped listeners.
        // Reload on JS edits instead of attaching a second set of listeners.
        if (/\/src\/.*\.(jsx|js)$/.test(file)) {
          server.ws.send({ type: 'full-reload' });
          return [];
        }
      },
    }],
  };
});
