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
  localPath?: string;
}
