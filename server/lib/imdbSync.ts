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

async function linesFromGzip(url: string, fetcher: typeof fetch): Promise<AsyncIterable<string>> {
  const response = await fetcher(url, { headers: { 'User-Agent': 'SceneRoot/0.1 (local family media center)' }, signal: AbortSignal.timeout(30 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`IMDb ${response.status} pour ${url}`);
  const source = Readable.fromWeb(response.body as never).pipe(createGunzip());
  return createInterface({ input: source, crlfDelay: Infinity });
}

export async function syncImdbCatalog(store: CatalogStore, options: {
  fetcher?: typeof fetch;
  onProgress?: (progress: ImdbSyncProgress) => void;
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
  report('Téléchargement des titres');
  try {
    const titles: CatalogTitleInput[] = [];
    let first = true;
    for await (const line of await linesFromGzip(`${BASE}/title.basics.tsv.gz`, fetcher)) {
      if (first) { first = false; continue; }
      const [imdbId, rawType, primaryTitle, originalTitle, adult, startYear, endYear, runtime, rawGenres] = line.split('\t');
      const kind = TITLE_TYPES.get(rawType); if (!kind || !imdbId || !primaryTitle) continue;
      titles.push({ imdbId, kind, primaryTitle, originalTitle: originalTitle === '\\N' ? undefined : originalTitle,
        startYear: optionalNumber(startYear), endYear: optionalNumber(endYear), runtimeMinutes: optionalNumber(runtime),
        genres: rawGenres === '\\N' ? [] : rawGenres.split(',').filter(Boolean).map(genre => GENRES[genre] ?? genre), adult: adult === '1' });
      processed++;
      if (titles.length >= BATCH) { store.upsertTitles(titles.splice(0), token); if (processed % 50_000 === 0) report('Import des titres'); }
    }
    store.upsertTitles(titles, token); store.finishDataset('basics', token);

    processed = 0; report('Import des notes');
    const ratings: CatalogRatingInput[] = []; first = true;
    for await (const line of await linesFromGzip(`${BASE}/title.ratings.tsv.gz`, fetcher)) {
      if (first) { first = false; continue; }
      const [imdbId, rating, votes] = line.split('\t'); ratings.push({ imdbId, rating:Number(rating)||0, votes:Number(votes)||0 }); processed++;
      if (ratings.length >= BATCH) { store.upsertRatings(ratings.splice(0)); if (processed % 50_000 === 0) report('Import des notes'); }
    }
    store.upsertRatings(ratings);

    processed = 0; report('Import des saisons et épisodes');
    const episodes: CatalogEpisodeInput[] = []; first = true;
    for await (const line of await linesFromGzip(`${BASE}/title.episode.tsv.gz`, fetcher)) {
      if (first) { first = false; continue; }
      const [imdbId, parentImdbId, season, episode] = line.split('\t');
      episodes.push({ imdbId, parentImdbId, season:optionalNumber(season), episode:optionalNumber(episode) }); processed++;
      if (episodes.length >= BATCH) { store.upsertEpisodes(episodes.splice(0), token); if (processed % 50_000 === 0) report('Import des saisons et épisodes'); }
    }
    store.upsertEpisodes(episodes, token); store.finishDataset('episodes', token);
    const completedAt = new Date().toISOString();
    store.setSync({ source:'imdb', status:'complete', phase:'Catalogue local à jour', startedAt, completedAt, processed });
  } catch (error) {
    store.setSync({ source:'imdb', status:'error', phase:'Échec de la synchronisation', startedAt, completedAt:new Date().toISOString(), processed, error:(error as Error).message });
    throw error;
  }
}
