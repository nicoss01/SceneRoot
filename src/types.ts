export type MediaKind = 'film' | 'serie';

export interface Profile {
  id: string;
  name: string;
  ageLimit: number;
  locked?: boolean;
  avatar: string;
  accent: string;
}

export interface MediaItem {
  id: string;
  title: string;
  kind: MediaKind;
  year: number;
  genres: string[];
  duration: string;
  rating: number;
  progress?: number;
  quality: '720p' | '1080p' | '4K';
  description: string;
  palette: [string, string];
  symbol: string;
  art?: string;
  localPath?: string;
  source?: 'local' | 'imdb' | 'tmdb' | 'tvmaze' | 'wikipedia';
  sourceUrl?: string;
  informationSource?: string;
  versionCount?: number;
  episodeCount?: number;
  sizeBytes?: number;
  matched?: boolean;
  local?: boolean;
  badge?: 'new' | 'episode';
  /** Épisode en cours, affiché sur la carte de reprise : « S02 · E05 ». */
  episodeLabel?: string;
}

export interface PlayerTrack {
  id: number;
  label: string;
  lang?: string;
  selected: boolean;
}

export interface PlayerStatus {
  engine: 'mpv';
  running: boolean;
  playing?: boolean;
  position?: number;
  duration?: number;
  title?: string;
  path?: string;
  audioTracks?: PlayerTrack[];
  subtitleTracks?: PlayerTrack[];
}
