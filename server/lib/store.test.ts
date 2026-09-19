import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, type StoredDb } from './store.js';

const dirs: string[] = [];
function tempDir() { const dir = mkdtempSync(join(tmpdir(), 'sceneroot-store-')); dirs.push(dir); return dir; }
afterEach(() => { while (dirs.length) { try { rmSync(dirs.pop()!, { recursive: true, force: true }); } catch { /* ignore */ } } });

const sample: StoredDb = {
  profiles: [{ id: 'p1', name: 'Nico' }],
  library: [{ id: 'm1', title: 'Astro' }],
  ratings: [{ profileId: 'p1', mediaId: 'm1', score: 8 }],
  playback: { 'p1:m1': { position: 42, duration: 100, updatedAt: '2024-01-01T00:00:00Z' } },
  guests: [{ id: 'g1', ageLimit: 13 }],
  settings: { minFreeGb: 80, setupComplete: true },
  favorites: [{ profileId: 'p1', mediaId: 'm1', at: '2024-01-01T00:00:00Z' }],
  hidden: [{ profileId: 'p1', mediaId: 'm2', at: '2024-01-02T00:00:00Z' }],
};

describe('createStore (sqlite)', () => {
  it('round-trips every collection', () => {
    const store = createStore(tempDir());
    expect(store.backend).toBe('sqlite');
    store.save(sample);
    expect(store.load()).toEqual(sample);
  });

  it('persists across store instances (real file)', () => {
    const dir = tempDir();
    createStore(dir).save(sample);
    const reopened = createStore(dir);
    expect(reopened.load()).toEqual(sample);
  });

  it('replaces collections rather than appending on save', () => {
    const dir = tempDir();
    const store = createStore(dir);
    store.save(sample);
    store.save({ ...sample, profiles: [{ id: 'p2', name: 'Cathy' }] });
    expect(store.load().profiles).toEqual([{ id: 'p2', name: 'Cathy' }]);
  });

  it('imports a legacy sceneroot.json on first run', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'sceneroot.json'), JSON.stringify(sample));
    const store = createStore(dir);
    expect(store.load()).toEqual(sample);
  });
});
