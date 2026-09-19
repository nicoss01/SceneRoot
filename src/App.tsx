import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BarChart3, Check, ChevronRight, Clock3, Download, Film, FolderOpen, HardDrive, Heart, Hourglass, Lock, Monitor, Pause, Pencil, Play, Plus, RefreshCw, RotateCcw, Search, ShieldCheck, Sparkles, Star, Subtitles, Timer, Trash2, Tv, Users, Volume2, Wifi, WandSparkles, X } from 'lucide-react';
import { Brand } from './components/Brand';
import { MediaCard } from './components/MediaCard';
import { MetadataMatcher } from './components/MetadataMatcher';
import { ProfileAvatar } from './components/ProfileAvatar';
import { ProfileEditor } from './components/ProfileEditor';
import { Shell } from './components/Shell';
import { media, profiles } from './data/demo';
import { resolveMedia } from './data/catalog';
import { allGenres } from './data/genres';
import { useCatalog } from './hooks/useCatalog';
import { useLibrary } from './hooks/useLibrary';
import { useHistory, useResume } from './hooks/usePlaybackHistory';
import { useLibraryGroup } from './hooks/useLibraryGroup';
import { DownloadPanel } from './components/DownloadPanel';
import { useDownloads } from './hooks/useDownloads';
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
  const isDefault=(id:string)=>profiles.some(base=>base.id===id);
  const [modal,setModal]=useState<'guest'|'profile'|'unlock'|null>(null);
  const [editing,setEditing]=useState<Profile|undefined>(); const [unlocking,setUnlocking]=useState<Profile|undefined>();
  const [pin,setPin]=useState(''); const [unlockError,setUnlockError]=useState('');
  const [age,setAge]=useState(18); const [guestTtl,setGuestTtl]=useState('shutdown');
  const createGuest=async()=>{const fallback:Profile={id:`guest-${Date.now()}`,name:'Invité',ageLimit:age,avatar:'I',accent:'#a78bfa'};try{const response=await fetch('/api/guests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ttl:guestTtl,ageLimit:age})});const result=await response.json() as {id?:string};onSelect({...fallback,id:result.id??fallback.id})}catch{onSelect(fallback)}};
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
    {modal==='profile'&&<ProfileEditor profile={editing} deletable={editing?!isDefault(editing.id):false} onClose={()=>setModal(null)} onSaved={saved=>{onSaved(saved);setModal(null);if(!editing)onSelect(saved)}} onDeleted={deleted=>{onDeleted(deleted);setModal(null)}}/>}
    {modal==='guest'&&<div className="modal-backdrop"><div className="profile-modal"><button className="modal-close" onClick={()=>setModal(null)}><X/></button><span className="modal-icon"><Users/></span><h2>Session invitée</h2><p>Cette session ne modifiera pas les recommandations de la famille.</p><label>Limite d’âge<select value={age} onChange={e=>setAge(Number(e.target.value))}><option value="18">Tout public</option><option value="10">-10</option><option value="13">-13</option><option value="16">-16</option></select></label><label>Conserver le profil<select value={guestTtl} onChange={e=>setGuestTtl(e.target.value)}><option value="shutdown">Jusqu’à extinction</option><option value="24h">24 heures</option><option value="7d">7 jours</option><option value="permanent">Conserver ce profil</option></select></label><button className="primary modal-submit" onClick={createGuest}>Commencer</button></div></div>}
    {modal==='unlock'&&unlocking&&<div className="modal-backdrop"><div className="profile-modal unlock-modal"><button className="modal-close" onClick={()=>setModal(null)}><X/></button><ProfileAvatar profile={unlocking}/><h2>{unlocking.name}</h2><p>Entrez le code de verrouillage de ce profil.</p><label>Code<input autoFocus type="password" inputMode="numeric" value={pin} onChange={event=>setPin(event.target.value.replace(/\D/g,'').slice(0,8))} onKeyDown={event=>{if(event.key==='Enter')void unlock()}}/></label>{unlockError&&<div className="profile-error">{unlockError}</div>}<button className="primary modal-submit" onClick={()=>void unlock()}><Lock/>Déverrouiller</button></div></div>}
  </div>;
}

function Section({ title, items, onOpen, wide = false }: { title: string; items: MediaItem[]; onOpen: (m: MediaItem) => void; wide?: boolean }) {
  return <section><div className="section-title"><h2>{title}</h2><button>Tout voir <ChevronRight size={18}/></button></div><div className="rail">{items.map((m, i) => <MediaCard key={m.id} item={m} active={i === 0} wide={wide} onOpen={() => onOpen(m)} />)}</div></section>;
}

function RemoteSection({ title, fallback, onOpen, kind }: { title:string; fallback:MediaItem[]; onOpen:(item:MediaItem)=>void; kind?:'film'|'serie' }) {
  const sectionRef=useRef<HTMLElement>(null);const[visible,setVisible]=useState(false);
  const {items,loading,source}=useCatalog(kind,6,visible);
  useEffect(()=>{const node=sectionRef.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries[0]?.isIntersecting){setVisible(true);observer.disconnect()}},{rootMargin:'320px'});observer.observe(node);return()=>observer.disconnect()},[]);
  const displayed=items.length?items:fallback;
  return <section ref={sectionRef}><div className="section-title"><h2>{title}</h2><span>{loading?'Chargement…':source?`Source : ${source}`:''}</span></div><div className="rail">{displayed.map((item,index)=><MediaCard key={item.id} item={item} active={index===0} onOpen={()=>onOpen(item)}/>)}</div></section>;
}

function HomePage({profile}:{profile:Profile}) {
  const navigate = useNavigate(); const open = (m: MediaItem) => navigate(`/title/${m.id}`);
  const resume = useResume(profile.id);
  return <>
    <div className="welcome home-welcome"><h1>Bonsoir, {profile.name}</h1><p>De belles histoires vous attendent.</p></div>
    {resume.items.length>0&&<Section title="Reprendre la lecture" items={resume.items.slice(0,6)} onOpen={open} wide />}
    <RemoteSection title="Dernières sorties" fallback={media.slice(4,10)} onOpen={open} />
    <RemoteSection title="Films à découvrir" fallback={media.filter(m=>m.kind==='film').slice(0,6)} onOpen={open} kind="film" />
    <RemoteSection title="Séries à découvrir" fallback={media.filter(m=>m.kind==='serie').slice(0,6)} onOpen={open} kind="serie" />
    <section><div className="section-title"><h2>Explorer par genre</h2><span>{allGenres.length} genres films et séries</span></div><div className="genres">{allGenres.map((label,i) => {const Icon=i%4===0?Film:i%4===1?Tv:i%4===2?Sparkles:Heart;return <button className={`genre focusable ${i===0?'is-active':''}`} key={label} onClick={()=>navigate(`/search?genre=${encodeURIComponent(label)}`)}><Icon />{label}</button>})}</div></section>
  </>;
}

function BrowsePage({ kind, title }: { kind?: 'film'|'serie'; title: string }) {
  const navigate=useNavigate();const sentinel=useRef<HTMLDivElement>(null);const catalog=useCatalog(kind,15,true);const fallback=kind?media.filter(m=>m.kind===kind):media;const list=catalog.items.length?catalog.items:fallback;
  useEffect(()=>{const node=sentinel.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries[0]?.isIntersecting&&!catalog.loading&&catalog.hasMore)void catalog.loadMore()},{rootMargin:'500px'});observer.observe(node);return()=>observer.disconnect()},[catalog.hasMore,catalog.loadMore,catalog.loading]);
  return <><div className="welcome"><h1>{title}</h1><p>{catalog.items.length?`${catalog.items.length} titres chargés depuis ${catalog.source}.`:`${fallback.length} titres disponibles sur votre SceneRoot.`}</p></div><div className="grid">{list.map((item,index)=><MediaCard item={item} active={index===0} key={item.id} onOpen={()=>navigate(`/title/${item.id}`)}/>)}</div><div className="catalog-sentinel" ref={sentinel}>{catalog.loading&&<><i/>Chargement de la suite…</>}{catalog.error&&<button className="secondary" onClick={()=>catalog.loadMore()}>Réessayer le chargement</button>}{!catalog.hasMore&&catalog.items.length>0&&<span>Fin du catalogue</span>}</div></>;
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
  useEffect(()=>{const timer=setTimeout(()=>setDebouncedQuery(query.trim()),320);return()=>clearTimeout(timer)},[query]);
  const catalog=useCatalog(type==='all'?undefined:type,20,true,selectedGenre,debouncedQuery);
  const normalized=query.toLowerCase();
  const localResults = media.filter(m => (type==='all'||m.kind===type)&&(!selectedGenre||m.genres.includes(selectedGenre))&&(!query || `${m.title} ${m.genres.join(' ')}`.toLowerCase().includes(normalized) || (normalized.includes('planète')&&m.genres.includes('Science-fiction'))));
  const results=catalog.items.length?catalog.items:localResults;
  useEffect(()=>{const node=sentinel.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries[0]?.isIntersecting&&!catalog.loading&&catalog.hasMore)void catalog.loadMore()},{rootMargin:'420px'});observer.observe(node);return()=>observer.disconnect()},[catalog.hasMore,catalog.loadMore,catalog.loading]);
  const reset=()=>{setQuery('');setSelectedGenre('');setType('all')};
  return <><label className="searchbox"><Search/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Rechercher un film ou une série…"/><kbd>OK</kbd></label>
    <div className="search-filter-title"><h2>Filtres</h2><button onClick={reset}><RefreshCw/> Réinitialiser les filtres</button></div>
    <div className="search-filters"><div className="filter-panel"><h3><Film/>Type</h3><div>{([['all','Tous'],['film','Films'],['serie','Séries']] as const).map(([value,label])=><button className={type===value?'on':''} onClick={()=>setType(value)} key={value}>{label}</button>)}</div></div><div className="filter-panel"><h3><Timer/>Durée</h3><div><button>&lt; 1h30</button><button className="on">1h30 – 2h</button><button>&gt; 2h</button></div></div><div className="filter-panel"><h3><Star/>Notes utilisateurs</h3><div><button>≥ 5</button><button className="on">≥ 7</button><button>≥ 8</button></div></div><div className="filter-panel"><h3><Monitor/>Qualité</h3><div><button>720p</button><button className="on">1080p</button><button>4K</button></div></div></div>
    <div className="genre-filter"><h3><Sparkles/>Tous les genres</h3><div>{allGenres.map(genre=><button className={selectedGenre===genre?'on':''} onClick={()=>setSelectedGenre(current=>current===genre?'':genre)} key={genre}>{genre}</button>)}</div></div>
    <div className="section-title"><h2>{query?`Résultats pour « ${query} »`:selectedGenre||'Tous les contenus'}</h2><span>{catalog.source?`${results.length} résultats · ${catalog.source}`:`${results.length} résultats`}</span></div>
    <div className="grid">{results.map((m,i)=><MediaCard item={m} active={i===0} key={m.id} onOpen={()=>navigate(`/title/${m.id}`)}/>)}</div><div className="catalog-sentinel" ref={sentinel}>{catalog.loading&&<><i/>Recherche dans le catalogue…</>}{catalog.error&&<button className="secondary" onClick={()=>catalog.loadMore()}>Réessayer</button>}{!catalog.loading&&!results.length&&<span>Aucun titre ne correspond encore à ces filtres.</span>}</div></>;
}

type Mood = 'Détente'|'Action'|'Émotion'|'Frissons'|'Découverte';
type ScoredMedia = { item:MediaItem; score:number; affinities:number[]; minAffinity:number; seenCount:number };
function TonightPage({availableProfiles}:{availableProfiles:Profile[]}) {
  const navigate=useNavigate();
  const library=useLibrary();
  const [selected,setSelected]=useState(()=>availableProfiles.slice(0,3).map(profile=>profile.id));
  const [kind,setKind]=useState<'film'|'serie'|'any'>('any');
  const [duration,setDuration]=useState<'short'|'medium'|'any'>('any');
  const [mood,setMood]=useState<Mood>('Découverte');
  const [genre,setGenre]=useState('');
  const [choosing,setChoosing]=useState(false); const [chosen,setChosen]=useState<string|null>(null);
  const [scored,setScored]=useState<ScoredMedia[]>([]); const [computing,setComputing]=useState(false);
  const demoMode=!library.loading&&library.items.length===0;
  const pool=useMemo(()=>{
    const base=library.items.length?library.items:media;
    return base.filter(m=>(kind==='any'||m.kind===kind)&&(!genre||m.genres.includes(genre))&&matchesDuration(m,duration));
  },[library.items,kind,genre,duration]);
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
  return <><div className="tonight-head"><div className="welcome"><h1>Que regarde-t-on ce soir ?</h1><p>SceneRoot cherche le meilleur compromis, pas la moyenne la plus facile.</p></div><button className="primary magic" onClick={pick} disabled={!scored.length}><WandSparkles/>{choosing?'Choix en cours…':'Faites le choix pour nous'}</button></div>
    {demoMode&&<div className="player-note" style={{margin:'0 0 12px'}}>Mode démonstration : aucune bibliothèque locale indexée, propositions issues d’un catalogue fictif.</div>}
    <div className="chooser"><FilterGroup title="Profils">{availableProfiles.map(p=><button className={selected.includes(p.id)?'on':''} onClick={()=>setSelected(s=>s.includes(p.id)?s.filter(x=>x!==p.id):[...s,p.id])} key={p.id}>{p.name}{selected.includes(p.id)&&<Check/>}</button>)}</FilterGroup><FilterGroup title="Envie">{(['film','serie','any'] as const).map(v=><button className={kind===v?'on':''} onClick={()=>setKind(v)} key={v}>{v==='film'?'Film':v==='serie'?'Série':'Peu importe'}</button>)}</FilterGroup><FilterGroup title="Durée">{([['short','< 1h30'],['medium','1h30–2h'],['any','Peu importe']] as const).map(([v,l])=><button className={duration===v?'on':''} onClick={()=>setDuration(v)} key={v}>{l}</button>)}</FilterGroup><FilterGroup title="Ambiance">{(['Détente','Action','Émotion','Frissons','Découverte'] as Mood[]).map(v=><button className={mood===v?'on':''} onClick={()=>setMood(v)} key={v}>{v}</button>)}</FilterGroup><label className="tonight-genre"><strong>Genre</strong><select value={genre} onChange={event=>setGenre(event.target.value)}><option value="">Tous les genres</option>{allGenres.map(value=><option value={value} key={value}>{value}</option>)}</select></label></div>
    <div className="match-list">{scored.map((x,i)=><button className={`match-card ${chosen===x.item.id?'winner':''}`} key={x.item.id} onClick={()=>navigate(`/title/${x.item.id}`)}><div className="match-rank">{i+1}</div><div className="match-art" style={{'--a':x.item.palette[0],'--b':x.item.palette[1]} as React.CSSProperties}>{x.item.symbol}</div><div className="match-copy"><h3>{x.item.title}</h3><strong>{x.score} % compatible</strong><p>✓ {selectedProfileNames(selected,availableProfiles)} · ✓ satisfaction minimale {x.minAffinity}% · {x.seenCount>0?`⚠ déjà vu par ${x.seenCount} profil${x.seenCount>1?'s':''}`:'✓ jamais vu par le groupe'} · {x.item.duration}</p></div><ChevronRight/></button>)}{!scored.length&&!computing&&<div className="empty-recommendations"><Sparkles/><h3>Aucun titre avec ces contraintes</h3><p>Essayez « Peu importe » pour la durée ou choisissez un autre genre.</p></div>}{computing&&!scored.length&&<div className="library-loading"><i/>Calcul du meilleur compromis…</div>}</div>
  </>;
}
const moodGenres:Record<Mood,string[]>={Détente:['Comédie','Famille','Animation'],Action:['Action','Aventure','Action & aventure'],Émotion:['Drame','Romance'],Frissons:['Horreur','Thriller','Mystère'],Découverte:['Documentaire','Histoire','Science-fiction']};
function matchesDuration(item:MediaItem,duration:'short'|'medium'|'any'){if(duration==='any'||item.kind==='serie')return true;const match=item.duration.match(/(?:(\d+)h)?(\d{1,2})/);if(!match)return true;const minutes=Number(match[1]??0)*60+Number(match[2]??0);return duration==='short'?minutes<90:minutes>=90&&minutes<=120}
function selectedProfileNames(ids:string[],availableProfiles:Profile[]){const names=ids.map(id=>availableProfiles.find(profile=>profile.id===id)?.name).filter(Boolean);return names.length?`${names.join(', ')} sont pris en compte`:'sélection familiale neutre'}
function FilterGroup({title,children}:{title:string;children:React.ReactNode}){return <div className="filter-group"><strong>{title}</strong><div>{children}</div></div>}

function DetailPage({profile}:{profile:Profile}) {
  const { id } = useParams(); const navigate = useNavigate(); const item = resolveMedia(id);
  const isLocalSeries=Boolean(item.local)&&item.kind==='serie';
  const [downloading,setDownloading]=useState(false);
  const {seasons,detail}=useLibraryGroup(id,profile.id,isLocalSeries);
  const nextId=detail?.nextEpisodeId; const playTarget=nextId??item.id;
  const nextEpisode=seasons.flatMap(season=>season.episodes.map(episode=>({...episode,season:season.season}))).find(episode=>episode.id===nextId);
  const nextStarted=nextEpisode?(nextEpisode.progress>0.02&&nextEpisode.progress<0.9):Boolean(item.progress);
  const playLabel=isLocalSeries?(nextEpisode?`${nextStarted?'Reprendre':'Lire'} S${nextEpisode.season}E${String(nextEpisode.episode).padStart(2,'0')}`:'Lire'):(item.progress?'Reprendre':'Lire');
  return <div className="detail" style={{ '--a': item.palette[0], '--b': item.palette[1], backgroundImage:`linear-gradient(90deg,rgba(1,7,14,.94) 8%,rgba(1,7,14,.28)), url('${item.art??'/assets/sceneroot-landscape.png'}')` } as React.CSSProperties}>
    <button className="back focusable" onClick={()=>navigate(-1)}><ArrowLeft/> Retour</button>
    <div className="detail__symbol">{item.symbol}<i/></div><div className="detail__content"><span className="eyebrow">{item.kind === 'film' ? 'FILM' : 'SÉRIE'} · {item.year}</span><h1>{item.title}</h1>
    <div className="detail__meta"><Star fill="currentColor"/> {item.rating>0?`${item.rating}/10`:'Non noté'} <span>{item.duration}</span><span>{item.quality}</span></div><p>{item.description}</p><div className="detail__genres">{item.genres.map(g=><span key={g}>{g}</span>)}</div>{item.sourceUrl&&<a className="source-link" href={item.sourceUrl} target="_blank" rel="noreferrer">Informations : {item.informationSource??(item.source==='tvmaze'?'TVmaze':item.source==='wikipedia'?'Wikipédia':'TMDB')}</a>}
    <div className="actions"><button className="primary focusable" onClick={()=>navigate(`/player/${playTarget}`)}><Play fill="currentColor"/> {playLabel}</button><button className="secondary focusable" onClick={()=>setDownloading(true)}><Download/> Télécharger</button><button className="icon-btn focusable"><Heart/></button></div>
    {downloading&&<DownloadPanel item={item} onClose={()=>setDownloading(false)}/>}
    {isLocalSeries&&seasons.length>0&&<div className="episodes">{seasons.map(season=><div className="season" key={season.season}><h3>Saison {season.season} · {season.episodes.length} épisode{season.episodes.length>1?'s':''}</h3><div className="episode-list">{season.episodes.map(episode=><button className={`episode focusable ${episode.id===nextId?'is-next':''}`} key={episode.id} onClick={()=>navigate(`/player/${episode.id}`)}><span className="episode-num">E{String(episode.episode).padStart(2,'0')}</span><span className="episode-title">{episode.title}{episode.id===nextId&&<em> · à suivre</em>}</span><Play size={16} fill="currentColor"/>{episode.progress>0.02&&<i className="episode-progress" style={{width:`${Math.min(100,Math.round(episode.progress*100))}%`}}/>}</button>)}</div></div>)}</div>}</div>
  </div>;
}

function PlayerPage({profile}:{profile:Profile}) {
  const { id } = useParams(); const navigate=useNavigate(); const item=resolveMedia(id);
  const isLocal=Boolean(item.local)&&Boolean(id);
  const [status,setStatus]=useState<PlayerStatus|null>(null);
  const [panel,setPanel]=useState<'sub'|'audio'|null>(null);
  const [error,setError]=useState('');
  const positionRef=useRef(0); const durationRef=useRef(0);
  const control=useCallback((command:string,value?:number|string)=>fetch('/api/player/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command,value})}),[]);
  const persist=useCallback((keepalive=false)=>{if(!isLocal||!id||durationRef.current<=0)return;void fetch(`/api/playback/${encodeURIComponent(profile.id)}/${encodeURIComponent(id)}`,{method:'PUT',keepalive,headers:{'Content-Type':'application/json'},body:JSON.stringify({position:positionRef.current,duration:durationRef.current})}).catch(()=>{})},[id,isLocal,profile.id]);
  useEffect(()=>{if(!isLocal||!id)return;let active=true;(async()=>{let startPosition=0;try{const resume=await fetch(`/api/playback/${encodeURIComponent(profile.id)}`);if(resume.ok){const rows=await resume.json() as Array<{mediaId:string;position:number}>;startPosition=rows.find(row=>row.mediaId===id)?.position??0}}catch{}try{const response=await fetch(`/api/player/${encodeURIComponent(id)}/play`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({startPosition})});if(!response.ok)throw new Error()}catch{if(active)setError('Le lecteur mpv est indisponible sur cet appareil.')}})();return()=>{active=false}},[id,isLocal,profile.id]);
  useEffect(()=>{if(!isLocal)return;let active=true;const tick=async()=>{try{const response=await fetch('/api/player/status');if(!response.ok)return;const next=await response.json() as PlayerStatus;if(!active)return;setStatus(next);if(next.running){positionRef.current=next.position??0;durationRef.current=next.duration??0}}catch{}};void tick();const interval=setInterval(()=>void tick(),1000);return()=>{active=false;clearInterval(interval)}},[isLocal]);
  useEffect(()=>{if(!isLocal)return;const interval=setInterval(()=>persist(),10000);const onHide=()=>persist(true);window.addEventListener('pagehide',onHide);return()=>{clearInterval(interval);window.removeEventListener('pagehide',onHide);persist(true)}},[isLocal,persist]);
  const finish=async()=>{persist(true);await control('stop').catch(()=>{});navigate(`/rate/${item.id}`)};
  const leave=()=>{persist(true);navigate(-1)};
  const running=Boolean(status?.running);const playing=status?.playing??true;const position=status?.position??0;const duration=status?.duration??0;
  const pct=duration>0?Math.min(100,(position/duration)*100):0;
  const seek:React.MouseEventHandler<HTMLDivElement>=event=>{if(!running||duration<=0)return;const rect=event.currentTarget.getBoundingClientRect();const ratio=Math.min(1,Math.max(0,(event.clientX-rect.left)/rect.width));void control('seek-to',Math.round(ratio*duration))};
  const audioTracks=status?.audioTracks??[]; const subtitleTracks=status?.subtitleTracks??[];
  return <div className="player" style={{ '--a': item.palette[0], '--b': item.palette[1], backgroundImage:`linear-gradient(105deg,rgba(1,7,14,.5),transparent 60%), url('${item.art??'/assets/sceneroot-landscape.png'}')` } as React.CSSProperties}>
    <div className="player__scene"><span>{item.symbol}</span><i/></div><div className="player__top"><Brand compact/><div><h1>{item.title}</h1><p>{item.kind === 'film'?'Film':'Série'} · {item.year} · {item.duration} · {item.quality}</p>{isLocal?(error?<small className="player-note">{error}</small>:running?<small className="player-note">Lecture native mpv sur le téléviseur.</small>:<small className="player-note">Démarrage du lecteur…</small>):<small className="player-note">Ce titre n’est pas encore dans votre médiathèque locale.</small>}</div></div>
    {panel==='audio' && <div className="track-panel"><h3><Volume2/>Piste audio</h3>{audioTracks.length?audioTracks.map(track=><button className={track.selected?'active':''} key={track.id} onClick={()=>void control('set-audio',track.id)}>{track.label}{track.selected&&<Check/>}</button>):<button disabled>Aucune piste détectée</button>}</div>}
    {panel==='sub' && <div className="track-panel"><h3><Subtitles/>Sous-titres</h3><button className={subtitleTracks.every(track=>!track.selected)?'active':''} onClick={()=>void control('set-subtitle','no')}>Désactivés{subtitleTracks.every(track=>!track.selected)&&<Check/>}</button>{subtitleTracks.map(track=><button className={track.selected?'active':''} key={track.id} onClick={()=>void control('set-subtitle',track.id)}>{track.label}{track.selected&&<Check/>}</button>)}</div>}
    <div className="player__controls"><div className="timeline"><span>{formatTime(position)}</span><i onClick={seek} role="slider" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} tabIndex={0}><b style={{width:`${pct}%`}}/></i><span>-{formatTime(Math.max(0,duration-position))}</span></div><div className="controls-row"><button onClick={leave}><ArrowLeft/>Retour</button><button onClick={()=>void control('seek-back')} disabled={!running}><RotateCcw/>-10s</button><button className="round" onClick={()=>void control(playing?'pause':'play')} disabled={!running}>{playing?<Pause fill="currentColor"/>:<Play fill="currentColor"/>}</button><button onClick={()=>void control('seek-forward')} disabled={!running}><Timer/>+30s</button><div className="controls-spacer"/><button onClick={finish}><Check/>Terminer</button><button className={panel==='sub'?'selected':''} onClick={()=>setPanel(panel==='sub'?null:'sub')}><Subtitles/>Sous-titres</button><button className={panel==='audio'?'selected':''} onClick={()=>setPanel(panel==='audio'?null:'audio')}><Volume2/>Audio</button></div></div>
  </div>;
}

function RatingPage({profile}:{profile:Profile}) {
  const {id}=useParams();const navigate=useNavigate();const item=resolveMedia(id);const [score,setScore]=useState(4);const [tags,setTags]=useState<string[]>([]);const [saving,setSaving]=useState(false);
  const toggle=(tag:string)=>setTags(current=>current.includes(tag)?current.filter(x=>x!==tag):[...current,tag]);
  const save=async()=>{setSaving(true);try{await fetch('/api/ratings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({profileId:profile.id,mediaId:item.id,score:score*2,tags})})}finally{navigate('/roots')}};
  return <div className="rating-page" style={{backgroundImage:`linear-gradient(90deg,rgba(2,8,17,.72),rgba(2,8,17,.58)),url('${item.art??'/assets/sceneroot-landscape.png'}')`}}><Brand compact/><div className="rating-card"><span className="rating-icon"><Film/></span><h1>Vous avez terminé<br/>« {item.title} »</h1><p>Merci d’avoir regardé ! Que pensez-vous de ce {item.kind==='film'?'film':'programme'} ?</p><div className="stars">{[1,2,3,4,5].map(value=><button key={value} onClick={()=>setScore(value)} aria-label={`${value} étoile${value>1?'s':''}`}><Star fill={value<=score?'currentColor':'transparent'}/></button>)}</div><strong>{score} / 5 — {score===5?'Excellent':score===4?'Très bien':score===3?'Bien':score===2?'Moyen':'Décevant'}</strong><div className="rating-tags"><button className={tags.includes('À revoir')?'on':''} onClick={()=>toggle('À revoir')}><RotateCcw/>À revoir</button><button className={tags.includes('Émouvant')?'on':''} onClick={()=>toggle('Émouvant')}><Heart/>Émouvant</button><button className={tags.includes('Surprenant')?'on':''} onClick={()=>toggle('Surprenant')}><Sparkles/>Surprenant</button><button className={tags.includes('Trop long')?'on':''} onClick={()=>toggle('Trop long')}><Hourglass/>Trop long</button></div><div className="rating-actions"><button className="primary" onClick={save} disabled={saving}><Star fill="currentColor"/>{saving?'Enregistrement…':'Noter maintenant'}</button><button className="secondary" onClick={()=>navigate('/')}><Clock3/>Plus tard</button></div><small><Users/>Vos avis nous aident à proposer des recommandations plus personnalisées.</small></div></div>;
}

type RootsTab='all'|'film'|'serie'|'rated';
function RootsPage({profile}:{profile:Profile}) {
  const navigate=useNavigate(); const history=useHistory(profile.id); const [tab,setTab]=useState<RootsTab>('all');
  const filtered=history.items.filter(item=>tab==='all'?true:tab==='rated'?item.rating>0:item.kind===tab);
  const tabs:[RootsTab,string,React.ReactNode][]=[['all','Déjà vus',<Clock3/>],['film','Films',<Film/>],['serie','Séries',<Tv/>],['rated','Favoris notés',<Heart/>]];
  return <><div className="welcome"><h1>Mes <em>Roots</em></h1><p>Votre historique de visionnage personnel.</p></div>
    <div className="stat-tabs">{tabs.map(([value,label,icon])=><button className={tab===value?'is-on':''} key={value} onClick={()=>setTab(value)}>{icon}{label}</button>)}</div>
    {history.loading&&<div className="library-loading"><i/>Lecture de votre historique…</div>}
    {!history.loading&&!filtered.length&&<div className="library-empty"><Clock3/><h2>Rien pour le moment</h2><p>Vos films et séries terminés ou notés apparaîtront ici.</p></div>}
    {filtered.length>0&&<div className="grid">{filtered.map((m,i)=><MediaCard item={m} active={i===0} key={m.id} onOpen={()=>navigate(`/title/${m.id}`)}/>)}</div>}</> }

const torrentStatus:Record<number,string>={0:'En pause',1:'Vérif. en attente',2:'Vérification',3:'En file',4:'Téléchargement',5:'Envoi en file',6:'Partage'};
function DownloadsPage() {
  const {torrents,error,loading,control}=useDownloads();
  return <><div className="welcome"><h1>Téléchargements</h1><p>File Transmission en direct.</p></div>
    {loading&&!torrents.length&&<div className="library-loading"><i/>Connexion à Transmission…</div>}
    {error&&<div className="library-empty"><Download/><h2>Transmission indisponible</h2><p>{error}</p></div>}
    {!error&&!loading&&!torrents.length&&<div className="library-empty"><Download/><h2>Aucun téléchargement</h2><p>Lancez un téléchargement depuis une fiche pour le suivre ici.</p></div>}
    {torrents.length>0&&<div className="download-list">{torrents.map(torrent=>{const pct=Math.round(torrent.percentDone*100);const active=torrent.status!==0;return <div className="download-row" key={torrent.id}>
      <div className="download-info"><strong>{torrent.name}</strong><div className="download-badges"><span>{torrentStatus[torrent.status]??'—'}</span><span>{pct}%</span><span>{formatBytes(torrent.sizeWhenDone||torrent.totalSize)}</span>{torrent.rateDownload>0&&<span>↓ {formatBytes(torrent.rateDownload)}/s</span>}{torrent.peersConnected>0&&<span>{torrent.peersConnected} pairs</span>}{torrent.errorString&&<span className="src">{torrent.errorString}</span>}</div><span className="progress"><i style={{width:`${pct}%`}}/></span></div>
      <div className="download-actions">{active?<button className="icon-btn" title="Mettre en pause" onClick={()=>void control(torrent.id,'stop')}><Pause/></button>:<button className="icon-btn" title="Reprendre" onClick={()=>void control(torrent.id,'start')}><Play fill="currentColor"/></button>}<button className="icon-btn" title="Annuler" onClick={()=>{if(window.confirm('Retirer ce téléchargement ? Les données déjà téléchargées sont conservées.'))void control(torrent.id,'remove',false)}}><Trash2/></button></div>
    </div>})}</div>}
  </>;
}
type StorageRoot={root:string;total:number;free:number;available:number;libraryBytes:number};
function formatBytes(bytes:number){if(!bytes)return '0 o';const units=['o','Ko','Mo','Go','To'];const i=Math.min(units.length-1,Math.floor(Math.log(bytes)/Math.log(1024)));return `${(bytes/1024**i).toFixed(i>=3?1:0)} ${units[i]}`}
function SettingsPage() {
  const [scan, setScan] = useState(false); const [scanMessage,setScanMessage]=useState('Surveillance active'); const [cec,setCec]=useState(true); const [updates,setUpdates]=useState(true);
  const [storage,setStorage]=useState<StorageRoot[]>([]);
  const [cache,setCache]=useState<{entries:number;bytes:number}|null>(null);
  const [purging,setPurging]=useState(false);
  const loadCache=()=>fetch('/api/cache').then(response=>response.ok?response.json():null).then((data:{entries:number;bytes:number}|null)=>setCache(data)).catch(()=>{});
  useEffect(()=>{fetch('/api/storage').then(response=>response.ok?response.json():[]).then((rows:StorageRoot[])=>setStorage(rows)).catch(()=>{});void loadCache()},[]);
  const purgeCache=async()=>{setPurging(true);try{await fetch('/api/cache',{method:'DELETE'});await loadCache()}finally{setPurging(false)}};
  const totals=storage.reduce((acc,s)=>({total:acc.total+s.total,free:acc.free+s.free,library:acc.library+s.libraryBytes}),{total:0,free:0,library:0});
  const used=Math.max(0,totals.total-totals.free);
  const runScan=async()=>{setScan(true);setScanMessage('Analyse des emplacements…');try{const response=await fetch('/api/library/scan',{method:'POST'});const result=await response.json() as {items?:unknown[]};setScanMessage(`${result.items?.length??0} média(s) indexé(s)`)}catch{setScanMessage('Serveur indisponible — nouvel essai au prochain scan')}finally{setScan(false)}};
  return <><div className="welcome"><h1>Paramètres</h1><p>Configurez votre médiathèque, la lecture et l’appareil.</p></div><div className="settings-grid">
    <div className="settings-card"><h2><FolderOpen/>Médiathèque</h2><p>Dossiers analysés · <span className="online">{scanMessage}</span></p><div className="path"><HardDrive/> /mnt/media <Check/></div><button className="primary" onClick={runScan} disabled={scan}><RefreshCw className={scan?'spin':''}/>{scan?'Analyse en cours…':'Analyser maintenant'}</button></div>
    <div className="settings-card"><h2><Monitor/>Téléviseur & CEC</h2><Setting label="Contrôle HDMI-CEC" value={cec} setValue={setCec}/><Setting label="Démarrer en plein écran" value={true}/><Setting label="Adapter le taux de rafraîchissement" value={true}/></div>
    <div className="settings-card"><h2><Download/>Téléchargements</h2><p>Client local</p><div className="path"><Wifi/> Transmission RPC <Check/></div><label>Limite de stockage<input type="range" defaultValue="70"/></label><small>Les torrents doivent provenir de contenus que vous êtes autorisé à télécharger.</small></div>
    <div className="settings-card storage"><h2><BarChart3/>Stockage</h2>{storage.length?<><div className="storage-number"><b>{formatBytes(used)}</b> / {formatBytes(totals.total)} utilisés</div><div className="storage-bar"><i style={{width:`${totals.total?Math.min(100,totals.library/totals.total*100):0}%`}}/><i style={{width:`${totals.total?Math.min(100,Math.max(0,used-totals.library)/totals.total*100):0}%`}}/></div><div className="storage-key"><span>Médiathèque indexée {formatBytes(totals.library)}</span><span>Espace libre {formatBytes(totals.free)}</span></div><p>{storage.length} emplacement{storage.length>1?'s':''} de stockage surveillé{storage.length>1?'s':''}.</p></>:<p>Aucun emplacement de stockage détecté. Configurez <code>SCENEROOT_MEDIA</code> puis relancez une analyse.</p>}</div>
    <div className="settings-card"><h2><ShieldCheck/>Système</h2><Setting label="Mises à jour automatiques" value={updates} setValue={setUpdates}/><Setting label="Catalogue et cache local" value={true}/><p>TMDB si configuré · sinon Wikipédia + TVmaze</p>{cache&&<div className="path"><HardDrive/> Cache métadonnées : {formatBytes(cache.bytes)} · {cache.entries} fichier{cache.entries>1?'s':''}</div>}<button className="secondary" onClick={()=>void purgeCache()} disabled={purging||!cache?.entries}><Trash2 className={purging?'spin':''}/>{purging?'Purge en cours…':'Purger le cache'}</button><small>Ce produit utilise l’API TMDB mais n’est ni approuvé ni certifié par TMDB.</small><div className="version">SceneRoot v0.1.0 <span>À jour</span></div></div>
    <div className="settings-card sources"><h2><Wifi/>Sources de recherche</h2><div className="source-row"><span><b>Torznab / C411</b><small>Clé API stockée localement</small></span><i className="dot"/></div><button className="secondary"><Plus/>Ajouter une source Torznab</button><small>Utilisez uniquement des sources et contenus que vous êtes autorisé à récupérer.</small></div>
  </div></>;
}
function Setting({label,value,setValue}:{label:string;value:boolean;setValue?:(v:boolean)=>void}) { return <button className="setting" onClick={()=>setValue?.(!value)}><span>{label}</span><i className={value?'on':''}><b/></i></button> }

function App() {
  const [booting,setBooting]=useState(true);
  const [savedProfiles,setSavedProfiles]=useState<Profile[]>([]);
  const [profile,setProfile]=useState<Profile|null>(()=>{try{return JSON.parse(localStorage.getItem('sceneroot-profile')||'null')}catch{return null}});
  useEffect(()=>{const timer=setTimeout(()=>setBooting(false),1450);return()=>clearTimeout(timer)},[]);
  useEffect(()=>{fetch('/api/profiles').then(response=>response.ok?response.json():[]).then((items:Profile[])=>setSavedProfiles(items)).catch(()=>{})},[]);
  useEffect(()=>{ const handle=(e:KeyboardEvent)=>{ if(!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].includes(e.key))return; const els=[...document.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input,select')].filter(x=>x.offsetParent!==null); const current=document.activeElement as HTMLElement; const r=current?.getBoundingClientRect(); if(!r){els[0]?.focus();return} const horizontal=e.key==='ArrowLeft'||e.key==='ArrowRight'; const sign=e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1; let best:HTMLElement|undefined,score=Infinity; for(const el of els){if(el===current)continue;const q=el.getBoundingClientRect();const dx=q.left+q.width/2-(r.left+r.width/2),dy=q.top+q.height/2-(r.top+r.height/2);const primary=horizontal?dx:dy;if(Math.sign(primary)!==sign)continue;const secondary=horizontal?dy:dx;const s=Math.abs(primary)+Math.abs(secondary)*2;if(s<score){score=s;best=el}} if(best){e.preventDefault();best.focus()}}; addEventListener('keydown',handle); return()=>removeEventListener('keydown',handle)},[]);
  if(booting)return <BootScreen/>;
  const availableProfiles=[...profiles.map(base=>savedProfiles.find(saved=>saved.id===base.id)??base),...savedProfiles.filter(saved=>!profiles.some(base=>base.id===saved.id))];
  const upsertProfile=(saved:Profile)=>setSavedProfiles(current=>current.some(item=>item.id===saved.id)?current.map(item=>item.id===saved.id?saved:item):[...current,saved]);
  const removeProfile=(deleted:Profile)=>{setSavedProfiles(current=>current.filter(item=>item.id!==deleted.id));if(profile?.id===deleted.id){localStorage.removeItem('sceneroot-profile');setProfile(null)}};
  if(!profile)return <ProfileGate availableProfiles={availableProfiles} onSaved={upsertProfile} onDeleted={removeProfile} onSelect={p=>{localStorage.setItem('sceneroot-profile',JSON.stringify(p));setProfile(p)}}/>;
  const switchProfile=()=>{localStorage.removeItem('sceneroot-profile');setProfile(null)};
  return <Routes><Route path="/player/:id" element={<PlayerPage profile={profile}/>}/><Route path="/rate/:id" element={<RatingPage profile={profile}/>}/><Route path="/title/:id" element={<Shell profile={profile} onSwitchProfile={switchProfile}><DetailPage profile={profile}/></Shell>}/><Route path="*" element={<Shell profile={profile} onSwitchProfile={switchProfile}><Routes>
    <Route path="/" element={<HomePage profile={profile}/>}/><Route path="/films" element={<BrowsePage kind="film" title="Films"/>}/><Route path="/series" element={<BrowsePage kind="serie" title="Séries"/>}/><Route path="/discover" element={<BrowsePage title="Découvrir"/>}/><Route path="/tonight" element={<TonightPage availableProfiles={availableProfiles}/>}/><Route path="/library" element={<LibraryPage/>}/><Route path="/downloads" element={<DownloadsPage/>}/><Route path="/roots" element={<RootsPage profile={profile}/>}/><Route path="/search" element={<SearchPage/>}/><Route path="/settings" element={<SettingsPage/>}/>
  </Routes></Shell>}/></Routes>;
}
export default App;
