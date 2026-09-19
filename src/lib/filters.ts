import type { MediaItem } from '../types';

export type DurationBucket = 'short' | 'medium' | 'long' | 'any';

/** Parses a film runtime label like "1h42" or "2h04" into minutes; null when unknown. */
export function runtimeMinutes(duration: string): number | null {
  const match = duration.match(/(?:(\d+)h)?(\d{1,2})/);
  if (!match) return null;
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

export function matchesDuration(item: MediaItem, duration: DurationBucket): boolean {
  if (duration === 'any' || item.kind === 'serie') return true;
  const minutes = runtimeMinutes(item.duration);
  if (minutes === null) return true; // unknown duration never gets filtered out
  if (duration === 'short') return minutes < 90;
  if (duration === 'medium') return minutes >= 90 && minutes <= 120;
  return minutes > 120; // long
}

export type SearchFilters = { duration: DurationBucket; minRating: number; quality: '' | MediaItem['quality'] };

export function matchesSearchFilters(item: MediaItem, filters: SearchFilters): boolean {
  return matchesDuration(item, filters.duration)
    && item.rating >= filters.minRating
    && (!filters.quality || item.quality === filters.quality);
}
