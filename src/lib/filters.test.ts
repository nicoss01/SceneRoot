import { describe, expect, it } from 'vitest';
import { matchesDuration, matchesSearchFilters, runtimeMinutes } from './filters';
import type { MediaItem } from '../types';

const film = (over: Partial<MediaItem>): MediaItem => ({
  id: 'x', title: 't', kind: 'film', year: 2024, genres: [], duration: '1h45', rating: 7,
  quality: '1080p', description: '', palette: ['#000', '#111'], symbol: '', ...over,
});

describe('runtimeMinutes', () => {
  it('parses hour/minute labels', () => {
    expect(runtimeMinutes('1h42')).toBe(102);
    expect(runtimeMinutes('2h04')).toBe(124);
  });
  it('returns null for unknown durations', () => {
    expect(runtimeMinutes('Durée inconnue')).toBeNull();
  });
});

describe('matchesDuration', () => {
  it('buckets films by runtime', () => {
    expect(matchesDuration(film({ duration: '1h20' }), 'short')).toBe(true);
    expect(matchesDuration(film({ duration: '1h45' }), 'medium')).toBe(true);
    expect(matchesDuration(film({ duration: '2h30' }), 'long')).toBe(true);
    expect(matchesDuration(film({ duration: '1h20' }), 'long')).toBe(false);
  });
  it('never filters out series or unknown durations', () => {
    expect(matchesDuration(film({ kind: 'serie', duration: '8 ép.' }), 'short')).toBe(true);
    expect(matchesDuration(film({ duration: 'Durée inconnue' }), 'long')).toBe(true);
  });
  it('passes everything for "any"', () => {
    expect(matchesDuration(film({ duration: '3h00' }), 'any')).toBe(true);
  });
});

describe('matchesSearchFilters', () => {
  it('applies rating and quality together', () => {
    const item = film({ rating: 6, quality: '1080p' });
    expect(matchesSearchFilters(item, { duration: 'any', minRating: 5, quality: '1080p' })).toBe(true);
    expect(matchesSearchFilters(item, { duration: 'any', minRating: 7, quality: '' })).toBe(false);
    expect(matchesSearchFilters(item, { duration: 'any', minRating: 0, quality: '4K' })).toBe(false);
  });
  it('treats zero filters as no-op', () => {
    expect(matchesSearchFilters(film({ rating: 0 }), { duration: 'any', minRating: 0, quality: '' })).toBe(true);
  });
});
