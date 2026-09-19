import { describe, expect, it } from 'vitest';
import { libraryGroupToMedia, type LibraryGroup } from './library';

const group = (over: Partial<LibraryGroup> = {}): LibraryGroup => ({
  id: 'g1', title: 'Astro', kind: 'film', year: 2024, totalSize: 1000,
  episodeCount: 0, versions: [{ id: 'g1', technical: { height: 2160 } }], ...over,
});

describe('libraryGroupToMedia', () => {
  it('marks library items as local and matched with metadata', () => {
    const media = libraryGroupToMedia(group({ metadata: { provider: 'tmdb', providerId: 1, title: 'Astro', genres: ['Science-fiction'] } }), 0);
    expect(media.local).toBe(true);
    expect(media.matched).toBe(true);
    expect(media.genres).toEqual(['Science-fiction']);
  });

  it('infers 4K from the tallest version', () => {
    expect(libraryGroupToMedia(group(), 0).quality).toBe('4K');
    expect(libraryGroupToMedia(group({ versions: [{ id: 'g1', technical: { height: 1080 } }] }), 0).quality).toBe('1080p');
    expect(libraryGroupToMedia(group({ versions: [{ id: 'g1', technical: { height: 480 } }] }), 0).quality).toBe('720p');
  });

  it('labels a series episode count as duration', () => {
    const media = libraryGroupToMedia(group({ kind: 'serie', episodeCount: 8, versions: [{ id: 'g1' }] }), 0);
    expect(media.duration).toBe('8 ép.');
    expect(media.kind).toBe('serie');
  });

  it('carries an optional progress percentage', () => {
    expect(libraryGroupToMedia(group(), 0, 42).progress).toBe(42);
    expect(libraryGroupToMedia(group(), 0).progress).toBeUndefined();
  });
});
