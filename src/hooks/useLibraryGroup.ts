import { useEffect, useMemo, useState } from 'react';
import { rememberCatalogItems } from '../data/catalog';
import type { LibraryMetadata } from '../data/library';
import type { MediaItem, MediaKind } from '../types';

export type GroupVersion = { id: string; title: string; season?: number; episode?: number; size: number; technical?: Record<string, unknown>; position: number; progress: number };
export type GroupDetail = { id: string; title: string; year?: number; kind: MediaKind; metadata?: LibraryMetadata; totalSize: number; episodeCount: number; versions: GroupVersion[]; nextEpisodeId?: string };
export type Season = { season: number; episodes: Array<{ id: string; episode: number; title: string; progress: number; position: number }> };

export function useLibraryGroup(id: string | undefined, profileId: string, enabled: boolean) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(enabled);
  useEffect(() => {
    if (!enabled || !id) { setDetail(null); setLoading(false); return; }
    let active = true; setLoading(true);
    fetch(`/api/library/group/${encodeURIComponent(id)}?profileId=${encodeURIComponent(profileId)}`)
      .then(response => response.ok ? response.json() as Promise<GroupDetail> : null)
      .then(data => {
        if (!active) return;
        setDetail(data); setLoading(false);
        if (data) {
          const episodes: MediaItem[] = data.versions.filter(version => version.episode).map(version => ({
            id: version.id,
            title: `${data.title} · S${version.season ?? 1}E${String(version.episode).padStart(2, '0')}`,
            kind: 'serie', year: data.year ?? new Date().getFullYear(),
            genres: data.metadata?.genres?.length ? data.metadata.genres : ['Non classé'],
            duration: 'Épisode', rating: 0, quality: '1080p',
            description: data.metadata?.overview ?? '', palette: ['#0e7490', '#172554'], symbol: '▥',
            art: data.metadata?.backdrop ?? data.metadata?.poster, source: 'local', local: true,
          }));
          if (episodes.length) rememberCatalogItems(episodes);
        }
      })
      .catch(() => { if (active) { setDetail(null); setLoading(false); } });
    return () => { active = false; };
  }, [id, profileId, enabled]);

  const seasons = useMemo<Season[]>(() => {
    if (!detail) return [];
    const map = new Map<number, Season>();
    for (const version of detail.versions) {
      if (!version.episode) continue;
      const key = version.season ?? 1;
      const season = map.get(key) ?? { season: key, episodes: [] };
      if (!season.episodes.some(episode => episode.episode === version.episode))
        season.episodes.push({ id: version.id, episode: version.episode, title: version.title, progress: version.progress, position: version.position });
      map.set(key, season);
    }
    return [...map.values()].map(season => ({ ...season, episodes: season.episodes.sort((a, b) => a.episode - b.episode) })).sort((a, b) => a.season - b.season);
  }, [detail]);

  return { detail, seasons, loading };
}
