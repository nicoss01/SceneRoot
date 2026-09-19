import { createRequire } from 'node:module';
import { join } from 'node:path';

export type CatalogKind = 'film' | 'serie' | 'episode';

export type CatalogTitleInput = {
  imdbId: string;
  kind: CatalogKind;
  primaryTitle: string;
  originalTitle?: string;
  startYear?: number;
  endYear?: number;
  runtimeMinutes?: number;
  genres: string[];
  adult: boolean;
};

export type CatalogEpisodeInput = { imdbId: string; parentImdbId: string; season?: number; episode?: number };
export type CatalogRatingInput = { imdbId: string; rating: number; votes: number };

export type LocalizedMetadata = {
  imdbId: string;
  titleFr?: string;
  overviewFr?: string;
  poster?: string;
  backdrop?: string;
  ageRating?: string;
  tmdbId?: number;
  tvmazeId?: number;
  wikidataId?: string;
  source: 'tmdb' | 'tvmaze' | 'wikidata' | 'wikipedia' | 'none';
  checkedAt?: string;
};

export type CatalogRow = CatalogTitleInput & {
  rating: number;
  votes: number;
  titleFr?: string;
  overviewFr?: string;
  poster?: string;
  backdrop?: string;
  ageRating?: string;
  tmdbId?: number;
  tvmazeId?: number;
  wikidataId?: string;
  metadataSource?: string;
  metadataCheckedAt?: string;
  wikidataCheckedAt?: string;
};

export type CatalogQuery = {
  kind?: Exclude<CatalogKind, 'episode'>;
  query?: string;
  genre?: string;
  page: number;
  limit: number;
  sort?: 'popular' | 'recent';
};

export type CatalogSyncState = {
  source: string;
  status: 'idle' | 'running' | 'complete' | 'error';
  phase: string;
  startedAt?: string;
  completedAt?: string;
  processed: number;
  total?: number;
  error?: string;
};

interface Statement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}
interface SqliteDb { exec(sql: string): void; prepare(sql: string): Statement; close?(): void }

function parseGenres(value: string): string[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}

function rowFromSql(raw: Record<string, unknown>): CatalogRow {
  return {
    imdbId: String(raw.imdb_id), kind: String(raw.kind) as CatalogKind,
    primaryTitle: String(raw.primary_title), originalTitle: raw.original_title ? String(raw.original_title) : undefined,
    startYear: raw.start_year == null ? undefined : Number(raw.start_year), endYear: raw.end_year == null ? undefined : Number(raw.end_year),
    runtimeMinutes: raw.runtime_minutes == null ? undefined : Number(raw.runtime_minutes), genres: parseGenres(String(raw.genres ?? '[]')),
    adult: Boolean(raw.is_adult), rating: Number(raw.rating ?? 0), votes: Number(raw.votes ?? 0),
    titleFr: raw.title_fr ? String(raw.title_fr) : undefined, overviewFr: raw.overview_fr ? String(raw.overview_fr) : undefined,
    poster: raw.poster ? String(raw.poster) : undefined, backdrop: raw.backdrop ? String(raw.backdrop) : undefined,
    ageRating: raw.age_rating ? String(raw.age_rating) : undefined, tmdbId: raw.tmdb_id == null ? undefined : Number(raw.tmdb_id),
    tvmazeId: raw.tvmaze_id == null ? undefined : Number(raw.tvmaze_id), wikidataId: raw.wikidata_id ? String(raw.wikidata_id) : undefined,
    metadataSource: raw.metadata_source ? String(raw.metadata_source) : undefined,
    metadataCheckedAt: raw.metadata_checked_at ? String(raw.metadata_checked_at) : undefined,
    wikidataCheckedAt: raw.wikidata_checked_at ? String(raw.wikidata_checked_at) : undefined,
  };
}

export class CatalogStore {
  readonly available: boolean;
  private db?: SqliteDb;

  constructor(dataDir: string) {
    let DatabaseSync: (new (path: string) => SqliteDb) | undefined;
    try { ({ DatabaseSync } = createRequire(import.meta.url)('node:sqlite')); } catch { /* Node ancien : catalogue distant conservé */ }
    this.available = Boolean(DatabaseSync);
    if (!DatabaseSync) return;
    this.db = new DatabaseSync(join(dataDir, 'sceneroot.db'));
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_titles(
        imdb_id TEXT PRIMARY KEY, kind TEXT NOT NULL, primary_title TEXT NOT NULL, original_title TEXT,
        start_year INTEGER, end_year INTEGER, runtime_minutes INTEGER, genres TEXT NOT NULL DEFAULT '[]',
        is_adult INTEGER NOT NULL DEFAULT 0, rating REAL NOT NULL DEFAULT 0, votes INTEGER NOT NULL DEFAULT 0,
        sync_token TEXT, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_catalog_kind_popular ON catalog_titles(kind, votes DESC, rating DESC);
      CREATE INDEX IF NOT EXISTS idx_catalog_kind_recent ON catalog_titles(kind, start_year DESC, votes DESC);
      CREATE INDEX IF NOT EXISTS idx_catalog_primary_title ON catalog_titles(primary_title COLLATE NOCASE);
      CREATE TABLE IF NOT EXISTS catalog_episodes(
        imdb_id TEXT PRIMARY KEY, parent_imdb_id TEXT NOT NULL, season INTEGER, episode INTEGER, sync_token TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_catalog_episode_parent ON catalog_episodes(parent_imdb_id, season, episode);
      CREATE TABLE IF NOT EXISTS catalog_localized(
        imdb_id TEXT PRIMARY KEY, title_fr TEXT, overview_fr TEXT, poster TEXT, backdrop TEXT, age_rating TEXT,
        tmdb_id INTEGER, tvmaze_id INTEGER, wikidata_id TEXT, metadata_source TEXT NOT NULL, metadata_checked_at TEXT NOT NULL, wikidata_checked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_catalog_tmdb ON catalog_localized(tmdb_id);
      CREATE INDEX IF NOT EXISTS idx_catalog_tvmaze ON catalog_localized(tvmaze_id);
      CREATE INDEX IF NOT EXISTS idx_catalog_wikidata ON catalog_localized(wikidata_id);
      CREATE TABLE IF NOT EXISTS catalog_sync(
        source TEXT PRIMARY KEY, status TEXT NOT NULL, phase TEXT NOT NULL, started_at TEXT, completed_at TEXT,
        processed INTEGER NOT NULL DEFAULT 0, total INTEGER, error TEXT
      );
    `);
    try { this.db.exec('ALTER TABLE catalog_localized ADD COLUMN wikidata_checked_at TEXT'); } catch { /* migration déjà appliquée */ }
  }

  count(kind?: 'film' | 'serie'): number {
    if (!this.db) return 0;
    const row = (kind
      ? this.db.prepare('SELECT COUNT(*) AS n FROM catalog_titles WHERE kind = ?').get(kind)
      : this.db.prepare("SELECT COUNT(*) AS n FROM catalog_titles WHERE kind IN ('film','serie')").get()) as { n: number };
    return Number(row.n);
  }

  query(input: CatalogQuery): { items: CatalogRow[]; total: number } {
    if (!this.db) return { items: [], total: 0 };
    const where = ["t.kind IN ('film','serie')", 't.is_adult = 0'];
    const params: unknown[] = [];
    if (input.kind) { where.push('t.kind = ?'); params.push(input.kind); }
    if (input.query?.trim()) {
      where.push('(t.primary_title LIKE ? COLLATE NOCASE OR t.original_title LIKE ? COLLATE NOCASE OR l.title_fr LIKE ? COLLATE NOCASE)');
      const pattern = `%${input.query.trim().replace(/[%_]/g, value => `\\${value}`)}%`;
      params.push(pattern, pattern, pattern);
    }
    if (input.genre?.trim()) { where.push('t.genres LIKE ?'); params.push(`%"${input.genre.trim()}"%`); }
    const clause = where.join(' AND ');
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM catalog_titles t LEFT JOIN catalog_localized l ON l.imdb_id=t.imdb_id WHERE ${clause}`).get(...params) as { n: number }).n);
    const order = input.sort === 'recent' ? 't.start_year DESC, t.votes DESC, t.rating DESC' : 't.votes DESC, t.rating DESC, t.start_year DESC';
    const offset = (Math.max(1, input.page) - 1) * input.limit;
    const rows = this.db.prepare(`
      SELECT t.*, l.title_fr, l.overview_fr, l.poster, l.backdrop, l.age_rating, l.tmdb_id, l.tvmaze_id,
             l.wikidata_id, l.metadata_source, l.metadata_checked_at, l.wikidata_checked_at
      FROM catalog_titles t LEFT JOIN catalog_localized l ON l.imdb_id=t.imdb_id
      WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?
    `).all(...params, input.limit, offset) as Array<Record<string, unknown>>;
    return { items: rows.map(rowFromSql), total };
  }

  get(imdbId: string): CatalogRow | undefined {
    if (!this.db) return undefined;
    const row = this.db.prepare(`SELECT t.*, l.title_fr, l.overview_fr, l.poster, l.backdrop, l.age_rating, l.tmdb_id, l.tvmaze_id, l.wikidata_id, l.metadata_source, l.metadata_checked_at, l.wikidata_checked_at FROM catalog_titles t LEFT JOIN catalog_localized l ON l.imdb_id=t.imdb_id WHERE t.imdb_id=?`).get(imdbId) as Record<string, unknown> | undefined;
    return row ? rowFromSql(row) : undefined;
  }

  seasons(parentImdbId: string): Array<{ season: number; episodes: Array<{ imdbId: string; episode: number; title: string; titleFr?: string; overviewFr?: string; still?: string }> }> {
    if (!this.db) return [];
    const rows = this.db.prepare(`
      SELECT e.imdb_id, e.season, e.episode, t.primary_title, l.title_fr, l.overview_fr, l.poster
      FROM catalog_episodes e JOIN catalog_titles t ON t.imdb_id=e.imdb_id
      LEFT JOIN catalog_localized l ON l.imdb_id=e.imdb_id
      WHERE e.parent_imdb_id=? ORDER BY e.season, e.episode
    `).all(parentImdbId) as Array<Record<string, unknown>>;
    const seasons = new Map<number, Array<{ imdbId: string; episode: number; title: string; titleFr?: string; overviewFr?: string; still?: string }>>();
    for (const row of rows) {
      const season = Number(row.season ?? 0); const list = seasons.get(season) ?? [];
      list.push({ imdbId: String(row.imdb_id), episode: Number(row.episode ?? 0), title: String(row.primary_title), titleFr: row.title_fr ? String(row.title_fr) : undefined, overviewFr: row.overview_fr ? String(row.overview_fr) : undefined, still: row.poster ? String(row.poster) : undefined });
      seasons.set(season, list);
    }
    return [...seasons].map(([season, episodes]) => ({ season, episodes }));
  }

  upsertTitles(rows: CatalogTitleInput[], syncToken: string): void {
    if (!this.db || !rows.length) return;
    const statement = this.db.prepare(`INSERT INTO catalog_titles(imdb_id,kind,primary_title,original_title,start_year,end_year,runtime_minutes,genres,is_adult,sync_token,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(imdb_id) DO UPDATE SET kind=excluded.kind,primary_title=excluded.primary_title,original_title=excluded.original_title,start_year=excluded.start_year,end_year=excluded.end_year,runtime_minutes=excluded.runtime_minutes,genres=excluded.genres,is_adult=excluded.is_adult,sync_token=excluded.sync_token,updated_at=excluded.updated_at`);
    const now = new Date().toISOString(); this.db.exec('BEGIN');
    try { for (const row of rows) statement.run(row.imdbId,row.kind,row.primaryTitle,row.originalTitle??null,row.startYear??null,row.endYear??null,row.runtimeMinutes??null,JSON.stringify(row.genres),row.adult?1:0,syncToken,now); this.db.exec('COMMIT'); } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  upsertRatings(rows: CatalogRatingInput[]): void {
    if (!this.db || !rows.length) return;
    const statement = this.db.prepare('UPDATE catalog_titles SET rating=?, votes=? WHERE imdb_id=?'); this.db.exec('BEGIN');
    try { for (const row of rows) statement.run(row.rating,row.votes,row.imdbId); this.db.exec('COMMIT'); } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  upsertEpisodes(rows: CatalogEpisodeInput[], syncToken: string): void {
    if (!this.db || !rows.length) return;
    const statement = this.db.prepare('INSERT INTO catalog_episodes(imdb_id,parent_imdb_id,season,episode,sync_token) VALUES(?,?,?,?,?) ON CONFLICT(imdb_id) DO UPDATE SET parent_imdb_id=excluded.parent_imdb_id,season=excluded.season,episode=excluded.episode,sync_token=excluded.sync_token'); this.db.exec('BEGIN');
    try { for (const row of rows) statement.run(row.imdbId,row.parentImdbId,row.season??null,row.episode??null,syncToken); this.db.exec('COMMIT'); } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  finishDataset(dataset: 'basics' | 'episodes', syncToken: string): void {
    if (!this.db) return;
    if (dataset === 'basics') this.db.prepare('DELETE FROM catalog_titles WHERE sync_token IS NOT NULL AND sync_token <> ?').run(syncToken);
    else this.db.prepare('DELETE FROM catalog_episodes WHERE sync_token IS NOT NULL AND sync_token <> ?').run(syncToken);
  }

  upsertLocalized(value: LocalizedMetadata): void {
    if (!this.db) return;
    const checkedAt=value.checkedAt??new Date().toISOString();
    this.db.prepare(`INSERT INTO catalog_localized(imdb_id,title_fr,overview_fr,poster,backdrop,age_rating,tmdb_id,tvmaze_id,wikidata_id,metadata_source,metadata_checked_at,wikidata_checked_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(imdb_id) DO UPDATE SET
      title_fr=COALESCE(excluded.title_fr,catalog_localized.title_fr), overview_fr=COALESCE(excluded.overview_fr,catalog_localized.overview_fr),
      poster=COALESCE(excluded.poster,catalog_localized.poster), backdrop=COALESCE(excluded.backdrop,catalog_localized.backdrop), age_rating=COALESCE(excluded.age_rating,catalog_localized.age_rating),
      tmdb_id=COALESCE(excluded.tmdb_id,catalog_localized.tmdb_id), tvmaze_id=COALESCE(excluded.tvmaze_id,catalog_localized.tvmaze_id), wikidata_id=COALESCE(excluded.wikidata_id,catalog_localized.wikidata_id),
      metadata_source=CASE WHEN excluded.metadata_source IN ('none','wikidata') AND catalog_localized.metadata_source<>'none' THEN catalog_localized.metadata_source ELSE excluded.metadata_source END,
      metadata_checked_at=CASE WHEN excluded.metadata_source='wikidata' THEN catalog_localized.metadata_checked_at ELSE excluded.metadata_checked_at END,
      wikidata_checked_at=COALESCE(excluded.wikidata_checked_at,catalog_localized.wikidata_checked_at)`)
      .run(value.imdbId,value.titleFr??null,value.overviewFr??null,value.poster??null,value.backdrop??null,value.ageRating??null,value.tmdbId??null,value.tvmazeId??null,value.wikidataId??null,value.source,value.source==='wikidata'?new Date(0).toISOString():checkedAt,value.source==='wikidata'?checkedAt:null);
  }

  setSync(state: CatalogSyncState): void {
    if (!this.db) return;
    this.db.prepare(`INSERT INTO catalog_sync(source,status,phase,started_at,completed_at,processed,total,error) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(source) DO UPDATE SET status=excluded.status,phase=excluded.phase,started_at=excluded.started_at,completed_at=excluded.completed_at,processed=excluded.processed,total=excluded.total,error=excluded.error`)
      .run(state.source,state.status,state.phase,state.startedAt??null,state.completedAt??null,state.processed,state.total??null,state.error??null);
  }

  syncStates(): CatalogSyncState[] {
    if (!this.db) return [];
    return (this.db.prepare('SELECT * FROM catalog_sync ORDER BY source').all() as Array<Record<string, unknown>>).map(row => ({
      source:String(row.source), status:String(row.status) as CatalogSyncState['status'], phase:String(row.phase), startedAt:row.started_at?String(row.started_at):undefined,
      completedAt:row.completed_at?String(row.completed_at):undefined, processed:Number(row.processed??0), total:row.total==null?undefined:Number(row.total), error:row.error?String(row.error):undefined,
    }));
  }

  close(): void { this.db?.close?.(); }
}
