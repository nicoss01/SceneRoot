import { describe, expect, it } from 'vitest';
import { bearerToken, isAdminAuthorized, isLoopback, requiresAdmin } from './auth.js';

describe('isLoopback', () => {
  it('recognises loopback addresses', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
  });
  it('rejects LAN and undefined addresses', () => {
    expect(isLoopback('192.168.1.20')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });
});

describe('bearerToken', () => {
  it('extracts a bearer token', () => {
    expect(bearerToken('Bearer abc123')).toBe('abc123');
    expect(bearerToken('bearer  xyz')).toBe('xyz');
  });
  it('returns undefined without a bearer scheme', () => {
    expect(bearerToken(undefined)).toBeUndefined();
    expect(bearerToken('Basic abc')).toBeUndefined();
  });
});

describe('isAdminAuthorized', () => {
  it('always allows the local device', () => {
    expect(isAdminAuthorized('127.0.0.1', undefined, undefined)).toBe(true);
    expect(isAdminAuthorized('::1', undefined, 'secret')).toBe(true);
  });
  it('denies remote clients when no token is configured', () => {
    expect(isAdminAuthorized('192.168.1.20', 'anything', undefined)).toBe(false);
  });
  it('allows remote clients with the correct token', () => {
    expect(isAdminAuthorized('192.168.1.20', 'secret', 'secret')).toBe(true);
  });
  it('denies remote clients with a wrong or missing token', () => {
    expect(isAdminAuthorized('192.168.1.20', 'nope', 'secret')).toBe(false);
    expect(isAdminAuthorized('192.168.1.20', undefined, 'secret')).toBe(false);
  });
});

describe('requiresAdmin', () => {
  it('protects system POST routes', () => {
    expect(requiresAdmin('POST', '/api/library/scan')).toBe(true);
    expect(requiresAdmin('POST', '/api/downloads')).toBe(true);
    expect(requiresAdmin('POST', '/api/downloads/7/control')).toBe(true);
    expect(requiresAdmin('POST', '/api/cec/standby')).toBe(true);
    expect(requiresAdmin('POST', '/api/player/abc/play')).toBe(true);
    expect(requiresAdmin('POST', '/api/player/control')).toBe(true);
  });
  it('leaves read and compute routes open', () => {
    expect(requiresAdmin('GET', '/api/library')).toBe(false);
    expect(requiresAdmin('POST', '/api/downloads/rank')).toBe(false);
    expect(requiresAdmin('POST', '/api/ratings')).toBe(false);
    expect(requiresAdmin('GET', '/api/downloads')).toBe(false);
  });
});
