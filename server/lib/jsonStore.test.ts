import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteJson, readJson } from './jsonStore.js';

const dirs: string[] = [];
function tempDir() { const dir = mkdtempSync(join(tmpdir(), 'sceneroot-store-')); dirs.push(dir); return dir; }
afterEach(() => { while (dirs.length) { try { rmSync(dirs.pop()!, { recursive: true, force: true }); } catch { /* ignore */ } } });

describe('readJson', () => {
  it('returns the fallback when the file is missing', () => {
    expect(readJson(join(tempDir(), 'nope.json'), { a: 1 })).toEqual({ a: 1 });
  });
  it('returns the fallback when the file is corrupt', () => {
    const path = join(tempDir(), 'bad.json'); writeFileSync(path, '{ not json');
    expect(readJson(path, { safe: true })).toEqual({ safe: true });
  });
  it('parses valid JSON', () => {
    const path = join(tempDir(), 'ok.json'); writeFileSync(path, JSON.stringify({ n: 42 }));
    expect(readJson(path, {})).toEqual({ n: 42 });
  });
});

describe('atomicWriteJson', () => {
  it('round-trips through readJson', () => {
    const path = join(tempDir(), 'db.json');
    atomicWriteJson(path, { hello: 'world', list: [1, 2, 3] });
    expect(readJson(path, {})).toEqual({ hello: 'world', list: [1, 2, 3] });
  });
  it('leaves no temporary files behind on success', () => {
    const dir = tempDir(); const path = join(dir, 'db.json');
    atomicWriteJson(path, { ok: true });
    expect(readdirSync(dir).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });
  it('preserves the previous file if new data cannot be serialised', () => {
    const path = join(tempDir(), 'db.json');
    atomicWriteJson(path, { version: 1 });
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(() => atomicWriteJson(path, circular)).toThrow();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ version: 1 });
  });
});
