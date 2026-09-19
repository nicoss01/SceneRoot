import { describe, expect, it } from 'vitest';
import { recommendGroup, type RecoDeps } from './recommend.js';

const genresById: Record<string, string[]> = {
  'sf-loved': ['Science-fiction'],
  'a': ['Science-fiction'],
  'b': ['Horreur'],
  'kids': ['Famille'],
};
const deps = (over: Partial<RecoDeps> = {}): RecoDeps => ({
  ratings: [],
  playback: [],
  genresOf: id => genresById[id] ?? [],
  ageLimits: {},
  ...over,
});

describe('recommendGroup', () => {
  it('returns a neutral score without any history', () => {
    const [a] = recommendGroup(['nico'], [{ id: 'a', genres: ['Science-fiction'] }], deps());
    expect(a.score).toBe(65);
  });

  it('predicts high affinity for a genre the profile rated highly', () => {
    const result = recommendGroup(['nico'], [
      { id: 'a', genres: ['Science-fiction'] },
      { id: 'b', genres: ['Horreur'] },
    ], deps({ ratings: [{ profileId: 'nico', mediaId: 'sf-loved', score: 10 }] }));
    const a = result.find(r => r.id === 'a')!;
    const b = result.find(r => r.id === 'b')!;
    expect(a.score).toBe(100);
    expect(b.score).toBe(65);
    expect(result[0].id).toBe('a');
  });

  it('applies a disagreement penalty across profiles', () => {
    const result = recommendGroup(['fan', 'hater'], [{ id: 'a', genres: ['Science-fiction'] }], deps({
      ratings: [
        { profileId: 'fan', mediaId: 'sf-loved', score: 10 },
        { profileId: 'hater', mediaId: 'sf-loved', score: 1 },
      ],
    }));
    expect(result[0].disagreement).toBeGreaterThan(0);
    expect(result[0].score).toBeLessThan(result[0].average);
  });

  it('ranks an unseen title above an equivalent already-seen one', () => {
    const result = recommendGroup(['nico'], [
      { id: 'a', genres: ['Science-fiction'] },
      { id: 'a2', genres: ['Science-fiction'] },
    ], deps({ playback: [{ profileId: 'nico', mediaId: 'a', progress: 0.95 }] }), true);
    const seen = result.find(r => r.id === 'a')!;
    const unseen = result.find(r => r.id === 'a2')!;
    expect(seen.seenBy).toContain('nico');
    expect(unseen.seenBy).toEqual([]);
    expect(seen.score).toBeLessThan(unseen.score);
    expect(result[0].id).toBe('a2');
  });

  it('keeps predicted affinity within 0..100', () => {
    const result = recommendGroup(['nico'], [{ id: 'a2', genres: ['Science-fiction'] }], deps({
      ratings: [{ profileId: 'nico', mediaId: 'sf-loved', score: 10 }],
      playback: [{ profileId: 'nico', mediaId: 'sf-loved', progress: 0.99 }],
    }));
    expect(result[0].average).toBeLessThanOrEqual(100);
  });

  it('excludes candidates above a profile age limit', () => {
    const result = recommendGroup(['kid'], [
      { id: 'kids', genres: ['Famille'], ageRating: 6 },
      { id: 'adult', genres: ['Horreur'], ageRating: 16 },
    ], deps({ ageLimits: { kid: 10 } }));
    expect(result.map(r => r.id)).toEqual(['kids']);
  });
});
