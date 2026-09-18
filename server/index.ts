import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import { createReadStream, existsSync, mkdirSync, readFileSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, join, parse, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

type Rating = { profileId: string; mediaId: string; score: number; tags: string[]; at: string };
type Db = { profiles: unknown[]; library: LibraryItem[]; ratings: Rating[]; playback: Record<string, number> };
type LibraryItem = { id: string; title: string; path: string; kind: 'film'|'serie'; year?: number; season?:number; episode?:number; size: number; addedAt: string; technical?: Record<string,unknown> };
type Source = { id:string; name:string; url:string; apiKey:string; categories?:string };

const app = Fastify({ logger: true });
const port = Number(process.env.SCENEROOT_PORT ?? 4174);
const dataDir = resolve(process.env.SCENEROOT_DATA ?? './data');
const dbPath = join(dataDir, 'sceneroot.json');
const mediaRoots = (process.env.SCENEROOT_MEDIA ?? '/mnt/media').split(',').map(x => resolve(x.trim()));
const videoExt = new Set(['.mp4','.mkv','.webm','.avi','.mov','.m4v']);
const execFileAsync=promisify(execFile);
let mpvProcess: ReturnType<typeof spawn> | null = null;
mkdirSync(dataDir, { recursive: true });

function loadDb(): Db {
  if (!existsSync(dbPath)) return { profiles: [], library: [], ratings: [], playback: {} };
  try { return JSON.parse(readFileSync(dbPath, 'utf8')) as Db; } catch { return { profiles: [], library: [], ratings: [], playback: {} }; }
}
function saveDb(db: Db) { writeFileSync(dbPath, JSON.stringify(db, null, 2)); }
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
  const library: LibraryItem[]=[]; for(const path of files){const info=statSync(path);const match=parse(path).name.match(/\b((?:19|20)\d{2})\b/);const ep=episodeFromFile(path);library.push({id:slug(path),title:titleFromFile(path),path,kind:ep?'serie':'film',year:match?Number(match[1]):undefined,...(ep??{}),size:info.size,addedAt:info.birthtime.toISOString(),technical:await probe(path)})}
  const db=loadDb(); db.library=library; saveDb(db); return library;
}

await app.register(cors, { origin: true });
app.get('/api/health', async () => ({ ok:true, version:'0.1.0', mediaRoots }));
app.get('/api/library', async () => loadDb().library.map(({path,...item})=>item));
app.get('/api/library/grouped', async () => {const grouped=new Map<string,{title:string;year?:number;kind:string;versions:unknown[]}>();for(const {path,...item} of loadDb().library){const key=`${item.title}:${item.year??''}`;const group=grouped.get(key)??{title:item.title,year:item.year,kind:item.kind,versions:[]};group.versions.push(item);grouped.set(key,group)}return[...grouped.values()]});
app.post('/api/library/scan', async () => ({ items: await scanLibrary() }));
app.get('/api/storage',async()=>mediaRoots.filter(existsSync).map(root=>{const s=statfsSync(root);return{root,total:s.blocks*s.bsize,free:s.bfree*s.bsize,available:s.bavail*s.bsize,libraryBytes:loadDb().library.filter(x=>x.path.startsWith(root)).reduce((n,x)=>n+x.size,0)}}));
app.get<{Params:{id:string}}>('/api/media/:id', async (request, reply) => {
  const item=loadDb().library.find(x=>x.id===request.params.id); if(!item) return reply.code(404).send({error:'Média introuvable'});
  const root=mediaRoots.find(r=>item.path.startsWith(r)); if(!root) return reply.code(403).send({error:'Chemin non autorisé'});
  const total=statSync(item.path).size; const range=request.headers.range;
  if(!range){reply.header('Content-Length',total).header('Content-Type','video/mp4');return reply.send(createReadStream(item.path));}
  const [startRaw,endRaw]=range.replace(/bytes=/,'').split('-'); const start=Number(startRaw); const end=endRaw?Number(endRaw):Math.min(start+8*1024*1024,total-1);
  reply.code(206).headers({'Content-Range':`bytes ${start}-${end}/${total}`,'Accept-Ranges':'bytes','Content-Length':end-start+1,'Content-Type':'video/mp4'});
  return reply.send(createReadStream(item.path,{start,end}));
});
app.post<{Body:Rating}>('/api/ratings', async request => { const db=loadDb(); const rating={...request.body,at:new Date().toISOString()}; db.ratings=db.ratings.filter(x=>!(x.profileId===rating.profileId&&x.mediaId===rating.mediaId));db.ratings.push(rating);saveDb(db);return rating; });
app.put<{Params:{profileId:string;mediaId:string};Body:{position:number}}>('/api/playback/:profileId/:mediaId', async request=>{const db=loadDb();db.playback[`${request.params.profileId}:${request.params.mediaId}`]=request.body.position;saveDb(db);return{ok:true}});
app.post<{Body:{profileIds:string[];candidates:Array<{id:string;genres:string[];ageRating?:number}>}}>('/api/recommendations/group',async request=>{const db=loadDb();const {profileIds,candidates}=request.body;return candidates.map(candidate=>{const affinities=profileIds.map(profileId=>{const rs=db.ratings.filter(r=>r.profileId===profileId);const own=rs.find(r=>r.mediaId===candidate.id);return own?own.score*10:70});const average=affinities.reduce((a,b)=>a+b,0)/Math.max(1,affinities.length);const disagreement=Math.max(...affinities)-Math.min(...affinities);return{id:candidate.id,score:Math.round(average-.42*disagreement),average,disagreement,affinities}}).sort((a,b)=>b.score-a.score)});
app.post<{Body:{ttl:'shutdown'|'24h'|'7d'|'permanent';ageLimit:number}}>('/api/guests',async request=>({id:`guest-${Date.now()}`,temporary:request.body.ttl!=='permanent',expiresAt:request.body.ttl==='24h'?Date.now()+86400000:request.body.ttl==='7d'?Date.now()+604800000:null,ageLimit:request.body.ageLimit}));

function sources():Source[]{const configured:Source[]=[];if(process.env.C411_API_KEY)configured.push({id:'c411',name:'C411',url:'https://c411.org/api/torznab',apiKey:process.env.C411_API_KEY,categories:'2000,5000'});try{configured.push(...JSON.parse(process.env.SCENEROOT_TORZNAB_SOURCES??'[]'))}catch{}return configured}
function xmlText(block:string,tag:string){const m=block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`,'i'));return m?.[1]?.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')}
app.get<{Querystring:{q:string;kind?:'movie'|'tv';season?:string;episode?:string}}>('/api/sources/search',async(request,reply)=>{if(!request.query.q)return reply.code(400).send({error:'Recherche manquante'});const results=[];for(const source of sources()){const url=new URL(source.url);url.searchParams.set('apikey',source.apiKey);url.searchParams.set('t',request.query.kind==='tv'?'tvsearch':request.query.kind==='movie'?'movie':'search');url.searchParams.set('q',request.query.q);if(source.categories)url.searchParams.set('cat',source.categories);if(request.query.season)url.searchParams.set('season',request.query.season);if(request.query.episode)url.searchParams.set('ep',request.query.episode);try{const res=await fetch(url,{signal:AbortSignal.timeout(10000)});const xml=await res.text();for(const block of xml.match(/<item>[\s\S]*?<\/item>/gi)??[]){results.push({source:source.name,title:xmlText(block,'title'),link:xmlText(block,'link')??xmlText(block,'guid'),size:Number(xmlText(block,'size')??0),seeders:Number(block.match(/name="seeders"[^>]*value="(\d+)"/i)?.[1]??0),published:xmlText(block,'pubDate')})}}catch(error){app.log.warn({source:source.name,error},'Torznab source failed')}}return results});

app.post<{Body:{magnet:string;expectedBytes?:number}}>('/api/downloads', async (request,reply)=>{
  if(!request.body.magnet?.startsWith('magnet:?')) return reply.code(400).send({error:'Lien magnet invalide'});
  const targetRoot=mediaRoots.find(existsSync)??dataDir;const disk=statfsSync(targetRoot);const available=disk.bavail*disk.bsize;const reserve=Number(process.env.SCENEROOT_MIN_FREE_GB??50)*1024**3;if(available-(request.body.expectedBytes??0)<reserve)return reply.code(507).send({error:'Espace disque insuffisant',available,reserve,expectedBytes:request.body.expectedBytes??0});
  const rpc=process.env.TRANSMISSION_RPC_URL; if(!rpc) return reply.code(503).send({error:'Configurez TRANSMISSION_RPC_URL'});
  const auth=process.env.TRANSMISSION_RPC_AUTH; const headers:Record<string,string>={'Content-Type':'application/json'}; if(auth)headers.Authorization=`Basic ${Buffer.from(auth).toString('base64')}`;
  let response=await fetch(rpc,{method:'POST',headers,body:JSON.stringify({method:'torrent-add',arguments:{filename:request.body.magnet}})});
  if(response.status===409){headers['X-Transmission-Session-Id']=response.headers.get('x-transmission-session-id')??'';response=await fetch(rpc,{method:'POST',headers,body:JSON.stringify({method:'torrent-add',arguments:{filename:request.body.magnet}})});}
  return reply.code(response.ok?200:502).send(await response.json());
});
app.post<{Body:{kind:'film'|'serie';preferredQuality?:string;preferredLanguages?:string[];preferHdr?:boolean;maxBytes?:number;candidates:Array<{id:string;title:string;quality:string;languages:string[];hdr:boolean;size:number;seeders:number;codec?:string}>}}>('/api/downloads/rank',async request=>request.body.candidates.map(candidate=>{let score=Math.min(30,Math.log2(candidate.seeders+1)*5);if(candidate.quality===request.body.preferredQuality)score+=28;if(request.body.preferredLanguages?.some(l=>candidate.languages.includes(l)))score+=22;if(request.body.preferHdr&&candidate.hdr)score+=10;if(request.body.maxBytes&&candidate.size>request.body.maxBytes)score-=35;if(/hevc|h265/i.test(candidate.codec??''))score+=6;return{...candidate,compatibilityScore:Math.round(score)}}).sort((a,b)=>b.compatibilityScore-a.compatibilityScore));
app.post('/api/cec/:action', async (request,reply)=>{
  const action=(request.params as {action:string}).action; const commands:Record<string,string>={active:'as',standby:'tx 10:36',scan:'scan'}; if(!commands[action])return reply.code(400).send({error:'Action CEC inconnue'});
  const child=spawn('cec-client',commands[action].split(' '),{stdio:'ignore'}); child.on('error',()=>{}); return {ok:true};
});
app.post<{Params:{id:string};Body:{fallback?:boolean}}>('/api/player/:id/play',async(request,reply)=>{const item=loadDb().library.find(x=>x.id===request.params.id);if(!item)return reply.code(404).send({error:'Média introuvable'});if(!mediaRoots.some(root=>item.path.startsWith(root)))return reply.code(403).send({error:'Chemin non autorisé'});mpvProcess?.kill();mpvProcess=spawn('mpv',['--fs','--hwdec=auto-safe','--audio-display=no','--keep-open=no','--input-ipc-server=/tmp/sceneroot-mpv.sock',item.path],{stdio:'ignore',env:{...process.env,DISPLAY:process.env.DISPLAY??':0'}});mpvProcess.on('exit',()=>{mpvProcess=null});mpvProcess.on('error',error=>app.log.warn({error},'mpv failed'));return{ok:true,engine:'mpv'}});
app.post<{Body:{command:'pause'|'stop'|'seek-forward'|'seek-back'|'audio-next'|'subtitle-next'}}>('/api/player/control',async(request,reply)=>{const map:Record<string,string[]>={pause:['cycle','pause'],stop:['quit'],'seek-forward':['seek','30','relative'],'seek-back':['seek','-10','relative'],'audio-next':['cycle','audio'],'subtitle-next':['cycle','sub']};const command=map[request.body.command];if(!command)return reply.code(400).send({error:'Commande inconnue'});try{await new Promise<void>((resolve,reject)=>{const socket=spawn('socat',['-','UNIX-CONNECT:/tmp/sceneroot-mpv.sock']);socket.stdin.end(JSON.stringify({command})+'\n');socket.on('exit',code=>code===0?resolve():reject(new Error(`socat ${code}`)));socket.on('error',reject)});return{ok:true}}catch{return reply.code(503).send({error:'Lecteur mpv indisponible'})}});

const dist=resolve('./dist');
if(existsSync(dist)){
  await app.register(staticPlugin,{root:dist});
  app.setNotFoundHandler((request,reply)=>request.url.startsWith('/api/')?reply.code(404).send({error:'Route inconnue'}):reply.sendFile('index.html'));
}
await app.listen({port,host:'0.0.0.0'});
if(process.env.SCENEROOT_WATCH!=='false'){scanLibrary().catch(error=>app.log.warn({error},'Initial media scan failed'));setInterval(()=>scanLibrary().catch(error=>app.log.warn({error},'Background media scan failed')),60_000).unref()}
