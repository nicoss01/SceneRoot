import { useCallback, useEffect, useState } from 'react';
import { rememberCatalogItems } from '../data/catalog';
import { libraryGroupToMedia, type LibraryGroup } from '../data/library';
import type { MediaItem } from '../types';

export type { LibraryGroup, LibraryMetadata } from '../data/library';

export function useLibrary() {
  const [groups, setGroups] = useState<LibraryGroup[]>([]);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/library/grouped');
      if (!response.ok) throw new Error(`Bibliothèque indisponible (${response.status})`);
      const result = await response.json() as LibraryGroup[];
      const mapped = result.map((group, index) => libraryGroupToMedia(group, index));
      setGroups(result); setItems(mapped); rememberCatalogItems(mapped);
    } catch (cause) { setError((cause as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { groups, items, loading, error, refresh };
}
