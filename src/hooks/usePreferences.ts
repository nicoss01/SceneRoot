import { useCallback, useEffect, useState } from 'react';

/** Per-profile favourites and hidden media, with optimistic toggles. */
export function usePreferences(profileId: string) {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const refresh = useCallback(() => fetch(`/api/preferences/${encodeURIComponent(profileId)}`)
    .then(response => response.ok ? response.json() as Promise<{ favorites: string[]; hidden: string[] }> : null)
    .then(data => { if (data) { setFavorites(new Set(data.favorites)); setHidden(new Set(data.hidden)); } })
    .catch(() => {}), [profileId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const set = useCallback(async (mediaId: string, change: { favorite?: boolean; hidden?: boolean }) => {
    if (change.favorite !== undefined) setFavorites(current => { const next = new Set(current); if (change.favorite) next.add(mediaId); else next.delete(mediaId); return next; });
    if (change.hidden !== undefined) setHidden(current => { const next = new Set(current); if (change.hidden) next.add(mediaId); else next.delete(mediaId); return next; });
    await fetch(`/api/preferences/${encodeURIComponent(profileId)}/${encodeURIComponent(mediaId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) }).catch(() => {});
  }, [profileId]);
  return { favorites, hidden, set, refresh };
}
