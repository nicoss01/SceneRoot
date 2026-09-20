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

const PRIVATE_V4 = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./];

/** True for loopback and RFC1918 / link-local / IPv6 ULA addresses (a home LAN). */
export function isPrivateAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  const ip = remoteAddress.startsWith('::ffff:') ? remoteAddress.slice(7) : remoteAddress;
  if (isLoopback(ip)) return true;
  if (PRIVATE_V4.some(re => re.test(ip))) return true;
  const low = ip.toLowerCase();
  return low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80');
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
export function isAdminAuthorized(remoteAddress: string | undefined, token: string | undefined, configuredToken: string | undefined, trustPrivate = true): boolean {
  if (isLoopback(remoteAddress)) return true;
  if (trustPrivate && isPrivateAddress(remoteAddress)) return true;
  if (!configuredToken || !token) return false;
  return safeEqual(token, configuredToken);
}

export function requiresAdmin(method: string, url: string): boolean {
  const path = url.split('?')[0];
  if (method === 'DELETE') return path === '/api/cache' || path === '/api/catalog' || /^\/api\/sources\/[^/]+$/.test(path) || /^\/api\/profiles\/[^/]+$/.test(path);
  if (method === 'PUT') return path === '/api/settings' || /^\/api\/profiles\/[^/]+$/.test(path);
  if (method !== 'POST') return false;
  if (path === '/api/downloads/rank') return false;
  return path === '/api/profiles'
    || path === '/api/library/scan'
    || path === '/api/library/enrich'
    || path === '/api/catalog/sync'
    || path === '/api/catalog/sync/stop'
    || path === '/api/cec' || path.startsWith('/api/cec/')
    || path === '/api/downloads'
    || path === '/api/downloads/torrent'
    || /^\/api\/downloads\/[^/]+\/(control|play)$/.test(path)
    || path === '/api/sources'
    || path.startsWith('/api/player/');
}
