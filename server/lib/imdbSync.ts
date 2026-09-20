import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import type { CatalogEpisodeInput, CatalogRatingInput, CatalogStore, CatalogTitleInput } from './catalogStore.js';

const BASE = 'https://datasets.imdbws.com';
const BATCH = 5_000;
const TITLE_TYPES = new Map<string, CatalogTitleInput['kind']>([
  ['movie', 'film'], ['tvMovie', 'film'], ['tvSeries', 'serie'], ['tvMiniSeries', 'serie'], ['tvEpisode', 'episode'],
]);
const GENRES: Record<string,string> = {
  Action:'Action', Adult:'Adulte', Adventure:'Aventure', Animation:'Animation', Biography:'Biographie', Comedy:'Comédie', Crime:'Policier',
  Documentary:'Documentaire', Drama:'Drame', Family:'Famille', Fantasy:'Fantastique', 'Film-Noir':'Film noir', 'Game-Show':'Jeu télévisé', History:'Histoire',
  Horror:'Horreur', Music:'Musique', Musical:'Comédie musicale', Mystery:'Mystère', News:'Actualités', 'Reality-TV':'Téléréalité', Romance:'Romance',
  'Sci-Fi':'Science-fiction', Short:'Court métrage', Sport:'Sport', 'Talk-Show':'Talk-show', Thriller:'Thriller', War:'Guerre', Western:'Western',
};

export type ImdbSyncProgress = { phase: string; processed: number; startedAt: string };

function optionalNumber(value: string): number | undefined {
  if (!value || value === '\\N') return undefined;
  const number = Number(value); return Number.isFinite(number) ? number : undefined;
}

async function linesFromGzip(url: string, fetcher: typeof fetch, signal?: AbortSignal): Promise<AsyncIterable<string>> {
  // Deux raisons d'abandonner : un téléchargement qui s'éternise, ou un arrêt
  // demandé depuis les réglages.
  const deadline = AbortSignal.timeout(30 * 60_000);
  const response = await fetcher(url, { headers: { 'User-Agent': 'SceneRoot/0.1 (local family media center)' }, signal: signal ? AbortSignal.any([deadline, signal]) : deadline });
  if (!response.ok || !response.body) throw new Error(`IMDb ${response.status} pour ${url}`);
  const source = Readable.fromWeb(response.body as never).pipe(createGunzip());
  return createInterface({ input: source, crlfDelay: Infinity });
}

/** Levée lorsqu'un arrêt est demandé : ce n'est pas une panne. */
export class SyncCancelled extends Error {
  constructor() { super('Synchronisation arrêtée'); this.name = 'SyncCancelled' }
}

export async function syncImdbCatalog(store: CatalogStore, options: {
  fetcher?: typeof fetch;
  onProgress?: (progress: ImdbSyncProgress) => void;
  signal?: AbortSignal;
} = {}): Promise<void> {
  if (!store.available) throw new Error('SQLite indisponible : import IMDb impossible');
  const fetcher = options.fetcher ?? fetch;
  const startedAt = new Date().toISOString();
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let processed = 0;
  const report = (phase: string) => {
    const progress = { phase, processed, startedAt };
    store.setSync({ source: 'imdb', status: 'running', ...progress }); options.onProgress?.(progress);
  };
  // Vérifié à chaque lot : l'arrêt est effectif en une fraction de seconde.
  const stopIfCancelled = () => { if (options.signal?.aborted) throw new SyncCancelled() };
  report('Téléchargement des titres');
  try {
    const titles: CatalogTitleInput[] = [];
    let first = true;
    for await (const line of await linesFromGzip(`${BASE}/title.basics.tsv.gz`, fetcher, options.signal)) {
      if (first) { first = false; continue; }
      const [imdbId, rawType, primaryTitle, originalTitle, adult, startYear, endYear, runtime, rawGenres] = line.split('\t');
      const kind = TITLE_TYPES.get(rawType); if (!kind || !imdbId || !primaryTitle) continue;
      titles.push({ imdbId, kind, primaryTitle, originalTitle: originalTitle === '\\N' ? undefined : originalTitle,
        startYear: optionalNumber(startYear), endYear: optionalNumber(endYear), runtimeMinutes: optionalNumber(runtime),
        genres: rawGenres === '\\N' ? [] : rawGenres.split(',').filter(Boolean).map(genre => GENRES[genre] ?? genre), adult: adult === '1' });
      processed++;
      if (titles.length >= BATCH) { stopIfCancelled(); store.upsertTitles(titles.splice(0), token); if (processed % 20_000 === 0) report('Import des titres'); }
    }
    stopIfCancelled();
    store.upsertTitles(titles, token); store.finishDataset('basics', token);

    processed = 0; report('Import des notes');
    const ratings: CatalogRatingInput[] = []; first = true;
    for await (const line of await linesFromGzip(`${BASE}/title.ratings.tsv.gz`, fetcher, options.signal)) {
      if (first) { first = false; continue; }
      const [imdbId, rating, votes] = line.split('\t'); ratings.push({ imdbId, rating:Number(rating)||0, votes:Number(votes)||0 }); processed++;
      if (ratings.length >= BATCH) { stopIfCancelled(); store.upsertRatings(ratings.splice(0)); if (processed % 20_000 === 0) report('Import des notes'); }
    }
    stopIfCancelled();
    store.upsertRatings(ratings);

    processed = 0; report('Import des saisons et épisodes');
    const episodes: CatalogEpisodeInput[] = []; first = true;
    for await (const line of await linesFromGzip(`${BASE}/title.episode.tsv.gz`, fetcher, options.signal)) {
      if (first) { first = false; continue; }
      const [imdbId, parentImdbId, season, episode] = line.split('\t');
      episodes.push({ imdbId, parentImdbId, season:optionalNumber(season), episode:optionalNumber(episode) }); processed++;
      if (episodes.length >= BATCH) { stopIfCancelled(); store.upsertEpisodes(episodes.splice(0), token); if (processed % 20_000 === 0) report('Import des saisons et épisodes'); }
    }
    stopIfCancelled();
    store.upsertEpisodes(episodes, token); store.finishDataset('episodes', token);
    const completedAt = new Date().toISOString();
    store.setSync({ source:'imdb', status:'complete', phase:'Catalogue local à jour', startedAt, completedAt, processed });
  } catch (error) {
    const cancelled = error instanceof SyncCancelled || (error as Error).name === 'AbortError';
    store.setSync({
      source:'imdb',
      status: cancelled ? 'idle' : 'error',
      phase: cancelled ? 'Synchronisation arrêtée' : 'Échec de la synchronisation',
      startedAt, completedAt:new Date().toISOString(), processed,
      error: cancelled ? undefined : (error as Error).message,
    });
    if (!cancelled) throw error;
  }
}
