import { statSync } from 'node:fs';
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
  source: 'tmdb' | 'omdb' | 'tvmaze' | 'wikidata' | 'wikipedia' | 'none';
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
  /** Année maximale acceptée : écarte les titres à paraître. */
  maxYear?: number;
  /** Année minimale acceptée : restreint le classement aux titres récents. */
  minYear?: number;
  /** Note minimale acceptée : sert au classement « mieux notés ». */
  minRating?: number;
};

export type CatalogSyncState = {
  source: string;
  status: 'idle' | 'running' | 'complete' | 'error';
  phase: string;
  startedAt?: string;
  /** Dernier signe de vie : distingue un import qui avance d'un import figé. */
  updatedAt?: string;
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

/** Plafond de candidats remontés par l'index plein texte pour une recherche. */
const SEARCH_CANDIDATES = 400;
/** Découpe une saisie en mots, quels que soient les séparateurs et la casse. */
const SPLIT_WORDS = new RegExp('[^\\p{L}\\p{N}]+', 'u');

export class CatalogStore {
  readonly available: boolean;
  readonly file: string;
  private db?: SqliteDb;

  /** Taille occupée sur le disque, journal d'écriture compris. */
  sizeBytes(): number {
    let bytes = 0;
    for (const suffix of ['', '-wal', '-shm']) {
      try { bytes += statSync(`${this.file}${suffix}`).size } catch { /* fichier absent */ }
    }
    return bytes;
  }

  constructor(dataDir: string) {
    this.file = join(dataDir, 'sceneroot.db');
    let DatabaseSync: (new (path: string) => SqliteDb) | undefined;
    try { ({ DatabaseSync } = createRequire(import.meta.url)('node:sqlite')); } catch { /* Node ancien : catalogue distant conservé */ }
    this.available = Boolean(DatabaseSync);
    if (!DatabaseSync) return;
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');
    this.migrate();
  }

  /** Crée le schéma et applique les migrations. Rejouable après une remise à zéro. */
  private migrate(): void {
    if (!this.db) return;
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
        processed INTEGER NOT NULL DEFAULT 0, total INTEGER, error TEXT, updated_at TEXT
      );
    `);
    try { this.db.exec('ALTER TABLE catalog_localized ADD COLUMN wikidata_checked_at TEXT'); } catch { /* migration déjà appliquée */ }
    try { this.db.exec('ALTER TABLE catalog_sync ADD COLUMN updated_at TEXT'); } catch { /* migration déjà appliquée */ }
    // « browsable » résume en une égalité les deux conditions de tout parcours
    // du catalogue (un film ou une série, tout public). Sans elle, la clause
    // kind IN (...) obligeait SQLite à balayer la table puis à trier en
    // mémoire : plusieurs secondes dès quelques centaines de milliers de
    // titres. Colonne générée : rien à maintenir à l'écriture.
    try {
      this.db.exec("ALTER TABLE catalog_titles ADD COLUMN browsable INTEGER GENERATED ALWAYS AS (CASE WHEN kind IN ('film','serie') AND is_adult = 0 THEN 1 ELSE 0 END) VIRTUAL");
    } catch { /* migration déjà appliquée */ }
    try {
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_catalog_browse_popular ON catalog_titles(browsable, votes DESC, rating DESC, start_year DESC);
        CREATE INDEX IF NOT EXISTS idx_catalog_browse_recent ON catalog_titles(browsable, start_year DESC, votes DESC, rating DESC);
      `);
    } catch { /* colonne générée indisponible : on reste sur les index d'origine */ }
    // Index plein texte : chercher « anatomy » dans « Grey's Anatomy » impose
    // sinon un LIKE '%...%', donc un parcours de toute la table — plusieurs
    // secondes par frappe sur un catalogue IMDb complet.
    try {
      this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS catalog_search USING fts5(imdb_id UNINDEXED, text, tokenize='unicode61 remove_diacritics 2')");
      this.searchIndex = true;
    } catch { this.searchIndex = false; /* FTS5 absent : on retombe sur LIKE */ }
  }

  /** Vrai quand la table plein texte existe. */
  private searchIndex = false;

  /** Nombre d'entrées indexées, 0 quand l'index reste à construire. */
  searchIndexSize(): number {
    if (!this.db || !this.searchIndex) return 0;
    const cached = this.counts.get('search');
    if (cached !== undefined) return cached;
    try {
      const value = Number((this.db.prepare('SELECT COUNT(*) AS n FROM catalog_search').get() as { n: number }).n);
      this.counts.set('search', value);
      return value;
    } catch { return 0 }
  }

  /**
   * Vrai quand l'index couvre l'ensemble des titres parcourables. La
   * comparaison se fait sur le nombre de lignes indexables, et non sur count(),
   * qui inclut les titres pour adultes écartés de l'index.
   */
  private searchIndexFresh(): boolean {
    if (!this.db) return false;
    const indexed = this.searchIndexSize();
    if (!indexed) return false;
    const cached = this.counts.get('browsable');
    let expected = cached;
    if (expected === undefined) {
      try {
        expected = Number((this.db.prepare('SELECT COUNT(*) AS n FROM catalog_titles WHERE browsable = 1').get() as { n: number }).n);
        this.counts.set('browsable', expected);
      } catch { return true }
    }
    return indexed >= expected;
  }

  /**
   * (Re)construit l'index de recherche à partir des titres. Un seul parcours,
   * à lancer après un import : quelques secondes pour des centaines de milliers
   * de titres, contre plusieurs secondes par recherche sans lui.
   */
  rebuildSearchIndex(): number {
    if (!this.db || !this.searchIndex) return 0;
    try {
      this.db.exec('DELETE FROM catalog_search');
      this.db.exec(`
        INSERT INTO catalog_search(imdb_id, text)
        SELECT t.imdb_id,
               t.primary_title || ' ' || COALESCE(t.original_title, '') || ' ' || COALESCE(l.title_fr, '')
        FROM catalog_titles t LEFT JOIN catalog_localized l ON l.imdb_id = t.imdb_id
        WHERE t.browsable = 1
      `);
      return this.searchIndexSize();
    } catch { return 0 }
  }

  /** Réindexe un titre dont le titre français vient d'arriver. */
  private indexOne(imdbId: string): void {
    if (!this.db || !this.searchIndex) return;
    try {
      this.db.prepare('DELETE FROM catalog_search WHERE imdb_id = ?').run(imdbId);
      this.db.prepare(`
        INSERT INTO catalog_search(imdb_id, text)
        SELECT t.imdb_id,
               t.primary_title || ' ' || COALESCE(t.original_title, '') || ' ' || COALESCE(l.title_fr, '')
        FROM catalog_titles t LEFT JOIN catalog_localized l ON l.imdb_id = t.imdb_id
        WHERE t.imdb_id = ? AND t.browsable = 1
      `).run(imdbId);
    } catch { /* index facultatif */ }
  }

  /**
   * Remet le catalogue à zéro : les tables sont supprimées puis recréées, ce
   * qui est bien plus rapide que d'effacer des centaines de milliers de lignes,
   * et le fichier est compacté dans la foulée.
   */
  reset(): void {
    if (!this.db) return;
    this.invalidateCounts();
    this.db.exec('DROP TABLE IF EXISTS catalog_titles; DROP TABLE IF EXISTS catalog_episodes; DROP TABLE IF EXISTS catalog_localized; DROP TABLE IF EXISTS catalog_sync; DROP TABLE IF EXISTS catalog_search;');
    this.migrate();
    try { this.db.exec('VACUUM') } catch { /* compactage facultatif */ }
    // Sans cette troncature, le journal d'écriture garde la taille de l'ancien
    // catalogue et les réglages annoncent un espace occupé qui n'existe plus.
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* journal déjà vide */ }
  }

  /**
   * Comptages mémorisés : ils sont demandés à chaque requête de catalogue et
   * coûtent un parcours complet de la table. Le cache tombe à chaque écriture.
   */
  private counts = new Map<string, number>();

  private invalidateCounts() { this.counts.clear(); }

  count(kind?: 'film' | 'serie'): number {
    if (!this.db) return 0;
    const key = kind ?? 'all';
    const cached = this.counts.get(key);
    if (cached !== undefined) return cached;
    const row = (kind
      ? this.db.prepare('SELECT COUNT(*) AS n FROM catalog_titles WHERE kind = ?').get(kind)
      : this.db.prepare("SELECT COUNT(*) AS n FROM catalog_titles WHERE kind IN ('film','serie')").get()) as { n: number };
    const value = Number(row.n);
    this.counts.set(key, value);
    return value;
  }

  /**
   * Titres portant des votes IMDb. Sans eux le classement par popularité n'a
   * rien à ordonner : c'est le symptôme d'un import interrompu avant les notes.
   */
  ratedCount(): number {
    if (!this.db) return 0;
    const cached = this.counts.get('rated');
    if (cached !== undefined) return cached;
    try {
      const value = Number((this.db.prepare('SELECT COUNT(*) AS n FROM catalog_titles WHERE browsable = 1 AND votes > 0').get() as { n: number }).n);
      this.counts.set('rated', value);
      return value;
    } catch { return 0 }
  }

  query(input: CatalogQuery): { items: CatalogRow[]; total: number; hasMore: boolean } {
    if (!this.db) return { items: [], total: 0, hasMore: false };
    const base = ['t.browsable = 1'];
    const baseParams: unknown[] = [];
    if (input.kind) { base.push('t.kind = ?'); baseParams.push(input.kind); }
    if (input.genre?.trim()) { base.push('t.genres LIKE ?'); baseParams.push(`%"${input.genre.trim()}"%`); }
    // Le tri « récent » remonte d'abord les titres annoncés : sans ce filtre en
    // SQL, une page entière pouvait être écartée après coup et sortir vide.
    if (input.maxYear) { base.push('(t.start_year IS NULL OR t.start_year <= ?)'); baseParams.push(input.maxYear); }
    if (input.minYear) { base.push('t.start_year >= ?'); baseParams.push(input.minYear); }
    if (input.minRating) { base.push('t.rating >= ?'); baseParams.push(input.minRating); }

    const search = input.query?.trim();
    const escaped = search?.replace(/[\\%_]/g, value => '\\' + value);
    const order = input.sort === 'recent' ? 't.start_year DESC, t.votes DESC, t.rating DESC' : 't.votes DESC, t.rating DESC, t.start_year DESC';
    const offset = (Math.max(1, input.page) - 1) * input.limit;

    // Une ligne de plus que demandé : elle indique qu'une page suivante existe,
    // sans le COUNT(*) qui parcourait toute la table à chaque requête.
    const fetch = (pattern?: string, titleOnly = false) => {
      const where = base.slice();
      const params = baseParams.slice();
      if (pattern && titleOnly) {
        where.push("t.primary_title LIKE ? ESCAPE '\\'");
        params.push(pattern);
      } else if (pattern) {
        where.push("(t.primary_title LIKE ? ESCAPE '\\' COLLATE NOCASE OR t.original_title LIKE ? ESCAPE '\\' COLLATE NOCASE OR l.title_fr LIKE ? ESCAPE '\\' COLLATE NOCASE)");
        params.push(pattern, pattern, pattern);
      }
      const clause = where.join(' AND ');
      const rows = this.db!.prepare(`
        SELECT t.*, l.title_fr, l.overview_fr, l.poster, l.backdrop, l.age_rating, l.tmdb_id, l.tvmaze_id,
               l.wikidata_id, l.metadata_source, l.metadata_checked_at, l.wikidata_checked_at
        FROM catalog_titles t LEFT JOIN catalog_localized l ON l.imdb_id=t.imdb_id
        WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?
      `).all(...params, input.limit + 1, offset) as Array<Record<string, unknown>>;
      return { rows, clause, params };
    };

    // L'index plein texte trouve un mot où qu'il soit dans le titre sans
    // parcourir la table. À défaut (index pas encore construit), on tente le
    // « commence par », qui s'appuie sur l'index des titres, puis en dernier
    // recours le « contient », qui balaie tout le catalogue.
    let result = search ? this.fetchByIds(this.searchIds(search), base, baseParams, order, input.limit, offset) : undefined;
    // Un index incomplet (import en cours, mise à jour récente) ne doit pas
    // faire croire qu'il n'y a rien : on repasse alors par les titres.
    if (result && !result.rows.length && !this.searchIndexFresh()) result = undefined;
    if (!result) {
      result = fetch(escaped ? `${escaped}%` : undefined, true);
      if (escaped && result.rows.length <= input.limit) result = fetch(`%${escaped}%`);
    }

    const hasMore = result.rows.length > input.limit;
    const items = (hasMore ? result.rows.slice(0, input.limit) : result.rows).map(rowFromSql);
    // Compter les résultats d'une recherche imposerait un second parcours
    // complet pour une simple indication : on rapporte ce que l'on a vu.
    const total = search ? offset + items.length + (hasMore ? 1 : 0) : this.total(result.clause, result.params);
    return { items, total, hasMore };
  }

  /**
   * Identifiants correspondant à une recherche, via l'index plein texte.
   * Chaque mot saisi est traité comme un début de mot : « grey ana » trouve
   * « Grey's Anatomy ». Renvoie null quand l'index n'est pas exploitable.
   */
  private searchIds(search: string): string[] | null {
    if (!this.db || !this.searchIndex) return null;
    const words = search.toLowerCase().split(SPLIT_WORDS).filter(Boolean);
    if (!words.length) return null;
    const match = words.map(word => `"${word.replace(/"/g, '""')}"*`).join(' ');
    try {
      const rows = this.db.prepare('SELECT imdb_id FROM catalog_search WHERE catalog_search MATCH ? LIMIT ?').all(match, SEARCH_CANDIDATES) as Array<{ imdb_id: string }>;
      return rows.map(row => String(row.imdb_id));
    } catch { return null }
  }

  /** Applique les filtres et le tri habituels à une liste d'identifiants. */
  private fetchByIds(ids: string[] | null, base: string[], baseParams: unknown[], order: string, limit: number, offset: number) {
    if (!this.db || ids === null) return undefined;
    if (!ids.length) return { rows: [] as Array<Record<string, unknown>>, clause: '0', params: [] as unknown[] };
    const where = [...base, `t.imdb_id IN (${ids.map(() => '?').join(',')})`];
    const params = [...baseParams, ...ids];
    const clause = where.join(' AND ');
    const rows = this.db.prepare(`
      SELECT t.*, l.title_fr, l.overview_fr, l.poster, l.backdrop, l.age_rating, l.tmdb_id, l.tvmaze_id,
             l.wikidata_id, l.metadata_source, l.metadata_checked_at, l.wikidata_checked_at
      FROM catalog_titles t LEFT JOIN catalog_localized l ON l.imdb_id=t.imdb_id
      WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?
    `).all(...params, limit + 1, offset) as Array<Record<string, unknown>>;
    return { rows, clause, params };
  }

  /** Nombre de titres correspondant à un filtre, mémorisé d'une requête à l'autre. */
  private total(clause: string, params: unknown[]): number {
    if (!this.db) return 0;
    const key = `total:${clause}:${JSON.stringify(params)}`;
    const cached = this.counts.get(key);
    if (cached !== undefined) return cached;
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM catalog_titles t LEFT JOIN catalog_localized l ON l.imdb_id=t.imdb_id WHERE ${clause}`).get(...params) as { n: number };
    const value = Number(row.n);
    this.counts.set(key, value);
    return value;
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
    this.invalidateCounts();
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
    this.invalidateCounts();
    if (dataset === 'basics') this.db.prepare('DELETE FROM catalog_titles WHERE sync_token IS NOT NULL AND sync_token <> ?').run(syncToken);
    else this.db.prepare('DELETE FROM catalog_episodes WHERE sync_token IS NOT NULL AND sync_token <> ?').run(syncToken);
  }

  /**
   * Met à jour les statistiques du planificateur SQLite. Sans elles, il ignore
   * l'index des titres et balaie la table entière à chaque recherche — plusieurs
   * secondes sur un Raspberry Pi. À relancer après un import massif.
   */
  analyze(): void {
    try { this.db?.exec('ANALYZE') } catch { /* statistiques facultatives */ }
  }

  /** Vrai quand le planificateur n'a encore aucune statistique exploitable. */
  needsAnalyze(): boolean {
    if (!this.db) return false;
    try {
      const row = this.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='sqlite_stat1'").get() as { n: number };
      return Number(row.n) === 0;
    } catch { return false }
  }

  /** Oublie les métadonnées françaises d'un titre pour forcer leur récupération. */
  forgetLocalized(imdbId: string): void {
    this.db?.prepare('DELETE FROM catalog_localized WHERE imdb_id = ?').run(imdbId);
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
    this.indexOne(value.imdbId);
  }

  setSync(state: CatalogSyncState): void {
    if (!this.db) return;
    this.db.prepare(`INSERT INTO catalog_sync(source,status,phase,started_at,completed_at,processed,total,error,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(source) DO UPDATE SET status=excluded.status,phase=excluded.phase,started_at=excluded.started_at,completed_at=excluded.completed_at,processed=excluded.processed,total=excluded.total,error=excluded.error,updated_at=excluded.updated_at`)
      .run(state.source,state.status,state.phase,state.startedAt??null,state.completedAt??null,state.processed,state.total??null,state.error??null,state.updatedAt??new Date().toISOString());
  }

  syncStates(): CatalogSyncState[] {
    if (!this.db) return [];
    return (this.db.prepare('SELECT * FROM catalog_sync ORDER BY source').all() as Array<Record<string, unknown>>).map(row => ({
      source:String(row.source), status:String(row.status) as CatalogSyncState['status'], phase:String(row.phase), startedAt:row.started_at?String(row.started_at):undefined,
      completedAt:row.completed_at?String(row.completed_at):undefined, updatedAt:row.updated_at?String(row.updated_at):undefined,
      processed:Number(row.processed??0), total:row.total==null?undefined:Number(row.total), error:row.error?String(row.error):undefined,
    }));
  }

  close(): void { this.db?.close?.(); }
}
