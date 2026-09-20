export type Direction = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
export type Box = { left: number; top: number; width: number; height: number };

const EDGE = 4; // tolérance : deux éléments alignés à quelques pixels près le sont

/**
 * Choisit l'élément suivant dans une direction, à la façon d'une télécommande.
 *
 * L'ancienne version pondérait l'écart latéral puis prenait le meilleur score :
 * en appuyant à droite sur une grille, elle sautait volontiers à la ligne du
 * dessous plutôt qu'à la case voisine. On privilégie donc les éléments dont la
 * projection sur l'axe transversal chevauche celle de l'élément courant — ceux
 * qui « se suivent » visuellement — et on ne se rabat sur les autres qu'à
 * défaut, en pénalisant alors l'écart latéral.
 */
export function nextInDirection<T>(current: Box, candidates: Array<{ item: T; box: Box }>, direction: Direction): T | undefined {
  const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight';
  const forward = direction === 'ArrowRight' || direction === 'ArrowDown';
  const centre = (box: Box) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
  const here = centre(current);

  let aligned: { item: T; score: number } | undefined;
  let fallback: { item: T; score: number } | undefined;
  for (const candidate of candidates) {
    const there = centre(candidate.box);
    const primary = horizontal ? there.x - here.x : there.y - here.y;
    // Le décalage doit être franc : un élément superposé n'est pas « suivant ».
    if (forward ? primary <= EDGE : primary >= -EDGE) continue;
    const secondary = Math.abs(horizontal ? there.y - here.y : there.x - here.x);
    const overlap = horizontal
      ? candidate.box.top < current.top + current.height - EDGE && current.top < candidate.box.top + candidate.box.height - EDGE
      : candidate.box.left < current.left + current.width - EDGE && current.left < candidate.box.left + candidate.box.width - EDGE;
    const distance = Math.abs(primary);
    if (overlap) {
      if (!aligned || distance < aligned.score) aligned = { item: candidate.item, score: distance };
    } else {
      const score = distance + secondary * 3;
      if (!fallback || score < fallback.score) fallback = { item: candidate.item, score };
    }
  }
  return (aligned ?? fallback)?.item;
}
