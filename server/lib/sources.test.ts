import { describe, expect, it } from 'vitest';
import { maskSource, sanitizeSource } from './sources.js';

describe('sanitizeSource', () => {
  it('accepts a valid http(s) source and trims fields', () => {
    const s = sanitizeSource({ name: '  Legal  ', url: ' https://ex.org/api ', apiKey: ' k ', categories: ' 2000 ' }, 'id1');
    expect(s).toEqual({ id: 'id1', name: 'Legal', url: 'https://ex.org/api', apiKey: 'k', categories: '2000' });
  });
  it('rejects a missing name or non-http url', () => {
    expect(sanitizeSource({ name: '', url: 'https://ex.org' }, 'i')).toBeNull();
    expect(sanitizeSource({ name: 'X', url: 'ftp://ex.org' }, 'i')).toBeNull();
    expect(sanitizeSource({ name: 'X', url: 'not-a-url' }, 'i')).toBeNull();
  });
  it('drops empty categories to undefined', () => {
    expect(sanitizeSource({ name: 'X', url: 'https://e.org', categories: '   ' }, 'i')?.categories).toBeUndefined();
  });
});

describe('maskSource', () => {
  it('never exposes the api key', () => {
    const masked = maskSource({ id: 'i', name: 'N', url: 'https://e.org', apiKey: 'secret', categories: '2000' });
    expect(masked).toEqual({ id: 'i', name: 'N', url: 'https://e.org', categories: '2000', hasKey: true });
    expect('apiKey' in masked).toBe(false);
  });
  it('reports hasKey false when no key', () => {
    expect(maskSource({ id: 'i', name: 'N', url: 'https://e.org', apiKey: '' }).hasKey).toBe(false);
  });
});
