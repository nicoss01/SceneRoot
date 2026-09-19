import { useEffect, useState } from 'react';
import { rememberCatalogItems } from '../data/catalog';
import type { MediaItem } from '../types';

export type EpisodeMeta = { id: string; season: number; episode: number; title: string; overview?: string; still?: string; versions: number; progress: number; position: number; playable?: boolean };
export type SeasonMeta = { season: number; episodes: EpisodeMeta[] };
export type SeriesEpisodes = { seasons: SeasonMeta[]; source?: string };

export function useSeriesEpisodes(id: string | undefined, profileId: string, enabled: boolean, seriesTitle: string, art?: string) {
  const [data, setData] = useState<SeriesEpisodes>({ seasons: [] });
  const [loading, setLoading] = useState(enabled);
  useEffect(() => {
    if (!enabled || !id) { setData({ seasons: [] }); setLoading(false); return; }
    let active = true; setLoading(true);
    const endpoint = id.startsWith('imdb-serie-') ? `/api/catalog/${encodeURIComponent(id)}/seasons` : `/api/library/group/${encodeURIComponent(id)}/episodes?profileId=${encodeURIComponent(profileId)}`;
    fetch(endpoint)
      .then(response => response.ok ? response.json() as Promise<SeriesEpisodes> : null)
      .then(result => {
        if (!active) return;
        const value = result ?? { seasons: [] };
        setData(value); setLoading(false);
        const playable: MediaItem[] = value.seasons.flatMap(season => season.episodes.filter(episode => episode.playable !== false).map(episode => ({
          id: episode.id,
          title: `${seriesTitle} · S${episode.season}E${String(episode.episode).padStart(2, '0')} — ${episode.title}`,
          kind: 'serie', year: new Date().getFullYear(), genres: ['Non classé'], duration: 'Épisode', rating: 0,
          quality: '1080p', description: episode.overview ?? '', palette: ['#0e7490', '#172554'], symbol: '▥',
          art: episode.still ?? art, source: 'local', local: true,
        })));
        if (playable.length) rememberCatalogItems(playable);
      })
      .catch(() => { if (active) { setData({ seasons: [] }); setLoading(false); } });
    return () => { active = false; };
  }, [id, profileId, enabled, seriesTitle, art]);
  return { ...data, loading };
}
