import { useCallback, useEffect, useRef, useState } from 'react';
import { rememberCatalogItems } from '../data/catalog';
import { libraryGroupToMedia, type LibraryGroup } from '../data/library';
import type { MediaItem } from '../types';

type ResumeEntry = { group: LibraryGroup; mediaId: string; position: number; duration: number; progress: number; updatedAt: string; season?: number; episode?: number };

/** « S02 · E05 » lorsque la reprise porte sur un épisode identifié. */
function episodeLabel(entry: { season?: number; episode?: number }): string | undefined {
  if (entry.episode === undefined) return undefined;
  const season = entry.season !== undefined ? `S${String(entry.season).padStart(2, '0')} · ` : '';
  return `${season}E${String(entry.episode).padStart(2, '0')}`;
}
type HistoryEntry = ResumeEntry & { completed: boolean; rating?: number; tags?: string[] };

function useEndpoint<T>(url: string, map: (rows: T[]) => MediaItem[]) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Indisponible (${response.status})`);
      const rows = await response.json() as T[];
      const mapped = map(rows);
      rememberCatalogItems(mapped);
      setItems(mapped);
    } catch (cause) { setError((cause as Error).message); } finally { setLoading(false); }
    // map is recreated per call site but kept stable enough for this usage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { items, loading, error, refresh };
}

export function useResume(profileId: string) {
  // La carte affichée porte l'identifiant du groupe ; retirer une reprise exige
  // celui de la lecture elle-même, que l'on garde en correspondance.
  const keys = useRef<Record<string, string>>({});
  const result = useEndpoint<ResumeEntry>(`/api/playback/${encodeURIComponent(profileId)}`, rows => {
    const mapped = rows.map((row, index) => ({ media: { ...libraryGroupToMedia(row.group, index, Math.min(100, Math.round(row.progress * 100))), episodeLabel: episodeLabel(row) }, mediaId: row.mediaId }));
    keys.current = Object.fromEntries(mapped.map(entry => [entry.media.id, entry.mediaId]));
    return mapped.map(entry => entry.media);
  });
  const dismiss = useCallback(async (itemId: string) => {
    const mediaId = keys.current[itemId] ?? itemId;
    await fetch(`/api/playback/${encodeURIComponent(profileId)}/${encodeURIComponent(mediaId)}/dismiss`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dismissed: true }),
    }).catch(() => { /* hors ligne : la carte réapparaîtra */ });
    await result.refresh();
  }, [profileId, result]);
  return { ...result, dismiss };
}

export function useHistory(profileId: string) {
  return useEndpoint<HistoryEntry>(`/api/history/${encodeURIComponent(profileId)}`, rows =>
    rows.map((row, index) => {
      const media = libraryGroupToMedia(row.group, index, row.completed ? undefined : Math.min(100, Math.round(row.progress * 100)));
      return row.rating ? { ...media, rating: row.rating } : media;
    }));
}
