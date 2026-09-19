import { describe, expect, it } from 'vitest';
import { rankDownloads, type RankCandidate } from './rank.js';

const base = (over: Partial<RankCandidate>): RankCandidate => ({ id: 'x', title: 't', quality: '1080p', languages: ['french'], hdr: false, size: 1e9, seeders: 10, ...over });

describe('rankDownloads', () => {
  it('favours the preferred quality and language', () => {
    const good = base({ id: 'good', quality: '1080p', languages: ['multi'] });
    const bad = base({ id: 'bad', quality: '480p', languages: ['english'] });
    const [first] = rankDownloads([bad, good], { preferredQuality: '1080p', preferredLanguages: ['multi'] });
    expect(first.id).toBe('good');
    expect(first.compatibilityScore).toBeGreaterThan(0);
  });

  it('penalises files above the size cap', () => {
    const small = base({ id: 'small', size: 1e9 });
    const huge = base({ id: 'huge', size: 50e9 });
    const ranked = rankDownloads([huge, small], { maxBytes: 5e9 });
    expect(ranked[0].id).toBe('small');
    expect(ranked.find(r => r.id === 'huge')!.compatibilityScore).toBeLessThan(ranked.find(r => r.id === 'small')!.compatibilityScore);
  });

  it('rewards HEVC codec and HDR when preferred', () => {
    const hevc = base({ id: 'hevc', codec: 'HEVC', hdr: true });
    const avc = base({ id: 'avc', codec: 'H.264', hdr: false });
    const ranked = rankDownloads([avc, hevc], { preferHdr: true });
    expect(ranked[0].id).toBe('hevc');
  });

  it('sorts descending and preserves candidate fields', () => {
    const ranked = rankDownloads([base({ id: 'a', seeders: 1 }), base({ id: 'b', seeders: 100 })], {});
    expect(ranked.map(r => r.id)).toEqual(['b', 'a']);
    expect(ranked[0]).toHaveProperty('title');
  });
});
