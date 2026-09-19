import { afterEach, describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalogStore } from './catalogStore.js';
import { syncImdbCatalog } from './imdbSync.js';

const resources: Array<{ dir:string; store:CatalogStore }> = [];
afterEach(() => { for (const resource of resources.splice(0)) { resource.store.close(); rmSync(resource.dir, { recursive:true, force:true }); } });

describe('IMDb synchronization', () => {
  it('streams the three datasets into the local catalog', async () => {
    const dir=mkdtempSync(join(tmpdir(),'sceneroot-imdb-'));const store=new CatalogStore(dir);resources.push({dir,store});
    const datasets:Record<string,string>={
      'title.basics.tsv.gz':'tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres\n'+
        'tt100\ttvSeries\tOrbit\tOrbit\t0\t2024\t\\N\t50\tDrama,Sci-Fi\n'+
        'tt101\ttvEpisode\tPilot\tPilot\t0\t2024\t\\N\t49\tDrama\n'+
        'tt200\tmovie\tMoon\tMoon\t0\t2023\t\\N\t105\tAdventure,Sci-Fi\n',
      'title.ratings.tsv.gz':'tconst\taverageRating\tnumVotes\ntt100\t8.1\t5000\ntt200\t7.5\t2500\n',
      'title.episode.tsv.gz':'tconst\tparentTconst\tseasonNumber\tepisodeNumber\ntt101\ttt100\t1\t1\n',
    };
    const fetcher:typeof fetch=async input=>{const name=String(input).split('/').pop()!;return new Response(gzipSync(datasets[name]),{status:200})};
    await syncImdbCatalog(store,{fetcher});
    expect(store.count()).toBe(2);
    expect(store.get('tt200')).toMatchObject({kind:'film',genres:['Aventure','Science-fiction'],rating:7.5});
    expect(store.seasons('tt100')[0].episodes[0]).toMatchObject({imdbId:'tt101',episode:1});
    expect(store.syncStates()[0]).toMatchObject({source:'imdb',status:'complete',phase:'Catalogue local à jour'});
  });
});
