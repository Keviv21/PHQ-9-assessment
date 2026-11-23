import { loadContent } from './content-db.js';

// Load the published catalogue and sample patients from the configured database.
// The API serves this startup snapshot; restart after publishing a new version.
export const content = await loadContent();
