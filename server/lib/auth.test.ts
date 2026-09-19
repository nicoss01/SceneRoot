import { describe, expect, it } from 'vitest';
import { bearerToken, isAdminAuthorized, isLoopback, isPrivateAddress, requiresAdmin } from './auth.js';

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
  it('trusts the private LAN by default', () => {
    expect(isAdminAuthorized('192.168.1.20', undefined, undefined)).toBe(true);
    expect(isAdminAuthorized('10.0.0.5', undefined, undefined)).toBe(true);
  });
  it('denies WAN clients when no token is configured', () => {
    expect(isAdminAuthorized('8.8.8.8', 'anything', undefined)).toBe(false);
  });
  it('allows WAN clients with the correct token', () => {
    expect(isAdminAuthorized('8.8.8.8', 'secret', 'secret')).toBe(true);
  });
  it('denies WAN clients with a wrong or missing token', () => {
    expect(isAdminAuthorized('8.8.8.8', 'nope', 'secret')).toBe(false);
    expect(isAdminAuthorized('8.8.8.8', undefined, 'secret')).toBe(false);
  });
  it('can require a token even on the LAN (strict mode)', () => {
    expect(isAdminAuthorized('192.168.1.20', undefined, 'secret', false)).toBe(false);
    expect(isAdminAuthorized('192.168.1.20', 'secret', 'secret', false)).toBe(true);
  });
});

describe('isPrivateAddress', () => {
  it('recognises RFC1918 and loopback', () => {
    for (const ip of ['127.0.0.1', '192.168.0.1', '10.1.2.3', '172.16.0.1', '::ffff:192.168.1.5', 'fd00::1']) expect(isPrivateAddress(ip)).toBe(true);
  });
  it('rejects public addresses', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress(undefined)).toBe(false);
  });
});

describe('requiresAdmin', () => {
  it('protects system POST routes', () => {
    expect(requiresAdmin('POST', '/api/library/scan')).toBe(true);
    expect(requiresAdmin('POST', '/api/downloads')).toBe(true);
    expect(requiresAdmin('POST', '/api/downloads/7/control')).toBe(true);
    expect(requiresAdmin('POST', '/api/downloads/7/play')).toBe(true);
    expect(requiresAdmin('POST', '/api/cec/standby')).toBe(true);
    expect(requiresAdmin('POST', '/api/player/abc/play')).toBe(true);
    expect(requiresAdmin('POST', '/api/player/control')).toBe(true);
    expect(requiresAdmin('DELETE', '/api/cache')).toBe(true);
    expect(requiresAdmin('POST', '/api/sources')).toBe(true);
    expect(requiresAdmin('DELETE', '/api/sources/abc')).toBe(true);
    expect(requiresAdmin('PUT', '/api/settings')).toBe(true);
  });
  it('leaves read, compute and family routes open', () => {
    expect(requiresAdmin('GET', '/api/library')).toBe(false);
    expect(requiresAdmin('POST', '/api/downloads/rank')).toBe(false);
    expect(requiresAdmin('POST', '/api/ratings')).toBe(false);
    expect(requiresAdmin('GET', '/api/downloads')).toBe(false);
    expect(requiresAdmin('GET', '/api/cache')).toBe(false);
    expect(requiresAdmin('GET', '/api/sources/search')).toBe(false);
    expect(requiresAdmin('DELETE', '/api/profiles/1')).toBe(false);
    expect(requiresAdmin('PUT', '/api/profiles/1')).toBe(false);
  });
});
