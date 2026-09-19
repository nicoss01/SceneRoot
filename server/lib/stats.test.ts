import { describe, expect, it } from 'vitest';
import { computeStats, type StatsDeps } from './stats.js';

const genres: Record<string, string[]> = { a: ['Science-fiction'], b: ['Science-fiction', 'Action'], c: ['Comédie'] };
const kinds: Record<string, 'film' | 'serie'> = { a: 'film', b: 'serie', c: 'film' };
const deps = (over: Partial<StatsDeps> = {}): StatsDeps => ({
  ratings: [],
  playback: [],
  genresOf: id => genres[id] ?? [],
  kindOf: id => kinds[id],
  ...over,
});

describe('computeStats', () => {
  it('counts watched from completed playback and ratings (deduped)', () => {
    const stats = computeStats(deps({
      playback: [{ mediaId: 'a', progress: 0.95, updatedAt: '2024-05-10T00:00:00Z' }, { mediaId: 'b', progress: 0.3, updatedAt: '2024-05-11T00:00:00Z' }],
      ratings: [{ mediaId: 'a', score: 8, tags: [], at: '2024-05-10T00:00:00Z' }, { mediaId: 'c', score: 6, tags: [], at: '2024-05-12T00:00:00Z' }],
    }), new Date('2024-06-15T00:00:00Z'));
    expect(stats.watched).toBe(2); // a (completed+rated), c (rated); b not completed
    expect(stats.rated).toBe(2);
    expect(stats.films).toBe(2); // a, c
    expect(stats.series).toBe(0);
  });

  it('averages ratings and tallies tags and genres', () => {
    const stats = computeStats(deps({
      playback: [{ mediaId: 'b', progress: 1, updatedAt: '2024-06-01T00:00:00Z' }],
      ratings: [{ mediaId: 'a', score: 10, tags: ['Émouvant'], at: '2024-06-01T00:00:00Z' }, { mediaId: 'c', score: 6, tags: ['Émouvant', 'Trop long'], at: '2024-06-02T00:00:00Z' }],
    }), new Date('2024-06-15T00:00:00Z'));
    expect(stats.averageRating).toBe(8);
    expect(stats.topGenres[0]).toEqual({ genre: 'Science-fiction', count: 2 }); // a + b
    expect(stats.topTags[0]).toEqual({ tag: 'Émouvant', count: 2 });
  });

  it('reports a 6-month activity window ending on the current month', () => {
    const stats = computeStats(deps({
      playback: [{ mediaId: 'a', progress: 1, updatedAt: '2024-06-05T00:00:00Z' }],
    }), new Date('2024-06-15T00:00:00Z'));
    expect(stats.activity).toHaveLength(6);
    expect(stats.activity.at(-1)).toEqual({ month: '2024-06', count: 1 });
    expect(stats.activity[0].month).toBe('2024-01');
  });

  it('builds a per-genre monthly timeline for the taste tree', () => {
    const stats = computeStats(deps({
      playback: [
        { mediaId: 'a', progress: 1, updatedAt: '2024-02-05T00:00:00Z' },
        { mediaId: 'b', progress: 1, updatedAt: '2024-06-05T00:00:00Z' },
      ],
    }), new Date('2024-06-15T00:00:00Z'));
    const sf = stats.genreTimeline.find(branch => branch.genre === 'Science-fiction');
    expect(sf?.total).toBe(2); // a (Feb) + b (Jun)
    expect(sf?.months).toEqual([0, 1, 0, 0, 1, 0]); // Jan..Jun window
  });

  it('returns null average with no ratings', () => {
    expect(computeStats(deps()).averageRating).toBeNull();
  });
});
