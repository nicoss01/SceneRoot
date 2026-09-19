import { describe, expect, it } from 'vitest';
import { parseRelease } from './release';

describe('parseRelease', () => {
  it('detects 4K/2160p and HDR', () => {
    const r = parseRelease('Film.2024.2160p.UHD.BluRay.HDR.x265-GROUP');
    expect(r.quality).toBe('2160p');
    expect(r.hdr).toBe(true);
    expect(r.codec).toBe('HEVC');
  });

  it('detects 1080p H.264 and MULTI/TrueFrench languages', () => {
    const r = parseRelease('Serie.S01E02.MULTI.1080p.WEB.x264.TRUEFRENCH-TEAM');
    expect(r.quality).toBe('1080p');
    expect(r.codec).toBe('H.264');
    expect(r.languages).toContain('multi');
    expect(r.languages).toContain('truefrench');
  });

  it('falls back to inconnu when no language token is present', () => {
    const r = parseRelease('Movie.2020.720p.WEBRip');
    expect(r.quality).toBe('720p');
    expect(r.languages).toEqual(['inconnu']);
  });

  it('marks SD when no resolution token matches', () => {
    expect(parseRelease('Old.Movie.DVDRip').quality).toBe('SD');
  });
});
