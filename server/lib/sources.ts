export type TorznabSource = { id: string; name: string; url: string; apiKey: string; categories?: string };
export type MaskedSource = { id: string; name: string; url: string; categories?: string; hasKey: boolean };

/** Validates and normalises a user-submitted Torznab source; returns null when invalid. */
export function sanitizeSource(input: Partial<TorznabSource>, id: string): TorznabSource | null {
  const name = String(input.name ?? '').trim();
  const url = String(input.url ?? '').trim();
  if (!name || !/^https?:\/\//i.test(url)) return null;
  const categories = String(input.categories ?? '').trim();
  return { id, name, url, apiKey: String(input.apiKey ?? '').trim(), categories: categories || undefined };
}

/** Hides the API key when exposing a source to clients. */
export function maskSource(source: TorznabSource): MaskedSource {
  return { id: source.id, name: source.name, url: source.url, categories: source.categories, hasKey: Boolean(source.apiKey) };
}
