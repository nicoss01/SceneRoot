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

  it('excludes upcoming titles so a "recent" page is never emptied after the fact', () => {
    const store = fresh();
    store.upsertTitles([
      { imdbId:'tt1', kind:'film', primaryTitle:'Sorti', startYear:2024, genres:[], adult:false },
      { imdbId:'tt2', kind:'film', primaryTitle:'Annoncé', startYear:2099, genres:[], adult:false },
      { imdbId:'tt3', kind:'film', primaryTitle:'Année inconnue', genres:[], adult:false },
    ], 'sync');
    const page = store.query({ page:1, limit:2, sort:'recent', maxYear:2026 });
    expect(page.items.map(row => row.primaryTitle)).not.toContain('Annoncé');
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.total).toBe(2);
  });

  it('reports a next page without counting the whole table', () => {
    const store = fresh();
    store.upsertTitles(Array.from({ length: 5 }, (_, index) => (
      { imdbId:`tt${index}`, kind:'film' as const, primaryTitle:`Film ${index}`, startYear:2020, genres:[], adult:false, votes:index }
    )), 'sync');
    const first = store.query({ page:1, limit:2, sort:'popular' });
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const last = store.query({ page:3, limit:2, sort:'popular' });
    expect(last.hasMore).toBe(false);
  });

  it('finds a title by a word in the middle once the search index is built', () => {
    const store = fresh();
    store.upsertTitles([
      { imdbId:'tt700', kind:'serie', primaryTitle:"Grey's Anatomy", startYear:2005, genres:[], adult:false, votes:9000 },
      { imdbId:'tt701', kind:'film', primaryTitle:'Anatomie du silence', startYear:2018, genres:[], adult:false, votes:10 },
    ], 'sync');
    expect(store.rebuildSearchIndex()).toBe(2);
    // « anatomy » n'est pas un début de titre : seul l'index plein texte le trouve.
    expect(store.query({ page:1, limit:10, query:'anatomy' }).items.map(row => row.imdbId)).toEqual(['tt700']);
    // Les accents ne doivent pas faire échouer la recherche.
    expect(store.query({ page:1, limit:10, query:'anatomie' }).items.map(row => row.imdbId)).toContain('tt701');
    // Plusieurs mots : tous doivent correspondre, même partiellement saisis.
    expect(store.query({ page:1, limit:10, query:'grey anat' }).items.map(row => row.imdbId)).toEqual(['tt700']);
    expect(store.query({ page:1, limit:10, query:'zzzz' }).items).toHaveLength(0);
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
