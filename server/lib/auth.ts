const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

export function isLoopback(remoteAddress: string | undefined): boolean {
  return !!remoteAddress && LOOPBACK.has(remoteAddress);
}

/** Extracts a bearer token from an Authorization header, if present. */
export function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1];
}

/**
 * Admin/system routes (scan, downloads, player, CEC) are allowed from the
 * device itself (loopback — the kiosk browser) with no configuration.
 * Any remote client must present the configured admin token; if none is
 * configured, remote administration is denied outright.
 */
export function isAdminAuthorized(remoteAddress: string | undefined, token: string | undefined, configuredToken: string | undefined): boolean {
  if (isLoopback(remoteAddress)) return true;
  if (!configuredToken) return false;
  return token === configuredToken;
}

export function requiresAdmin(method: string, url: string): boolean {
  if (method !== 'POST') return false;
  const path = url.split('?')[0];
  if (path === '/api/downloads/rank') return false;
  return path === '/api/library/scan'
    || path === '/api/library/enrich'
    || path === '/api/cec' || path.startsWith('/api/cec/')
    || path === '/api/downloads'
    || /^\/api\/downloads\/[^/]+\/control$/.test(path)
    || path.startsWith('/api/player/');
}
