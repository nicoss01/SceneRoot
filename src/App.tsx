import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BarChart3, Check, ChevronDown, ChevronRight, ChevronsUp, ChevronUp, Clock3, Download, Eye, EyeOff, Film, FolderOpen, HardDrive, Heart, Hourglass, Lock, Monitor, Pause, Pencil, Play, Plus, RefreshCw, RotateCcw, Search, ShieldCheck, Sparkles, Star, Subtitles, Timer, Trash2, Tv, Users, Volume2, Wifi, WandSparkles, X } from 'lucide-react';
import { Brand } from './components/Brand';
import { MediaCard } from './components/MediaCard';
import { MetadataMatcher } from './components/MetadataMatcher';
import { ProfileAvatar } from './components/ProfileAvatar';
import { ProfileEditor } from './components/ProfileEditor';
import { Shell } from './components/Shell';
import { resolveMedia } from './data/catalog';
import { allGenres } from './data/genres';
import { useCatalog } from './hooks/useCatalog';
import { useLibrary } from './hooks/useLibrary';
import { useHistory, useResume } from './hooks/usePlaybackHistory';
import { useLibraryGroup } from './hooks/useLibraryGroup';
import { useSeriesEpisodes } from './hooks/useSeriesEpisodes';
import { usePlayerChrome } from './hooks/usePlayerChrome';
import { useResolvedMedia } from './hooks/useResolvedMedia';
import { usePreferences } from './hooks/usePreferences';
import { useOpinion } from './hooks/useOpinion';
import { useRemoteUrl } from './hooks/useRemoteUrl';
import { nextInDirection, type Direction } from './lib/spatial';
import { posterUrl } from './lib/image';
import { useWatched } from './context/watched';
import { useEscapeClose } from './hooks/useEscapeClose';
import { useModalFocus } from './hooks/useModalFocus';
import { WatchedContext } from './context/watched';
import { formatBytes, formatDateTime } from './lib/format';
import { matchesDuration, matchesSearchFilters, type DurationBucket } from './lib/filters';
import { DownloadPanel } from './components/DownloadPanel';
import { TorrentUpload } from './components/TorrentUpload';
import { QRCode } from './components/QRCode';
import { SetupWizard } from './components/SetupWizard';
import { TasteTree } from './components/TasteTree';
import { useDownloads, type Torrent } from './hooks/useDownloads';
import type { MediaItem, PlayerStatus, Profile } from './types';

function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function BootScreen() {
  return <div className="boot-screen">
    <div className="boot-glow" />
    <img className="boot-logo" src="/assets/logo-square.png" alt="SceneRoot" />
    <p>Chargement de votre univers multimédia…</p>
    <div className="boot-progress"><i /></div>
    <div className="boot-categories"><span><Film/> FILMS</span><span><Tv/> SÉRIES</span><span><Sparkles/> DÉCOUVERTE</span><span><Users/> PROFILS</span></div>
    <small>ALIMENTÉ PAR<br/><b>RASPBERRY PI</b></small>
  </div>;
}

function ProfileGate({ onSelect, availableProfiles, onSaved, onDeleted }: { onSelect: (profile: Profile) => void; availableProfiles:Profile[]; onSaved:(profile:Profile)=>void; onDeleted:(profile:Profile)=>void }) {
  const [modal,setModal]=useState<'guest'|'profile'|'unlock'|null>(null);
  useEscapeClose(()=>setModal(null),modal==='guest'||modal==='unlock');
  const [editing,setEditing]=useState<Profile|undefined>(); const [unlocking,setUnlocking]=useState<Profile|undefined>();
  const [pin,setPin]=useState(''); const [unlockError,setUnlockError]=useState('');
  const [age,setAge]=useState(18); const [guestTtl,setGuestTtl]=useState('shutdown');
  const createGuest=async()=>{const fallback:Profile={id:`guest-${Date.now()}`,name:'Invité',ageLimit:age,avatar:'I',accent:'#a78bfa'};try{const response=await fetch('/api/guests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ttl:guestTtl,ageLimit:age})});const result=await response.json() as {id?:string};onSelect({...fallback,id:result.id??fallback.id})}catch{onSelect(fallback)}};
  const guestRef=useModalFocus<HTMLDivElement>(modal==='guest');
  const unlockRef=useModalFocus<HTMLDivElement>(modal==='unlock');
  const choose=(profile:Profile)=>{if(!profile.locked){onSelect(profile);return}setUnlocking(profile);setPin('');setUnlockError('');setModal('unlock')};
  const unlock=async()=>{if(!unlocking)return;setUnlockError('');try{const response=await fetch(`/api/profiles/${unlocking.id}/unlock`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})});if(!response.ok)throw new Error('Code incorrect');onSelect(unlocking)}catch(cause){setUnlockError((cause as Error).message)}};
  return <div className="gate starscape">
    <div className="gate__head"><Brand /><span>20:24 · <Wifi size={20}/></span></div>
    <div className="gate__title"><h1>Qui regarde ?</h1><p>Choisissez votre profil pour commencer</p></div>
    <div className="profiles">{availableProfiles.map((profile, i) => <div className={`profile-card ${i === 0 ? 'is-active' : ''}`} key={profile.id}>
      <button className="profile-select focusable" onClick={() => choose(profile)}><ProfileAvatar profile={profile}/><strong>{profile.name} {profile.locked && <Lock size={18}/>}</strong><small>{profile.ageLimit === 18 ? 'Tout public' : `-${profile.ageLimit}`}</small></button>
      <button className="profile-edit focusable" title={`Modifier le profil ${profile.name}`} aria-label={`Modifier le profil ${profile.name}`} onClick={()=>{setEditing(profile);setModal('profile')}}><Pencil/></button>
    </div>)}</div>
    <div className="gate-actions"><button className="add-profile focusable" onClick={()=>{setEditing(undefined);setModal('profile')}}><Plus /> Ajouter un profil</button><button className="add-profile focusable" onClick={()=>setModal('guest')}><Users/> Invité</button></div>
    {modal==='profile'&&<ProfileEditor profile={editing} deletable={Boolean(editing)} onClose={()=>setModal(null)} onSaved={saved=>{onSaved(saved);setModal(null);if(!editing)onSelect(saved)}} onDeleted={deleted=>{onDeleted(deleted);setModal(null)}}/>}
    {modal==='guest'&&<div className="modal-backdrop"><div className="profile-modal" role="dialog" aria-modal="true" ref={guestRef}><button className="modal-close" onClick={()=>setModal(null)}><X/></button><span className="modal-icon"><Users/></span><h2>Session invitée</h2><p>Cette session ne modifiera pas les recommandations de la famille.</p><label>Limite d’âge<select value={age} onChange={e=>setAge(Number(e.target.value))}><option value="18">Tout public</option><option value="10">-10</option><option value="13">-13</option><option value="16">-16</option></select></label><label>Conserver le profil<select value={guestTtl} onChange={e=>setGuestTtl(e.target.value)}><option value="shutdown">Jusqu’à extinction</option><option value="24h">24 heures</option><option value="7d">7 jours</option><option value="permanent">Conserver ce profil</option></select></label><button className="primary modal-submit" onClick={createGuest}>Commencer</button></div></div>}
    {modal==='unlock'&&unlocking&&<div className="modal-backdrop"><div className="profile-modal unlock-modal" role="dialog" aria-modal="true" ref={unlockRef}><button className="modal-close" onClick={()=>setModal(null)}><X/></button><ProfileAvatar profile={unlocking}/><h2>{unlocking.name}</h2><p>Entrez le code de verrouillage de ce profil.</p><label>Code<input autoFocus type="password" inputMode="numeric" value={pin} onChange={event=>setPin(event.target.value.replace(/\D/g,'').slice(0,8))} onKeyDown={event=>{if(event.key==='Enter')void unlock()}}/></label>{unlockError&&<div className="profile-error">{unlockError}</div>}<button className="primary modal-submit" onClick={()=>void unlock()}><Lock/>Déverrouiller</button></div></div>}
  </div>;
}

function WatchedProvider({profileId,children}:{profileId:string;children:React.ReactNode}) {
  const [watched,setWatched]=useState<Set<string>>(new Set());
  useEffect(()=>{let active=true;const load=()=>fetch(`/api/watched/${encodeURIComponent(profileId)}`).then(response=>response.ok?response.json():[]).then((ids:string[])=>{if(active)setWatched(new Set(ids))}).catch(()=>{});void load();const interval=setInterval(()=>void load(),60_000);return()=>{active=false;clearInterval(interval)}},[profileId]);
  return <WatchedContext.Provider value={watched}>{children}</WatchedContext.Provider>;
}
function Section({ title, items, onOpen, onDismiss, wide = false }: { title: string; items: MediaItem[]; onOpen: (m: MediaItem) => void; onDismiss?: (m: MediaItem) => void; wide?: boolean }) {
  return <section><div className="section-title"><h2>{title}</h2><button>Tout voir <ChevronRight size={18}/></button></div><div className="rail">{items.map((m, i) => <MediaCard key={m.id} item={m} active={i === 0} wide={wide} onOpen={() => onOpen(m)} onDismiss={onDismiss ? () => onDismiss(m) : undefined} />)}</div></section>;
}

function RemoteSection({ title, onOpen, kind, recent }: { title:string; onOpen:(item:MediaItem)=>void; kind?:'film'|'serie'; recent?:boolean }) {
  const sectionRef=useRef<HTMLElement>(null);const[visible,setVisible]=useState(false);
  const catalog=useCatalog(kind,6,visible,'','',recent?'recent':'');const {items,loading,source,refresh}=catalog;
  useEffect(()=>{const node=sectionRef.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries[0]?.isIntersecting){setVisible(true);observer.disconnect()}},{rootMargin:'320px'});observer.observe(node);return()=>observer.disconnect()},[]);
  useEffect(()=>{if(!visible)return;const interval=setInterval(()=>refresh(),24*60*60*1000);return()=>clearInterval(interval)},[visible,refresh]);
  return <section ref={sectionRef}><div className="section-title"><h2>{title}</h2><span>{loading?'Chargement…':source?`Source : ${source}`:''}</span></div>{items.length?<div className="rail">{items.map((item,index)=><MediaCard key={item.id} item={item} active={index===0} onOpen={()=>onOpen(item)}/>)}</div>:!loading&&<div className="library-empty compact"><Film/><p>Aucun titre disponible pour le moment.</p></div>}</section>;
}

function HomePage({profile}:{profile:Profile}) {
  const navigate = useNavigate(); const open = (m: MediaItem) => navigate(`/title/${m.id}`);
  const resume = useResume(profile.id); const {hidden}=usePreferences(profile.id);
  const resumeItems=resume.items.filter(m=>!hidden.has(m.id));
  return <>
    <div className="welcome home-welcome"><h1>Bonsoir, {profile.name}</h1><p>De belles histoires vous attendent.</p></div>
    {resumeItems.length>0&&<Section title="Reprendre la lecture" items={resumeItems.slice(0,6)} onOpen={open} onDismiss={media=>void resume.dismiss(media.id)} wide />}
    <RemoteSection title="Dernières sorties" onOpen={open} recent />
    <RemoteSection title="Films à découvrir" onOpen={open} kind="film" />
    <RemoteSection title="Séries à découvrir" onOpen={open} kind="serie" />
    <section><div className="section-title"><h2>Explorer par genre</h2><span>{allGenres.length} genres films et séries</span></div><div className="genres">{allGenres.map((label,i) => {const Icon=i%4===0?Film:i%4===1?Tv:i%4===2?Sparkles:Heart;return <button className={`genre focusable ${i===0?'is-active':''}`} key={label} onClick={()=>navigate(`/search?genre=${encodeURIComponent(label)}`)}><Icon />{label}</button>})}</div></section>
  </>;
}

function BrowsePage({ kind, title }: { kind?: 'film'|'serie'; title: string }) {
  const navigate=useNavigate();const sentinel=useRef<HTMLDivElement>(null);const catalog=useCatalog(kind,15,true);const list=catalog.items;
  useEffect(()=>{const node=sentinel.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries[0]?.isIntersecting&&!catalog.loading&&catalog.hasMore)void catalog.loadMore()},{rootMargin:'500px'});observer.observe(node);return()=>observer.disconnect()},[catalog.hasMore,catalog.loadMore,catalog.loading]);
  return <><div className="welcome"><h1>{title}</h1><p>{catalog.items.length?`${catalog.items.length} titres chargés depuis ${catalog.source}.`:'Le catalogue est encore vide.'}</p></div><div className="grid">{list.map((item,index)=><MediaCard item={item} active={index===0} key={item.id} onOpen={()=>navigate(`/title/${item.id}`)}/>)}</div>{!catalog.loading&&!catalog.error&&!list.length&&<div className="library-empty"><Film/><h2>Aucun contenu disponible</h2><p>Synchronisez le catalogue IMDb ou ajoutez des médias à votre bibliothèque.</p></div>}<div className="catalog-sentinel" ref={sentinel}>{catalog.loading&&<><i/>Chargement de la suite…</>}{catalog.error&&<button className="secondary" onClick={()=>catalog.loadMore()}>Réessayer le chargement</button>}{!catalog.hasMore&&catalog.items.length>0&&<span>Fin du catalogue</span>}</div></>;
}

function LibraryPage() {
  const navigate=useNavigate();const library=useLibrary();const[matchingId,setMatchingId]=useState<string|null>(null);const[scanning,setScanning]=useState(false);
  const unresolved=library.groups.filter(group=>!group.metadata);const matching=library.groups.find(group=>group.id===matchingId);
  const scan=async()=>{setScanning(true);try{await fetch('/api/library/scan',{method:'POST'});await library.refresh()}finally{setScanning(false)}};
  return <><div className="library-heading"><div className="welcome"><h1>Ma médiathèque</h1><p>{library.items.length} titre{library.items.length>1?'s':''} indexé{library.items.length>1?'s':''} · {unresolved.length} à identifier</p></div><div><button className="secondary" onClick={()=>void scan()} disabled={scanning}><RefreshCw className={scanning?'spin':''}/>{scanning?'Analyse…':'Analyser'}</button>{unresolved.length>0&&<button className="primary" onClick={()=>setMatchingId(unresolved[0].id)}><Search/>Identifier les médias</button>}</div></div>
    {library.loading&&<div className="library-loading"><i/>Lecture de la bibliothèque…</div>}
    {library.error&&<div className="library-empty"><FolderOpen/><h2>Bibliothèque indisponible</h2><p>{library.error}</p><button className="secondary" onClick={()=>void library.refresh()}>Réessayer</button></div>}
    {!library.loading&&!library.error&&!library.items.length&&<div className="library-empty"><FolderOpen/><h2>Aucun média indexé</h2><p>Connectez un disque ou configurez un partage réseau, puis lancez une analyse.</p><button className="primary" onClick={()=>void scan()}><RefreshCw/>Analyser maintenant</button></div>}
    {library.items.length>0&&<div className="grid library-grid">{library.items.map((item,index)=><div className="library-item" key={item.id}><MediaCard item={item} active={index===0} onOpen={()=>navigate(`/title/${item.id}`)}/><div className="library-badges"><span>{item.versionCount} version{item.versionCount!==1?'s':''}</span>{item.episodeCount? <span>{item.episodeCount} épisodes</span>:null}{!item.matched&&<button onClick={()=>setMatchingId(item.id)}>À identifier</button>}</div></div>)}</div>}
    {matching&&<MetadataMatcher group={matching} onClose={()=>setMatchingId(null)} onMatched={library.refresh}/>}</>;
}

function SearchPage() {
  const params=new URLSearchParams(location.search);const initialGenre=params.get('genre')??'';
  const [query, setQuery] = useState(initialGenre?'':'planète'); const [debouncedQuery,setDebouncedQuery]=useState(query);const [selectedGenre,setSelectedGenre]=useState(initialGenre);const[type,setType]=useState<'all'|'film'|'serie'>('all'); const navigate = useNavigate();const sentinel=useRef<HTMLDivElement>(null);
  const [duration,setDuration]=useState<DurationBucket>('any');const [minRating,setMinRating]=useState(0);const [quality,setQuality]=useState<''|MediaItem['quality']>('');
  useEffect(()=>{const timer=setTimeout(()=>setDebouncedQuery(query.trim()),320);return()=>clearTimeout(timer)},[query]);
  const catalog=useCatalog(type==='all'?undefined:type,20,true,selectedGenre,debouncedQuery);
  const results=catalog.items.filter(item=>matchesSearchFilters(item,{duration,minRating,quality}));
  useEffect(()=>{const node=sentinel.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries[0]?.isIntersecting&&!catalog.loading&&catalog.hasMore)void catalog.loadMore()},{rootMargin:'420px'});observer.observe(node);return()=>observer.disconnect()},[catalog.hasMore,catalog.loadMore,catalog.loading]);
  const [tab,setTab]=useState<'search'|'torrent'>('search');
  const reset=()=>{setQuery('');setSelectedGenre('');setType('all');setDuration('any');setMinRating(0);setQuality('')};
  // Télécommande de recherche : le téléphone dépose une requête, l'écran la
  // reprend. On ignore l'état déjà en place à l'arrivée sur la page.
  const remoteUrl=useRemoteUrl('/remote.html');
  const lastRemote=useRef<string>('');
  useEffect(()=>{
    let active=true;
    const poll=async()=>{
      try{
        const response=await fetch('/api/remote/search');
        if(!response.ok)return;
        const remote=await response.json() as {query:string;kind:'all'|'film'|'serie';genre:string;duration:DurationBucket;minRating:number;quality:string;updatedAt:string};
        if(!active)return;
        if(!lastRemote.current){lastRemote.current=remote.updatedAt;return}
        if(remote.updatedAt===lastRemote.current)return;
        lastRemote.current=remote.updatedAt;
        setQuery(remote.query);setSelectedGenre(remote.genre);setType(remote.kind);
        setDuration(remote.duration);setMinRating(remote.minRating);setQuality(remote.quality as ''|MediaItem['quality']);
      }catch{/* réseau indisponible : on réessaiera */}
    };
    void poll();
    const timer=setInterval(()=>void poll(),2000);
    return()=>{active=false;clearInterval(timer)};
  },[]);
  return <>
    <div className="search-tabs">
      <button className={tab==='search'?'on':''} onClick={()=>setTab('search')}><Search/> Rechercher</button>
      <button className={tab==='torrent'?'on':''} onClick={()=>setTab('torrent')}><Download/> Charger un torrent</button>
    </div>
    {tab==='torrent'&&<TorrentUpload/>}
    {tab==='search'&&<><label className="searchbox"><Search/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Rechercher un film ou une série…"/><kbd>OK</kbd></label>
    {remoteUrl&&<div className="search-remote"><QRCode value={remoteUrl} size={132}/><div><h3>Chercher depuis votre téléphone</h3><p>Scannez ce QR code pour saisir le texte et régler les filtres depuis le mobile : l’écran suit en direct.</p><small>{remoteUrl}</small></div></div>}
    <div className="search-filter-title"><h2>Filtres</h2><button onClick={reset}><RefreshCw/> Réinitialiser les filtres</button></div>
    <div className="search-filters"><div className="filter-panel"><h3><Film/>Type</h3><div>{([['all','Tous'],['film','Films'],['serie','Séries']] as const).map(([value,label])=><button className={type===value?'on':''} onClick={()=>setType(value)} key={value}>{label}</button>)}</div></div><div className="filter-panel"><h3><Timer/>Durée</h3><div>{([['short','< 1h30'],['medium','1h30 – 2h'],['long','> 2h']] as const).map(([value,label])=><button className={duration===value?'on':''} onClick={()=>setDuration(current=>current===value?'any':value)} key={value}>{label}</button>)}</div></div><div className="filter-panel"><h3><Star/>Notes utilisateurs</h3><div>{[5,7,8].map(value=><button className={minRating===value?'on':''} onClick={()=>setMinRating(current=>current===value?0:value)} key={value}>≥ {value}</button>)}</div></div><div className="filter-panel"><h3><Monitor/>Qualité</h3><div>{(['720p','1080p','4K'] as const).map(value=><button className={quality===value?'on':''} onClick={()=>setQuality(current=>current===value?'':value)} key={value}>{value}</button>)}</div></div></div>
    <div className="genre-filter"><h3><Sparkles/>Tous les genres</h3><div>{allGenres.map(genre=><button className={selectedGenre===genre?'on':''} onClick={()=>setSelectedGenre(current=>current===genre?'':genre)} key={genre}>{genre}</button>)}</div></div>
    <div className="section-title"><h2>{query?`Résultats pour « ${query} »`:selectedGenre||'Tous les contenus'}</h2><span>{catalog.source?`${results.length} résultats · ${catalog.source}`:`${results.length} résultats`}</span></div>
    <div className="grid">{results.map((m,i)=><MediaCard item={m} active={i===0} key={m.id} onOpen={()=>navigate(`/title/${m.id}`)}/>)}</div><div className="catalog-sentinel" ref={sentinel}>{catalog.loading&&<><i/>Recherche dans le catalogue…</>}{catalog.error&&<button className="secondary" onClick={()=>catalog.loadMore()}>Réessayer</button>}{!catalog.loading&&!results.length&&<span>Aucun titre ne correspond encore à ces filtres.</span>}</div></>}</>;
}

type Mood = 'Détente'|'Action'|'Émotion'|'Frissons'|'Découverte';
type ScoredMedia = { item:MediaItem; score:number; affinities:number[]; minAffinity:number; seenCount:number };
function TonightPage({availableProfiles,profile}:{availableProfiles:Profile[];profile:Profile}) {
  const navigate=useNavigate();
  const library=useLibrary(); const {hidden}=usePreferences(profile.id);
  const [selected,setSelected]=useState(()=>availableProfiles.slice(0,3).map(profile=>profile.id));
  // Un profil supprimé ailleurs ne doit plus peser dans le compromis.
  useEffect(()=>{setSelected(current=>{const kept=current.filter(id=>availableProfiles.some(profile=>profile.id===id));return kept.length===current.length?current:kept})},[availableProfiles]);
  const [kind,setKind]=useState<'film'|'serie'|'any'>('any');
  const [duration,setDuration]=useState<'short'|'medium'|'any'>('any');
  const [mood,setMood]=useState<Mood>('Découverte');
  const [genre,setGenre]=useState('');
  const [choosing,setChoosing]=useState(false); const [chosen,setChosen]=useState<string|null>(null);
  const [scored,setScored]=useState<ScoredMedia[]>([]); const [computing,setComputing]=useState(false);
  // « Ce soir » sert aussi à découvrir : le catalogue distant complète la
  // médiathèque, et ce qui n'est pas encore là se téléchargera depuis sa fiche.
  const catalog=useCatalog(kind==='any'?undefined:kind,24,true,genre);
  const libraryIds=useMemo(()=>new Set(library.items.map(item=>item.id)),[library.items]);
  const librarySignatures=useMemo(()=>new Set(library.items.map(item=>`${item.title.toLocaleLowerCase('fr')}|${item.year}`)),[library.items]);
  const pool=useMemo(()=>{
    const discoveries=catalog.items.filter(item=>!libraryIds.has(item.id)&&!librarySignatures.has(`${item.title.toLocaleLowerCase('fr')}|${item.year}`));
    return [...library.items,...discoveries].filter(m=>(kind==='any'||m.kind===kind)&&(!genre||m.genres.includes(genre))&&matchesDuration(m,duration)&&!hidden.has(m.id));
  },[library.items,catalog.items,libraryIds,librarySignatures,kind,genre,duration,hidden]);
  useEffect(()=>{
    let active=true;
    if(!pool.length){setScored([]);return}
    const profileIds=selected.length?selected:['family'];
    const candidates=pool.map(m=>({id:m.id,genres:m.genres}));
    const byId=new Map(pool.map(m=>[m.id,m]));
    setComputing(true);
    (async()=>{
      try{
        const response=await fetch('/api/recommendations/group',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profileIds,candidates})});
        if(!response.ok)throw new Error();
        const rows=await response.json() as Array<{id:string;score:number;affinities:number[];seenBy?:string[]}>;
        if(!active)return;
        const mapped=rows.flatMap(row=>{const item=byId.get(row.id);if(!item)return[];const bonus=moodGenres[mood].some(value=>item.genres.includes(value))?5:0;const affinities=row.affinities??[];return[{item,score:Math.max(0,Math.min(100,row.score+bonus)),affinities,minAffinity:affinities.length?Math.round(Math.min(...affinities)):row.score,seenCount:row.seenBy?.length??0}]});
        setScored(mapped.sort((a,b)=>b.score-a.score).slice(0,5));
      }catch{if(active)setScored([])}finally{if(active)setComputing(false)}
    })();
    return()=>{active=false};
  },[pool,selected,mood]);
  const pick=()=>{setChoosing(true);setChosen(null);setTimeout(()=>{setChosen(scored[Math.floor(Math.random()*Math.min(3,scored.length))]?.item.id??null);setChoosing(false)},1100)};
  return <><div className="tonight-head"><div className="welcome"><h1>Que regarde-t-on ce soir ?</h1><p>SceneRoot cherche le meilleur compromis, pas la moyenne la plus facile. Les titres absents de la médiathèque sont proposés au téléchargement.</p></div><button className="primary magic" onClick={pick} disabled={!scored.length}><WandSparkles/>{choosing?'Choix en cours…':'Faites le choix pour nous'}</button></div>
    <div className="chooser"><FilterGroup title="Profils">{availableProfiles.map(p=><button className={selected.includes(p.id)?'on':''} onClick={()=>setSelected(s=>s.includes(p.id)?s.filter(x=>x!==p.id):[...s,p.id])} key={p.id}>{p.name}{selected.includes(p.id)&&<Check/>}</button>)}</FilterGroup><FilterGroup title="Envie">{(['film','serie','any'] as const).map(v=><button className={kind===v?'on':''} onClick={()=>setKind(v)} key={v}>{v==='film'?'Film':v==='serie'?'Série':'Peu importe'}</button>)}</FilterGroup><FilterGroup title="Durée">{([['short','< 1h30'],['medium','1h30–2h'],['any','Peu importe']] as const).map(([v,l])=><button className={duration===v?'on':''} onClick={()=>setDuration(v)} key={v}>{l}</button>)}</FilterGroup><FilterGroup title="Ambiance">{(['Détente','Action','Émotion','Frissons','Découverte'] as Mood[]).map(v=><button className={mood===v?'on':''} onClick={()=>setMood(v)} key={v}>{v}</button>)}</FilterGroup><label className="tonight-genre"><strong>Genre</strong><select value={genre} onChange={event=>setGenre(event.target.value)}><option value="">Tous les genres</option>{allGenres.map(value=><option value={value} key={value}>{value}</option>)}</select></label></div>
    <div className="match-list">{scored.map((x,i)=><button className={`match-card ${chosen===x.item.id?'winner':''}`} key={x.item.id} onClick={()=>navigate(`/title/${x.item.id}`)}><div className="match-rank">{i+1}</div><div className="match-art" style={{'--a':x.item.palette[0],'--b':x.item.palette[1]} as React.CSSProperties}>{x.item.symbol}</div><div className="match-copy"><h3>{x.item.title}{!libraryIds.has(x.item.id)&&<span className="match-discover"><Download size={14}/>À télécharger</span>}</h3><strong>{x.score} % compatible</strong><p>✓ {selectedProfileNames(selected,availableProfiles)} · ✓ satisfaction minimale {x.minAffinity}% · {x.seenCount>0?`⚠ déjà vu par ${x.seenCount} profil${x.seenCount>1?'s':''}`:'✓ jamais vu par le groupe'} · {x.item.duration}</p></div><ChevronRight/></button>)}{!scored.length&&!computing&&<div className="empty-recommendations"><Sparkles/><h3>Aucun titre avec ces contraintes</h3><p>Essayez « Peu importe » pour la durée ou choisissez un autre genre.</p></div>}{computing&&!scored.length&&<div className="library-loading"><i/>Calcul du meilleur compromis…</div>}</div>
  </>;
}
const moodGenres:Record<Mood,string[]>={Détente:['Comédie','Famille','Animation'],Action:['Action','Aventure','Action & aventure'],Émotion:['Drame','Romance'],Frissons:['Horreur','Thriller','Mystère'],Découverte:['Documentaire','Histoire','Science-fiction']};
function selectedProfileNames(ids:string[],availableProfiles:Profile[]){const names=ids.map(id=>availableProfiles.find(profile=>profile.id===id)?.name).filter(Boolean);return names.length?`${names.join(', ')} sont pris en compte`:'sélection familiale neutre'}
function FilterGroup({title,children}:{title:string;children:React.ReactNode}){return <div className="filter-group"><strong>{title}</strong><div>{children}</div></div>}

function versionLabel(version:{size:number;technical?:Record<string,unknown>}){const height=Number(version.technical?.height??0);const quality=height>=2000?'4K':height>=900?'1080p':height>=600?'720p':'SD';const codec=version.technical?.videoCodec?String(version.technical.videoCodec).toUpperCase():'';const hdr=version.technical?.hdr?' · HDR':'';return `${quality}${codec?` · ${codec}`:''}${hdr} · ${formatBytes(version.size)}`}
function DetailPage({profile}:{profile:Profile}) {
  const { id } = useParams(); const navigate = useNavigate(); const {item,isLocal}=useResolvedMedia(id);
  const isLocalSeries=isLocal&&item.kind==='serie';
  const isSeries=item.kind==='serie';
  const [downloadMode,setDownloadMode]=useState<'later'|'play'|null>(null);const [chosenVersion,setChosenVersion]=useState<string|undefined>();
  const prefs=usePreferences(profile.id);const isFavorite=prefs.favorites.has(item.id);const isHidden=prefs.hidden.has(item.id);
  const seenFromHistory=useWatched().has(item.id);
  const opinion=useOpinion(profile.id,item.id,seenFromHistory);
  const [refreshing,setRefreshing]=useState(false);const [refreshMessage,setRefreshMessage]=useState('');
  // Recharge les métadonnées puis réaffiche la fiche avec les données fraîches.
  const refreshMedia=async()=>{setRefreshing(true);setRefreshMessage('');try{
    const response=await fetch(`/api/media/${encodeURIComponent(item.id)}/refresh`,{method:'POST'});
    const payload=await response.json().catch(()=>({})) as {error?:string};
    if(!response.ok)throw new Error(payload.error??`Échec (${response.status})`);
    window.location.reload();
  }catch(cause){setRefreshMessage((cause as Error).message);setRefreshing(false)}};
  const {detail}=useLibraryGroup(id,profile.id,isLocal);
  const series=useSeriesEpisodes(id,profile.id,isSeries,item.title,item.art,isLocal,item.year);
  const richEpisodes=series.seasons.flatMap(season=>season.episodes);
  const nextId=richEpisodes.find(episode=>episode.progress<0.9)?.id??detail?.nextEpisodeId;
  const filmVersions=(detail&&item.kind==='film')?detail.versions:[];
  const activeVersion=chosenVersion??item.id;
  const playTarget=item.kind==='serie'?(nextId??richEpisodes[0]?.id??item.id):activeVersion;
  const targetEpisode=richEpisodes.find(episode=>episode.id===playTarget);
  const episodeLabel=targetEpisode?` S${targetEpisode.season}E${String(targetEpisode.episode).padStart(2,'0')}`:'';
  const [resumeMap,setResumeMap]=useState<Record<string,number>>({});
  useEffect(()=>{if(!isLocal){setResumeMap({});return}let active=true;fetch(`/api/playback/${encodeURIComponent(profile.id)}`).then(response=>response.ok?response.json():[]).then((rows:Array<{mediaId:string;position:number}>)=>{if(!active)return;const map:Record<string,number>={};for(const row of rows)map[row.mediaId]=row.position;setResumeMap(map)}).catch(()=>{});return()=>{active=false}},[isLocal,profile.id]);
  const hasProgress=isLocalSeries?(targetEpisode?(targetEpisode.progress>0.02&&targetEpisode.progress<0.9):false):(resumeMap[playTarget]!==undefined);
  // À l'arrivée sur une fiche, le focus va sur l'action principale (lecture ou
  // téléchargement) pour que la télécommande soit immédiatement opérante.
  const primaryActionRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{primaryActionRef.current?.focus()},[item.id,isLocal]);
  return <div className="detail" style={{ '--a': item.palette[0], '--b': item.palette[1], backgroundImage:`linear-gradient(90deg,rgba(1,7,14,.94) 8%,rgba(1,7,14,.28)), url('${posterUrl(item.art)??'/assets/sceneroot-landscape.jpg'}')` } as React.CSSProperties}>
    <button className="back focusable" onClick={()=>navigate(-1)}><ArrowLeft/> Retour</button>
    <div className="detail__symbol">{item.symbol}<i/></div><div className="detail__content"><span className="eyebrow">{item.kind === 'film' ? 'FILM' : 'SÉRIE'} · {item.year}</span><h1>{item.title}</h1>
    <div className="detail__meta"><Star fill="currentColor"/> {item.rating>0?`${item.rating}/10`:'Non noté'} <span>{item.duration}</span><span>{item.quality}</span></div><p>{item.description}</p><div className="detail__genres">{item.genres.map(g=><span key={g}>{g}</span>)}</div>{item.sourceUrl&&<a className="source-link" href={item.sourceUrl} target="_blank" rel="noreferrer">Informations : {item.informationSource??(item.source==='tvmaze'?'TVmaze':item.source==='wikipedia'?'Wikipédia':'TMDB')}</a>}
    <div className="actions">{isLocal?(hasProgress?<><button ref={primaryActionRef} className="primary focusable" onClick={()=>navigate(`/player/${playTarget}`)}><Play fill="currentColor"/> Reprendre{episodeLabel}</button><button className="secondary focusable" onClick={()=>navigate(`/player/${playTarget}?restart=1`)}><RotateCcw/> Lire depuis le début</button></>:<button ref={primaryActionRef} className="primary focusable" onClick={()=>navigate(`/player/${playTarget}`)}><Play fill="currentColor"/> Lire{episodeLabel}</button>):<><button ref={primaryActionRef} className="primary focusable" onClick={()=>setDownloadMode('play')}><Play fill="currentColor"/> Télécharger et lancer la lecture</button><button className="secondary focusable" onClick={()=>setDownloadMode('later')}><Download/> Télécharger pour plus tard</button></>}<button className={`icon-btn focusable ${isFavorite?'is-fav':''}`} title={isFavorite?'Retirer des favoris':'Ajouter aux favoris'} onClick={()=>void prefs.set(item.id,{favorite:!isFavorite})}><Heart fill={isFavorite?'currentColor':'none'}/></button><button className="icon-btn focusable" title={isHidden?'Ne plus masquer':'Masquer ce contenu'} onClick={()=>void prefs.set(item.id,{hidden:!isHidden})}>{isHidden?<Eye/>:<EyeOff/>}</button></div>
    <div className="opinion"><span className="opinion-label">Votre avis</span>
      <div className="opinion-stars">{[2,4,6,8,10].map(value=><button key={value} className={`opinion-star focusable ${(opinion.score??0)>=value?'is-on':''}`} title={`Noter ${value}/10`} aria-label={`Noter ${value} sur 10`} onClick={()=>void opinion.rate(value)}><Star fill={(opinion.score??0)>=value?'currentColor':'none'}/></button>)}</div>
      <span className="opinion-score">{opinion.score!==null?`${opinion.score}/10`:'Pas encore noté'}</span>
      <button className={`chip focusable ${opinion.seen?'is-on':''}`} onClick={()=>void opinion.markSeen(!opinion.seen)}><Eye/> {opinion.seen?'Déjà vu':'Je l’ai déjà vu'}</button>
      <button className="chip focusable" onClick={()=>void refreshMedia()} disabled={refreshing}><RefreshCw className={refreshing?'spin':''}/> {refreshing?'Actualisation…':'Recharger les données'}</button>
      {refreshMessage&&<span className="opinion-error">{refreshMessage}</span>}
    </div>
    {item.kind==='film'&&filmVersions.length>1&&<div className="versions"><h3>{filmVersions.length} versions disponibles</h3><div className="version-list">{filmVersions.map(version=><button className={`version focusable ${activeVersion===version.id?'is-selected':''}`} key={version.id} onClick={()=>setChosenVersion(version.id)}>{versionLabel(version)}{activeVersion===version.id&&<Check/>}</button>)}</div></div>}
    {downloadMode&&<DownloadPanel item={item} priority={downloadMode==='play'} onQueued={downloadMode==='play'?torrentId=>{setDownloadMode(null);navigate(torrentId!=null?`/stream/${torrentId}`:'/downloads')}:undefined} onClose={()=>setDownloadMode(null)}/>}
    {isSeries&&(series.loading||series.seasons.length>0)&&<div className="episodes"><div className="episodes-head"><h2>Saisons et épisodes</h2>{series.source&&<span>Infos épisodes : {series.source}</span>}</div>{series.loading&&!series.seasons.length&&<div className="library-loading"><i/>Chargement des épisodes…</div>}{series.seasons.map(season=><div className="season" key={season.season}><h3>Saison {season.season} · {season.episodes.length} épisode{season.episodes.length>1?'s':''}</h3><div className="episode-cards">{season.episodes.map(episode=>{const playable=isLocal&&episode.playable!==false;return <button className={`episode-card focusable ${episode.id===nextId&&playable?'is-next':''}`} key={episode.id} disabled={!playable} onClick={()=>playable&&navigate(`/player/${episode.id}`)}><div className="episode-still" style={{'--a':item.palette[0],'--b':item.palette[1]} as React.CSSProperties}>{episode.still?<img src={posterUrl(episode.still)} alt="" loading="lazy" decoding="async" onError={event=>{event.currentTarget.style.display='none'}}/>:<span>{item.symbol}</span>}{playable&&<span className="episode-play"><Play size={18} fill="currentColor"/></span>}{episode.progress>0.02&&<i className="episode-progress" style={{width:`${Math.min(100,Math.round(episode.progress*100))}%`}}/>}</div><div className="episode-body"><strong>E{String(episode.episode).padStart(2,'0')} · {episode.title}{episode.id===nextId&&playable&&<em> · à suivre</em>}{episode.versions>1&&<em> · {episode.versions} versions</em>}</strong>{episode.overview&&<p>{episode.overview}</p>}</div></button>})}</div></div>)}</div>}</div>
  </div>;
}

// On ne propose de noter qu'à la fin d'un film : quitter au bout de vingt
// minutes n'est pas un avis sur l'œuvre.
const RATE_WINDOW_SECONDS=600;
function reachedEnding(position:number,duration:number){return duration>0&&position>=duration-RATE_WINDOW_SECONDS}

function PlayerPage({profile}:{profile:Profile}) {
  const { id } = useParams(); const navigate=useNavigate(); const [searchParams]=useSearchParams(); const restart=searchParams.get('restart')==='1'; const {item,isLocal:localMedia}=useResolvedMedia(id); const isLocal=localMedia&&Boolean(id);
  const [status,setStatus]=useState<PlayerStatus|null>(null);
  const [panel,setPanel]=useState<'sub'|'audio'|null>(null);
  const [error,setError]=useState('');
  const [nextEp,setNextEp]=useState<{id:string;title:string}|null>(null);
  const positionRef=useRef(0); const durationRef=useRef(0); const wasRunningRef=useRef(false);
  const control=useCallback((command:string,value?:number|string)=>fetch('/api/player/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command,value})}),[]);
  const persist=useCallback((keepalive=false)=>{if(!isLocal||!id||durationRef.current<=0)return;void fetch(`/api/playback/${encodeURIComponent(profile.id)}/${encodeURIComponent(id)}`,{method:'PUT',keepalive,headers:{'Content-Type':'application/json'},body:JSON.stringify({position:positionRef.current,duration:durationRef.current})}).catch(()=>{})},[id,isLocal,profile.id]);
  useEffect(()=>{if(!isLocal||!id){setNextEp(null);return}let active=true;setNextEp(null);(async()=>{let startPosition=0;if(!restart)try{const resume=await fetch(`/api/playback/${encodeURIComponent(profile.id)}`);if(resume.ok){const rows=await resume.json() as Array<{mediaId:string;position:number}>;startPosition=rows.find(row=>row.mediaId===id)?.position??0}}catch{}try{const response=await fetch(`/api/player/${encodeURIComponent(id)}/play`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({startPosition})});if(!response.ok)throw new Error();const data=await response.json().catch(()=>({})) as {nextMediaId?:string|null;nextTitle?:string|null};if(active&&data.nextMediaId)setNextEp({id:data.nextMediaId,title:data.nextTitle??'Épisode suivant'})}catch{if(active)setError('Le lecteur mpv est indisponible sur cet appareil.')}})();return()=>{active=false}},[id,isLocal,profile.id,restart]);
  useEffect(()=>{if(!isLocal)return;let active=true;const tick=async()=>{try{const response=await fetch('/api/player/status');if(!response.ok)return;const next=await response.json() as PlayerStatus;if(!active)return;setStatus(next);if(next.running){positionRef.current=next.position??0;durationRef.current=next.duration??0}}catch{}};void tick();const interval=setInterval(()=>void tick(),1000);return()=>{active=false;clearInterval(interval)}},[isLocal]);
  useEffect(()=>{if(!isLocal)return;const interval=setInterval(()=>persist(),10000);const onHide=()=>persist(true);window.addEventListener('pagehide',onHide);return()=>{clearInterval(interval);window.removeEventListener('pagehide',onHide);persist(true)}},[isLocal,persist]);
  const advance=useCallback((target:string)=>{persist(true);setPanel(null);navigate(`/player/${target}`)},[persist,navigate]);
  // mpv s'est arrêté (fin du média ou « Retour » sur la vidéo) : on enchaîne sur
  // l'épisode suivant s'il y en a un, sinon on quitte le lecteur.
  useEffect(()=>{const running=Boolean(status?.running);if(wasRunningRef.current&&!running){if(nextEp&&durationRef.current>0)advance(nextEp.id);else{persist(true);{if(reachedEnding(positionRef.current,durationRef.current))navigate(`/rate/${item.id}`);else navigate(-1)}}}wasRunningRef.current=running},[status,nextEp,advance,persist,navigate,item.id]);
  const finish=async()=>{persist(true);await control('stop').catch(()=>{});{if(reachedEnding(positionRef.current,durationRef.current))navigate(`/rate/${item.id}`);else navigate(-1)}};
  const leave=()=>{persist(true);void control('stop').catch(()=>{});navigate(-1)};
  const running=Boolean(status?.running);const playing=status?.playing??true;const position=status?.position??0;const duration=status?.duration??0;
  const pct=duration>0?Math.min(100,(position/duration)*100):0;
  const seek:React.MouseEventHandler<HTMLDivElement>=event=>{if(!running||duration<=0)return;const rect=event.currentTarget.getBoundingClientRect();const ratio=Math.min(1,Math.max(0,(event.clientX-rect.left)/rect.width));void control('seek-to',Math.round(ratio*duration))};
  const audioTracks=status?.audioTracks??[]; const subtitleTracks=status?.subtitleTracks??[];
  const nearEnd=running&&duration>0&&position>=duration-25;
  const chromeVisible=usePlayerChrome({enabled:isLocal,onSeekBy:delta=>{if(running&&duration>0)void control('seek-to',Math.min(duration,Math.max(0,positionRef.current+delta)))},onTogglePlay:()=>{if(running)void control(playing?'pause':'play')},onExit:leave});
  return <div className={`player ${chromeVisible?'':'chrome-hidden'}`} style={{ '--a': item.palette[0], '--b': item.palette[1], backgroundImage:`linear-gradient(105deg,rgba(1,7,14,.5),transparent 60%), url('${posterUrl(item.art)??'/assets/sceneroot-landscape.jpg'}')` } as React.CSSProperties}>
    <div className="player__scene"><span>{item.symbol}</span><i/></div><div className="player__top"><Brand compact/><div><h1>{item.title}</h1><p>{item.kind === 'film'?'Film':'Série'} · {item.year} · {item.duration} · {item.quality}</p>{isLocal?(error?<small className="player-note">{error}</small>:running?<small className="player-note">Lecture native mpv sur le téléviseur.</small>:<small className="player-note">Démarrage du lecteur…</small>):<small className="player-note">Ce titre n’est pas encore dans votre médiathèque locale.</small>}</div></div>
    {panel==='audio' && <div className="track-panel"><h3><Volume2/>Piste audio</h3>{audioTracks.length?audioTracks.map(track=><button className={track.selected?'active':''} key={track.id} onClick={()=>void control('set-audio',track.id)}>{track.label}{track.selected&&<Check/>}</button>):<button disabled>Aucune piste détectée</button>}</div>}
    {panel==='sub' && <div className="track-panel"><h3><Subtitles/>Sous-titres</h3><button className={subtitleTracks.every(track=>!track.selected)?'active':''} onClick={()=>void control('set-subtitle','no')}>Désactivés{subtitleTracks.every(track=>!track.selected)&&<Check/>}</button>{subtitleTracks.map(track=><button className={track.selected?'active':''} key={track.id} onClick={()=>void control('set-subtitle',track.id)}>{track.label}{track.selected&&<Check/>}</button>)}</div>}
    <div className="player__controls"><div className="timeline"><span>{formatTime(position)}</span><i onClick={seek} role="slider" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} tabIndex={0}><b style={{width:`${pct}%`}}/></i><span>-{formatTime(Math.max(0,duration-position))}</span></div><div className="controls-row"><button onClick={leave}><ArrowLeft/>Retour</button><button onClick={()=>void control('seek-back')} disabled={!running}><RotateCcw/>-10s</button><button className="round" onClick={()=>void control(playing?'pause':'play')} disabled={!running}>{playing?<Pause fill="currentColor"/>:<Play fill="currentColor"/>}</button><button onClick={()=>void control('seek-forward')} disabled={!running}><Timer/>+30s</button><div className="controls-spacer"/>{nextEp&&<button onClick={()=>advance(nextEp.id)}><ChevronRight/>Épisode suivant</button>}<button onClick={finish}><Check/>Terminer</button><button className={panel==='sub'?'selected':''} onClick={()=>setPanel(panel==='sub'?null:'sub')}><Subtitles/>Sous-titres</button><button className={panel==='audio'?'selected':''} onClick={()=>setPanel(panel==='audio'?null:'audio')}><Volume2/>Audio</button></div></div>
    {nearEnd&&nextEp&&<button className="next-episode-card" onClick={()=>advance(nextEp.id)}><span className="next-episode-label">À suivre</span><strong>{nextEp.title}</strong><span className="next-episode-cta"><Play size={16} fill="currentColor"/> Lire l’épisode suivant</span></button>}
  </div>;
}

function StreamPlayerPage({profile}:{profile:Profile}) {
  const {id}=useParams(); const navigate=useNavigate(); const torrentId=Number(id);
  const [phase,setPhase]=useState<'buffering'|'playing'|'error'>('buffering');
  const [buffered,setBuffered]=useState(0); const [name,setName]=useState(''); const [errorMsg,setErrorMsg]=useState('');
  const [status,setStatus]=useState<PlayerStatus|null>(null); const [panel,setPanel]=useState<'sub'|'audio'|null>(null);
  const positionRef=useRef(0); const durationRef=useRef(0); const mediaIdRef=useRef<string>('');
  const control=useCallback((command:string,value?:number|string)=>fetch('/api/player/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command,value})}),[]);
  const persist=useCallback((keepalive=false)=>{if(!mediaIdRef.current||durationRef.current<=0)return;void fetch(`/api/playback/${encodeURIComponent(profile.id)}/${encodeURIComponent(mediaIdRef.current)}`,{method:'PUT',keepalive,headers:{'Content-Type':'application/json'},body:JSON.stringify({position:positionRef.current,duration:durationRef.current})}).catch(()=>{})},[profile.id]);
  useEffect(()=>{if(!Number.isFinite(torrentId))return;let active=true;let timer:ReturnType<typeof setTimeout>|undefined;const attempt=async()=>{try{const response=await fetch(`/api/downloads/${torrentId}/play`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await response.json().catch(()=>({})) as {ready?:boolean;buffered?:number;name?:string;mediaId?:string;error?:string};if(!active)return;if(!response.ok){setErrorMsg(data.error??'Lecture indisponible');setPhase('error');return}setBuffered(data.buffered??0);if(data.name)setName(data.name);if(data.ready){mediaIdRef.current=data.mediaId??'';setPhase('playing')}else{timer=setTimeout(()=>void attempt(),2000)}}catch{if(active){setErrorMsg('Serveur indisponible');setPhase('error')}}};void attempt();return()=>{active=false;if(timer)clearTimeout(timer)}},[torrentId]);
  useEffect(()=>{if(phase!=='playing')return;let active=true;const tick=async()=>{try{const response=await fetch('/api/player/status');if(!response.ok)return;const next=await response.json() as PlayerStatus;if(!active)return;setStatus(next);if(next.running){positionRef.current=next.position??0;durationRef.current=next.duration??0}}catch{}};void tick();const interval=setInterval(()=>void tick(),1000);return()=>{active=false;clearInterval(interval)}},[phase]);
  useEffect(()=>{if(phase!=='playing')return;const interval=setInterval(()=>persist(),10000);const onHide=()=>persist(true);window.addEventListener('pagehide',onHide);return()=>{clearInterval(interval);window.removeEventListener('pagehide',onHide);persist(true)}},[phase,persist]);
  const finish=async()=>{persist(true);await control('stop').catch(()=>{});navigate(mediaIdRef.current&&reachedEnding(positionRef.current,durationRef.current)?`/rate/${mediaIdRef.current}`:'/downloads')};
  const running=Boolean(status?.running);const playing=status?.playing??true;const position=status?.position??0;const duration=status?.duration??0;
  const leaveStream=()=>{persist(true);void control('stop').catch(()=>{});navigate(-1)};
  const chromeVisible=usePlayerChrome({enabled:phase==='playing',onSeekBy:delta=>{if(running&&duration>0)void control('seek-to',Math.min(duration,Math.max(0,positionRef.current+delta)))},onTogglePlay:()=>{if(running)void control(playing?'pause':'play')},onExit:leaveStream});
  if(phase!=='playing')return <div className="player stream-buffering" style={{backgroundImage:`linear-gradient(105deg,rgba(1,7,14,.7),transparent 60%), url('/assets/sceneroot-landscape.jpg')`}}>
    <div className="buffering-card">{phase==='error'?<><Download/><h1>Lecture indisponible</h1><p>{errorMsg}</p><div className="controls-row"><button onClick={()=>navigate('/downloads')}><Download/>Voir les téléchargements</button><button onClick={()=>navigate(-1)}><ArrowLeft/>Retour</button></div></>:<><span className="buffering-spinner"/><h1>Mise en mémoire tampon…</h1><p>{name||'Préparation du flux'}</p><div className="buffering-bar"><i style={{width:`${Math.min(100,Math.round(buffered*100))}%`}}/></div><small>{Math.round(buffered*100)}% mis en tampon · la lecture démarre automatiquement</small><div className="controls-row"><button onClick={()=>navigate('/downloads')}><Download/>Suivre le téléchargement</button><button onClick={()=>navigate(-1)}><ArrowLeft/>Annuler</button></div></>}</div>
  </div>;
  const pct=duration>0?Math.min(100,(position/duration)*100):0;
  const seek:React.MouseEventHandler<HTMLDivElement>=event=>{if(!running||duration<=0)return;const rect=event.currentTarget.getBoundingClientRect();const ratio=Math.min(1,Math.max(0,(event.clientX-rect.left)/rect.width));void control('seek-to',Math.round(ratio*duration))};
  const audioTracks=status?.audioTracks??[];const subtitleTracks=status?.subtitleTracks??[];
  return <div className={`player ${chromeVisible?'':'chrome-hidden'}`} style={{backgroundImage:`linear-gradient(105deg,rgba(1,7,14,.5),transparent 60%), url('/assets/sceneroot-landscape.jpg')`}}>
    <div className="player__scene"><span>▥</span><i/></div><div className="player__top"><Brand compact/><div><h1>{name||'Lecture en cours'}</h1><p>Lecture progressive · téléchargement en cours</p></div></div>
    {panel==='audio' && <div className="track-panel"><h3><Volume2/>Piste audio</h3>{audioTracks.length?audioTracks.map(track=><button className={track.selected?'active':''} key={track.id} onClick={()=>void control('set-audio',track.id)}>{track.label}{track.selected&&<Check/>}</button>):<button disabled>Aucune piste détectée</button>}</div>}
    {panel==='sub' && <div className="track-panel"><h3><Subtitles/>Sous-titres</h3><button className={subtitleTracks.every(track=>!track.selected)?'active':''} onClick={()=>void control('set-subtitle','no')}>Désactivés{subtitleTracks.every(track=>!track.selected)&&<Check/>}</button>{subtitleTracks.map(track=><button className={track.selected?'active':''} key={track.id} onClick={()=>void control('set-subtitle',track.id)}>{track.label}{track.selected&&<Check/>}</button>)}</div>}
    <div className="player__controls"><div className="timeline"><span>{formatTime(position)}</span><i onClick={seek} role="slider" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} tabIndex={0}><b style={{width:`${pct}%`}}/></i><span>-{formatTime(Math.max(0,duration-position))}</span></div><div className="controls-row"><button onClick={()=>{persist(true);navigate(-1)}}><ArrowLeft/>Retour</button><button onClick={()=>void control('seek-back')} disabled={!running}><RotateCcw/>-10s</button><button className="round" onClick={()=>void control(playing?'pause':'play')} disabled={!running}>{playing?<Pause fill="currentColor"/>:<Play fill="currentColor"/>}</button><button onClick={()=>void control('seek-forward')} disabled={!running}><Timer/>+30s</button><div className="controls-spacer"/><button onClick={finish}><Check/>Terminer</button><button className={panel==='sub'?'selected':''} onClick={()=>setPanel(panel==='sub'?null:'sub')}><Subtitles/>Sous-titres</button><button className={panel==='audio'?'selected':''} onClick={()=>setPanel(panel==='audio'?null:'audio')}><Volume2/>Audio</button></div></div>
  </div>;
}

function RatingPage({profile}:{profile:Profile}) {
  const {id}=useParams();const navigate=useNavigate();const item=resolveMedia(id);const [score,setScore]=useState(4);const [tags,setTags]=useState<string[]>([]);const [saving,setSaving]=useState(false);
  const toggle=(tag:string)=>setTags(current=>current.includes(tag)?current.filter(x=>x!==tag):[...current,tag]);
  const save=async()=>{setSaving(true);try{await fetch('/api/ratings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profileId:profile.id,mediaId:id??item.id,score:score*2,tags})})}finally{navigate('/roots')}};
  return <div className="rating-page" style={{backgroundImage:`linear-gradient(90deg,rgba(2,8,17,.72),rgba(2,8,17,.58)),url('${posterUrl(item.art)??'/assets/sceneroot-landscape.jpg'}')`}}><Brand compact/><div className="rating-card"><span className="rating-icon"><Film/></span><h1>Vous avez terminé<br/>« {item.title} »</h1><p>Merci d’avoir regardé ! Que pensez-vous de ce {item.kind==='film'?'film':'programme'} ?</p><div className="stars">{[1,2,3,4,5].map(value=><button key={value} onClick={()=>setScore(value)} aria-label={`${value} étoile${value>1?'s':''}`}><Star fill={value<=score?'currentColor':'transparent'}/></button>)}</div><strong>{score} / 5 — {score===5?'Excellent':score===4?'Très bien':score===3?'Bien':score===2?'Moyen':'Décevant'}</strong><div className="rating-tags"><button className={tags.includes('À revoir')?'on':''} onClick={()=>toggle('À revoir')}><RotateCcw/>À revoir</button><button className={tags.includes('Émouvant')?'on':''} onClick={()=>toggle('Émouvant')}><Heart/>Émouvant</button><button className={tags.includes('Surprenant')?'on':''} onClick={()=>toggle('Surprenant')}><Sparkles/>Surprenant</button><button className={tags.includes('Trop long')?'on':''} onClick={()=>toggle('Trop long')}><Hourglass/>Trop long</button></div><div className="rating-actions"><button className="primary" onClick={save} disabled={saving}><Star fill="currentColor"/>{saving?'Enregistrement…':'Noter maintenant'}</button><button className="secondary" onClick={()=>navigate('/')}><Clock3/>Plus tard</button></div><small><Users/>Vos avis nous aident à proposer des recommandations plus personnalisées.</small></div></div>;
}

type RootsTab='all'|'film'|'serie'|'favorites'|'rated'|'stats';
type ProfileStats={watched:number;rated:number;averageRating:number|null;films:number;series:number;topGenres:{genre:string;count:number}[];topTags:{tag:string;count:number}[];activity:{month:string;count:number}[];genreTimeline:{genre:string;total:number;months:number[]}[]};
const monthLabels=['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];
function RootsStats({profile}:{profile:Profile}){
  const [stats,setStats]=useState<ProfileStats|null>(null);const [loading,setLoading]=useState(true);
  useEffect(()=>{let active=true;fetch(`/api/stats/${encodeURIComponent(profile.id)}`).then(response=>response.ok?response.json():null).then((data:ProfileStats|null)=>{if(active){setStats(data);setLoading(false)}}).catch(()=>{if(active)setLoading(false)})},[profile.id]);
  if(loading)return <div className="library-loading"><i/>Calcul de vos statistiques…</div>;
  if(!stats||(!stats.watched&&!stats.rated))return <div className="library-empty"><BarChart3/><h2>Pas encore de statistiques</h2><p>Regardez et notez des contenus pour voir vos goûts se dessiner.</p></div>;
  const maxGenre=Math.max(1,...stats.topGenres.map(genre=>genre.count));const maxMonth=Math.max(1,...stats.activity.map(month=>month.count));
  return <div className="stats">
    <div className="stat-kpis"><div className="stat-kpi"><b>{stats.watched}</b><span>Vus</span></div><div className="stat-kpi"><b>{stats.rated}</b><span>Notés</span></div><div className="stat-kpi"><b>{stats.averageRating??'—'}</b><span>Note moyenne</span></div><div className="stat-kpi"><b>{stats.films}</b><span>Films</span></div><div className="stat-kpi"><b>{stats.series}</b><span>Séries</span></div></div>
    <div className="stat-panels">
      <div className="stat-card"><h3><Sparkles/>Genres préférés</h3>{stats.topGenres.length?<div className="stat-bars">{stats.topGenres.map(genre=><div className="stat-bar" key={genre.genre}><span>{genre.genre}</span><i><b style={{width:`${genre.count/maxGenre*100}%`}}/></i><em>{genre.count}</em></div>)}</div>:<p className="muted-note">Aucun genre pour l’instant.</p>}</div>
      <div className="stat-card"><h3><BarChart3/>Activité (6 mois)</h3><div className="stat-months">{stats.activity.map(month=>{const m=Number(month.month.slice(5,7))-1;return <div className="stat-month" key={month.month}><i style={{height:`${Math.max(4,month.count/maxMonth*100)}%`}} title={`${month.count} vu(s)`}/><span>{monthLabels[m]??''}</span></div>})}</div></div>
    </div>
    {stats.topTags.length>0&&<div className="stat-card"><h3><Heart/>Ressentis</h3><div className="stat-tags">{stats.topTags.map(tag=><span key={tag.tag}>{tag.tag} · {tag.count}</span>)}</div></div>}
    {stats.genreTimeline.some(branch=>branch.total>0)&&<div className="stat-card"><h3><Sparkles/>Évolution de vos goûts</h3><TasteTree branches={stats.genreTimeline}/></div>}
  </div>;
}
function RootsPage({profile}:{profile:Profile}) {
  const navigate=useNavigate(); const history=useHistory(profile.id); const {favorites,hidden}=usePreferences(profile.id); const [tab,setTab]=useState<RootsTab>('all');
  const visible=history.items.filter(item=>!hidden.has(item.id));
  const favItems=[...favorites].map(favId=>({favId,item:resolveMedia(favId)})).filter(entry=>entry.item.id===entry.favId).map(entry=>entry.item);
  const filtered=tab==='favorites'?favItems.filter(item=>!hidden.has(item.id)):visible.filter(item=>tab==='all'?true:tab==='rated'?item.rating>0:item.kind===tab);
  const tabs:[RootsTab,string,React.ReactNode][]=[['all','Déjà vus',<Clock3/>],['film','Films',<Film/>],['serie','Séries',<Tv/>],['favorites','Favoris',<Heart/>],['rated','Notés',<Star/>],['stats','Statistiques',<BarChart3/>]];
  return <><div className="welcome"><h1>Mes <em>Roots</em></h1><p>Votre historique de visionnage personnel.</p></div>
    <div className="stat-tabs">{tabs.map(([value,label,icon])=><button className={tab===value?'is-on':''} key={value} onClick={()=>setTab(value)}>{icon}{label}</button>)}</div>
    {tab==='stats'?<RootsStats profile={profile}/>:<>
    {history.loading&&<div className="library-loading"><i/>Lecture de votre historique…</div>}
    {!history.loading&&!filtered.length&&<div className="library-empty"><Clock3/><h2>Rien pour le moment</h2><p>Vos films et séries terminés ou notés apparaîtront ici.</p></div>}
    {filtered.length>0&&<div className="grid">{filtered.map((m,i)=><MediaCard item={m} active={i===0} key={m.id} onOpen={()=>navigate(`/title/${m.id}`)}/>)}</div>}</>}</> }

const torrentStatus:Record<number,string>={0:'En pause',1:'Vérif. en attente',2:'Vérification',3:'En file',4:'Téléchargement',5:'Envoi en file',6:'Partage'};
function formatEta(seconds:number){if(seconds<0)return null;if(seconds<60)return `${seconds} s`;const h=Math.floor(seconds/3600),m=Math.floor((seconds%3600)/60);return h>0?`${h} h ${m} min`:`${m} min`}
const downloadFilters=[{id:'all',label:'Tous'},{id:'active',label:'En cours'},{id:'done',label:'Terminés'}] as const;
type DownloadFilter=typeof downloadFilters[number]['id'];

function DownloadsPage() {
  const {torrents:allTorrents,error,loading,control}=useDownloads();
  const navigate=useNavigate();
  const [filter,setFilter]=useState<DownloadFilter>('all');
  const [opening,setOpening]=useState<number|null>(null);
  const [openError,setOpenError]=useState('');
  // Un téléchargement est terminé dès que le fichier est complet, qu'il soit
  // arrêté ou encore en partage.
  const isDone=(torrent:Torrent)=>torrent.percentDone>=1;
  const counts={all:allTorrents.length,active:allTorrents.filter(t=>!isDone(t)).length,done:allTorrents.filter(isDone).length};
  const torrents=allTorrents.filter(torrent=>filter==='all'||(filter==='done'?isDone(torrent):!isDone(torrent)));
  // « Lecture » ouvre la fiche du média : la médiathèque est indexée au besoin
  // pour que le fichier tout juste arrivé y figure.
  const openMedia=async(id:number)=>{setOpening(id);setOpenError('');try{
    const response=await fetch(`/api/downloads/${id}/media`);
    const payload=await response.json().catch(()=>({})) as {mediaId?:string;error?:string};
    if(!response.ok||!payload.mediaId)throw new Error(payload.error??'Fiche introuvable');
    navigate(`/title/${payload.mediaId}`);
  }catch(cause){setOpenError((cause as Error).message)}finally{setOpening(null)}};
  return <><div className="welcome"><h1>Téléchargements</h1><p>File Transmission en direct · 3 téléchargements simultanés maximum, les prioritaires en haut.</p></div>
    {allTorrents.length>0&&<div className="download-filters">{downloadFilters.map(entry=><button key={entry.id} className={`chip ${filter===entry.id?'is-on':''}`} onClick={()=>setFilter(entry.id)}>{entry.label} ({counts[entry.id]})</button>)}</div>}
    {openError&&<div className="profile-error">{openError}</div>}
    {loading&&!torrents.length&&<div className="library-loading"><i/>Connexion à Transmission…</div>}
    {error&&<div className="library-empty"><Download/><h2>Transmission indisponible</h2><p>{error}</p></div>}
    {!error&&!loading&&!torrents.length&&<div className="library-empty"><Download/><h2>{allTorrents.length?'Aucun téléchargement dans ce filtre':'Aucun téléchargement'}</h2><p>{allTorrents.length?'Changez de filtre pour voir les autres téléchargements.':'Lancez un téléchargement depuis une fiche pour le suivre ici.'}</p></div>}
    {torrents.length>0&&<div className="download-list">{torrents.map((torrent,index)=>{const pct=Math.round(torrent.percentDone*100);const paused=torrent.status===0;const downloading=torrent.status===3||torrent.status===4;const eta=downloading?formatEta(torrent.eta):null;return <div className="download-row" key={torrent.id}>
      <div className="download-order"><button className="icon-btn" title="Monter en priorité" disabled={index===0} onClick={()=>void control(torrent.id,'queue-top')}><ChevronsUp/></button><button className="icon-btn" title="Monter" disabled={index===0} onClick={()=>void control(torrent.id,'queue-up')}><ChevronUp/></button><button className="icon-btn" title="Descendre" disabled={index===torrents.length-1} onClick={()=>void control(torrent.id,'queue-down')}><ChevronDown/></button></div>
      <div className="download-info"><strong>{torrent.name}</strong><div className="download-badges"><span className={downloading?'score':''}>{torrentStatus[torrent.status]??'—'}</span><span>{pct}%</span><span>{formatBytes(torrent.sizeWhenDone||torrent.totalSize)}</span>{torrent.rateDownload>0&&<span>↓ {formatBytes(torrent.rateDownload)}/s</span>}{eta&&<span>reste {eta}</span>}<span>{torrent.peersConnected} pair{torrent.peersConnected>1?'s':''}</span>{torrent.errorString&&<span className="src">{torrent.errorString}</span>}</div><span className="progress"><i style={{width:`${pct}%`}}/></span></div>
      <div className="download-actions">{torrent.percentDone>=1&&<button className="primary download-play" disabled={opening===torrent.id} onClick={()=>void openMedia(torrent.id)}><Play fill="currentColor"/>{opening===torrent.id?'Ouverture…':'Lecture'}</button>}{paused?<button className="icon-btn" title="Reprendre" onClick={()=>void control(torrent.id,'start')}><Play fill="currentColor"/></button>:<button className="icon-btn" title="Mettre en pause" onClick={()=>void control(torrent.id,'stop')}><Pause/></button>}<button className="icon-btn" title="Annuler" onClick={()=>{if(window.confirm('Retirer ce téléchargement ? Les données déjà téléchargées sont conservées.'))void control(torrent.id,'remove',false)}}><Trash2/></button></div>
    </div>})}</div>}
  </>;
}
type StorageRoot={root:string;total:number;free:number;available:number;libraryBytes:number};
type MaskedSource={id:string;name:string;url:string;categories?:string;hasKey:boolean};
type AppSettings={minFreeGb:number;preferredQuality:string;preferredAudio:AudioChoice;preferredLanguages:string[];preferHdr:boolean;catalogSyncEnabled:boolean;tmdb:{configured:boolean;source:'environment'|'settings'|'none';maskedKey?:string};envSources:{id:string;name:string}[];sources:MaskedSource[]};
type CatalogStatus={available:boolean;total:number;syncing:boolean;sources:Array<{source:string;status:string;phase:string;processed:number;startedAt?:string;completedAt?:string;error?:string}>;progress?:{step:number;steps:number;ratio:number};databaseBytes:number;lastSyncAt?:string;nextSyncAt?:string;intervalHours:number;tmdb:{configured:boolean;source:string}};
type AudioChoice='vf'|'vostfr'|'vost'|'any';
const audioChoices:Array<[AudioChoice,string]>=[['vf','VF / TRUEFRENCH'],['vostfr','VOST FR'],['vost','VOST'],['any','Peu importe']];
function SettingsPage() {
  const navigateSettings=useNavigate();
  const [scan, setScan] = useState(false); const [scanMessage,setScanMessage]=useState('Surveillance active'); const [updates,setUpdates]=useState(true);
  const [cecStatus,setCecStatus]=useState<{available:boolean;bridgeActive:boolean;adapter:string|null}|null>(null);
  const [storage,setStorage]=useState<StorageRoot[]>([]);
  const [cache,setCache]=useState<{entries:number;bytes:number}|null>(null);
  const [purging,setPurging]=useState(false);
  const loadCache=()=>fetch('/api/cache').then(response=>response.ok?response.json():null).then((data:{entries:number;bytes:number}|null)=>setCache(data)).catch(()=>{});
  useEffect(()=>{fetch('/api/storage').then(response=>response.ok?response.json():[]).then((rows:StorageRoot[])=>setStorage(rows)).catch(()=>{});fetch('/api/cec/status').then(response=>response.ok?response.json():null).then((data:{available:boolean;bridgeActive:boolean;adapter:string|null}|null)=>setCecStatus(data)).catch(()=>{});void loadCache()},[]);
  const purgeCache=async()=>{setPurging(true);try{await fetch('/api/cache',{method:'DELETE'});await loadCache()}finally{setPurging(false)}};
  const [settings,setSettings]=useState<AppSettings|null>(null);
  const [catalogStatus,setCatalogStatus]=useState<CatalogStatus|null>(null);const [tmdbKey,setTmdbKey]=useState('');const [catalogMessage,setCatalogMessage]=useState('');const [savingCatalog,setSavingCatalog]=useState(false);
  const [newSource,setNewSource]=useState({name:'',url:'',apiKey:'',categories:''});const [sourceError,setSourceError]=useState('');const [addingSource,setAddingSource]=useState(false);
  const loadSettings=()=>fetch('/api/settings').then(response=>response.ok?response.json():null).then((data:AppSettings|null)=>setSettings(data)).catch(()=>{});
  const loadCatalogStatus=()=>fetch('/api/catalog/status').then(response=>response.ok?response.json():null).then((data:CatalogStatus|null)=>setCatalogStatus(data)).catch(()=>{});
  useEffect(()=>{void loadSettings();void loadCatalogStatus()},[]);
  useEffect(()=>{if(!catalogStatus?.syncing)return;const timer=setInterval(()=>void loadCatalogStatus(),2500);return()=>clearInterval(timer)},[catalogStatus?.syncing]);
  const imdbSync=catalogStatus?.sources.find(source=>source.source==='imdb');
  const saveTmdb=async(remove=false)=>{setSavingCatalog(true);setCatalogMessage('');try{const response=await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({tmdbApiKey:remove?null:tmdbKey})});const payload=await response.json().catch(()=>({})) as {error?:string};if(!response.ok)throw new Error(payload.error??'Enregistrement impossible');setTmdbKey('');setCatalogMessage(remove?'Clé supprimée : Wikipédia redevient la source de secours.':'Clé TMDB validée et enregistrée côté serveur.');await Promise.all([loadSettings(),loadCatalogStatus()])}catch(cause){setCatalogMessage((cause as Error).message)}finally{setSavingCatalog(false)}};
  const setCatalogSync=async(enabled:boolean)=>{setSettings(current=>current?{...current,catalogSyncEnabled:enabled}:current);await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({catalogSyncEnabled:enabled})});await loadCatalogStatus()};
  const syncCatalog=async()=>{setCatalogMessage('');const response=await fetch('/api/catalog/sync',{method:'POST'});const payload=await response.json().catch(()=>({})) as {error?:string};setCatalogMessage(response.ok?'Synchronisation IMDb démarrée en arrière-plan.':payload.error??'Synchronisation impossible.');await loadCatalogStatus()};
  const stopCatalogSync=async()=>{setCatalogMessage('');const response=await fetch('/api/catalog/sync/stop',{method:'POST'});const payload=await response.json().catch(()=>({})) as {error?:string};setCatalogMessage(response.ok?'Arrêt demandé : l’import s’interrompt au prochain lot.':payload.error??'Arrêt impossible.');await loadCatalogStatus()};
  // Les titres déjà importés sont perdus : on demande confirmation.
  const resetCatalog=async()=>{
    if(!window.confirm('Vider le catalogue local ? Les titres importés seront supprimés et une nouvelle synchronisation sera nécessaire.'))return;
    setCatalogMessage('Remise à zéro en cours…');
    const response=await fetch('/api/catalog',{method:'DELETE'});
    const payload=await response.json().catch(()=>({})) as {error?:string};
    setCatalogMessage(response.ok?'Catalogue vidé.':payload.error??'Remise à zéro impossible.');
    await loadCatalogStatus();
  };
  const saveAudio=(preferredAudio:AudioChoice)=>{setSettings(current=>current?{...current,preferredAudio}:current);void fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({preferredAudio})})};
  const saveQuality=(preferredQuality:string)=>{setSettings(current=>current?{...current,preferredQuality}:current);void fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({preferredQuality})})};
  const saveReserve=(minFreeGb:number)=>{setSettings(current=>current?{...current,minFreeGb}:current);void fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({minFreeGb})})};
  const addSource=async()=>{setSourceError('');setAddingSource(true);try{const response=await fetch('/api/sources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(newSource)});if(!response.ok){const payload=await response.json().catch(()=>({}));throw new Error((payload as {error?:string}).error??'Ajout impossible')}setNewSource({name:'',url:'',apiKey:'',categories:''});await loadSettings()}catch(cause){setSourceError((cause as Error).message)}finally{setAddingSource(false)}};
  const removeSource=async(id:string)=>{await fetch(`/api/sources/${id}`,{method:'DELETE'});await loadSettings()};
  const [health,setHealth]=useState<{addresses?:string[];port?:number}|null>(null);
  const [tokenInfo,setTokenInfo]=useState<{token:string|null;source:string;requireToken:boolean}|null>(null);const [generating,setGenerating]=useState(false);
  useEffect(()=>{fetch('/api/health').then(response=>response.ok?response.json():null).then(setHealth).catch(()=>{})},[]);
  const loadToken=()=>fetch('/api/admin-token').then(response=>response.ok?response.json():null).then((data:{token:string|null;source:string;requireToken:boolean}|null)=>setTokenInfo(data)).catch(()=>setTokenInfo(null));
  useEffect(()=>{void loadToken()},[]);
  const generateToken=async()=>{setGenerating(true);try{await fetch('/api/admin-token',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await loadToken()}finally{setGenerating(false)}};
  const adminUrl=useMemo(()=>{const addr=health?.addresses?.[0];const base=addr&&health?.port?`http://${addr}:${health.port}/admin.html`:`${location.origin}/admin.html`;return tokenInfo?.token?`${base}#t=${encodeURIComponent(tokenInfo.token)}`:base},[health,tokenInfo]);
  const totals=storage.reduce((acc,s)=>({total:acc.total+s.total,free:acc.free+s.free,library:acc.library+s.libraryBytes}),{total:0,free:0,library:0});
  const used=Math.max(0,totals.total-totals.free);
  const runScan=async()=>{setScan(true);setScanMessage('Analyse des emplacements…');try{const response=await fetch('/api/library/scan',{method:'POST'});const result=await response.json() as {items?:unknown[]};setScanMessage(`${result.items?.length??0} média(s) indexé(s)`)}catch{setScanMessage('Serveur indisponible — nouvel essai au prochain scan')}finally{setScan(false)}};
  return <><div className="welcome"><h1>Paramètres</h1><p>Configurez votre médiathèque, la lecture et l’appareil.</p></div><div className="settings-grid">
    <div className="settings-card"><h2><FolderOpen/>Médiathèque</h2><p>Dossiers analysés · <span className="online">{scanMessage}</span></p><div className="path"><HardDrive/> /mnt/media <Check/></div><button className="primary" onClick={runScan} disabled={scan}><RefreshCw className={scan?'spin':''}/>{scan?'Analyse en cours…':'Analyser maintenant'}</button></div>
    <div className="settings-card"><h2><Monitor/>Téléviseur & CEC</h2><Setting label="Pont de télécommande HDMI-CEC" value={Boolean(cecStatus?.bridgeActive&&cecStatus.available)}/><div className="path"><Monitor/> {cecStatus?.bridgeActive&&cecStatus.available?'Pont actif · adaptateur détecté':cecStatus?.available?'Adaptateur détecté · pont inactif':cecStatus?.bridgeActive?'Pont actif · aucun adaptateur détecté':'Aucun adaptateur CEC détecté'}</div>{cecStatus?.adapter&&<small>Périphérique : {cecStatus.adapter}</small>}<Setting label="Démarrer en plein écran" value={true}/><Setting label="Adapter le taux de rafraîchissement" value={true}/></div>
    <div className="settings-card"><h2><Download/>Téléchargements</h2><p>Client local</p><div className="path"><Wifi/> Transmission RPC <Check/></div>
      <div className="audio-choice"><strong>Langue audio préférée</strong><div>{audioChoices.map(([value,label])=><button key={value} className={`chip focusable ${(settings?.preferredAudio??'vf')===value?'is-on':''}`} onClick={()=>saveAudio(value)}>{label}</button>)}</div><small>Ajoutée à la recherche de torrents ; si aucune version ne correspond, la recherche est relancée sans ce filtre.</small></div>
      <div className="audio-choice"><strong>Qualité préférée</strong><div>{(['720p','1080p','2160p'] as const).map(value=><button key={value} className={`chip focusable ${(settings?.preferredQuality??'1080p')===value?'is-on':''}`} onClick={()=>saveQuality(value)}>{value==='2160p'?'4K':value}</button>)}</div></div><label className="reserve-field">Réserve d’espace disque : <b>{settings?.minFreeGb??50} Go</b><input type="range" min={5} max={500} step={5} value={settings?.minFreeGb??50} onChange={event=>saveReserve(Number(event.target.value))}/></label><small>SceneRoot refuse un téléchargement qui passerait sous cette réserve. Les torrents doivent provenir de contenus que vous êtes autorisé à télécharger.</small></div>
    <div className="settings-card storage"><h2><BarChart3/>Stockage</h2>{storage.length?<><div className="storage-number"><b>{formatBytes(used)}</b> / {formatBytes(totals.total)} utilisés</div><div className="storage-bar"><i style={{width:`${totals.total?Math.min(100,totals.library/totals.total*100):0}%`}}/><i style={{width:`${totals.total?Math.min(100,Math.max(0,used-totals.library)/totals.total*100):0}%`}}/></div><div className="storage-key"><span>Médiathèque indexée {formatBytes(totals.library)}</span><span>Catalogue local {formatBytes(catalogStatus?.databaseBytes??0,'—')}</span><span>Espace libre {formatBytes(totals.free)}</span></div><p>{storage.length} emplacement{storage.length>1?'s':''} de stockage surveillé{storage.length>1?'s':''}.</p></>:<p>Aucun emplacement de stockage détecté. Configurez <code>SCENEROOT_MEDIA</code> puis relancez une analyse.</p>}</div>
    <div className="settings-card"><h2><ShieldCheck/>Système</h2><Setting label="Mises à jour automatiques" value={updates} setValue={setUpdates}/>{cache&&<div className="path"><HardDrive/> Cache HTTP : {formatBytes(cache.bytes)} · {cache.entries} fichier{cache.entries>1?'s':''}</div>}<button className="secondary" onClick={()=>void purgeCache()} disabled={purging||!cache?.entries}><Trash2 className={purging?'spin':''}/>{purging?'Purge en cours…':'Purger le cache HTTP'}</button><button className="path path-button" onClick={()=>navigateSettings('/about')}><ShieldCheck/> À propos & attributions</button><div className="version">SceneRoot v0.1.0 <span>À jour</span></div></div>
    <div className="settings-card catalog-settings"><h2><Film/>Catalogue local</h2><p><b>{(catalogStatus?.total??0).toLocaleString('fr-FR')}</b> films et séries dans SQLite · {formatBytes(catalogStatus?.databaseBytes??0,'0 o')} sur le disque.</p><Setting label={`Synchronisation IMDb automatique (toutes les ${Math.round(catalogStatus?.intervalHours??24)} h)`} value={settings?.catalogSyncEnabled??false} setValue={value=>void setCatalogSync(value)}/><div className="path"><HardDrive/> {imdbSync?.status==='error'?`Échec : ${imdbSync.error??'erreur inconnue'}`:catalogStatus?.syncing?imdbSync?.phase??'Synchronisation en cours…':imdbSync?.phase??'Catalogue IMDb non synchronisé'}</div>{catalogStatus?.syncing&&<><div className="sync-progress"><i style={{width:`${Math.round((catalogStatus.progress?.ratio??0)*100)}%`}}/></div><small>Étape {(catalogStatus.progress?.step??0)+1}/{catalogStatus.progress?.steps??4} · {(imdbSync?.processed??0).toLocaleString('fr-FR')} lignes traitées · l’import continue en arrière-plan, vous pouvez quitter cette page.</small></>}<small className="sync-dates">Dernière synchronisation : {formatDateTime(catalogStatus?.lastSyncAt)}{settings?.catalogSyncEnabled&&catalogStatus?.nextSyncAt&&!catalogStatus.syncing?` · prochaine : ${formatDateTime(catalogStatus.nextSyncAt)}`:''}</small><div className="catalog-actions"><button className="secondary" onClick={()=>void syncCatalog()} disabled={catalogStatus?.syncing||!catalogStatus?.available}><RefreshCw className={catalogStatus?.syncing?'spin':''}/>{catalogStatus?.syncing?'Synchronisation…':imdbSync?.completedAt||imdbSync?.processed?'Relancer la synchronisation':'Synchroniser maintenant'}</button>{catalogStatus?.syncing&&<button className="secondary" onClick={()=>void stopCatalogSync()}><Pause/>Arrêter</button>}<button className="danger-button" onClick={()=>void resetCatalog()} disabled={!catalogStatus?.available}><Trash2/>Réinitialiser le catalogue</button></div><small>IMDb fournit l’inventaire, les notes et la structure des épisodes. La mise à jour complète peut prendre du temps et plusieurs Go lors du premier import.</small></div>
    <div className="settings-card catalog-settings"><h2><Film/>Métadonnées françaises TMDB</h2><p>{settings?.tmdb.configured?<>Clé configurée via <b>{settings.tmdb.source==='environment'?'l’environnement':'SceneRoot'}</b> · {settings.tmdb.maskedKey}</>:<>Aucune clé : Wikipédia est utilisé uniquement pour les résumés de secours.</>}</p><div className="source-form"><input type="password" autoComplete="off" placeholder="Clé API TMDB v3" value={tmdbKey} disabled={settings?.tmdb.source==='environment'} onChange={event=>setTmdbKey(event.target.value)}/></div>{catalogMessage&&<div className="path">{catalogMessage}</div>}<button className="primary" onClick={()=>void saveTmdb()} disabled={savingCatalog||!tmdbKey.trim()||settings?.tmdb.source==='environment'}><Check/>{savingCatalog?'Validation…':'Valider la clé TMDB'}</button>{settings?.tmdb.source==='settings'&&<button className="secondary" onClick={()=>void saveTmdb(true)} disabled={savingCatalog}><Trash2/>Supprimer la clé</button>}<small>La clé reste côté serveur, n’est jamais renvoyée en clair au navigateur et sert à enrichir paresseusement les titres affichés.</small></div>
    <div className="settings-card mobile-access"><h2><Monitor/>Réglages depuis un mobile</h2><p>Scannez ce QR code avec votre téléphone pour ouvrir le panneau de réglages.</p><div className="qr-wrap"><QRCode value={adminUrl}/></div><a className="path" href={adminUrl} target="_blank" rel="noreferrer"><Wifi/> {adminUrl.split('#')[0]}</a>
      {tokenInfo?(tokenInfo.token?<div className="path"><ShieldCheck/> Jeton : <code>{tokenInfo.token}</code>{tokenInfo.source==='app'&&<button className="path-button" style={{width:'auto',padding:'4px 10px'}} onClick={()=>void generateToken()} disabled={generating}><RefreshCw className={generating?'spin':''}/>Régénérer</button>}</div>:<button className="secondary" onClick={()=>void generateToken()} disabled={generating}><ShieldCheck/>{generating?'Génération…':'Générer un jeton d’administration'}</button>):<small>Jeton visible uniquement depuis l’écran du téléviseur.</small>}
      <small>{tokenInfo?.requireToken?'Mode strict : un jeton est requis même sur le réseau local.':'Sur votre réseau local, les réglages fonctionnent sans jeton. Le jeton n’est utile que pour un accès hors du domicile ou en mode strict (SCENEROOT_REQUIRE_TOKEN=1).'} Le QR pré-remplit le jeton sur le mobile.</small></div>
    <div className="settings-card sources"><h2><Wifi/>Sources de recherche</h2>
      {settings?.envSources.map(source=><div className="source-row" key={source.id}><span><b>{source.name}</b><small>Configurée par l’environnement</small></span><i className="dot"/></div>)}
      {settings?.sources.map(source=><div className="source-row" key={source.id}><span><b>{source.name}</b><small>{source.url}{source.hasKey?' · clé API':''}</small></span><button className="icon-btn" title="Supprimer" onClick={()=>void removeSource(source.id)}><Trash2/></button></div>)}
      {!settings?.envSources.length&&!settings?.sources.length&&<p>Aucune source configurée.</p>}
      <div className="source-form"><input placeholder="Nom" value={newSource.name} onChange={event=>setNewSource(current=>({...current,name:event.target.value}))}/><input placeholder="URL Torznab (https://…)" value={newSource.url} onChange={event=>setNewSource(current=>({...current,url:event.target.value}))}/><input placeholder="Clé API (facultatif)" value={newSource.apiKey} onChange={event=>setNewSource(current=>({...current,apiKey:event.target.value}))}/><input placeholder="Catégories (ex. 2000,5000)" value={newSource.categories} onChange={event=>setNewSource(current=>({...current,categories:event.target.value}))}/></div>
      {sourceError&&<div className="profile-error">{sourceError}</div>}
      <button className="secondary" onClick={()=>void addSource()} disabled={addingSource||!newSource.name.trim()||!newSource.url.trim()}><Plus/>{addingSource?'Ajout…':'Ajouter une source Torznab'}</button>
      <small>Utilisez uniquement des sources et contenus que vous êtes autorisé à récupérer.</small></div>
  </div></>;
}
function Setting({label,value,setValue}:{label:string;value:boolean;setValue?:(v:boolean)=>void}) { return <button className="setting" onClick={()=>setValue?.(!value)}><span>{label}</span><i className={value?'on':''}><b/></i></button> }

type Attribution={name:string;role:string;license:string;url:string};
const dataSources:Attribution[]=[
  {name:'IMDb Datasets',role:'Inventaire local des films, séries, notes et relations épisodes',license:'Non-commercial datasets',url:'https://developer.imdb.com/non-commercial-datasets/'},
  {name:'The Movie Database (TMDB)',role:'Titres, affiches et résumés français',license:'API TMDB',url:'https://www.themoviedb.org/'},
  {name:'TVmaze',role:'Secours pour la structure et les fiches d’épisodes',license:'API TVmaze (CC BY-SA 4.0)',url:'https://www.tvmaze.com/api'},
  {name:'Wikidata',role:'Correspondance entre identifiants IMDb, TMDB et autres bases',license:'CC0',url:'https://www.wikidata.org/'},
  {name:'Wikipédia / MediaWiki',role:'Résumé de secours uniquement lorsqu’aucune fiche française n’est disponible',license:'Contenu sous CC BY-SA',url:'https://www.mediawiki.org/wiki/API:Main_page'},
];
const software:Attribution[]=[
  {name:'mpv',role:'Lecture vidéo native (HEVC, HDR, multi-pistes)',license:'GPLv2+ / LGPL',url:'https://mpv.io/'},
  {name:'FFmpeg / ffprobe',role:'Analyse des fichiers média',license:'LGPL / GPL',url:'https://ffmpeg.org/'},
  {name:'Transmission',role:'Téléchargements',license:'GPLv2 / MIT',url:'https://transmissionbt.com/'},
  {name:'Chromium',role:'Interface en mode kiosque',license:'BSD',url:'https://www.chromium.org/'},
  {name:'React · Vite · lucide-react',role:'Interface et icônes',license:'MIT / ISC',url:'https://react.dev/'},
];
function AboutPage(){
  const navigate=useNavigate();
  return <div className="about"><button className="back focusable" onClick={()=>navigate(-1)}><ArrowLeft/> Retour</button>
    <div className="welcome"><h1>À propos & attributions</h1><p>SceneRoot s’appuie sur des services et des logiciels tiers. Merci à leurs auteurs.</p></div>
    <div className="about-card tmdb-notice"><Film/><p><strong>Ce produit utilise l’API TMDB mais n’est ni approuvé ni certifié par TMDB.</strong><br/>This product uses the TMDB API but is not endorsed or certified by TMDB.</p></div>
    <div className="about-section"><h2>Sources de données</h2>{dataSources.map(item=><a className="about-item" href={item.url} target="_blank" rel="noreferrer" key={item.name}><div><strong>{item.name}</strong><small>{item.role}</small></div><span>{item.license}</span></a>)}</div>
    <div className="about-section"><h2>Lecture, système et interface</h2>{software.map(item=><a className="about-item" href={item.url} target="_blank" rel="noreferrer" key={item.name}><div><strong>{item.name}</strong><small>{item.role}</small></div><span>{item.license}</span></a>)}</div>
    <div className="about-section"><h2>SceneRoot</h2><p className="about-note">Media center familial pour Raspberry Pi. Utilisez uniquement des sources et des contenus que vous êtes autorisé à récupérer et à lire. SceneRoot v0.1.0.</p></div>
  </div>;
}

function App() {
  const [booting,setBooting]=useState(true);
  const [savedProfiles,setSavedProfiles]=useState<Profile[]>([]);
  const [profilesLoaded,setProfilesLoaded]=useState(false);
  const [setupComplete,setSetupComplete]=useState<boolean|null>(null);
  const [profile,setProfile]=useState<Profile|null>(()=>{try{const stored=JSON.parse(localStorage.getItem('sceneroot-profile')||'null') as Profile|null;if(stored&&['nicolas','cathy','nathan','lucie'].includes(stored.id)){localStorage.removeItem('sceneroot-profile');return null}return stored}catch{return null}});
  const refetchProfiles=useCallback(()=>fetch('/api/profiles').then(response=>response.ok?response.json():[]).then((items:Profile[])=>setSavedProfiles(items)).catch(()=>setSavedProfiles([])).finally(()=>setProfilesLoaded(true)),[]);
  useEffect(()=>{const timer=setTimeout(()=>setBooting(false),1450);return()=>clearTimeout(timer)},[]);
  useEffect(()=>{void refetchProfiles()},[refetchProfiles]);
  // Les profils se modifient aussi depuis le panneau mobile : on les relit
  // régulièrement et au retour sur l'écran, sinon la TV garde l'ancienne liste.
  useEffect(()=>{
    const timer=setInterval(()=>void refetchProfiles(),20_000);
    const onWake=()=>{if(!document.hidden)void refetchProfiles()};
    document.addEventListener('visibilitychange',onWake);
    window.addEventListener('focus',onWake);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',onWake);window.removeEventListener('focus',onWake)};
  },[refetchProfiles]);
  // Le profil actif est mémorisé localement : on le réaligne sur le serveur
  // (nom, avatar, limite d'âge) et on le libère s'il a été supprimé.
  useEffect(()=>{
    if(!profilesLoaded||!profile)return;
    const fresh=savedProfiles.find(entry=>entry.id===profile.id);
    if(!fresh){localStorage.removeItem('sceneroot-profile');setProfile(null);return}
    if(JSON.stringify(fresh)===JSON.stringify(profile))return;
    localStorage.setItem('sceneroot-profile',JSON.stringify(fresh));
    setProfile(fresh);
  },[savedProfiles,profilesLoaded,profile]);
  useEffect(()=>{fetch('/api/settings').then(response=>response.ok?response.json():null).then((data:{setupComplete?:boolean}|null)=>setSetupComplete(Boolean(data?.setupComplete))).catch(()=>setSetupComplete(false))},[]);
  // Zoom d'interface pour la TV : le kiosque ouvre l'app avec ?tv=<facteur>, qu'on
  // mémorise pour que le réglage survive à la navigation (sans toucher au navigateur).
  useEffect(()=>{ try{
    const param=new URLSearchParams(window.location.search).get('tv');
    if(param)localStorage.setItem('sceneroot-tv-zoom',param);
    const zoom=localStorage.getItem('sceneroot-tv-zoom');
    // Le zoom est aussi exposé en variable CSS : une page qui doit tenir dans
    // l'écran (le lecteur) divise 100vh par ce facteur, sinon elle déborde.
    if(zoom&&Number(zoom)>0){document.documentElement.style.setProperty('zoom',zoom);document.documentElement.style.setProperty('--tv-zoom',zoom)}
  }catch{/* stockage indisponible : zoom par défaut */} },[]);
  // Masque le pointeur après quelques secondes sans mouvement (sur la TV il disparaît
  // et ne revient jamais ; sur un ordinateur il réapparaît au moindre déplacement).
  useEffect(()=>{ let timer:ReturnType<typeof setTimeout>;
    const hide=()=>document.body.classList.add('hide-cursor');
    const wake=()=>{ document.body.classList.remove('hide-cursor'); clearTimeout(timer); timer=setTimeout(hide,3000) };
    wake();
    window.addEventListener('mousemove',wake); window.addEventListener('mousedown',wake);
    return()=>{ clearTimeout(timer); window.removeEventListener('mousemove',wake); window.removeEventListener('mousedown',wake); document.body.classList.remove('hide-cursor') };
  },[]);
  // Navigation directionnelle à la télécommande : on parcourt les éléments
  // visibles, en restant dans la modale ouverte s'il y en a une.
  useEffect(()=>{
    const handle=(event:KeyboardEvent)=>{
      const direction=event.key as Direction;
      if(!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].includes(direction))return;
      const scope=[...document.querySelectorAll<HTMLElement>('.modal-backdrop')].pop()??document;
      const elements=[...scope.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(element=>element.offsetParent!==null);
      const current=document.activeElement as HTMLElement|null;
      const box=current?.getBoundingClientRect();
      if(!box||!elements.includes(current as HTMLElement)){elements[0]?.focus();return}
      // Dans un champ de saisie, les flèches horizontales déplacent le curseur.
      const editing=current instanceof HTMLInputElement||current instanceof HTMLTextAreaElement;
      if(editing&&(direction==='ArrowLeft'||direction==='ArrowRight'))return;
      const target=nextInDirection(box,elements.filter(element=>element!==current).map(element=>({item:element,box:element.getBoundingClientRect()})),direction);
      if(target){event.preventDefault();target.focus()}
    };
    addEventListener('keydown',handle);
    return()=>removeEventListener('keydown',handle);
  },[]);
  if(booting||setupComplete===null||!profilesLoaded)return <BootScreen/>;
  const needsSetup=savedProfiles.length===0;
  if(needsSetup&&!profile)return <SetupWizard onDone={created=>{setSetupComplete(true);if(created.length)setSavedProfiles(current=>[...current,...created.filter(item=>!current.some(existing=>existing.id===item.id))]);void refetchProfiles()}}/>;
  const availableProfiles=savedProfiles;
  const upsertProfile=(saved:Profile)=>setSavedProfiles(current=>current.some(item=>item.id===saved.id)?current.map(item=>item.id===saved.id?saved:item):[...current,saved]);
  const removeProfile=(deleted:Profile)=>{setSavedProfiles(current=>current.filter(item=>item.id!==deleted.id));if(profile?.id===deleted.id){localStorage.removeItem('sceneroot-profile');setProfile(null)}};
  if(!profile)return <ProfileGate availableProfiles={availableProfiles} onSaved={upsertProfile} onDeleted={removeProfile} onSelect={p=>{localStorage.setItem('sceneroot-profile',JSON.stringify(p));setProfile(p)}}/>;
  const switchProfile=()=>{localStorage.removeItem('sceneroot-profile');setProfile(null)};
  return <WatchedProvider profileId={profile.id}><Routes><Route path="/player/:id" element={<PlayerPage profile={profile}/>}/><Route path="/stream/:id" element={<StreamPlayerPage profile={profile}/>}/><Route path="/rate/:id" element={<RatingPage profile={profile}/>}/><Route path="/title/:id" element={<Shell profile={profile} onSwitchProfile={switchProfile}><DetailPage profile={profile}/></Shell>}/><Route path="*" element={<Shell profile={profile} onSwitchProfile={switchProfile}><Routes>
    <Route path="/" element={<HomePage profile={profile}/>}/><Route path="/films" element={<BrowsePage kind="film" title="Films"/>}/><Route path="/series" element={<BrowsePage kind="serie" title="Séries"/>}/><Route path="/discover" element={<BrowsePage title="Découvrir"/>}/><Route path="/tonight" element={<TonightPage availableProfiles={availableProfiles} profile={profile}/>}/><Route path="/library" element={<LibraryPage/>}/><Route path="/downloads" element={<DownloadsPage/>}/><Route path="/roots" element={<RootsPage profile={profile}/>}/><Route path="/search" element={<SearchPage/>}/><Route path="/settings" element={<SettingsPage/>}/><Route path="/about" element={<AboutPage/>}/>
  </Routes></Shell>}/></Routes></WatchedProvider>;
}
export default App;
