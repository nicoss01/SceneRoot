/**
 * Fait passer une affiche distante par le cache du serveur : l'image n'est
 * téléchargée qu'une fois, puis servie depuis le Raspberry Pi — affichage
 * immédiat, et la médiathèque reste illustrée si le réseau tombe.
 *
 * Les chemins locaux (avatars, visuels embarqués) sont rendus tels quels.
 */
export function posterUrl(src?: string): string | undefined {
  if (!src) return undefined;
  if (!/^https?:\/\//i.test(src)) return src;
  return `/api/image?url=${encodeURIComponent(src)}`;
}

/** Visuel de remplacement quand aucune affiche n'est disponible. */
export function placeholderFor(kind: 'film' | 'serie'): string {
  return kind === 'serie' ? '/assets/placeholder_tvshow.jpg' : '/assets/placeholder_movie.jpg';
}

/** Affiche d'un média, ou son visuel de remplacement selon le type. */
export function artworkUrl(art: string | undefined, kind: 'film' | 'serie'): string {
  return posterUrl(art) ?? placeholderFor(kind);
}
