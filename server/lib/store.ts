import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { atomicWriteJson, readJson } from './jsonStore.js';

export interface StoredDb {
  profiles: Array<{ id: string } & Record<string, unknown>>;
  library: Array<{ id: string } & Record<string, unknown>>;
  ratings: Array<{ profileId: string; mediaId: string } & Record<string, unknown>>;
  playback: Record<string, unknown>;
  guests: Array<{ id: string } & Record<string, unknown>>;
  settings: Record<string, unknown>;
}
export interface Store { backend: 'sqlite' | 'json'; load(): StoredDb; save(db: StoredDb): void; }

const EMPTY: StoredDb = { profiles: [], library: [], ratings: [], playback: {}, guests: [], settings: {} };

function jsonStore(jsonPath: string): Store {
  return {
    backend: 'json',
    load() { return { ...EMPTY, ...readJson<Partial<StoredDb>>(jsonPath, EMPTY) }; },
    save(db) { atomicWriteJson(jsonPath, db); },
  };
}

/**
 * Persistence backed by SQLite (node:sqlite, built into Node ≥ 22.5) with a
 * transactional whole-collection write, falling back to the atomic JSON store
 * when SQLite is unavailable. The public shape stays identical, so callers keep
 * using load()/save() exactly as before. A legacy sceneroot.json is imported on
 * first run.
 */
export function createStore(dataDir: string): Store {
  const jsonPath = join(dataDir, 'sceneroot.json');
  const sqlitePath = join(dataDir, 'sceneroot.db');
  let DatabaseSync: (new (path: string) => SqliteDb) | undefined;
  try { ({ DatabaseSync } = createRequire(import.meta.url)('node:sqlite')); } catch { /* Node < 22.5 : repli JSON */ }
  if (!DatabaseSync) return jsonStore(jsonPath);

  const db = new DatabaseSync(sqlitePath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS library(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ratings(profileId TEXT NOT NULL, mediaId TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(profileId, mediaId));
    CREATE TABLE IF NOT EXISTS playback(key TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS guests(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `);

  const jsonRows = (sql: string) => (db.prepare(sql).all() as Array<{ data: string }>).map(row => JSON.parse(row.data));

  const store: Store = {
    backend: 'sqlite',
    load() {
      const playback: Record<string, unknown> = {};
      for (const row of db.prepare('SELECT key, data FROM playback').all() as Array<{ key: string; data: string }>) playback[row.key] = JSON.parse(row.data);
      const settingsRow = db.prepare('SELECT v FROM settings WHERE k = ?').get('app') as { v: string } | undefined;
      return {
        profiles: jsonRows('SELECT data FROM profiles'),
        library: jsonRows('SELECT data FROM library'),
        ratings: jsonRows('SELECT data FROM ratings'),
        guests: jsonRows('SELECT data FROM guests'),
        playback,
        settings: settingsRow ? JSON.parse(settingsRow.v) : {},
      };
    },
    save(data) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec('DELETE FROM profiles; DELETE FROM library; DELETE FROM ratings; DELETE FROM playback; DELETE FROM guests; DELETE FROM settings');
        const insProfile = db.prepare('INSERT OR REPLACE INTO profiles(id, data) VALUES(?, ?)');
        for (const profile of data.profiles ?? []) insProfile.run(String(profile.id), JSON.stringify(profile));
        const insLibrary = db.prepare('INSERT OR REPLACE INTO library(id, data) VALUES(?, ?)');
        for (const item of data.library ?? []) insLibrary.run(String(item.id), JSON.stringify(item));
        const insRating = db.prepare('INSERT OR REPLACE INTO ratings(profileId, mediaId, data) VALUES(?, ?, ?)');
        for (const rating of data.ratings ?? []) insRating.run(String(rating.profileId), String(rating.mediaId), JSON.stringify(rating));
        const insPlayback = db.prepare('INSERT OR REPLACE INTO playback(key, data) VALUES(?, ?)');
        for (const [key, value] of Object.entries(data.playback ?? {})) insPlayback.run(key, JSON.stringify(value));
        const insGuest = db.prepare('INSERT OR REPLACE INTO guests(id, data) VALUES(?, ?)');
        for (const guest of data.guests ?? []) insGuest.run(String(guest.id), JSON.stringify(guest));
        db.prepare('INSERT OR REPLACE INTO settings(k, v) VALUES(?, ?)').run('app', JSON.stringify(data.settings ?? {}));
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };

  const rows = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const empty = rows('profiles') + rows('library') + rows('ratings') + rows('playback') + rows('settings') === 0;
  if (empty && existsSync(jsonPath)) {
    try { store.save({ ...EMPTY, ...JSON.parse(readFileSync(jsonPath, 'utf8')) }); } catch { /* JSON illisible : démarrage à vide */ }
  }
  return store;
}

interface SqliteStatement { run(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown; }
interface SqliteDb { exec(sql: string): void; prepare(sql: string): SqliteStatement; }
