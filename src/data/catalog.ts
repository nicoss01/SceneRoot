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
  try {
    const remembered = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}') as Record<string, MediaItem>;
    if (id && remembered[id]) return remembered[id];
  } catch {
    // Fall through to a neutral placeholder while the API resolves the route.
  }
  return { id:id??'unknown', title:'Média indisponible', kind:'film', year:0, genres:[], duration:'—', rating:0, quality:'1080p', description:'Ce média n’est pas disponible dans le catalogue actuel.', palette:['#0e2236','#07111d'], symbol:'?', source:'local' };
}
