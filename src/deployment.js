// Hosting configuration is checked before opening a database. A temporary SQLite
// file on a function instance would lose patient work on the next cold start.
export function validateDeploymentEnvironment(env = process.env) {
  if (env.VERCEL && !env.DATABASE_URL?.trim()) {
    throw new Error('Vercel requires DATABASE_URL with persistent PostgreSQL storage; SQLite is only supported locally.');
  }
  if (env.DATABASE_URL) {
    let url;
    try { url = new URL(env.DATABASE_URL); } catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL.'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
        url.searchParams.get('sslmode') !== 'verify-full') {
      throw new Error('DATABASE_URL must be a PostgreSQL URL with sslmode=verify-full.');
    }
  }
}

export function isAllowedWebSocketOrigin(request, env = process.env) {
  const origin = request.headers.origin;
  // Non-browser clients do not always send Origin. Origin is a browser CSRF
  // boundary, not authentication for a patient or clinician.
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) return false;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (!local && parsed.protocol !== 'https:') return false;
    // Trust proxy headers only on Vercel, where the platform supplies them.
    const host = env.VERCEL ? request.headers['x-forwarded-host'] || request.headers.host : request.headers.host;
    return parsed.host === host;
  } catch { return false; }
}
