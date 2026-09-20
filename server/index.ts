import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { networkInterfaces } from 'node:os';
import { promisify } from 'node:util';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { recommendGroup } from './lib/recommend.js';
import { rankDownloads, type RankCandidate, type RankPrefs } from './lib/rank.js';
import { isAllowedOrigin, parseAllowedOrigins } from './lib/cors.js';
import { atomicWriteJson } from './lib/jsonStore.js';
import { createStore, type StoredDb } from './lib/store.js';
import { bearerToken, isAdminAuthorized, isLoopback, isPrivateAddress, requiresAdmin } from './lib/auth.js';
import { maskSource, normalizeTorznabUrl, sanitizeSource, type TorznabSource } from './lib/sources.js';
import { computeStats } from './lib/stats.js';
import { catalogGenres } from './lib/genres.js';
import { CatalogStore, type CatalogRow, type CatalogSyncState } from './lib/catalogStore.js';
import { syncImdbCatalog } from './lib/imdbSync.js';

type Rating = { profileId: string; mediaId: string; score: number; tags: string[]; at: string };
type ProfileRecord = { id:string; name:string; ageLimit:number; avatar:string; accent:string; pinHash?:string; createdAt:string };
type MediaMetadata = { provider:'tmdb'|'tvmaze'|'wikipedia'; providerId:number|string; title:string; originalTitle?:string; overview?:string; poster?:string; backdrop?:string; genres?:string[]; releaseDate?:string; ageRating?:string; runtime?:number; sourceUrl?:string; informationSource?:string };
type PlaybackEntry = { position:number; duration:number; updatedAt:string };
type Settings = { minFreeGb?:number; preferredQuality?:string; preferredLanguages?:string[]; preferHdr?:boolean; torznabSources?:TorznabSource[]; setupComplete?:boolean; adminToken?:string; tmdbApiKey?:string; catalogSyncEnabled?:boolean };
type GuestSession = { id:string; ageLimit:number; createdAt:string; expiresAt:number|null; ephemeral:boolean };
type MediaPref = { profileId:string; mediaId:string; at:string };
type Db = { profiles: ProfileRecord[]; library: LibraryItem[]; ratings: Rating[]; playback: Record<string, PlaybackEntry|number>; settings: Settings; guests: GuestSession[]; favorites: MediaPref[]; hidden: MediaPref[] };
type LibraryItem = { id: string; title: string; path: string; kind: 'film'|'serie'; year?: number; season?:number; episode?:number; size: number; modifiedAt:string; addedAt: string; technical?: Record<string,unknown>; metadata?:MediaMetadata };
type LibraryGroup = { id:string; title:string; year?:number; kind:'film'|'serie'; metadata?:MediaMetadata; versions:Array<Omit<LibraryItem,'path'>>; totalSize:number; episodeCount:number };
type Source = { id:string; name:string; url:string; apiKey:string; categories?:string };
type CatalogItem = { id:string; title:string; kind:'film'|'serie'; year:number; genres:string[]; duration:string; rating:number; quality:'1080p'; description:string; palette:[string,string]; symbol:string; art?:string; source:'imdb'|'tmdb'|'tvmaze'|'wikipedia'; sourceUrl?:string; informationSource?:string; badge?:'new'|'episode'; releaseDate?:string };
type CacheEntry<T> = { storedAt:string; expiresAt:number; data:T };
type CachedResult<T> = { data:T; cachedAt:string; state:'hit'|'miss'|'stale' };

const app = Fastify({ logger: true });
const port = Number(process.env.SCENEROOT_PORT ?? 4174);
const dataDir = resolve(process.env.SCENEROOT_DATA ?? './data');
const cacheDir = join(dataDir, 'cache');
const mediaRoots = (process.env.SCENEROOT_MEDIA ?? '/mnt/media').split(',').map(x => resolve(x.trim()));
const downloadDir = resolve(mediaRoots[0] ? join(mediaRoots[0], 'downloads') : join(process.env.SCENEROOT_DATA ?? './data', 'downloads'));
const videoExt = new Set(['.mp4','.mkv','.webm','.avi','.mov','.m4v']);
const execFileAsync=promisify(execFile);
const videoMime:Record<string,string>={'.mp4':'video/mp4','.m4v':'video/mp4','.mkv':'video/x-matroska','.webm':'video/webm','.avi':'video/x-msvideo','.mov':'video/quicktime'};
function mimeFor(path:string){return videoMime[extname(path).toLowerCase()]??'application/octet-stream'}
function isWithin(root:string,path:string){const rel=relative(root,resolve(path));return rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel)}
function isWithinRoots(path:string){return mediaRoots.some(root=>isWithin(root,path))}
const mpvSocket=process.env.SCENEROOT_MPV_IPC??(process.platform==='win32'?'\\\\.\\pipe\\sceneroot-mpv':'/tmp/sceneroot-mpv.sock');
let mpvProcess: ReturnType<typeof spawn> | null = null;
let mpvRequestId=0;
function mpvCommand<T=unknown>(command:unknown[]):Promise<T>{return new Promise((resolve,reject)=>{const requestId=++mpvRequestId;const socket=createConnection(mpvSocket);let buffer='';const timer=setTimeout(()=>{socket.destroy();reject(new Error('mpv IPC timeout'))},2500);const finish=(fn:()=>void)=>{clearTimeout(timer);socket.removeAllListeners();try{socket.end()}catch{}fn()};socket.on('connect',()=>socket.write(JSON.stringify({command,request_id:requestId})+'\n'));socket.on('data',chunk=>{buffer+=chunk.toString('utf8');let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);if(!line)continue;let message:{request_id?:number;error?:string;data?:unknown};try{message=JSON.parse(line)}catch{continue}if(message.request_id===requestId){if(message.error&&message.error!=='success')return finish(()=>reject(new Error(message.error)));return finish(()=>resolve(message.data as T))}}});socket.on('error',err=>{clearTimeout(timer);reject(err)})})}
async function mpvGet<T>(name:string):Promise<T|null>{try{return await mpvCommand<T>(['get_property',name])}catch{return null}}
/**
 * Environnement graphique du kiosque. Le serveur tourne en service systemd :
 * sans l'adresse du compositeur en cours, mpv ne trouve aucune sortie vidéo et
 * ne joue que le son. On repère donc la session Wayland vivante.
 */
function kioskDisplayEnv():Record<string,string>{
  try{
    for(const entry of readdirSync('/run/user')){
      const runtimeDir=`/run/user/${entry}`;
      const socket=readdirSync(runtimeDir).find(name=>/^wayland-\d+$/.test(name));
      if(socket)return{XDG_RUNTIME_DIR:runtimeDir,WAYLAND_DISPLAY:socket};
    }
  }catch{/* pas de session Wayland : on retombe sur X ou DRM */}
  return{};
}
/**
 * Télécommande HDMI-CEC. Chaque action réaffiche la barre de lecture de mpv
 * (« show-progress »), qui s'efface seule au bout de --osd-duration.
 */
const mpvInputConf=join(dataDir,'mpv-input.conf');
function writeMpvInput(){
  const bindings=[
    '# Généré par SceneRoot — ne pas modifier',
    'ENTER cycle pause; show-progress','KP_ENTER cycle pause; show-progress','SPACE cycle pause; show-progress',
    'PLAYPAUSE cycle pause; show-progress','PLAY set pause no; show-progress','PAUSE set pause yes; show-progress',
    'RIGHT seek 10; show-progress','LEFT seek -10; show-progress',
    'UP show-progress','DOWN show-progress',
    'ESC quit','BS quit','STOP quit','',
  ];
  try{writeFileSync(mpvInputConf,bindings.join('\n'))}
  catch(error){app.log.warn({error},'mpv input configuration could not be written')}
}
function spawnMpv(path:string,start:number){
  mpvProcess?.kill();
  // Sous un compositeur, le décodage matériel « direct » publie l'image sur un
  // plan que Cage ne compose pas : l'écran reste bleu alors que le son tourne.
  // La variante « copy » ramène les images vers la sortie vidéo.
  const hwdec=process.env.SCENEROOT_MPV_HWDEC??'auto-copy-safe';
  const args=[`--vo=${process.env.SCENEROOT_MPV_VO??'gpu'}`,`--hwdec=${hwdec}`,'--fs','--audio-display=no','--keep-open=no','--no-terminal',
    '--osd-duration=5000','--osd-bar=yes',
    `--input-conf=${mpvInputConf}`,`--input-ipc-server=${mpvSocket}`];
  if(start>0)args.push(`--start=${Math.floor(start)}`);
  args.push(path);
  mpvProcess=spawn('mpv',args,{stdio:['ignore','ignore','pipe'],env:{...process.env,DISPLAY:process.env.DISPLAY??':0',...kioskDisplayEnv()}});
  // Les erreurs de sortie vidéo ne sont visibles que là : on les journalise.
  mpvProcess.stderr?.on('data',chunk=>app.log.warn({mpv:String(chunk).trim().slice(0,400)},'mpv'));
  mpvProcess.on('exit',()=>{mpvProcess=null});
  mpvProcess.on('error',error=>app.log.warn({error},'mpv failed'));
}
function playbackEntry(value:unknown):PlaybackEntry|null{if(value==null)return null;if(typeof value==='number')return{position:value,duration:0,updatedAt:new Date(0).toISOString()};const v=value as Partial<PlaybackEntry>;return typeof v.position==='number'?{position:v.position,duration:Number(v.duration??0),updatedAt:String(v.updatedAt??new Date(0).toISOString())}:null}
mkdirSync(dataDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });
try{mkdirSync(downloadDir,{recursive:true})}catch{/* racine média absente en dev */}

const pendingCacheRequests=new Map<string,Promise<CachedResult<unknown>>>();
function cachePath(key:string){return join(cacheDir,`${key.replace(/[^a-z0-9_-]/gi,'-')}.json`)}
function readCache<T>(key:string):CacheEntry<T>|null{try{return JSON.parse(readFileSync(cachePath(key),'utf8')) as CacheEntry<T>}catch{return null}}
async function cachedJson<T>(key:string,url:string,ttlMs:number):Promise<CachedResult<T>>{
  const cached=readCache<T>(key);const now=Date.now();if(cached&&cached.expiresAt>now)return{data:cached.data,cachedAt:cached.storedAt,state:'hit'};
  const running=pendingCacheRequests.get(key);if(running)return running as Promise<CachedResult<T>>;
  const request=(async()=>{try{const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'SceneRoot/0.1 (+https://github.com/sceneroot)'},signal:AbortSignal.timeout(12_000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);const data=await response.json() as T;const entry:CacheEntry<T>={storedAt:new Date().toISOString(),expiresAt:Date.now()+ttlMs,data};atomicWriteJson(cachePath(key),entry);return{data,cachedAt:entry.storedAt,state:'miss'} as CachedResult<T>}catch(error){if(cached){app.log.warn({key,error},'Metadata provider unavailable; serving stale cache');return{data:cached.data,cachedAt:cached.storedAt,state:'stale'} as CachedResult<T>}throw error}finally{pendingCacheRequests.delete(key)}})();
  pendingCacheRequests.set(key,request as Promise<CachedResult<unknown>>);return request;
}

const store=createStore(dataDir);
const catalogStore=new CatalogStore(dataDir);
function loadDb(): Db {
  const empty:Db={ profiles: [], library: [], ratings: [], playback: {}, settings: {}, guests: [], favorites: [], hidden: [] };
  return {...empty,...(store.load() as unknown as Partial<Db>)};
}
function saveDb(db: Db) { store.save(db as unknown as StoredDb); }
function tmdbApiKey(){return process.env.TMDB_API_KEY?.trim()||loadDb().settings.tmdbApiKey?.trim()||''}
function maskSecret(value:string){return value.length<8?'••••':`${value.slice(0,4)}••••${value.slice(-4)}`}
const tmdbConfiguredByEnvironment=Boolean(process.env.TMDB_API_KEY?.trim());
if(!tmdbConfiguredByEnvironment){const savedKey=loadDb().settings.tmdbApiKey?.trim();if(savedKey)process.env.TMDB_API_KEY=savedKey}
function purgeExpiredGuests(clearEphemeral=false){const db=loadDb();const now=Date.now();const keep=db.guests.filter(guest=>(!clearEphemeral||!guest.ephemeral)&&(guest.expiresAt===null||guest.expiresAt>now));if(keep.length===db.guests.length)return;const removed=new Set(db.guests.filter(guest=>!keep.includes(guest)).map(guest=>guest.id));db.ratings=db.ratings.filter(rating=>!removed.has(rating.profileId));for(const key of Object.keys(db.playback))if(removed.has(key.slice(0,key.indexOf(':'))))delete db.playback[key];db.guests=keep;saveDb(db)}
function hashPin(pin:string){const salt=randomBytes(16);const digest=scryptSync(pin,salt,32);return`${salt.toString('hex')}:${digest.toString('hex')}`}
function verifyPin(pin:string,stored:string){try{const[saltHex,digestHex]=stored.split(':');const expected=Buffer.from(digestHex,'hex');const actual=scryptSync(pin,Buffer.from(saltHex,'hex'),expected.length);return timingSafeEqual(actual,expected)}catch{return false}}
function safeAvatar(value:string|undefined,fallback:string){return value&&(/^\/assets\/avatars\/[a-z0-9-]+\.png$/i.test(value)||/^[\p{L}\p{N}]$/u.test(value))?value:fallback}
function safeAccent(value:string|undefined){return value&&/^#[0-9a-f]{6}$/i.test(value)?value:'#22d3ee'}
function normalizeTmdb(item:Record<string,unknown>,kind:'movie'|'tv'):MediaMetadata{const title=String(kind==='tv'?item.name??item.original_name??'':item.title??item.original_title??'');const originalTitle=String(kind==='tv'?item.original_name??'':item.original_title??'');const releaseDate=String(kind==='tv'?item.first_air_date??'':item.release_date??'');const genres=Array.isArray(item.genres)?item.genres.map(g=>String((g as {name?:unknown}).name??'')).filter(Boolean):Array.isArray(item.genre_ids)?item.genre_ids.map(id=>tmdbGenres[Number(id)]).filter(Boolean):undefined;return{provider:'tmdb',providerId:Number(item.id),title,originalTitle,overview:String(item.overview??''),poster:item.poster_path?`https://image.tmdb.org/t/p/w500${item.poster_path}`:undefined,backdrop:item.backdrop_path?`https://image.tmdb.org/t/p/original${item.backdrop_path}`:undefined,genres,releaseDate,runtime:Number(item.runtime??0)||undefined,sourceUrl:`https://www.themoviedb.org/${kind==='tv'?'tv':'movie'}/${Number(item.id)}`}}
const tmdbGenres:Record<number,string>={12:'Aventure',14:'Fantastique',16:'Animation',18:'Drame',27:'Horreur',28:'Action',35:'Comédie',36:'Histoire',37:'Western',53:'Thriller',80:'Policier',99:'Documentaire',878:'Science-fiction',9648:'Mystère',10402:'Musique',10749:'Romance',10751:'Famille',10752:'Guerre',10759:'Action & aventure',10762:'Enfants',10763:'Actualités',10764:'Téléréalité',10765:'Science-fiction & fantastique',10766:'Soap',10767:'Talk-show',10768:'Guerre & politique',10770:'Téléfilm'};
function stripHtml(value:unknown){return String(value??'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
const tvmazeGenreNames:Record<string,string>={Adult:'Adulte',Adventure:'Aventure',Anime:'Anime',Children:'Enfants',Comedy:'Comédie',Crime:'Policier',DIY:'Bricolage',Drama:'Drame',Espionage:'Espionnage',Family:'Famille',Fantasy:'Fantastique',Food:'Cuisine',History:'Histoire',Horror:'Horreur',Legal:'Juridique',Medical:'Médical',Music:'Musique',Mystery:'Mystère',Nature:'Nature',Romance:'Romance','Science-Fiction':'Science-fiction',Sports:'Sport',Supernatural:'Surnaturel',Thriller:'Thriller',Travel:'Voyage',War:'Guerre',Western:'Western'};
function localizedTvmazeGenres(value:unknown){return Array.isArray(value)?value.map(genre=>tvmazeGenreNames[String(genre)]??String(genre)):[]}
function frenchTvmazeSummary(show:Record<string,unknown>){const premiered=String(show.premiered??'');const runtime=Number(show.averageRuntime??show.runtime??0);const statusNames:Record<string,string>={Running:'en cours',Ended:'terminée','To Be Determined':'au statut à confirmer','In Development':'en développement'};const typeNames:Record<string,string>={Scripted:'fiction',Reality:'téléréalité',Documentary:'documentaire',Animation:'animation',Variety:'divertissement',TalkShow:'talk-show',News:'actualité',Sports:'sport'};const network=show.network as {name?:string;country?:{code?:string}}|undefined;const webChannel=show.webChannel as {name?:string;country?:{code?:string}}|undefined;const code=network?.country?.code??webChannel?.country?.code;let country='';try{country=code?new Intl.DisplayNames(['fr'],{type:'region'}).of(code)??'':''}catch{}const parts=[`Série de ${typeNames[String(show.type??'')]??'télévision'}${country?` produite en ${country}`:''}${premiered?` et diffusée à partir de ${premiered.slice(0,4)}`:''}.`];if(runtime)parts.push(`Les épisodes durent environ ${runtime} minutes.`);const broadcaster=network?.name??webChannel?.name;if(broadcaster)parts.push(`Diffusion : ${broadcaster}.`);const status=statusNames[String(show.status??'')];if(status)parts.push(`La série est ${status}.`);parts.push('Le résumé narratif français n’est pas encore disponible.');return parts.join(' ')}
function durationLabel(minutes:unknown,kind:'film'|'serie'){const value=Number(minutes??0);if(!value)return kind==='serie'?'Série':'Durée inconnue';return`${Math.floor(value/60)}h${String(value%60).padStart(2,'0')}`}
function palette(id:number):[string,string]{const palettes:[string,string][]= [['#0e7490','#172554'],['#701a75','#1e40af'],['#065f46','#1e293b'],['#7c2d12','#581c87'],['#334155','#155e75']];return palettes[Math.abs(id)%palettes.length]}
function todayIso(){return new Date().toISOString().slice(0,10)}
/** Un titre sans date connue est conservé ; ceux à paraître sont écartés. */
function isReleased(item:CatalogItem){return !item.releaseDate||item.releaseDate<=todayIso()}
function normalizeTmdbCatalog(item:Record<string,unknown>,kind:'film'|'serie'):CatalogItem{const title=String(kind==='serie'?item.name??item.original_name??'':item.title??item.original_title??'');const date=String(kind==='serie'?item.first_air_date??'':item.release_date??'');const id=Number(item.id);return{id:`tmdb-${kind}-${id}`,title,kind,releaseDate:date||undefined,year:Number(date.slice(0,4))||new Date().getFullYear(),genres:(Array.isArray(item.genre_ids)?item.genre_ids:[]).map(value=>tmdbGenres[Number(value)]).filter(Boolean),duration:kind==='serie'?'Série':'Durée inconnue',rating:Math.round(Number(item.vote_average??0)*10)/10,quality:'1080p',description:String(item.overview??''),palette:palette(id),symbol:kind==='serie'?'▥':'◉',art:item.backdrop_path?`https://image.tmdb.org/t/p/w780${item.backdrop_path}`:item.poster_path?`https://image.tmdb.org/t/p/w500${item.poster_path}`:undefined,source:'tmdb',sourceUrl:`https://www.themoviedb.org/${kind==='serie'?'tv':'movie'}/${id}`}}
type ProviderPage={items:CatalogItem[];hasMore:boolean;source:string;cachedAt:string;cacheState:string;totalItems?:number;syncing?:boolean};
async function tmdbCatalog(kind:'film'|'serie',page:number,limit:number):Promise<ProviderPage>{const key=process.env.TMDB_API_KEY;if(!key)throw new Error('TMDB non configuré');const path=kind==='serie'?'tv':'movie';const url=new URL(`https://api.themoviedb.org/3/discover/${path}`);url.searchParams.set('api_key',key);url.searchParams.set('language','fr-FR');url.searchParams.set('sort_by','popularity.desc');url.searchParams.set('include_adult','false');url.searchParams.set('page',String(page));url.searchParams.set(kind==='serie'?'first_air_date.lte':'release_date.lte',todayIso());if(kind==='film')url.searchParams.set('region','FR');const result=await cachedJson<{results:Record<string,unknown>[];total_pages:number}>(`catalog-tmdb-${kind}-${page}`,url.toString(),6*60*60*1000);return{items:result.data.results.slice(0,limit).map(item=>normalizeTmdbCatalog(item,kind)),hasMore:page<result.data.total_pages,source:'TMDB',cachedAt:result.cachedAt,cacheState:result.state}}
async function tvmazeCatalog(page:number,limit:number):Promise<ProviderPage>{const offset=(page-1)*limit;const required=offset+limit;const all:Record<string,unknown>[]=[];const fetched:CachedResult<Record<string,unknown>[]>[]=[];for(let remotePage=0;all.length<required;remotePage++){const result=await cachedJson<Record<string,unknown>[]>(`catalog-tvmaze-${remotePage}`,`https://api.tvmaze.com/shows?page=${remotePage}`,12*60*60*1000);fetched.push(result);all.push(...result.data);if(!result.data.length)break}const selected=all.slice(offset,required);const items=await Promise.all(selected.map(async show=>{const id=Number(show.id);const image=show.image as {medium?:string;original?:string}|undefined;const rating=show.rating as {average?:number}|undefined;const runtime=show.averageRuntime??show.runtime;const premiered=String(show.premiered??'');const localized=await localizeTvmazeMetadata(normalizeTvmazeMetadata(show));return{id:`tvmaze-serie-${id}`,title:localized.title,kind:'serie' as const,year:Number(premiered.slice(0,4))||new Date().getFullYear(),genres:localized.genres??localizedTvmazeGenres(show.genres),duration:durationLabel(runtime,'serie'),rating:Number(rating?.average??0),quality:'1080p' as const,description:localized.overview??stripHtml(show.summary),palette:palette(id),symbol:'▥',art:image?.original??image?.medium,source:'tvmaze' as const,sourceUrl:localized.sourceUrl??String(show.url??''),informationSource:localized.informationSource??'TVmaze'}}));const cachedAt=fetched.map(result=>result.cachedAt).sort().at(-1)??new Date().toISOString();const states=[...new Set(fetched.map(result=>result.state))];return{items,hasMore:selected.length===limit&&fetched.at(-1)?.data.length!==0,source:'TVmaze + Wikipédia FR',cachedAt,cacheState:states.join('/')}}
type WikipediaPage={pageid:number;title:string;extract?:string;fullurl?:string;missing?:boolean;thumbnail?:{source?:string}};
type WikipediaResponse={query?:{pages?:Record<string,WikipediaPage>}};
function isFrenchSeriesPage(page:WikipediaPage,year?:number){const extract=page.extract??'';return !page.missing&&Boolean(extract)&&/(?:série|mini-série|feuilleton)\s+(?:télévisée|d'animation)|série d'animation/i.test(extract)&&(!year||extract.includes(String(year)))}
function cleanFrenchSeriesTitle(title:string){return title.replace(/\s*\((?:mini-)?série télévisée[^)]*\)$/i,'').trim()}
async function frenchSeriesInfo(title:string,year?:number):Promise<{title:string;overview:string;sourceUrl:string}|null>{const direct=new URL('https://fr.wikipedia.org/w/api.php');direct.searchParams.set('action','query');direct.searchParams.set('titles',`${title} (série télévisée)|${title}`);direct.searchParams.set('redirects','1');direct.searchParams.set('prop','extracts|info');direct.searchParams.set('inprop','url');direct.searchParams.set('exintro','1');direct.searchParams.set('explaintext','1');direct.searchParams.set('exchars','700');direct.searchParams.set('format','json');direct.searchParams.set('formatversion','2');const exact=await cachedJson<WikipediaResponse>(`metadata-wikipedia-fr-serie-direct-${slug(`${title}:${year??''}`)}`,direct.toString(),7*24*60*60*1000);let page=Object.values(exact.data.query?.pages??{}).find(candidate=>isFrenchSeriesPage(candidate,year));if(!page){const search=new URL('https://fr.wikipedia.org/w/api.php');search.searchParams.set('action','query');search.searchParams.set('generator','search');search.searchParams.set('gsrsearch',`intitle:"${title}" série télévisée${year?` ${year}`:''}`);search.searchParams.set('gsrnamespace','0');search.searchParams.set('gsrlimit','5');search.searchParams.set('prop','extracts|info');search.searchParams.set('inprop','url');search.searchParams.set('exintro','1');search.searchParams.set('explaintext','1');search.searchParams.set('exchars','700');search.searchParams.set('format','json');search.searchParams.set('formatversion','2');const fallback=await cachedJson<WikipediaResponse>(`metadata-wikipedia-fr-serie-search-${slug(`${title}:${year??''}`)}`,search.toString(),7*24*60*60*1000);const candidates=Object.values(fallback.data.query?.pages??{}).filter(candidate=>isFrenchSeriesPage(candidate,year));page=candidates.find(candidate=>comparableTitle(cleanFrenchSeriesTitle(candidate.title))===comparableTitle(title))}return page?.extract&&page.fullurl?{title:cleanFrenchSeriesTitle(page.title),overview:page.extract,sourceUrl:page.fullurl}:null}
async function localizeTvmazeMetadata(metadata:MediaMetadata){try{const french=await frenchSeriesInfo(metadata.title,Number(metadata.releaseDate?.slice(0,4))||undefined);return french?{...metadata,originalTitle:metadata.title,title:french.title,overview:french.overview,sourceUrl:french.sourceUrl,informationSource:'Wikipédia en français + TVmaze'}:metadata}catch(error){app.log.debug({error,title:metadata.title},'French series metadata unavailable');return metadata}}
async function tmdbRecent(kind:'film'|'serie',page:number,limit:number):Promise<ProviderPage>{const key=process.env.TMDB_API_KEY;if(!key)throw new Error('TMDB non configuré');const path=kind==='serie'?'tv/on_the_air':'movie/now_playing';const url=new URL(`https://api.themoviedb.org/3/${path}`);url.searchParams.set('api_key',key);url.searchParams.set('language','fr-FR');url.searchParams.set('page',String(page));if(kind==='film')url.searchParams.set('region','FR');const result=await cachedJson<{results:Record<string,unknown>[];total_pages:number}>(`catalog-recent-tmdb-${kind}-${page}`,url.toString(),12*60*60*1000);const badge:'new'|'episode'=kind==='serie'?'episode':'new';return{items:result.data.results.slice(0,limit).map(item=>({...normalizeTmdbCatalog(item,kind),badge})),hasMore:page<result.data.total_pages,source:kind==='serie'?'TMDB · à l’antenne':'TMDB · en salle',cachedAt:result.cachedAt,cacheState:result.state}}
async function catalogFor(kind:'film'|'serie',page:number,limit:number,recent=false){if(catalogStore.count(kind)>0)return localCatalog(page,limit,kind,'','',recent);if(tmdbApiKey())return recent?tmdbRecent(kind,page,limit):tmdbCatalog(kind,page,limit);return{items:[],hasMore:false,source:'Catalogue IMDb en attente',cachedAt:new Date(0).toISOString(),cacheState:'local'}}
function metadataToCatalogItem(item:MediaMetadata,kind:'film'|'serie',index:number):CatalogItem{const seed=Number(item.providerId)||parseInt(slug(String(item.providerId)),36)||index;return{id:`${item.provider}-${kind}-${item.providerId}`,title:item.title,kind,releaseDate:item.releaseDate,year:Number(item.releaseDate?.slice(0,4))||new Date().getFullYear(),genres:item.genres??[],duration:durationLabel(item.runtime,kind),rating:0,quality:'1080p',description:item.overview??'',palette:palette(seed),symbol:kind==='serie'?'▥':'◉',art:item.backdrop??item.poster,source:item.provider,sourceUrl:item.sourceUrl,informationSource:item.informationSource}}
async function searchedCatalog(query:string,kind?:'film'|'serie'):Promise<ProviderPage>{if(catalogStore.count(kind)>0)return localCatalog(1,30,kind,query);const kinds:('film'|'serie')[]=kind?[kind]:['film','serie'];const pages=await Promise.all(kinds.map(async mediaKind=>({mediaKind,result:await searchMetadata(query,mediaKind)})));return{items:pages.flatMap(({mediaKind,result})=>result.items.map((item,index)=>metadataToCatalogItem(item,mediaKind,index))),hasMore:false,source:[...new Set(pages.flatMap(page=>page.result.items.map(item=>item.informationSource??(item.provider==='tvmaze'?'TVmaze':item.provider==='wikipedia'?'Wikipédia':'TMDB'))))].join(' + ')||'Catalogue',cachedAt:new Date().toISOString(),cacheState:pages.map(page=>page.result.state).join('/')}}
function normalizeTvmazeMetadata(show:Record<string,unknown>):MediaMetadata{const image=show.image as {medium?:string;original?:string}|undefined;return{provider:'tvmaze',providerId:Number(show.id),title:String(show.name??''),overview:frenchTvmazeSummary(show),poster:image?.original??image?.medium,backdrop:image?.original,genres:localizedTvmazeGenres(show.genres),releaseDate:String(show.premiered??''),runtime:Number(show.averageRuntime??show.runtime??0)||undefined,sourceUrl:String(show.url??''),informationSource:'TVmaze · fiche technique en français'}}
function normalizeWikipediaMetadata(page:WikipediaPage,year?:number):MediaMetadata{return{provider:'wikipedia',providerId:page.pageid,title:page.title.replace(/\s*\((?:\d{4}\s+)?film\)$/i,''),overview:page.extract??'',poster:page.thumbnail?.source,backdrop:page.thumbnail?.source,genres:['Cinéma'],releaseDate:year?`${year}-01-01`:undefined,sourceUrl:page.fullurl}}
async function searchMetadata(query:string,kind:'film'|'serie',year?:string):Promise<{items:MediaMetadata[];state:string}>{
  const tmdbKey=process.env.TMDB_API_KEY;if(tmdbKey){const path=kind==='serie'?'tv':'movie';const url=new URL(`https://api.themoviedb.org/3/search/${path}`);url.searchParams.set('api_key',tmdbKey);url.searchParams.set('language','fr-FR');url.searchParams.set('query',query);if(year)url.searchParams.set(path==='tv'?'first_air_date_year':'year',year);const result=await cachedJson<{results:Array<Record<string,unknown>>}>(`metadata-search-${slug(`${path}:${query}:${year??''}`)}`,url.toString(),24*60*60*1000);return{items:result.data.results.slice(0,6).map(item=>normalizeTmdb(item,path)),state:result.state}}
  if(kind==='serie'){const url=`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`;const result=await cachedJson<Array<{show:Record<string,unknown>}>>(`metadata-tvmaze-search-${slug(query)}`,url,24*60*60*1000);return{items:await Promise.all(result.data.slice(0,6).map(entry=>localizeTvmazeMetadata(normalizeTvmazeMetadata(entry.show)))),state:result.state}}
  const url=new URL('https://en.wikipedia.org/w/api.php');url.searchParams.set('action','query');url.searchParams.set('generator','search');url.searchParams.set('gsrsearch',`${query}${year?` ${year}`:''} film`);url.searchParams.set('gsrnamespace','0');url.searchParams.set('gsrlimit','6');url.searchParams.set('prop','pageimages|extracts|info');url.searchParams.set('inprop','url');url.searchParams.set('piprop','thumbnail');url.searchParams.set('pithumbsize','780');url.searchParams.set('exintro','1');url.searchParams.set('explaintext','1');url.searchParams.set('exchars','420');url.searchParams.set('format','json');url.searchParams.set('formatversion','2');const result=await cachedJson<WikipediaResponse>(`metadata-wikipedia-search-${slug(`${query}:${year??''}`)}`,url.toString(),24*60*60*1000);return{items:Object.values(result.data.query?.pages??{}).slice(0,6).map(page=>normalizeWikipediaMetadata(page,year?Number(year):undefined)),state:result.state}
}
async function fetchMetadata(provider:MediaMetadata['provider'],providerId:number|string,kind:'film'|'serie'):Promise<{metadata:MediaMetadata;state:string}>{
  if(provider==='tmdb'){const key=process.env.TMDB_API_KEY;if(!key)throw new Error('TMDB non configuré');const path=kind==='serie'?'tv':'movie';const url=`https://api.themoviedb.org/3/${path}/${providerId}?api_key=${encodeURIComponent(key)}&language=fr-FR`;const result=await cachedJson<Record<string,unknown>>(`metadata-tmdb-${path}-${providerId}`,url,7*24*60*60*1000);return{metadata:normalizeTmdb(result.data,path),state:result.state}}
  if(provider==='tvmaze'){const result=await cachedJson<Record<string,unknown>>(`metadata-tvmaze-show-${providerId}`,`https://api.tvmaze.com/shows/${providerId}`,7*24*60*60*1000);return{metadata:await localizeTvmazeMetadata(normalizeTvmazeMetadata(result.data)),state:result.state}}
  const url=new URL('https://en.wikipedia.org/w/api.php');url.searchParams.set('action','query');url.searchParams.set('pageids',String(providerId));url.searchParams.set('prop','pageimages|extracts|info');url.searchParams.set('inprop','url');url.searchParams.set('piprop','thumbnail');url.searchParams.set('pithumbsize','780');url.searchParams.set('exintro','1');url.searchParams.set('explaintext','1');url.searchParams.set('format','json');url.searchParams.set('formatversion','2');const result=await cachedJson<WikipediaResponse>(`metadata-wikipedia-page-${providerId}`,url.toString(),7*24*60*60*1000);const page=Object.values(result.data.query?.pages??{})[0];if(!page)throw new Error('Fiche Wikipédia introuvable');return{metadata:normalizeWikipediaMetadata(page),state:result.state}
}
function comparableTitle(value:string){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function groupLibrary(library:LibraryItem[]):LibraryGroup[]{const grouped=new Map<string,LibraryGroup>();for(const {path,...item} of library){const title=item.metadata?.title??item.title;const year=Number(item.metadata?.releaseDate?.slice(0,4))||item.year;const key=`${item.kind}:${comparableTitle(title)}:${year??''}`;const group=grouped.get(key)??{id:item.id,title,year,kind:item.kind,metadata:item.metadata,versions:[],totalSize:0,episodeCount:0};group.versions.push(item);group.totalSize+=item.size;if(item.episode)group.episodeCount++;grouped.set(key,group)}return[...grouped.values()]}
function groupForMedia(groups:LibraryGroup[],mediaId:string){return groups.find(group=>group.id===mediaId||group.versions.some(version=>version.id===mediaId))}
function nextEpisodeOf(mediaId:string):{id:string;title:string;path:string}|null{const db=loadDb();const group=groupForMedia(groupLibrary(db.library),mediaId);if(!group||group.kind!=='serie')return null;const current=group.versions.find(version=>version.id===mediaId);if(!current?.episode)return null;const episodes=[...new Map(group.versions.filter(version=>version.episode).sort((a,b)=>(a.season??0)-(b.season??0)||(a.episode??0)-(b.episode??0)).map(version=>[`${version.season??1}:${version.episode}`,version])).values()];const key=`${current.season??1}:${current.episode}`;const index=episodes.findIndex(version=>`${version.season??1}:${version.episode}`===key);const next=index>=0?episodes[index+1]:undefined;if(!next)return null;const full=db.library.find(item=>item.id===next.id);return full?{id:next.id,title:next.title,path:full.path}:null}
function warmFile(path:string){try{const stream=createReadStream(path,{start:0,end:4*1024*1024});stream.on('error',()=>{});stream.on('data',()=>{});}catch{/* préchargement best-effort */}}
let enrichmentRunning=false;
async function enrichLibrary(limit=6){if(enrichmentRunning)return;enrichmentRunning=true;try{
  const pending=loadDb().library.filter(item=>!item.metadata).slice(0,limit);
  const decisions:Array<{kind:'film'|'serie';title:string;year?:number;metadata:MediaMetadata}>=[];
  for(const item of pending){try{const result=await searchMetadata(item.title,item.kind,item.year?String(item.year):undefined);const exact=result.items.filter(candidate=>comparableTitle(candidate.title)===comparableTitle(item.title)&&(!item.year||!candidate.releaseDate||Number(candidate.releaseDate.slice(0,4))===item.year));if(exact.length!==1)continue;decisions.push({kind:item.kind,title:item.title,year:item.year,metadata:exact[0]})}catch(error){app.log.warn({error,title:item.title},'Automatic metadata enrichment failed')}}
  if(!decisions.length)return;
  // Re-read just before writing so ratings/playback saved during the awaits above are not overwritten.
  const db=loadDb();let changed=false;
  for(const decision of decisions){for(const sibling of db.library.filter(entry=>!entry.metadata&&entry.kind===decision.kind&&entry.year===decision.year&&comparableTitle(entry.title)===comparableTitle(decision.title))){sibling.metadata=decision.metadata;sibling.title=decision.metadata.title;changed=true}}
  if(changed)saveDb(db);
}finally{enrichmentRunning=false}}
function slug(path: string) { let h=2166136261; for(const c of path) h=Math.imul(h^c.charCodeAt(0),16777619); return (h>>>0).toString(36); }
function titleFromFile(file: string) {
  const raw = parse(file).name.replace(/[._]/g,' ').replace(/\b(?:s\d{1,2}e\d{1,3}|\d{1,2}x\d{1,3}|season\s*\d+\s*episode\s*\d+)\b.*$/i,'').replace(/\b(19|20)\d{2}\b.*$/,'').replace(/\b(1080p|2160p|720p|bluray|webrip|web-dl).*$/i,'');
  return raw.replace(/\s+/g,' ').trim().replace(/\b\w/g,c=>c.toUpperCase());
}
function episodeFromFile(file:string){const name=parse(file).name;const m=name.match(/(?:S(\d{1,2})E(\d{1,3})|(\d{1,2})x(\d{1,3})|Season\s*(\d+)\s*Episode\s*(\d+))/i);return m?{season:Number(m[1]??m[3]??m[5]),episode:Number(m[2]??m[4]??m[6])}:null}
async function probe(path:string){try{const {stdout}=await execFileAsync('ffprobe',['-v','quiet','-print_format','json','-show_format','-show_streams',path],{timeout:15000,maxBuffer:2_000_000});const data=JSON.parse(stdout);const video=data.streams?.find((s:{codec_type:string})=>s.codec_type==='video');const audio=data.streams?.filter((s:{codec_type:string})=>s.codec_type==='audio')??[];const subtitles=data.streams?.filter((s:{codec_type:string})=>s.codec_type==='subtitle')??[];return{duration:Number(data.format?.duration??0),videoCodec:video?.codec_name,width:video?.width,height:video?.height,hdr:/smpte2084|arib-std-b67/i.test(JSON.stringify(video)),audio:audio.map((s:{codec_name:string;channels:number;tags?:{language?:string}})=>({codec:s.codec_name,channels:s.channels,language:s.tags?.language})),subtitles:subtitles.map((s:{codec_name:string;tags?:{language?:string}})=>({codec:s.codec_name,language:s.tags?.language}))}}catch{return{probePending:true}}}
async function walk(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const out: string[]=[]; for(const entry of await readdir(root,{withFileTypes:true})) { const p=join(root,entry.name); if(entry.isDirectory()) out.push(...await walk(p)); else if(videoExt.has(extname(p).toLowerCase())) out.push(p); } return out;
}
async function scanLibrary() {
  const files=(await Promise.all(mediaRoots.map(walk))).flat();
  const db=loadDb();const previous=new Map(db.library.map(item=>[item.path,item]));
  const library: LibraryItem[]=[]; for(const path of files){const info=statSync(path);const old=previous.get(path);const match=parse(path).name.match(/\b((?:19|20)\d{2})\b/);const ep=episodeFromFile(path);const unchanged=old&&old.size===info.size&&old.modifiedAt===info.mtime.toISOString();library.push({id:slug(path),title:old?.metadata?.title??titleFromFile(path),path,kind:ep?'serie':'film',year:match?Number(match[1]):old?.year,...(ep??{}),size:info.size,modifiedAt:info.mtime.toISOString(),addedAt:info.birthtime.toISOString(),technical:unchanged?old.technical:await probe(path),metadata:old?.metadata})}
  // Re-read just before writing so ratings/playback saved during the probe awaits are preserved.
  const fresh=loadDb();fresh.library=library;saveDb(fresh);void enrichLibrary(6);return library;
}

const allowedOrigins=parseAllowedOrigins(process.env.SCENEROOT_ALLOWED_ORIGINS);
await app.register(cors, { origin:(origin,callback)=>callback(null,isAllowedOrigin(origin,allowedOrigins)) });
const trustPrivateLan=process.env.SCENEROOT_REQUIRE_TOKEN!=='1';
function adminToken(){return process.env.SCENEROOT_ADMIN_TOKEN??loadDb().settings.adminToken}
app.addHook('onRequest',async(request,reply)=>{
  if(!requiresAdmin(request.method,request.url))return;
  const token=(request.headers['x-sceneroot-token'] as string|undefined)??bearerToken(request.headers.authorization);
  if(!isAdminAuthorized(request.ip,token,adminToken(),trustPrivateLan))return reply.code(401).send({error:'Administration réservée : accès distant refusé (token requis)'});
});
app.get('/api/admin-token',async(request,reply)=>{if(!isPrivateAddress(request.ip)&&!isLoopback(request.ip))return reply.code(403).send({error:'Réservé au réseau local'});const envToken=process.env.SCENEROOT_ADMIN_TOKEN;const dbToken=loadDb().settings.adminToken;return{token:envToken??dbToken??null,source:envToken?'env':dbToken?'app':'none',requireToken:!trustPrivateLan}});
app.post<{Body:{token?:string}}>('/api/admin-token',async(request,reply)=>{if(!isPrivateAddress(request.ip)&&!isLoopback(request.ip))return reply.code(403).send({error:'Réservé au réseau local'});if(process.env.SCENEROOT_ADMIN_TOKEN)return reply.code(409).send({error:'Jeton défini par l’environnement (SCENEROOT_ADMIN_TOKEN)'});const db=loadDb();const token=(request.body?.token?.trim())||randomBytes(18).toString('base64').replace(/[^A-Za-z0-9]/g,'').slice(0,24);db.settings.adminToken=token;saveDb(db);return{token}});
function lanAddresses(){const out:string[]=[];for(const entries of Object.values(networkInterfaces()))for(const entry of entries??[])if(entry.family==='IPv4'&&!entry.internal)out.push(entry.address);return out}
app.get('/api/health', async () => ({ ok:true, version:'0.1.0', mediaRoots, port, addresses:lanAddresses(), storage:store.backend }));
app.get('/api/genres',async()=>catalogGenres);
/**
 * Recherche pilotée depuis un téléphone : le mobile dépose ici la requête et
 * les filtres, l'écran de recherche du téléviseur les applique. L'état vit en
 * mémoire — il n'a aucun intérêt après un redémarrage.
 */
type RemoteSearch={query:string;kind:'all'|'film'|'serie';genre:string;duration:'any'|'short'|'medium'|'long';minRating:number;quality:string;updatedAt:string};
let remoteSearch:RemoteSearch={query:'',kind:'all',genre:'',duration:'any',minRating:0,quality:'',updatedAt:new Date(0).toISOString()};
app.get('/api/remote/search',async()=>remoteSearch);
app.put<{Body:Partial<RemoteSearch>}>('/api/remote/search',{schema:{body:{type:'object',properties:{query:{type:'string',maxLength:120},kind:{type:'string',enum:['all','film','serie']},genre:{type:'string',maxLength:60},duration:{type:'string',enum:['any','short','medium','long']},minRating:{type:'number',minimum:0,maximum:10},quality:{type:'string',maxLength:10}}}}},async request=>{
  const body=request.body;
  remoteSearch={
    query:typeof body.query==='string'?body.query.slice(0,120):remoteSearch.query,
    kind:body.kind??remoteSearch.kind,
    genre:typeof body.genre==='string'?body.genre:remoteSearch.genre,
    duration:body.duration??remoteSearch.duration,
    minRating:typeof body.minRating==='number'?body.minRating:remoteSearch.minRating,
    quality:typeof body.quality==='string'?body.quality:remoteSearch.quality,
    updatedAt:new Date().toISOString(),
  };
  return remoteSearch;
});
app.get('/api/profiles',async()=>loadDb().profiles.map(({pinHash,...profile})=>({...profile,locked:Boolean(pinHash)})));
app.post<{Body:{name:string;ageLimit:number;avatar?:string;accent?:string;pin?:string}}>('/api/profiles',{schema:{body:{type:'object',required:['name'],properties:{name:{type:'string',minLength:1,maxLength:40},ageLimit:{type:'number'},avatar:{type:'string'},accent:{type:'string'},pin:{type:'string',pattern:'^[0-9]{0,8}$'}}}}},async(request,reply)=>{const name=request.body.name?.trim();if(!name)return reply.code(400).send({error:'Le nom est obligatoire'});const db=loadDb();const profile:ProfileRecord={id:randomUUID(),name,ageLimit:Math.max(0,Math.min(18,Number(request.body.ageLimit??18))),avatar:safeAvatar(request.body.avatar,name[0].toUpperCase()),accent:safeAccent(request.body.accent),createdAt:new Date().toISOString(),pinHash:request.body.pin?hashPin(request.body.pin):undefined};db.profiles.push(profile);saveDb(db);const{pinHash,...safe}=profile;return reply.code(201).send({...safe,locked:Boolean(pinHash)})});
app.put<{Params:{id:string};Body:{name:string;ageLimit:number;avatar?:string;accent?:string;pin?:string|null}}>('/api/profiles/:id',async(request,reply)=>{const name=request.body.name?.trim();if(!name)return reply.code(400).send({error:'Le nom est obligatoire'});const db=loadDb();let profile=db.profiles.find(item=>item.id===request.params.id);if(!profile){profile={id:request.params.id,name,ageLimit:18,avatar:name[0].toUpperCase(),accent:'#22d3ee',createdAt:new Date().toISOString()};db.profiles.push(profile)}profile.name=name;profile.ageLimit=Math.max(0,Math.min(18,Number(request.body.ageLimit??profile.ageLimit)));profile.avatar=safeAvatar(request.body.avatar,profile.avatar||name[0].toUpperCase());profile.accent=safeAccent(request.body.accent??profile.accent);if(request.body.pin===null||request.body.pin==='')delete profile.pinHash;else if(request.body.pin!==undefined)profile.pinHash=hashPin(request.body.pin);saveDb(db);const{pinHash,...safe}=profile;return{...safe,locked:Boolean(pinHash)}});
app.delete<{Params:{id:string}}>('/api/profiles/:id',async request=>{const db=loadDb();const before=db.profiles.length;db.profiles=db.profiles.filter(profile=>profile.id!==request.params.id);db.ratings=db.ratings.filter(rating=>rating.profileId!==request.params.id);db.favorites=db.favorites.filter(entry=>entry.profileId!==request.params.id);db.hidden=db.hidden.filter(entry=>entry.profileId!==request.params.id);const prefix=`${request.params.id}:`;for(const key of Object.keys(db.playback))if(key.startsWith(prefix))delete db.playback[key];saveDb(db);return{ok:true,removed:before-db.profiles.length}});
app.post<{Params:{id:string};Body:{pin:string}}>('/api/profiles/:id/unlock',{schema:{body:{type:'object',required:['pin'],properties:{pin:{type:'string',maxLength:8}}}}},async(request,reply)=>{const profile=loadDb().profiles.find(p=>p.id===request.params.id);if(!profile)return reply.code(404).send({error:'Profil introuvable'});if(!profile.pinHash)return{ok:true};return verifyPin(request.body.pin??'',profile.pinHash)?{ok:true}:reply.code(401).send({error:'Code incorrect'})});
app.get('/api/library', async () => loadDb().library.map(({path,...item})=>item));
app.get('/api/library/grouped', async () => groupLibrary(loadDb().library).sort((a,b)=>b.versions[0].addedAt.localeCompare(a.versions[0].addedAt)));
app.get<{Params:{id:string};Querystring:{profileId?:string}}>('/api/library/group/:id',async(request,reply)=>{const db=loadDb();const group=groupForMedia(groupLibrary(db.library),request.params.id);if(!group)return reply.code(404).send({error:'Média introuvable'});const profileId=request.query.profileId;const progressFor=(id:string)=>{if(!profileId)return{position:0,progress:0};const entry=playbackEntry(db.playback[`${profileId}:${id}`]);return entry?{position:entry.position,progress:entry.duration>0?entry.position/entry.duration:0}:{position:0,progress:0}};const versions=group.versions.map(version=>({...version,...progressFor(version.id)}));const episodes=versions.filter(version=>version.episode).sort((a,b)=>(a.season??0)-(b.season??0)||(a.episode??0)-(b.episode??0));const nextEpisode=episodes.find(episode=>episode.progress<0.9)??episodes[0];return{...group,versions,nextEpisodeId:nextEpisode?.id};});
async function providerEpisodes(provider:MediaMetadata['provider'],providerId:number|string,season:number):Promise<Map<number,{name?:string;overview?:string;still?:string}>>{const map=new Map<number,{name?:string;overview?:string;still?:string}>();try{if(provider==='tmdb'&&process.env.TMDB_API_KEY){const url=`https://api.themoviedb.org/3/tv/${providerId}/season/${season}?api_key=${encodeURIComponent(process.env.TMDB_API_KEY)}&language=fr-FR`;const result=await cachedJson<{episodes?:Array<{episode_number:number;name?:string;overview?:string;still_path?:string}>}>(`episodes-tmdb-${providerId}-s${season}`,url,7*24*60*60*1000);for(const episode of result.data.episodes??[])map.set(episode.episode_number,{name:episode.name||undefined,overview:episode.overview||undefined,still:episode.still_path?`https://image.tmdb.org/t/p/w300${episode.still_path}`:undefined})}else if(provider==='tvmaze'){const result=await cachedJson<Array<{season:number;number:number;name?:string;summary?:string;image?:{medium?:string;original?:string}}>>(`episodes-tvmaze-${providerId}`,`https://api.tvmaze.com/shows/${providerId}/episodes`,7*24*60*60*1000);for(const episode of result.data)if(episode.season===season&&episode.number!=null)map.set(episode.number,{name:episode.name||undefined,overview:episode.summary?stripHtml(episode.summary):undefined,still:episode.image?.original??episode.image?.medium})}}catch(error){app.log.debug({error,provider,providerId,season},'Episode metadata unavailable')}return map}
app.get<{Params:{id:string};Querystring:{profileId?:string}}>('/api/library/group/:id/episodes',async(request,reply)=>{const db=loadDb();const group=groupForMedia(groupLibrary(db.library),request.params.id);if(!group)return reply.code(404).send({error:'Média introuvable'});if(group.kind!=='serie')return{seasons:[],source:undefined};const profileId=request.query.profileId;const progressFor=(id:string)=>{if(!profileId)return{position:0,progress:0};const entry=playbackEntry(db.playback[`${profileId}:${id}`]);return entry?{position:entry.position,progress:entry.duration>0?entry.position/entry.duration:0}:{position:0,progress:0}};const provider=group.metadata?.provider;const providerId=group.metadata?.providerId;const seasonNumbers=[...new Set(group.versions.filter(version=>version.episode).map(version=>version.season??1))].sort((a,b)=>a-b);const seasons=await Promise.all(seasonNumbers.map(async season=>{const meta=(provider&&providerId!=null)?await providerEpisodes(provider,providerId,season):new Map();const byEpisode=new Map<number,Array<Omit<LibraryItem,'path'>>>();for(const version of group.versions.filter(v=>v.episode&&(v.season??1)===season)){const arr=byEpisode.get(version.episode!)??[];arr.push(version);byEpisode.set(version.episode!,arr)}const episodes=[...byEpisode.entries()].sort((a,b)=>a[0]-b[0]).map(([number,files])=>{const info=meta.get(number);const primary=files[0];const progress=progressFor(primary.id);return{id:primary.id,season,episode:number,title:info?.name||primary.title,overview:info?.overview,still:info?.still,versions:files.length,progress:progress.progress,position:progress.position}});return{season,episodes}}));return{seasons,source:provider==='tmdb'?'TMDB (fr-FR)':provider==='tvmaze'?'TVmaze':undefined}});
app.post('/api/library/scan', async () => ({ items: await scanLibrary() }));
app.post('/api/library/enrich',async()=>{void enrichLibrary(30);return{ok:true,status:'started'}});
app.get<{Querystring:{kind?:'film'|'serie';page?:string;limit?:string;genre?:string;q?:string;sort?:string}}>('/api/catalog',async(request,reply)=>{
  const page=Math.max(1,Number(request.query.page??1));const limit=Math.max(1,Math.min(30,Number(request.query.limit??12)));const recent=request.query.sort==='recent';
  try{
    let result:ProviderPage;
    if(catalogStore.count()>0)result=await localCatalog(page,limit,request.query.kind,request.query.q?.trim()??'',request.query.genre?.trim()??'',recent);
    else if(request.query.q?.trim())result=page===1?await searchedCatalog(request.query.q.trim(),request.query.kind):{items:[],hasMore:false,source:'Catalogue',cachedAt:new Date().toISOString(),cacheState:'hit'};
    else if(request.query.kind)result=await catalogFor(request.query.kind,page,limit,recent);
    else{const filmLimit=Math.ceil(limit/2);const serieLimit=limit-filmLimit;const[films,series]=await Promise.all([catalogFor('film',page,filmLimit,recent),catalogFor('serie',page,serieLimit,recent)]);const items:CatalogItem[]=[];for(let index=0;index<Math.max(films.items.length,series.items.length);index++){if(films.items[index])items.push(films.items[index]);if(series.items[index])items.push(series.items[index])}result={items:items.slice(0,limit),hasMore:films.hasMore||series.hasMore,source:`${films.source} + ${series.source}`,cachedAt:films.cachedAt>series.cachedAt?films.cachedAt:series.cachedAt,cacheState:films.cacheState===series.cacheState?films.cacheState:`${films.cacheState}/${series.cacheState}`}}
    const wantedGenre=request.query.genre?.trim().toLocaleLowerCase('fr');const items=result.items.filter(isReleased).filter(item=>!wantedGenre||item.genres.some(genre=>genre.toLocaleLowerCase('fr')===wantedGenre));reply.header('Cache-Control','private, max-age=600, stale-while-revalidate=3600').header('X-SceneRoot-Cache',result.cacheState);return{items:items.slice(0,limit),page,hasMore:result.hasMore,source:result.source,cachedAt:result.cachedAt,total:result.totalItems};
  }catch(error){app.log.warn({error},'Catalog loading failed');return reply.code(502).send({error:'Catalogue distant temporairement indisponible'})}
});
app.get<{Querystring:{q:string;kind?:'film'|'serie';year?:string}}>('/api/metadata/search',async(request,reply)=>{if(!request.query.q)return reply.code(400).send({error:'Recherche manquante'});try{const result=await searchMetadata(request.query.q,request.query.kind??'film',request.query.year);reply.header('X-SceneRoot-Cache',result.state);return result.items}catch(error){app.log.warn({error},'Metadata search failed');return reply.code(502).send({error:'Source de métadonnées indisponible'})}});
app.put<{Params:{id:string};Body:{provider?:MediaMetadata['provider'];providerId:number|string}}>('/api/library/:id/match',async(request,reply)=>{const db=loadDb();const item=db.library.find(x=>x.id===request.params.id);if(!item)return reply.code(404).send({error:'Média introuvable'});try{const result=await fetchMetadata(request.body.provider??'tmdb',request.body.providerId,item.kind);const originalTitle=item.title;const originalYear=item.year;for(const sibling of db.library.filter(entry=>entry.kind===item.kind&&entry.year===originalYear&&comparableTitle(entry.title)===comparableTitle(originalTitle))){sibling.metadata=result.metadata;sibling.title=result.metadata.title}saveDb(db);reply.header('X-SceneRoot-Cache',result.state);return result.metadata}catch(error){app.log.warn({error},'Metadata match failed');return reply.code(502).send({error:'Correspondance indisponible'})}});
let imdbSyncPromise:Promise<void>|null=null;
/** Synchronisation automatique du catalogue : une fois par jour par défaut. */
const catalogSyncIntervalMs=Math.max(1,Number(process.env.SCENEROOT_CATALOG_SYNC_DAYS??1))*24*60*60*1000;
// L'import IMDb traverse quatre étapes de tailles inconnues à l'avance : la
// progression se lit donc à l'étape en cours, complétée par le nombre de lignes.
const catalogPhases=['Téléchargement des titres','Import des titres','Import des notes','Import des saisons et épisodes'];
function catalogProgress(state?:CatalogSyncState){
  if(!state)return undefined;
  const steps=catalogPhases.length;
  if(state.status==='complete')return{step:steps,steps,ratio:1};
  const index=catalogPhases.indexOf(state.phase);
  return{step:Math.max(0,index),steps,ratio:index<0?0:index/steps};
}
function lastCatalogSync(){return catalogStore.syncStates().find(state=>state.source==='imdb'&&state.status==='complete')?.completedAt}
function nextCatalogSync(){if(!loadDb().settings.catalogSyncEnabled)return undefined;const last=lastCatalogSync();return new Date(last?Date.parse(last)+catalogSyncIntervalMs:Date.now()).toISOString()}
function hasCatalogSyncSpace(){try{const disk=statfsSync(dataDir);return disk.bavail*disk.bsize>=Math.max(1,Number(process.env.SCENEROOT_CATALOG_MIN_FREE_GB??4))*1024**3}catch{return true}}
function startImdbSync(){if(imdbSyncPromise)return imdbSyncPromise;if(!hasCatalogSyncSpace()){const message='Espace insuffisant pour importer les jeux de données IMDb.';catalogStore.setSync({source:'imdb',status:'error',phase:'Synchronisation bloquée',processed:0,error:message});app.log.warn(message);return Promise.resolve()}imdbSyncPromise=syncImdbCatalog(catalogStore,{onProgress:progress=>app.log.info(progress,'IMDb catalogue synchronization')}).catch(error=>{app.log.error({error},'IMDb catalogue synchronization failed')}).finally(()=>{imdbSyncPromise=null});return imdbSyncPromise}
app.get('/api/catalog/status',async()=>({available:catalogStore.available,total:catalogStore.count(),syncing:Boolean(imdbSyncPromise),sources:catalogStore.syncStates(),progress:catalogProgress(catalogStore.syncStates().find(state=>state.source==='imdb')),databaseBytes:catalogStore.sizeBytes(),lastSyncAt:lastCatalogSync(),nextSyncAt:nextCatalogSync(),intervalHours:catalogSyncIntervalMs/3_600_000,tmdb:{configured:Boolean(tmdbApiKey()),source:tmdbConfiguredByEnvironment?'environment':tmdbApiKey()?'settings':'none'},architecture:{titles:'IMDb Datasets',frenchMetadata:'TMDB',episodes:'TMDB + TVmaze',identifiers:'Wikidata',fallback:'Wikipédia'}}));
app.post('/api/catalog/sync',async(_request,reply)=>{if(!catalogStore.available)return reply.code(503).send({error:'SQLite nécessite Node.js 22.5 ou supérieur'});if(!hasCatalogSyncSpace())return reply.code(507).send({error:'Au moins 4 Go libres sont requis pour synchroniser le catalogue IMDb.'});void startImdbSync();return reply.code(202).send({ok:true,status:'running'})});

async function enrichCatalogSeason(parent:CatalogRow,seasonNumber:number){
  let parentRow=parent;const key=tmdbApiKey();if(key&&!parent.tmdbId){await enrichTmdbRow(parent,key);parentRow=catalogStore.get(parent.imdbId)??parent}
  const localSeason=catalogStore.seasons(parent.imdbId).find(value=>value.season===seasonNumber);if(!localSeason)return;
  if(key&&parentRow.tmdbId){const url=`https://api.themoviedb.org/3/tv/${parentRow.tmdbId}/season/${seasonNumber}?api_key=${encodeURIComponent(key)}&language=fr-FR`;try{const result=await cachedJson<{episodes?:Array<{episode_number:number;name?:string;overview?:string;still_path?:string}>}>(`catalog-episodes-tmdb-${parentRow.tmdbId}-${seasonNumber}`,url,30*24*60*60*1000);for(const remote of result.data.episodes??[]){const local=localSeason.episodes.find(value=>value.episode===remote.episode_number);if(local)catalogStore.upsertLocalized({imdbId:local.imdbId,titleFr:remote.name,overviewFr:remote.overview,poster:remote.still_path?`https://image.tmdb.org/t/p/w500${remote.still_path}`:undefined,source:'tmdb'})}return}catch(error){app.log.debug({error,parent:parent.imdbId,seasonNumber},'TMDB season enrichment failed')}
  }
  try{const lookup=await fetch(`https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(parent.imdbId)}`,{headers:{Accept:'application/json','User-Agent':'SceneRoot/0.1'},signal:AbortSignal.timeout(12_000)});if(!lookup.ok)return;const show=await lookup.json() as {id:number};catalogStore.upsertLocalized({imdbId:parent.imdbId,tvmazeId:show.id,source:'tvmaze'});const result=await cachedJson<Array<{season:number;number:number;name?:string;summary?:string;image?:{medium?:string;original?:string}}>>(`catalog-episodes-tvmaze-${show.id}`,`https://api.tvmaze.com/shows/${show.id}/episodes`,30*24*60*60*1000);for(const remote of result.data.filter(value=>value.season===seasonNumber)){const local=localSeason.episodes.find(value=>value.episode===remote.number);if(local)catalogStore.upsertLocalized({imdbId:local.imdbId,titleFr:remote.name,overviewFr:stripHtml(remote.summary),poster:remote.image?.original??remote.image?.medium,source:'tvmaze'})}}catch(error){app.log.debug({error,parent:parent.imdbId,seasonNumber},'TVmaze season enrichment failed')}
}
app.get<{Params:{id:string}}>('/api/catalog/:id/seasons',async(request,reply)=>{const match=/^imdb-serie-(tt\d+)$/.exec(request.params.id);if(!match)return reply.code(404).send({error:'Série du catalogue local introuvable'});const parent=catalogStore.get(match[1]);if(!parent||parent.kind!=='serie')return reply.code(404).send({error:'Série introuvable'});let seasons=catalogStore.seasons(parent.imdbId);await Promise.allSettled(seasons.slice(0,3).filter(season=>season.episodes.some(episode=>!episode.titleFr)).map(season=>enrichCatalogSeason(parent,season.season)));seasons=catalogStore.seasons(parent.imdbId);return{source:tmdbApiKey()?'IMDb + TMDB (fr-FR)':'IMDb + TVmaze',seasons:seasons.map(season=>({season:season.season,episodes:season.episodes.map(episode=>({id:`imdb-episode-${episode.imdbId}`,season:season.season,episode:episode.episode,title:episode.titleFr||episode.title,overview:episode.overviewFr,still:episode.still,versions:0,progress:0,position:0,playable:false}))}))}});

function cacheStats(){try{const files=readdirSync(cacheDir);let bytes=0;for(const file of files){try{bytes+=statSync(join(cacheDir,file)).size}catch{/* fichier disparu entre-temps */}}return{entries:files.length,bytes}}catch{return{entries:0,bytes:0}}}
app.get('/api/cache',async()=>cacheStats());
app.delete('/api/cache',async()=>{let removed=0;try{for(const file of readdirSync(cacheDir)){try{rmSync(join(cacheDir,file));removed++}catch{/* ignore */}}}catch{/* dossier absent */}return{ok:true,removed}});
app.get('/api/storage',async()=>mediaRoots.filter(existsSync).map(root=>{const s=statfsSync(root);return{root,total:s.blocks*s.bsize,free:s.bfree*s.bsize,available:s.bavail*s.bsize,libraryBytes:loadDb().library.filter(x=>isWithin(root,x.path)).reduce((n,x)=>n+x.size,0)}}));
app.get('/api/settings',async()=>{const s=loadDb().settings;const key=tmdbApiKey();return{minFreeGb:s.minFreeGb??Number(process.env.SCENEROOT_MIN_FREE_GB??5),preferredQuality:s.preferredQuality??'1080p',preferredLanguages:s.preferredLanguages??['multi','truefrench','vff','french'],preferHdr:Boolean(s.preferHdr),setupComplete:Boolean(s.setupComplete),catalogSyncEnabled:s.catalogSyncEnabled??false,tmdb:{configured:Boolean(key),source:tmdbConfiguredByEnvironment?'environment':key?'settings':'none',maskedKey:key?maskSecret(key):undefined},envSources:envSources().map(source=>({id:source.id,name:source.name})),sources:(s.torznabSources??[]).map(maskSource)}});
app.put<{Body:Partial<Settings>&{tmdbApiKey?:string|null}}>('/api/settings',{schema:{body:{type:'object',properties:{minFreeGb:{type:'number',minimum:0,maximum:100000},preferredQuality:{type:'string'},preferredLanguages:{type:'array',items:{type:'string'}},preferHdr:{type:'boolean'},setupComplete:{type:'boolean'},catalogSyncEnabled:{type:'boolean'},tmdbApiKey:{type:['string','null'],maxLength:512}}}}},async(request,reply)=>{const db=loadDb();if(request.body.minFreeGb!==undefined)db.settings.minFreeGb=Number(request.body.minFreeGb);if(request.body.preferredQuality!==undefined)db.settings.preferredQuality=String(request.body.preferredQuality);if(Array.isArray(request.body.preferredLanguages))db.settings.preferredLanguages=request.body.preferredLanguages.map(String);if(request.body.preferHdr!==undefined)db.settings.preferHdr=Boolean(request.body.preferHdr);if(request.body.setupComplete!==undefined)db.settings.setupComplete=Boolean(request.body.setupComplete);if(request.body.catalogSyncEnabled!==undefined)db.settings.catalogSyncEnabled=Boolean(request.body.catalogSyncEnabled);if(request.body.tmdbApiKey!==undefined){if(tmdbConfiguredByEnvironment)return reply.code(409).send({error:'La clé TMDB est imposée par la variable d’environnement TMDB_API_KEY.'});const key=String(request.body.tmdbApiKey??'').trim();if(key){try{const response=await fetch(`https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(key)}`,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12_000)});if(!response.ok)return reply.code(400).send({error:'Clé API TMDB v3 invalide.'})}catch{return reply.code(502).send({error:'TMDB est injoignable, la clé n’a pas été enregistrée.'})}db.settings.tmdbApiKey=key;process.env.TMDB_API_KEY=key}else{delete db.settings.tmdbApiKey;delete process.env.TMDB_API_KEY}}saveDb(db);if(request.body.catalogSyncEnabled&&!catalogStore.count())void startImdbSync();return{ok:true}});
app.post<{Body:Partial<TorznabSource>}>('/api/sources',{schema:{body:{type:'object',required:['name','url'],properties:{name:{type:'string'},url:{type:'string'},apiKey:{type:'string'},categories:{type:'string'}}}}},async(request,reply)=>{const source=sanitizeSource(request.body,randomUUID());if(!source)return reply.code(400).send({error:'Source invalide : nom et URL http(s) requis'});const db=loadDb();db.settings.torznabSources=[...(db.settings.torznabSources??[]),source];saveDb(db);return reply.code(201).send(maskSource(source))});
app.delete<{Params:{id:string}}>('/api/sources/:id',async request=>{const db=loadDb();const list=db.settings.torznabSources??[];const before=list.length;db.settings.torznabSources=list.filter(source=>source.id!==request.params.id);saveDb(db);return{ok:true,removed:before-(db.settings.torznabSources?.length??0)}});
app.get<{Params:{id:string}}>('/api/media/:id', async (request, reply) => {
  const item=loadDb().library.find(x=>x.id===request.params.id); if(!item) return reply.code(404).send({error:'Média introuvable'});
  if(!isWithinRoots(item.path)) return reply.code(403).send({error:'Chemin non autorisé'});
  const total=statSync(item.path).size; const range=request.headers.range; const contentType=mimeFor(item.path);
  if(!range){reply.header('Content-Length',total).header('Accept-Ranges','bytes').header('Content-Type',contentType);return reply.send(createReadStream(item.path));}
  const [startRaw,endRaw]=range.replace(/bytes=/,'').split('-'); const start=Number(startRaw); const end=endRaw?Number(endRaw):Math.min(start+8*1024*1024,total-1);
  reply.code(206).headers({'Content-Range':`bytes ${start}-${end}/${total}`,'Accept-Ranges':'bytes','Content-Length':end-start+1,'Content-Type':contentType});
  return reply.send(createReadStream(item.path,{start,end}));
});
app.post<{Body:Rating}>('/api/ratings', {schema:{body:{type:'object',required:['profileId','mediaId','score'],properties:{profileId:{type:'string',minLength:1},mediaId:{type:'string',minLength:1},score:{type:'number',minimum:0,maximum:10},tags:{type:'array',items:{type:'string'}}}}}}, async request => { const db=loadDb(); const rating={...request.body,at:new Date().toISOString()}; db.ratings=db.ratings.filter(x=>!(x.profileId===rating.profileId&&x.mediaId===rating.mediaId));db.ratings.push(rating);saveDb(db);return rating; });
app.put<{Params:{profileId:string;mediaId:string};Body:{position:number;duration?:number}}>('/api/playback/:profileId/:mediaId', {schema:{body:{type:'object',required:['position'],properties:{position:{type:'number',minimum:0},duration:{type:'number',minimum:0}}}}}, async request=>{const db=loadDb();db.playback[`${request.params.profileId}:${request.params.mediaId}`]={position:Number(request.body.position)||0,duration:Number(request.body.duration)||0,updatedAt:new Date().toISOString()};saveDb(db);return{ok:true}});
app.get<{Params:{profileId:string}}>('/api/playback/:profileId',async request=>{const db=loadDb();const groups=groupLibrary(db.library);const prefix=`${request.params.profileId}:`;return Object.entries(db.playback).filter(([key])=>key.startsWith(prefix)).map(([key,value])=>{const entry=playbackEntry(value);if(!entry)return null;const mediaId=key.slice(prefix.length);const group=groupForMedia(groups,mediaId);if(!group)return null;const progress=entry.duration>0?entry.position/entry.duration:0;return{group,mediaId,position:entry.position,duration:entry.duration,progress,updatedAt:entry.updatedAt,completed:progress>=0.92}}).filter((entry): entry is NonNullable<typeof entry>=>entry!==null&&!entry.completed).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))});
app.get<{Params:{profileId:string}}>('/api/history/:profileId',async request=>{const db=loadDb();const groups=groupLibrary(db.library);const prefix=`${request.params.profileId}:`;const seen=new Map<string,{group:LibraryGroup;mediaId:string;progress:number;position:number;duration:number;updatedAt:string;completed:boolean;rating?:number;tags?:string[]}>();for(const[key,value]of Object.entries(db.playback)){if(!key.startsWith(prefix))continue;const entry=playbackEntry(value);if(!entry)continue;const mediaId=key.slice(prefix.length);const group=groupForMedia(groups,mediaId);if(!group)continue;const progress=entry.duration>0?entry.position/entry.duration:0;seen.set(group.id,{group,mediaId,progress,position:entry.position,duration:entry.duration,updatedAt:entry.updatedAt,completed:progress>=0.92})}for(const rating of db.ratings.filter(r=>r.profileId===request.params.profileId)){const group=groupForMedia(groups,rating.mediaId);if(!group)continue;const existing=seen.get(group.id);if(existing){existing.rating=rating.score;existing.tags=rating.tags;if(rating.at>existing.updatedAt)existing.updatedAt=rating.at}else seen.set(group.id,{group,mediaId:rating.mediaId,progress:0,position:0,duration:0,updatedAt:rating.at,completed:true,rating:rating.score,tags:rating.tags})}return[...seen.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))});
app.get<{Params:{profileId:string}}>('/api/ratings/:profileId',async request=>loadDb().ratings.filter(rating=>rating.profileId===request.params.profileId));
/**
 * Oublie une progression : sert au bouton « déjà vu » de la fiche, qui écrit
 * une progression complète et doit pouvoir être annulé.
 */
app.delete<{Params:{profileId:string;mediaId:string}}>('/api/playback/:profileId/:mediaId',async request=>{const db=loadDb();const key=`${request.params.profileId}:${request.params.mediaId}`;const existed=key in db.playback;delete db.playback[key];saveDb(db);return{ok:true,removed:existed}});
/** Supprime du cache les métadonnées associées à un identifiant. */
function purgeCacheFor(token:string){let removed=0;try{for(const file of readdirSync(cacheDir))if(file.includes(token)){try{rmSync(join(cacheDir,file));removed++}catch{/* fichier déjà parti */}}}catch{/* pas de cache */}return removed}
/**
 * Force la récupération des informations d'un média : métadonnées françaises du
 * catalogue, ou réidentification d'un titre de la médiathèque.
 */
app.post<{Params:{id:string}}>('/api/media/:id/refresh',async(request,reply)=>{
  const id=request.params.id;
  const imdb=/^imdb-(?:film|serie)-(tt\d+)$/.exec(id);
  if(imdb){
    const row=catalogStore.get(imdb[1]);
    if(!row)return reply.code(404).send({error:'Titre absent du catalogue local'});
    catalogStore.forgetLocalized(imdb[1]);
    purgeCacheFor(imdb[1]);
    const key=tmdbApiKey();
    try{await (key?enrichTmdbRow(catalogStore.get(imdb[1])??row,key):enrichWikipediaFallback(catalogStore.get(imdb[1])??row))}
    catch(error){app.log.warn({error,id},'Media refresh failed')}
    const fresh=catalogStore.get(imdb[1]);
    return{ok:true,scope:'catalogue',item:fresh?localCatalogItem(fresh):undefined};
  }
  const db=loadDb();
  const item=db.library.find(entry=>entry.id===id);
  if(item){
    // Toutes les versions du même titre partagent la fiche : on les réinitialise ensemble.
    for(const sibling of db.library.filter(entry=>entry.kind===item.kind&&entry.year===item.year&&comparableTitle(entry.title)===comparableTitle(item.title)))sibling.metadata=undefined;
    saveDb(db);
    await enrichLibrary(12);
    return{ok:true,scope:'médiathèque'};
  }
  return{ok:true,scope:'cache',removed:purgeCacheFor(id)};
});
app.get<{Params:{profileId:string}}>('/api/watched/:profileId',async request=>{const db=loadDb();const prefix=`${request.params.profileId}:`;const ids=new Set<string>();for(const[key,raw]of Object.entries(db.playback)){if(!key.startsWith(prefix))continue;const entry=playbackEntry(raw);if(entry&&entry.duration>0&&entry.position/entry.duration>=0.92)ids.add(key.slice(prefix.length))}for(const rating of db.ratings)if(rating.profileId===request.params.profileId)ids.add(rating.mediaId);return[...ids]});
app.get<{Params:{profileId:string}}>('/api/preferences/:profileId',async request=>{const db=loadDb();const pid=request.params.profileId;return{favorites:db.favorites.filter(entry=>entry.profileId===pid).map(entry=>entry.mediaId),hidden:db.hidden.filter(entry=>entry.profileId===pid).map(entry=>entry.mediaId)}});
app.put<{Params:{profileId:string;mediaId:string};Body:{favorite?:boolean;hidden?:boolean}}>('/api/preferences/:profileId/:mediaId',{schema:{body:{type:'object',properties:{favorite:{type:'boolean'},hidden:{type:'boolean'}}}}},async request=>{const db=loadDb();const{profileId,mediaId}=request.params;const{favorite,hidden}=request.body;if(favorite!==undefined){db.favorites=db.favorites.filter(entry=>!(entry.profileId===profileId&&entry.mediaId===mediaId));if(favorite)db.favorites.push({profileId,mediaId,at:new Date().toISOString()})}if(hidden!==undefined){db.hidden=db.hidden.filter(entry=>!(entry.profileId===profileId&&entry.mediaId===mediaId));if(hidden)db.hidden.push({profileId,mediaId,at:new Date().toISOString()})}saveDb(db);return{ok:true}});
app.get<{Params:{profileId:string}}>('/api/stats/:profileId',async request=>{const db=loadDb();const groups=groupLibrary(db.library);const prefix=`${request.params.profileId}:`;const genresOf=(mediaId:string)=>groupForMedia(groups,mediaId)?.metadata?.genres??[];const kindOf=(mediaId:string)=>groupForMedia(groups,mediaId)?.kind;const playback=Object.entries(db.playback).flatMap(([key,raw])=>{if(!key.startsWith(prefix))return[];const entry=playbackEntry(raw);if(!entry)return[];return[{mediaId:key.slice(prefix.length),progress:entry.duration>0?entry.position/entry.duration:0,updatedAt:entry.updatedAt}]});const ratings=db.ratings.filter(rating=>rating.profileId===request.params.profileId).map(rating=>({mediaId:rating.mediaId,score:rating.score,tags:rating.tags??[],at:rating.at}));return computeStats({ratings,playback,genresOf,kindOf})});
app.post<{Body:{profileIds:string[];candidates:Array<{id:string;genres:string[];ageRating?:number}>;preferUnseen?:boolean}}>('/api/recommendations/group',async request=>{
  const db=loadDb();const{profileIds,candidates}=request.body;const groups=groupLibrary(db.library);
  const genresOf=(mediaId:string)=>{const inCandidate=candidates.find(candidate=>candidate.id===mediaId);if(inCandidate?.genres?.length)return inCandidate.genres;return groupForMedia(groups,mediaId)?.metadata?.genres??[]};
  const playback=Object.entries(db.playback).flatMap(([key,raw])=>{const entry=playbackEntry(raw);if(!entry)return[];const sep=key.indexOf(':');return[{profileId:key.slice(0,sep),mediaId:key.slice(sep+1),progress:entry.duration>0?entry.position/entry.duration:0}]});
  const ageLimits=Object.fromEntries(db.profiles.map(profile=>[profile.id,profile.ageLimit]));
  return recommendGroup(profileIds,candidates,{ratings:db.ratings,playback,genresOf,ageLimits},request.body.preferUnseen!==false);
});
app.post<{Body:{ttl:'shutdown'|'24h'|'7d'|'permanent';ageLimit:number}}>('/api/guests',{schema:{body:{type:'object',required:['ttl'],properties:{ttl:{type:'string',enum:['shutdown','24h','7d','permanent']},ageLimit:{type:'number'}}}}},async request=>{
  const ageLimit=Math.max(0,Math.min(18,Number(request.body.ageLimit??18)));
  if(request.body.ttl==='permanent'){const db=loadDb();const profile:ProfileRecord={id:randomUUID(),name:'Invité',ageLimit,avatar:'I',accent:'#a78bfa',createdAt:new Date().toISOString()};db.profiles.push(profile);saveDb(db);return{id:profile.id,temporary:false,expiresAt:null,ageLimit,profile:true}}
  const expiresAt=request.body.ttl==='24h'?Date.now()+86400000:request.body.ttl==='7d'?Date.now()+604800000:null;
  const session:GuestSession={id:randomUUID(),ageLimit,createdAt:new Date().toISOString(),expiresAt,ephemeral:request.body.ttl==='shutdown'};
  const db=loadDb();db.guests.push(session);saveDb(db);
  return{id:session.id,temporary:true,expiresAt,ageLimit};
});
app.get<{Params:{id:string}}>('/api/guests/:id',async(request,reply)=>{purgeExpiredGuests();const session=loadDb().guests.find(guest=>guest.id===request.params.id);if(!session)return reply.code(404).send({error:'Session invité expirée ou introuvable'});return session});

function envSources():Source[]{const configured:Source[]=[];if(process.env.C411_API_KEY)configured.push({id:'c411',name:'C411',url:process.env.C411_TORZNAB_URL??'https://c411.org/api/torznab',apiKey:process.env.C411_API_KEY,categories:process.env.C411_CATEGORIES??'2000,5000'});try{configured.push(...JSON.parse(process.env.SCENEROOT_TORZNAB_SOURCES??'[]'))}catch{}return configured}
function sources():Source[]{return[...envSources(),...(loadDb().settings.torznabSources??[])]}
function xmlText(block:string,tag:string){const m=block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`,'i'));return m?.[1]?.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')}
function torznabAttr(block:string,name:string){return block.match(new RegExp(`name="${name}"[^>]*value="([^"]+)"`,'i'))?.[1]}
/**
 * Lien de téléchargement d'un <item>. L'aimant prime ; sinon on prend l'URL du
 * fichier .torrent, que les flux exposent indifféremment via <enclosure url>,
 * <enclosure_url url> ou <link>.
 */
function torznabLink(block:string){
  const magnet=torznabAttr(block,'magneturl');if(magnet?.startsWith('magnet:'))return magnet;
  const link=xmlText(block,'link');if(link?.startsWith('magnet:'))return link;
  const enclosure=block.match(/<enclosure(?:_url)?[^>]*\surl="([^"]+)"/i)?.[1];
  return decodeXml(enclosure)??link??xmlText(block,'guid');
}
/** Une URL dans un attribut XML arrive avec ses entités encodées (&amp;). */
function decodeXml(value?:string){return value?.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>')}
/**
 * Les trackers privés exigent la clé d'API sur l'URL de téléchargement comme
 * sur la recherche ; sans elle, la récupération du .torrent renvoie un 401.
 */
function withApiKey(link:string|undefined,endpoint:string,apiKey:string){
  if(!link||!apiKey||!/^https?:\/\//i.test(link))return link;
  try{
    const url=new URL(link);
    if(url.host!==new URL(endpoint).host)return link;
    for(const name of['apikey','apiKey','api_key','passkey'])if(url.searchParams.has(name))return link;
    url.searchParams.set('apikey',apiKey);
    return url.toString();
  }catch{return link}
}
function stripYear(q:string){return q.replace(/\s*\((?:19|20)\d{2}\)\s*$/,'').trim()}
/** Repli pour les trackers qui ignorent season/ep : « Série S01E02 ». */
function episodeQuery(q:string,season?:string,episode?:string){if(!season)return q;const s=String(season).padStart(2,'0');return episode?`${q} S${s}E${String(episode).padStart(2,'0')}`:`${q} S${s}`}
/** Un flux Torznab signale ses refus en HTTP 200 avec <error description="…">. */
function torznabError(xml:string){const match=xml.match(/<error[^>]*description="([^"]*)"/i);if(match)return match[1];if(/<error[^>]*code="/i.test(xml))return 'Erreur Torznab signalée par la source';return undefined}
type TorznabResult={source:string;title?:string;link?:string;size:number;seeders:number;published?:string};
// Les trackers privés répondent parfois en 15-20 s sur une recherche « froide » :
// 12 s expiraient avant la première réponse. Réglable via l'environnement.
// Délai par requête : assez long pour un tracker lent, assez court pour ne pas
// bloquer l'écran de recherche quand une source ne répond plus.
const torznabTimeout=Math.max(3000,Number(process.env.SCENEROOT_TORZNAB_TIMEOUT_MS)||12000);
app.get<{Querystring:{q:string;kind?:'movie'|'tv';season?:string;episode?:string}}>('/api/sources/search',async(request,reply)=>{
  if(!request.query.q)return reply.code(400).send({error:'Recherche manquante'});
  const q=stripYear(request.query.q);
  const type=request.query.kind==='tv'?'tvsearch':request.query.kind==='movie'?'movie':'search';
  const searchOne=async(source:Source)=>{
    const endpoint=normalizeTorznabUrl(source.url);
    const once=async(params:Record<string,string|undefined>)=>{const url=new URL(endpoint);url.searchParams.set('apikey',source.apiKey);for(const[key,value]of Object.entries(params))if(value)url.searchParams.set(key,value);try{const res=await fetch(url,{signal:AbortSignal.timeout(torznabTimeout),headers:{'User-Agent':'SceneRoot/0.1 (+https://github.com/sceneroot)'}});const xml=await res.text();return{status:res.status,ok:res.ok,blocks:xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)??[],error:res.ok?torznabError(xml):`HTTP ${res.status}`}}catch(error){return{status:0,ok:false,blocks:[] as string[],error:(error as Error).message}}};
    // Les trackers francophones n'implémentent pas tous t=movie/tvsearch, les
    // catégories, ni season/ep : on dégrade jusqu'à la requête la plus simple,
    // celle que l'on peut reproduire à la main dans un navigateur.
    const attempts:Array<{mode:string;params:Record<string,string|undefined>}>=[
      {mode:`t=${type}`,params:{t:type,q,cat:source.categories,season:request.query.season,ep:request.query.episode}},
      {mode:`t=${type} sans catégorie`,params:{t:type,q,season:request.query.season,ep:request.query.episode}},
      {mode:'t=search + épisode dans le titre',params:{t:'search',q:episodeQuery(q,request.query.season,request.query.episode)}},
      {mode:'t=search',params:{t:'search',q}},
    ].filter((entry,index,all)=>all.findIndex(other=>JSON.stringify(other.params)===JSON.stringify(entry.params))===index);
    let attempt=await once(attempts[0].params);let mode=attempts[0].mode;
    for(const next of attempts.slice(1)){
      // Une source injoignable le restera pour les replis : inutile d'attendre
      // quatre expirations de suite avant d'afficher le diagnostic.
      if(attempt.blocks.length||attempt.status===0)break;
      const candidate=await once(next.params);
      if(candidate.ok||!attempt.ok){attempt=candidate;mode=next.mode}
      if(attempt.blocks.length)break;
    }
    const rows=attempt.ok?attempt.blocks.map(block=>({source:source.name,title:xmlText(block,'title'),link:withApiKey(torznabLink(block),endpoint,source.apiKey),size:Number(torznabAttr(block,'size')??xmlText(block,'size')??0),seeders:Number(torznabAttr(block,'seeders')??0),published:xmlText(block,'pubDate')})):[];
    if(!attempt.ok)app.log.warn({source:source.name,status:attempt.status,url:endpoint},'Torznab source failed');
    return{rows,diagnostic:{source:source.name,status:attempt.status,count:attempt.blocks.length,error:attempt.error,mode}};
  };
  // Sources interrogées en parallèle : la recherche dure le temps de la plus
  // lente, non la somme de toutes.
  const settled=await Promise.all(sources().map(searchOne));
  const results:TorznabResult[]=settled.flatMap(entry=>entry.rows);
  const diagnostics=settled.map(entry=>entry.diagnostic);
  app.log.info({q,diagnostics},'Torznab search');
  reply.header('X-SceneRoot-Sources',JSON.stringify(diagnostics).slice(0,600));
  return results;
});

// Repli sur l'emplacement standard du démon local : une installation par défaut
// fonctionne même si TRANSMISSION_RPC_URL manque dans /etc/sceneroot.env.
const transmissionRpc=process.env.TRANSMISSION_RPC_URL||'http://127.0.0.1:9091/transmission/rpc';
async function transmission(method:string,args:Record<string,unknown>){const rpc=transmissionRpc;const auth=process.env.TRANSMISSION_RPC_AUTH;const headers:Record<string,string>={'Content-Type':'application/json'};if(auth)headers.Authorization=`Basic ${Buffer.from(auth).toString('base64')}`;const body=JSON.stringify({method,arguments:args});let response=await fetch(rpc,{method:'POST',headers,body,signal:AbortSignal.timeout(10000)});if(response.status===409){headers['X-Transmission-Session-Id']=response.headers.get('x-transmission-session-id')??'';response=await fetch(rpc,{method:'POST',headers,body,signal:AbortSignal.timeout(10000)})}return response}
/** Traduit un refus du RPC en consigne exploitable depuis la TV. */
function transmissionHttpError(status:number){if(status===401)return 'Transmission exige des identifiants RPC : lancez scripts/doctor.sh --fix sur le Raspberry Pi.';if(status===403)return 'Transmission refuse cette adresse : ajoutez-la à rpc-whitelist dans /etc/transmission-daemon/settings.json.';return `Transmission a répondu HTTP ${status}.`}
/** Transforme une panne réseau en consigne exploitable depuis la TV. */
function transmissionError(error:unknown){const message=(error as Error).message??'';if(/fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|timeout|abort/i.test(message))return `Le démon Transmission ne répond pas sur ${transmissionRpc}. Vérifiez qu'il tourne (sudo systemctl enable --now transmission-daemon) puis relancez SceneRoot.`;return message||'Transmission indisponible'}
/**
 * Prépare l'argument de torrent-add. Un aimant part tel quel ; une URL .torrent
 * est récupérée ici plutôt que par Transmission, qui n'a ni la clé d'API ni le
 * User-Agent attendus par les trackers privés et échouait silencieusement.
 */
async function torrentPayload(link:string):Promise<{filename:string}|{metainfo:string}|{error:string}>{
  if(link.startsWith('magnet:'))return{filename:link};
  try{
    const response=await fetch(link,{redirect:'follow',signal:AbortSignal.timeout(20000),headers:{'User-Agent':'SceneRoot/0.1 (+https://github.com/sceneroot)',Accept:'application/x-bittorrent,*/*'}});
    if(!response.ok)return{error:`La source a refusé le fichier .torrent (HTTP ${response.status}).`};
    const buffer=Buffer.from(await response.arrayBuffer());
    // Un tracker qui redirige vers sa page de connexion renvoie du HTML en 200 :
    // un torrent commence toujours par un dictionnaire bencodé.
    if(buffer.subarray(0,1).toString()!=='d')return{error:'La source a renvoyé une page web au lieu d’un fichier .torrent : vérifiez la clé d’API de cette source.'};
    return{metainfo:buffer.toString('base64')};
  }catch(error){return{error:`Téléchargement du .torrent impossible : ${(error as Error).message}`}}
}
function ensureTransmissionSession(){return transmission('session-set',{'download-queue-enabled':true,'download-queue-size':3,'download-dir':downloadDir}).catch(()=>{/* Transmission non configuré : appliqué dès qu'il est disponible */})}
app.post<{Body:{magnet:string;expectedBytes?:number}}>('/api/downloads', {schema:{body:{type:'object',required:['magnet'],properties:{magnet:{type:'string',minLength:8},expectedBytes:{type:'number',minimum:0}}}}}, async (request,reply)=>{
  const source=request.body.magnet; if(!source||!/^(magnet:\?|https?:\/\/)/i.test(source)) return reply.code(400).send({error:'Lien de téléchargement invalide (magnet ou URL .torrent attendu)'});
  const targetRoot=mediaRoots.find(existsSync)??dataDir;const disk=statfsSync(targetRoot);const available=disk.bavail*disk.bsize;const gb=(n:number)=>`${(n/1024**3).toFixed(1)} Go`;const reserve=Number(loadDb().settings.minFreeGb??process.env.SCENEROOT_MIN_FREE_GB??5)*1024**3;if(available-(request.body.expectedBytes??0)<reserve)return reply.code(507).send({error:`Espace disque insuffisant sur ${targetRoot} : ${gb(available)} libres, réserve de ${gb(reserve)} exigée. Baissez la réserve dans les réglages.`,available,reserve,expectedBytes:request.body.expectedBytes??0});
  try{
    await ensureTransmissionSession();
    const added=await torrentPayload(source);
    if('error' in added)return reply.code(502).send({error:added.error});
    const response=await transmission('torrent-add',{...added,'download-dir':downloadDir,paused:false});
    const payload=await response.json().catch(()=>({})) as {result?:string};
    if(!response.ok)return reply.code(502).send({error:`Transmission a refusé la requête (HTTP ${response.status})`});
    // Transmission répond en HTTP 200 même lorsqu'il rejette le torrent : sans
    // cette vérification, l'interface annonçait « Envoyé » pour rien.
    if(payload.result&&payload.result!=='success')return reply.code(502).send({error:`Transmission : ${payload.result}`});
    return reply.send(payload);
  }catch(error){return reply.code((error as {statusCode?:number}).statusCode??503).send({error:transmissionError(error)})}
});
app.get('/api/downloads', async (_request,reply)=>{try{const response=await transmission('torrent-get',{fields:['id','name','percentDone','rateDownload','rateUpload','status','totalSize','sizeWhenDone','eta','errorString','downloadDir','peersConnected','queuePosition']});if(!response.ok)return reply.code(502).send({error:transmissionHttpError(response.status)});const payload=await response.json() as {arguments?:{torrents?:Array<{queuePosition?:number}>}};const torrents=payload.arguments?.torrents??[];return[...torrents].sort((a,b)=>(a.queuePosition??0)-(b.queuePosition??0))}catch(error){return reply.code((error as {statusCode?:number}).statusCode??503).send({error:transmissionError(error)})}});
const queueMethods:Record<string,string>={start:'torrent-start',stop:'torrent-stop',remove:'torrent-remove','queue-top':'queue-move-top','queue-up':'queue-move-up','queue-down':'queue-move-down','queue-bottom':'queue-move-bottom'};
app.post<{Params:{id:string};Body:{action:keyof typeof queueMethods;deleteData?:boolean}}>('/api/downloads/:id/control', {schema:{body:{type:'object',required:['action'],properties:{action:{type:'string',enum:['start','stop','remove','queue-top','queue-up','queue-down','queue-bottom']},deleteData:{type:'boolean'}}}}}, async (request,reply)=>{const id=Number(request.params.id);if(!Number.isFinite(id))return reply.code(400).send({error:'Identifiant invalide'});const method=queueMethods[request.body.action];if(!method)return reply.code(400).send({error:'Action inconnue'});try{const args:Record<string,unknown>=request.body.action==='remove'?{ids:[id],'delete-local-data':Boolean(request.body.deleteData)}:{ids:[id]};const response=await transmission(method,args);if(!response.ok)return reply.code(502).send({error:transmissionHttpError(response.status)});return{ok:true}}catch(error){return reply.code((error as {statusCode?:number}).statusCode??503).send({error:transmissionError(error)})}});
app.post<{Body:RankPrefs&{kind?:'film'|'serie';candidates:RankCandidate[]}}>('/api/downloads/rank',async request=>rankDownloads(request.body.candidates,request.body));
/**
 * Fiche du média correspondant à un téléchargement terminé. Le fichier vient
 * d'arriver : on indexe la médiathèque si besoin pour que la page existe.
 */
app.get<{Params:{id:string}}>('/api/downloads/:id/media',async(request,reply)=>{
  const id=Number(request.params.id);if(!Number.isFinite(id))return reply.code(400).send({error:'Identifiant invalide'});
  try{
    const response=await transmission('torrent-get',{ids:[id],fields:['name','downloadDir','files','percentDone']});
    if(!response.ok)return reply.code(502).send({error:transmissionHttpError(response.status)});
    const torrent=(await response.json() as {arguments?:{torrents?:Array<{downloadDir:string;percentDone:number;files?:Array<{name:string;length:number}>}>}}).arguments?.torrents?.[0];
    if(!torrent)return reply.code(404).send({error:'Téléchargement introuvable'});
    const videos=(torrent.files??[]).filter(file=>videoExt.has(extname(file.name).toLowerCase()));
    if(!videos.length)return reply.code(409).send({error:'Aucun fichier vidéo dans ce téléchargement'});
    const file=videos.reduce((best,candidate)=>candidate.length>best.length?candidate:best);
    const path=resolve(join(torrent.downloadDir,file.name));
    if(!isWithinRoots(path))return reply.code(403).send({error:'Le dossier de téléchargement n’est pas dans une racine média autorisée'});
    const mediaId=slug(path);
    if(!loadDb().library.some(item=>item.id===mediaId))await scanLibrary();
    return{mediaId,name:file.name,indexed:loadDb().library.some(item=>item.id===mediaId)};
  }catch(error){return reply.code((error as {statusCode?:number}).statusCode??503).send({error:transmissionError(error)})}
});
app.post<{Params:{id:string};Body:{startPosition?:number}}>('/api/downloads/:id/play',async(request,reply)=>{const id=Number(request.params.id);if(!Number.isFinite(id))return reply.code(400).send({error:'Identifiant invalide'});try{await transmission('torrent-set',{ids:[id],sequentialDownload:true}).catch(()=>{/* séquentiel non supporté (Transmission < 4.1) */});const response=await transmission('torrent-get',{ids:[id],fields:['id','name','downloadDir','percentDone','files']});if(!response.ok)return reply.code(502).send({error:transmissionHttpError(response.status)});const torrent=(await response.json() as {arguments?:{torrents?:Array<{name:string;downloadDir:string;files?:Array<{name:string;length:number;bytesCompleted:number}>}>}}).arguments?.torrents?.[0];if(!torrent)return reply.code(404).send({error:'Téléchargement introuvable'});const videos=(torrent.files??[]).filter(file=>videoExt.has(extname(file.name).toLowerCase()));if(!videos.length)return reply.code(409).send({error:'Aucun fichier vidéo dans ce téléchargement'});const file=videos.reduce((best,candidate)=>candidate.length>best.length?candidate:best);const path=resolve(join(torrent.downloadDir,file.name));if(!isWithinRoots(path))return reply.code(403).send({error:'Le dossier de téléchargement n’est pas dans une racine média autorisée'});const buffered=file.length>0?file.bytesCompleted/file.length:0;const mediaId=slug(path);const complete=file.bytesCompleted>=file.length&&file.length>0;const ready=existsSync(path)&&(complete||buffered>=0.02);if(!ready)return{ready:false,buffered,name:file.name,mediaId};spawnMpv(path,Number(request.body?.startPosition)||0);return{ready:true,engine:'mpv',mediaId,buffered,name:file.name}}catch(error){return reply.code((error as {statusCode?:number}).statusCode??503).send({error:transmissionError(error)})}});
app.get('/api/cec/status',async()=>{
  const adapter=['/dev/cec0','/dev/cec1','/dev/cec2','/dev/cec3'].find(existsSync)??null;
  let bridgeActive=false;
  if(process.platform==='linux')try{await execFileAsync('systemctl',['is-active','--quiet','sceneroot-cec.service'],{timeout:2000});bridgeActive=true}catch{/* service absent ou arrêté */}
  return{available:Boolean(adapter),bridgeActive,adapter};
});
app.post('/api/cec/:action', {schema:{params:{type:'object',required:['action'],properties:{action:{type:'string',enum:['active','standby','scan']}}}}}, async (request,reply)=>{
  const action=(request.params as {action:string}).action; const commands:Record<string,string>={active:'as',standby:'tx 10:36',scan:'scan'}; if(!commands[action])return reply.code(400).send({error:'Action CEC inconnue'});
  const child=spawn('cec-client',commands[action].split(' '),{stdio:'ignore'}); child.on('error',()=>{}); return {ok:true};
});
app.post<{Params:{id:string};Body:{startPosition?:number}}>('/api/player/:id/play',async(request,reply)=>{const item=loadDb().library.find(x=>x.id===request.params.id);if(!item)return reply.code(404).send({error:'Média introuvable'});if(!isWithinRoots(item.path))return reply.code(403).send({error:'Chemin non autorisé'});spawnMpv(item.path,Number(request.body?.startPosition)||0);const next=nextEpisodeOf(item.id);if(next&&isWithinRoots(next.path))warmFile(next.path);return{ok:true,engine:'mpv',mediaId:item.id,nextMediaId:next?.id??null,nextTitle:next?.title??null}});
type MpvTrack={id:number;type:string;title?:string;lang?:string;selected?:boolean;'external-filename'?:string};
app.get('/api/player/status',async(_request,reply)=>{if(!mpvProcess)return{engine:'mpv' as const,running:false};try{const[position,duration,pause,tracks,title,path]=await Promise.all([mpvGet<number>('time-pos'),mpvGet<number>('duration'),mpvGet<boolean>('pause'),mpvGet<MpvTrack[]>('track-list'),mpvGet<string>('media-title'),mpvGet<string>('path')]);const mapTracks=(type:string)=>(tracks??[]).filter(track=>track.type===type).map(track=>({id:track.id,label:track.title||track.lang||(track['external-filename']?'Fichier externe':`Piste ${track.id}`),lang:track.lang,selected:Boolean(track.selected)}));return{engine:'mpv' as const,running:true,playing:pause===false,position:position??0,duration:duration??0,title:title??undefined,path:path??undefined,audioTracks:mapTracks('audio'),subtitleTracks:mapTracks('sub')}}catch{return reply.code(503).send({engine:'mpv',running:false,error:'Lecteur mpv indisponible'})}});
app.post<{Body:{command:string;value?:number|string}}>('/api/player/control',{schema:{body:{type:'object',required:['command'],properties:{command:{type:'string',enum:['pause','play','stop','seek-forward','seek-back','audio-next','subtitle-next','seek-to','set-audio','set-subtitle']},value:{type:['number','string']}}}}},async(request,reply)=>{const{command,value}=request.body;let mpvCmd:unknown[]|undefined={pause:['cycle','pause'],play:['set_property','pause',false],stop:['quit'],'seek-forward':['seek',30,'relative'],'seek-back':['seek',-10,'relative'],'audio-next':['cycle','audio'],'subtitle-next':['cycle','sub']}[command];if(command==='seek-to'&&typeof value==='number')mpvCmd=['seek',value,'absolute'];else if(command==='set-audio')mpvCmd=['set_property','aid',value??'auto'];else if(command==='set-subtitle')mpvCmd=['set_property','sid',value===undefined||value==='no'?'no':value];if(!mpvCmd)return reply.code(400).send({error:'Commande inconnue'});try{await mpvCommand(mpvCmd);return{ok:true}}catch{return reply.code(503).send({error:'Lecteur mpv indisponible'})}});

function localCatalogItem(row:CatalogRow):CatalogItem{
  const seed=Number(row.imdbId.replace(/\D/g,''))||1;const kind=row.kind==='serie'?'serie':'film';
  return{id:`imdb-${kind}-${row.imdbId}`,title:row.titleFr||row.primaryTitle,kind,year:row.startYear??0,releaseDate:row.startYear?`${row.startYear}-01-01`:undefined,genres:row.genres,duration:durationLabel(row.runtimeMinutes,kind),rating:row.rating,quality:'1080p',description:row.overviewFr||'Résumé français en cours d’enrichissement.',palette:palette(seed),symbol:kind==='serie'?'▥':'◉',art:row.backdrop||row.poster,source:row.metadataSource==='tmdb'?'tmdb':row.metadataSource==='wikipedia'?'wikipedia':'imdb',sourceUrl:row.tmdbId?`https://www.themoviedb.org/${kind==='serie'?'tv':'movie'}/${row.tmdbId}`:`https://www.imdb.com/title/${row.imdbId}/`,informationSource:row.metadataSource==='tmdb'?'TMDB (fr-FR) + IMDb':row.metadataSource==='wikipedia'?'Wikipédia FR (secours) + IMDb':'IMDb Datasets'};
}

async function enrichTmdbRow(row:CatalogRow,key:string){
  if(row.metadataSource==='tmdb'&&row.metadataCheckedAt)return;
  const path=row.kind==='serie'?'tv':'movie';const url=new URL(`https://api.themoviedb.org/3/find/${row.imdbId}`);url.searchParams.set('api_key',key);url.searchParams.set('language','fr-FR');url.searchParams.set('external_source','imdb_id');
  try{const result=await cachedJson<{movie_results?:Record<string,unknown>[];tv_results?:Record<string,unknown>[]}>(`tmdb-find-${row.imdbId}`,url.toString(),30*24*60*60*1000);const hit=(path==='tv'?result.data.tv_results:result.data.movie_results)?.[0];if(!hit){catalogStore.upsertLocalized({imdbId:row.imdbId,source:'none'});return}const normalized=normalizeTmdb(hit,path);catalogStore.upsertLocalized({imdbId:row.imdbId,titleFr:normalized.title,overviewFr:normalized.overview,poster:normalized.poster,backdrop:normalized.backdrop,tmdbId:Number(normalized.providerId),source:'tmdb'})}catch(error){app.log.debug({error,imdbId:row.imdbId},'TMDB lazy enrichment failed')}
}

async function enrichWikipediaFallback(row:CatalogRow){
  if(row.metadataCheckedAt)return;const url=new URL('https://fr.wikipedia.org/w/api.php');url.searchParams.set('action','query');url.searchParams.set('generator','search');url.searchParams.set('gsrsearch',`intitle:"${row.primaryTitle}" ${row.kind==='serie'?'série télévisée':'film'}${row.startYear?` ${row.startYear}`:''}`);url.searchParams.set('gsrnamespace','0');url.searchParams.set('gsrlimit','1');url.searchParams.set('prop','extracts|pageimages|info');url.searchParams.set('inprop','url');url.searchParams.set('exintro','1');url.searchParams.set('explaintext','1');url.searchParams.set('exchars','650');url.searchParams.set('piprop','thumbnail');url.searchParams.set('pithumbsize','780');url.searchParams.set('format','json');url.searchParams.set('formatversion','2');
  try{const result=await cachedJson<WikipediaResponse>(`wikipedia-rescue-${row.imdbId}`,url.toString(),30*24*60*60*1000);const page=Object.values(result.data.query?.pages??{})[0];catalogStore.upsertLocalized(page?{imdbId:row.imdbId,titleFr:page.title.replace(/\s*\([^)]*\)$/,''),overviewFr:page.extract,poster:page.thumbnail?.source,source:'wikipedia'}:{imdbId:row.imdbId,source:'none'})}catch(error){app.log.debug({error,imdbId:row.imdbId},'Wikipedia rescue summary failed')}
}

async function enrichWikidataIds(rows:CatalogRow[]){
  const staleBefore=Date.now()-90*24*60*60*1000;const missing=rows.filter(row=>!row.wikidataCheckedAt||Date.parse(row.wikidataCheckedAt)<staleBefore).map(row=>row.imdbId);if(!missing.length)return;const values=missing.map(id=>`"${id}"`).join(' ');const query=`SELECT ?item ?imdb ?tmdbMovie ?tmdbTv WHERE { VALUES ?imdb { ${values} } ?item wdt:P345 ?imdb. OPTIONAL { ?item wdt:P4947 ?tmdbMovie. } OPTIONAL { ?item wdt:P4983 ?tmdbTv. } }`;const url=new URL('https://query.wikidata.org/sparql');url.searchParams.set('query',query);url.searchParams.set('format','json');
  try{const response=await fetch(url,{headers:{Accept:'application/sparql-results+json','User-Agent':'SceneRoot/0.1'},signal:AbortSignal.timeout(12_000)});if(!response.ok)return;const data=await response.json() as {results?:{bindings?:Array<{item?:{value?:string};imdb?:{value?:string};tmdbMovie?:{value?:string};tmdbTv?:{value?:string}}>}};const found=new Set<string>();for(const binding of data.results?.bindings??[]){const imdbId=binding.imdb?.value;const qid=binding.item?.value?.split('/').pop();if(imdbId&&qid){found.add(imdbId);catalogStore.upsertLocalized({imdbId,wikidataId:qid,tmdbId:Number(binding.tmdbMovie?.value??binding.tmdbTv?.value)||undefined,source:'wikidata'})}}for(const imdbId of missing)if(!found.has(imdbId))catalogStore.upsertLocalized({imdbId,source:'wikidata'})}catch(error){app.log.debug({error},'Wikidata identifier mapping failed')}
}

async function localCatalog(page:number,limit:number,kind?:'film'|'serie',query='',genre='',recent=false):Promise<ProviderPage>{
  let result=catalogStore.query({kind,query,genre,page,limit,sort:recent?'recent':'popular'});const key=tmdbApiKey();const staleBefore=Date.now()-30*24*60*60*1000;const needs=result.items.filter(row=>key?row.metadataSource!=='tmdb'||!row.metadataCheckedAt||Date.parse(row.metadataCheckedAt)<staleBefore:!row.metadataCheckedAt||Date.parse(row.metadataCheckedAt)<staleBefore);
  if(needs.length){await Promise.allSettled(needs.slice(0,Math.min(8,limit)).map(row=>key?enrichTmdbRow(row,key):enrichWikipediaFallback(row)));result=catalogStore.query({kind,query,genre,page,limit,sort:recent?'recent':'popular'})}void enrichWikidataIds(result.items);
  return{items:result.items.map(localCatalogItem),hasMore:page*limit<result.total,source:key?'IMDb local + TMDB français':'IMDb local + Wikipédia (secours)',cachedAt:new Date().toISOString(),cacheState:'local',totalItems:result.total};
}

app.get('/admin',async(_request,reply)=>reply.redirect('/admin.html'));
const dist=resolve('./dist');
if(existsSync(dist)){
  // Les pages HTML ne doivent jamais être servies depuis le cache : après une
  // mise à jour, Chromium en kiosque continuait sinon de charger l'ancien
  // index.html, donc l'ancienne interface. Les fichiers versionnés par empreinte
  // restent, eux, cachés durablement.
  app.addHook('onSend',async(request,reply)=>{
    if(request.url.startsWith('/api/'))return;
    if(/^\/assets\//.test(request.url))reply.header('Cache-Control','public, max-age=31536000, immutable');
    else reply.header('Cache-Control','no-cache, must-revalidate');
  });
  await app.register(staticPlugin,{root:dist});
  app.setNotFoundHandler((request,reply)=>request.url.startsWith('/api/')?reply.code(404).send({error:'Route inconnue'}):reply.header('Cache-Control','no-cache, must-revalidate').sendFile('index.html'));
}
await app.listen({port,host:'0.0.0.0'});
try{purgeExpiredGuests(true)}catch(error){app.log.warn({error},'Guest purge at startup failed')}
writeMpvInput();
void ensureTransmissionSession();
setInterval(()=>{try{purgeExpiredGuests()}catch(error){app.log.warn({error},'Guest purge failed')}},5*60_000).unref();
function warmRecentCatalog(){void catalogFor('film',1,12,true).catch(()=>{});void catalogFor('serie',1,12,true).catch(()=>{})}
warmRecentCatalog();
setInterval(warmRecentCatalog,24*60*60*1000).unref();
function scheduleImdbCatalog(){const settings=loadDb().settings;if(!settings.catalogSyncEnabled)return;const last=lastCatalogSync();if(!last||Date.now()-Date.parse(last)>catalogSyncIntervalMs)void startImdbSync()}
scheduleImdbCatalog();
// Vérification horaire : la synchronisation part dès que les 24 h sont écoulées,
// même si le Raspberry Pi était éteint au moment prévu.
setInterval(scheduleImdbCatalog,60*60*1000).unref();
if(process.env.SCENEROOT_WATCH!=='false'){scanLibrary().catch(error=>app.log.warn({error},'Initial media scan failed'));setInterval(()=>scanLibrary().catch(error=>app.log.warn({error},'Background media scan failed')),60_000).unref()}
