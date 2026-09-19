import { timingSafeEqual } from 'node:crypto';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

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
  if (!configuredToken || !token) return false;
  return safeEqual(token, configuredToken);
}

export function requiresAdmin(method: string, url: string): boolean {
  const path = url.split('?')[0];
  if (method === 'DELETE') return path === '/api/cache' || /^\/api\/sources\/[^/]+$/.test(path);
  if (method === 'PUT') return path === '/api/settings';
  if (method !== 'POST') return false;
  if (path === '/api/downloads/rank') return false;
  return path === '/api/library/scan'
    || path === '/api/library/enrich'
    || path === '/api/cec' || path.startsWith('/api/cec/')
    || path === '/api/downloads'
    || /^\/api\/downloads\/[^/]+\/control$/.test(path)
    || path === '/api/sources'
    || path.startsWith('/api/player/');
}
