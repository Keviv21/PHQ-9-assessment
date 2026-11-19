import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../data/analytics-demo.sqlite', import.meta.url));
if (!existsSync(path)) {
  console.error('Run npm run seed:analytics first to create the separate synthetic database.');
  process.exit(1);
}
process.env.DB_PATH = path;
process.env.PORT = process.env.ANALYTICS_DEMO_PORT || '4175';
await import('../src/server.js');
