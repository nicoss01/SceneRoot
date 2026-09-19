import { useEffect, useState } from 'react';
import { resolveMedia } from '../data/catalog';
import { libraryGroupToMedia, type LibraryGroup } from '../data/library';
import type { MediaItem } from '../types';

/**
 * Resolves the MediaItem for a route id. resolveMedia only knows items cached in
 * sessionStorage during in-app navigation, so a direct load or page refresh of
 * /player/:id or /title/:id would otherwise fall back to demo content. When the
 * cache misses, we fetch the library group by id so real local media stays
 * playable across reloads.
 */
export function useResolvedMedia(id: string | undefined) {
  const initial = resolveMedia(id);
  const initialFound = Boolean(id) && initial.id === id;
  const [item, setItem] = useState<MediaItem>(initial);
  const [isLocal, setIsLocal] = useState(initialFound && Boolean(initial.local));

  useEffect(() => {
    const base = resolveMedia(id);
    const found = Boolean(id) && base.id === id;
    setItem(base);
    setIsLocal(found && Boolean(base.local));
    // Already resolved to a known local item — no need to hit the server.
    if (!id || (found && base.local)) return;
    let active = true;
    fetch(`/api/library/group/${encodeURIComponent(id)}`)
      .then(response => response.ok ? response.json() as Promise<LibraryGroup> : null)
      .then(group => {
        if (!active || !group) return;
        setItem(libraryGroupToMedia(group, 0));
        setIsLocal(true);
      })
      .catch(() => { /* offline / not a local media — keep the fallback item */ });
    return () => { active = false; };
  }, [id]);

  return { item, isLocal };
}
