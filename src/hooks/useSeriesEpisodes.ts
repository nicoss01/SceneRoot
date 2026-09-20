import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { rememberCatalogItems } from '../data/catalog';
import type { MediaItem } from '../types';

export type EpisodeMeta = { id: string; season: number; episode: number; title: string; overview?: string; still?: string; versions: number; progress: number; position: number; playable?: boolean };
export type SeasonSummary = { season: number; episodeCount: number };
type Payload = { source?: string; available?: SeasonSummary[]; seasons: Array<{ season: number; episodes: EpisodeMeta[] }> };
type Cached = { at: number; source?: string; available: SeasonSummary[]; episodes: EpisodeMeta[] };

/** Les épisodes changent rarement : une demi-journée de cache évite de tout recharger. */
const TTL = 12 * 60 * 60 * 1000;
const cacheKey = (seriesId: string, season: number | 'all') => `sceneroot-episodes:${seriesId}:${season}`;
const seasonKey = (seriesId: string) => `sceneroot-season:${seriesId}`;

function readCache(key: string): Cached | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Cached;
    return Date.now() - value.at < TTL ? value : null;
  } catch { return null }
}
function writeCache(key: string, value: Cached) {
  try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* quota atteint : on s'en passe */ }
}
function rememberSeason(seriesId: string, season: number) {
  try { localStorage.setItem(seasonKey(seriesId), String(season)) } catch { /* stockage indisponible */ }
}
function lastSeason(seriesId: string): number | undefined {
  try { return Number(localStorage.getItem(seasonKey(seriesId))) || undefined } catch { return undefined }
}

/** Rend les épisodes jouables résolvables par la fiche et le lecteur. */
function remember(episodes: EpisodeMeta[], seriesTitle: string, art?: string) {
  const playable: MediaItem[] = episodes.filter(episode => episode.playable !== false).map(episode => ({
    id: episode.id,
    title: `${seriesTitle} · S${episode.season}E${String(episode.episode).padStart(2, '0')} — ${episode.title}`,
    kind: 'serie', year: new Date().getFullYear(), genres: ['Non classé'], duration: 'Épisode', rating: 0,
    quality: '1080p', description: episode.overview ?? '', palette: ['#0e7490', '#172554'], symbol: '▥',
    art: episode.still ?? art, source: 'local', local: true,
  }));
  if (playable.length) rememberCatalogItems(playable);
}

/**
 * Saisons et épisodes d'une série, une saison à la fois.
 *
 * Une série de la médiathèque renvoie tout d'un coup (lecture locale, peu
 * coûteuse) ; une série du catalogue ne détaille que la saison demandée. Dans
 * les deux cas le résultat est mis en cache pour la session et la saison
 * consultée est mémorisée, pour rouvrir la série là où on l'avait laissée.
 */
export function useSeriesEpisodes(id: string | undefined, profileId: string, enabled: boolean, seriesTitle: string, art?: string, local = false, year?: number) {
  const [available, setAvailable] = useState<SeasonSummary[]>([]);
  const [season, setSeason] = useState<number | undefined>(undefined);
  const [episodes, setEpisodes] = useState<EpisodeMeta[]>([]);
  const [source, setSource] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(enabled);
  // Épisodes de toutes les saisons d'une série locale : tout arrive ensemble.
  const localAll = useRef<Map<number, EpisodeMeta[]>>(new Map());

  const apply = useCallback((payload: Payload, wanted?: number) => {
    const seasons = payload.seasons ?? [];
    const list = payload.available?.length ? payload.available : seasons.map(entry => ({ season: entry.season, episodeCount: entry.episodes.length }));
    localAll.current = new Map(seasons.map(entry => [entry.season, entry.episodes]));
    const chosen = list.some(entry => entry.season === wanted) ? wanted! : (seasons[0]?.season ?? list[0]?.season);
    const shown = seasons.find(entry => entry.season === chosen)?.episodes ?? [];
    setAvailable(list); setSource(payload.source); setSeason(chosen); setEpisodes(shown);
    remember(shown, seriesTitle, art);
    return { list, chosen, shown };
  }, [seriesTitle, art]);

  useEffect(() => {
    if (!enabled || !id) { setAvailable([]); setEpisodes([]); setSeason(undefined); setLoading(false); return; }
    let active = true;
    const wanted = lastSeason(id);
    const cached = readCache(cacheKey(id, local ? 'all' : (wanted ?? 1)));
    if (cached) {
      // Affichage immédiat depuis le cache ; la vérification se fait derrière.
      setAvailable(cached.available); setSource(cached.source); setEpisodes(cached.episodes);
      setSeason(wanted ?? cached.available[0]?.season); setLoading(false);
      remember(cached.episodes, seriesTitle, art);
    } else { setLoading(true); }

    const context = new URLSearchParams({ title: seriesTitle });
    if (year) context.set('year', String(year));
    if (wanted && !local) context.set('season', String(wanted));
    const endpoint = local
      ? `/api/library/group/${encodeURIComponent(id)}/episodes?profileId=${encodeURIComponent(profileId)}`
      : `/api/catalog/${encodeURIComponent(id)}/seasons?${context}`;
    fetch(endpoint)
      .then(response => response.ok ? response.json() as Promise<Payload> : null)
      .then(payload => {
        if (!active || !payload) { if (active && !cached) setLoading(false); return; }
        const { chosen, shown } = apply(payload, wanted);
        if (chosen !== undefined) writeCache(cacheKey(id, local ? 'all' : chosen), { at: Date.now(), source: payload.source, available: payload.available ?? [], episodes: shown });
        setLoading(false);
      })
      .catch(() => { if (active && !cached) { setEpisodes([]); setLoading(false); } });
    return () => { active = false };
  }, [id, profileId, enabled, seriesTitle, art, local, year, apply]);

  const selectSeason = useCallback((next: number) => {
    if (!id || next === season) return;
    rememberSeason(id, next);
    setSeason(next);
    // Série locale : tout est déjà en mémoire, aucun aller-retour réseau.
    const known = localAll.current.get(next);
    if (known) { setEpisodes(known); remember(known, seriesTitle, art); return; }
    const cached = readCache(cacheKey(id, next));
    if (cached) { setEpisodes(cached.episodes); remember(cached.episodes, seriesTitle, art); return; }
    setLoading(true);
    const context = new URLSearchParams({ title: seriesTitle, season: String(next) });
    if (year) context.set('year', String(year));
    fetch(`/api/catalog/${encodeURIComponent(id)}/seasons?${context}`)
      .then(response => response.ok ? response.json() as Promise<Payload> : null)
      .then(payload => {
        if (!payload) { setEpisodes([]); setLoading(false); return; }
        const { shown } = apply(payload, next);
        writeCache(cacheKey(id, next), { at: Date.now(), source: payload.source, available: payload.available ?? [], episodes: shown });
        setLoading(false);
      })
      .catch(() => { setEpisodes([]); setLoading(false) });
  }, [id, season, seriesTitle, art, year, apply]);

  const seasons = useMemo(() => (season === undefined ? [] : [{ season, episodes }]), [season, episodes]);
  return { seasons, available, season, selectSeason, episodes, source, loading };
}
