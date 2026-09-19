import { useCallback, useEffect, useRef, useState } from 'react';
import { rememberCatalogItems } from '../data/catalog';
import type { MediaItem, MediaKind } from '../types';

type CatalogResponse = {
  items: MediaItem[];
  page: number;
  hasMore: boolean;
  source: string;
  cachedAt: string;
};

export function useCatalog(kind?: MediaKind, limit = 12, enabled = true, genre = '', query = '', sort = '') {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    requestRef.current?.abort();
    setItems([]);
    setPage(0);
    setHasMore(true);
    setSource('');
    setError('');
  }, []);

  useEffect(() => { reset(); }, [genre, kind, limit, query, sort, reset]);

  const loadMore = useCallback(async () => {
    if (!enabled || loading || !hasMore) return;
    const nextPage = page + 1;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: String(limit) });
      if (kind) params.set('kind', kind);
      if (genre) params.set('genre', genre);
      if (query) params.set('q', query);
      if (sort) params.set('sort', sort);
      const response = await fetch(`/api/catalog?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Catalogue indisponible (${response.status})`);
      const result = await response.json() as CatalogResponse;
      rememberCatalogItems(result.items);
      setItems(current => {
        const merged = new Map(current.map(item => [item.id, item]));
        result.items.forEach(item => merged.set(item.id, item));
        return [...merged.values()];
      });
      setPage(result.page);
      setHasMore(result.hasMore);
      setSource(result.source);
    } catch (cause) {
      if ((cause as Error).name !== 'AbortError') setError((cause as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [enabled, genre, hasMore, kind, limit, loading, page, query, sort]);

  useEffect(() => {
    if (enabled && page === 0 && items.length === 0 && !loading && !error) void loadMore();
  }, [enabled, error, items.length, loadMore, loading, page]);

  useEffect(() => () => requestRef.current?.abort(), []);
  return { items, hasMore, loading, source, error, loadMore, refresh: reset };
}
