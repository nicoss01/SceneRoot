import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalogStore } from './catalogStore.js';

const stores: Array<{ dir: string; store: CatalogStore }> = [];
function fresh() { const dir = mkdtempSync(join(tmpdir(), 'sceneroot-catalog-')); const store = new CatalogStore(dir); stores.push({ dir, store }); return store; }
afterEach(() => { for (const entry of stores.splice(0)) { entry.store.close(); rmSync(entry.dir, { recursive:true, force:true }); } });

describe('CatalogStore', () => {
  it('indexes IMDb titles and searches localized metadata', () => {
    const store = fresh();
    store.upsertTitles([
      { imdbId:'tt001', kind:'film', primaryTitle:'The Space Trip', startYear:2024, runtimeMinutes:105, genres:['Sci-Fi'], adult:false },
      { imdbId:'tt002', kind:'serie', primaryTitle:'Dark Woods', startYear:2023, genres:['Drama'], adult:false },
    ], 'sync-1');
    store.upsertRatings([{ imdbId:'tt001', rating:8.4, votes:1200 }]);
    store.upsertLocalized({ imdbId:'tt001', titleFr:'Le voyage spatial', overviewFr:'Une aventure.', tmdbId:42, source:'tmdb' });
    const result = store.query({ query:'voyage', kind:'film', page:1, limit:10 });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ imdbId:'tt001', titleFr:'Le voyage spatial', rating:8.4, tmdbId:42 });
  });

  it('reconstructs seasons and episodes from IMDb relationships', () => {
    const store = fresh();
    store.upsertTitles([
      { imdbId:'tt100', kind:'serie', primaryTitle:'Orbit', genres:['Sci-Fi'], adult:false },
      { imdbId:'tt101', kind:'episode', primaryTitle:'Pilot', genres:[], adult:false },
      { imdbId:'tt102', kind:'episode', primaryTitle:'Return', genres:[], adult:false },
    ], 'sync-1');
    store.upsertEpisodes([
      { imdbId:'tt101', parentImdbId:'tt100', season:1, episode:1 },
      { imdbId:'tt102', parentImdbId:'tt100', season:1, episode:2 },
    ], 'sync-1');
    store.upsertLocalized({ imdbId:'tt101', titleFr:'Pilote', source:'tmdb' });
    expect(store.seasons('tt100')).toEqual([{ season:1, episodes:[
      expect.objectContaining({ imdbId:'tt101', episode:1, titleFr:'Pilote' }),
      expect.objectContaining({ imdbId:'tt102', episode:2, title:'Return' }),
    ] }]);
  });

  it('removes rows absent from a completed IMDb generation', () => {
    const store = fresh();
    store.upsertTitles([{ imdbId:'tt1', kind:'film', primaryTitle:'Old', genres:[], adult:false }], 'old');
    store.upsertTitles([{ imdbId:'tt2', kind:'film', primaryTitle:'New', genres:[], adult:false }], 'new');
    store.finishDataset('basics', 'new');
    expect(store.count()).toBe(1);
    expect(store.get('tt1')).toBeUndefined();
  });
});
