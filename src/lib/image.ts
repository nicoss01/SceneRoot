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
