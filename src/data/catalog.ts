import { media as demoMedia } from './demo';
import type { MediaItem } from '../types';

const storageKey = 'sceneroot-catalog-items';

export function rememberCatalogItems(items: MediaItem[]) {
  try {
    const current = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}') as Record<string, MediaItem>;
    for (const item of items) current[item.id] = item;
    sessionStorage.setItem(storageKey, JSON.stringify(current));
  } catch {
    // Private browsing/storage restrictions must never prevent navigation.
  }
}

export function resolveMedia(id?: string): MediaItem {
  const local = demoMedia.find(item => item.id === id);
  if (local) return local;
  try {
    const remembered = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}') as Record<string, MediaItem>;
    if (id && remembered[id]) return remembered[id];
  } catch {
    // Fall through to a stable local item.
  }
  return demoMedia[0];
}
