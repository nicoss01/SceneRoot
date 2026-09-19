const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Decides whether a browser Origin may call the API.
 * A missing origin (same-origin / non-CORS requests such as the kiosk itself) is always allowed.
 * Localhost origins are always allowed (dev server, on-device browser).
 * Any other origin must be explicitly listed in SCENEROOT_ALLOWED_ORIGINS.
 */
export function isAllowedOrigin(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  let hostname: string;
  try { hostname = new URL(origin).hostname; } catch { return false; }
  if (LOCAL_HOSTS.has(hostname)) return true;
  return allowed.includes(origin);
}

export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? '').split(',').map(entry => entry.trim()).filter(Boolean);
}
