import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

/** Reads and parses a JSON file, returning `fallback` on absence or corruption. */
export function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return fallback; }
}

/**
 * Writes JSON atomically: serialises to a temporary sibling file, then renames
 * over the target. A crash mid-write can never leave a half-written store —
 * the previous version stays intact until the rename succeeds.
 */
export function atomicWriteJson(path: string, data: unknown): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, path);
  } catch (error) {
    try { if (existsSync(tmp)) rmSync(tmp); } catch { /* best effort cleanup */ }
    throw error;
  }
}
