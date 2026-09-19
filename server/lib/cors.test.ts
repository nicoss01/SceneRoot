import { describe, expect, it } from 'vitest';
import { isAllowedOrigin, parseAllowedOrigins } from './cors.js';

describe('parseAllowedOrigins', () => {
  it('splits, trims and drops empties', () => {
    expect(parseAllowedOrigins(' https://a.tv , https://b.tv ,')).toEqual(['https://a.tv', 'https://b.tv']);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});

describe('isAllowedOrigin', () => {
  it('allows requests without an Origin header (same-origin / kiosk)', () => {
    expect(isAllowedOrigin(undefined, [])).toBe(true);
  });
  it('always allows localhost origins', () => {
    expect(isAllowedOrigin('http://localhost:5173', [])).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:4174', [])).toBe(true);
  });
  it('rejects unknown origins that are not listed', () => {
    expect(isAllowedOrigin('https://evil.example', [])).toBe(false);
  });
  it('allows explicitly configured origins', () => {
    expect(isAllowedOrigin('https://tv.maison.lan', ['https://tv.maison.lan'])).toBe(true);
  });
  it('rejects malformed origins', () => {
    expect(isAllowedOrigin('not-a-url', [])).toBe(false);
  });
});
