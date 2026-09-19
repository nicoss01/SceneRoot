export type TorznabSource = { id: string; name: string; url: string; apiKey: string; categories?: string };
export type MaskedSource = { id: string; name: string; url: string; categories?: string; hasKey: boolean };

/**
 * Complète une URL de source saisie à la main. Beaucoup d'utilisateurs collent
 * l'adresse du site (« https://c411.org ») au lieu du point d'accès Torznab :
 * la requête part alors sur la page d'accueil, qui redirige puis expire.
 */
export function normalizeTorznabUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  let url: URL;
  try { url = new URL(trimmed) } catch { return trimmed }
  url.hash = '';
  if (url.pathname === '' || url.pathname === '/') url.pathname = '/api/torznab';
  else if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}

/** Validates and normalises a user-submitted Torznab source; returns null when invalid. */
export function sanitizeSource(input: Partial<TorznabSource>, id: string): TorznabSource | null {
  const name = String(input.name ?? '').trim();
  const url = String(input.url ?? '').trim();
  if (!name || !/^https?:\/\//i.test(url)) return null;
  const categories = String(input.categories ?? '').trim();
  return { id, name, url: normalizeTorznabUrl(url), apiKey: String(input.apiKey ?? '').trim(), categories: categories || undefined };
}

/** Hides the API key when exposing a source to clients. */
export function maskSource(source: TorznabSource): MaskedSource {
  return { id: source.id, name: source.name, url: source.url, categories: source.categories, hasKey: Boolean(source.apiKey) };
}
