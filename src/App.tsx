import { useEffect, useMemo, useState } from 'react';
import { Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BarChart3, Check, ChevronRight, Clock3, Download, Film, FolderOpen, Gauge, HardDrive, Heart, Lock, Monitor, Pause, Play, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Star, Subtitles, Timer, Tv, UserPlus, Users, Volume2, Wifi, WandSparkles, X } from 'lucide-react';
import { Brand } from './components/Brand';
import { MediaCard } from './components/MediaCard';
import { Shell } from './components/Shell';
import { media, profiles } from './data/demo';
import type { MediaItem, Profile } from './types';

function BootScreen() {
  return <div className="boot-screen">
    <div className="boot-glow" />
    <Brand vertical />
    <p>Chargement de votre univers multimédia…</p>
    <div className="boot-progress"><i /></div>
    <div className="boot-categories"><span><Film/> FILMS</span><span><Tv/> SÉRIES</span><span><Sparkles/> DÉCOUVERTE</span><span><Users/> PROFILS</span></div>
    <small>ALIMENTÉ PAR<br/><b>RASPBERRY PI</b></small>
  </div>;
}

function ProfileGate({ onSelect }: { onSelect: (profile: Profile) => void }) {
  const [modal,setModal]=useState<'guest'|'profile'|null>(null);
  const [name,setName]=useState(''); const [age,setAge]=useState(18); const [guestTtl,setGuestTtl]=useState('shutdown');
  const createProfile=()=>{const clean=name.trim()||'Nouveau profil';onSelect({id:`profile-${Date.now()}`,name:clean,ageLimit:age,avatar:clean[0].toUpperCase(),accent:'#22d3ee'})};
  const createGuest=()=>onSelect({id:`guest-${Date.now()}`,name:'Invité',ageLimit:age,avatar:'I',accent:'#a78bfa'});
  return <div className="gate starscape">
    <div className="gate__head"><Brand /><span>20:24 · <Wifi size={20}/></span></div>
    <div className="gate__title"><h1>Qui regarde ?</h1><p>Choisissez votre profil pour commencer</p></div>
    <div className="profiles">{profiles.map((profile, i) => <button className={`profile-card focusable ${i === 0 ? 'is-active' : ''}`} key={profile.id} onClick={() => onSelect(profile)}>
      <span className="avatar" style={{ '--accent': profile.accent } as React.CSSProperties}>{profile.avatar}<i /></span>
      <strong>{profile.name} {profile.locked && <Lock size={18}/>}</strong>
      <small>{profile.ageLimit === 18 ? 'Tout public' : `-${profile.ageLimit}`}</small>
    </button>)}</div>
    <div className="gate-actions"><button className="add-profile focusable" onClick={()=>setModal('profile')}><Plus /> Ajouter un profil</button><button className="add-profile focusable" onClick={()=>setModal('guest')}><Users/> Invité</button></div>
    {modal&&<div className="modal-backdrop"><div className="profile-modal"><button className="modal-close" onClick={()=>setModal(null)}><X/></button><span className="modal-icon">{modal==='guest'?<Users/>:<UserPlus/>}</span><h2>{modal==='guest'?'Session invitée':'Nouveau profil'}</h2><p>{modal==='guest'?'Cette session ne modifiera pas les recommandations de la famille.':'Créez un espace personnel avec ses propres recommandations.'}</p>{modal==='profile'&&<label>Nom<input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="Prénom"/></label>}<label>Limite d’âge<select value={age} onChange={e=>setAge(Number(e.target.value))}><option value="18">Tout public</option><option value="10">-10</option><option value="13">-13</option><option value="16">-16</option></select></label>{modal==='guest'&&<label>Conserver le profil<select value={guestTtl} onChange={e=>setGuestTtl(e.target.value)}><option value="shutdown">Jusqu’à extinction</option><option value="24h">24 heures</option><option value="7d">7 jours</option><option value="permanent">Conserver ce profil</option></select></label>}<button className="primary modal-submit" onClick={modal==='guest'?createGuest:createProfile}>{modal==='guest'?'Commencer':'Créer le profil'}</button></div></div>}
  </div>;
}

function Section({ title, items, onOpen, wide = false }: { title: string; items: MediaItem[]; onOpen: (m: MediaItem) => void; wide?: boolean }) {
  return <section><div className="section-title"><h2>{title}</h2><button>Tout voir <ChevronRight size={18}/></button></div><div className="rail">{items.map((m, i) => <MediaCard key={m.id} item={m} active={i === 0} wide={wide} onOpen={() => onOpen(m)} />)}</div></section>;
}

function HomePage({profile}:{profile:Profile}) {
  const navigate = useNavigate(); const open = (m: MediaItem) => navigate(`/title/${m.id}`);
  return <>
    <div className="welcome home-welcome"><h1>Bonsoir, {profile.name}</h1><p>De belles histoires vous attendent.</p></div>
    <Section title="Reprendre la lecture" items={media.slice(0,4)} onOpen={open} wide />
    <Section title="Dernières sorties" items={media.slice(4,10)} onOpen={open} />
    <Section title="Recommandé pour vous" items={media.slice(8).concat(media.slice(1,3))} onOpen={open} />
    <section><div className="section-title"><h2>Explorer par genre</h2></div><div className="genres">{[['Film',Film],['Série',Tv],['Science-fiction',Sparkles],['Horreur',ShieldCheck],['Animation',Heart]].map(([label, Icon],i) => <button className={`genre focusable ${i===0?'is-active':''}`} key={label as string}><Icon />{label as string}</button>)}</div></section>
  </>;
}

function BrowsePage({ kind, title }: { kind?: 'film'|'serie'; title: string }) {
  const navigate = useNavigate(); const list = kind ? media.filter(m => m.kind === kind) : media;
  return <><div className="welcome"><h1>{title}</h1><p>{list.length} titres disponibles sur votre SceneRoot.</p></div><div className="grid">{list.concat(list).map((m,i)=><MediaCard item={m} active={i===0} key={`${m.id}-${i}`} onOpen={()=>navigate(`/title/${m.id}`)}/>)}</div></>;
}

function SearchPage() {
  const [query, setQuery] = useState('planète'); const navigate = useNavigate();
  const normalized=query.toLowerCase();
  const results = media.filter(m => !query || `${m.title} ${m.genres.join(' ')}`.toLowerCase().includes(normalized) || (normalized.includes('planète')&&m.genres.includes('Science-fiction')));
  return <><label className="searchbox"><Search/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Rechercher un film ou une série…"/><kbd>OK</kbd></label>
    <div className="search-filter-title"><h2>Filtres</h2><button><RefreshCw/> Réinitialiser les filtres</button></div>
    <div className="search-filters"><div className="filter-panel"><h3><Film/>Genre</h3><div><button className="on">Film</button><button>Série</button><button>SF</button><button>Horreur</button></div></div><div className="filter-panel"><h3><Timer/>Durée</h3><div><button>&lt; 1h30</button><button className="on">1h30 – 2h</button><button>&gt; 2h</button></div></div><div className="filter-panel"><h3><Star/>Notes utilisateurs</h3><div><button>≥ 5</button><button className="on">≥ 7</button><button>≥ 8</button></div></div><div className="filter-panel"><h3><Monitor/>Qualité</h3><div><button>720p</button><button className="on">1080p</button><button>4K</button></div></div></div>
    <div className="section-title"><h2>Résultats pour « {query} »</h2><span>{results.length} résultats</span></div>
    <div className="grid">{results.map((m,i)=><MediaCard item={m} active={i===0} key={m.id} onOpen={()=>navigate(`/title/${m.id}`)}/>)}</div></>;
}

type Mood = 'Détente'|'Action'|'Émotion'|'Frissons'|'Découverte';
function TonightPage() {
  const navigate=useNavigate();
  const [selected,setSelected]=useState(['nicolas','cathy','nathan']);
  const [kind,setKind]=useState<'film'|'serie'|'any'>('film');
  const [duration,setDuration]=useState<'short'|'medium'|'any'>('medium');
  const [mood,setMood]=useState<Mood>('Découverte');
  const [choosing,setChoosing]=useState(false); const [chosen,setChosen]=useState<string|null>(null);
  const scored=useMemo(()=>media.filter(m=>kind==='any'||m.kind===kind).map((m,i)=>{
    const affinities=selected.map((_,p)=>Math.max(52,Math.min(98,Math.round(82+Math.sin(i*2.1+p*1.7)*12))));
    const avg=affinities.reduce((a,b)=>a+b,0)/affinities.length;
    const disagreement=Math.max(...affinities)-Math.min(...affinities);
    return{item:m,score:Math.round(avg-disagreement*.42+(i%3===1?4:0))};
  }).sort((a,b)=>b.score-a.score).slice(0,5),[selected,kind,duration,mood]);
  const pick=()=>{setChoosing(true);setChosen(null);setTimeout(()=>{setChosen(scored[Math.floor(Math.random()*Math.min(3,scored.length))]?.item.id??null);setChoosing(false)},1100)};
  return <><div className="tonight-head"><div className="welcome"><h1>Que regarde-t-on ce soir ?</h1><p>SceneRoot cherche le meilleur compromis, pas la moyenne la plus facile.</p></div><button className="primary magic" onClick={pick}><WandSparkles/>{choosing?'Choix en cours…':'Faites le choix pour nous'}</button></div>
    <div className="chooser"><FilterGroup title="Profils">{profiles.map(p=><button className={selected.includes(p.id)?'on':''} onClick={()=>setSelected(s=>s.includes(p.id)?s.filter(x=>x!==p.id):[...s,p.id])} key={p.id}>{p.name}{selected.includes(p.id)&&<Check/>}</button>)}</FilterGroup><FilterGroup title="Envie">{(['film','serie','any'] as const).map(v=><button className={kind===v?'on':''} onClick={()=>setKind(v)} key={v}>{v==='film'?'Film':v==='serie'?'Série':'Peu importe'}</button>)}</FilterGroup><FilterGroup title="Durée">{([['short','< 1h30'],['medium','1h30–2h'],['any','Peu importe']] as const).map(([v,l])=><button className={duration===v?'on':''} onClick={()=>setDuration(v)} key={v}>{l}</button>)}</FilterGroup><FilterGroup title="Ambiance">{(['Détente','Action','Émotion','Frissons','Découverte'] as Mood[]).map(v=><button className={mood===v?'on':''} onClick={()=>setMood(v)} key={v}>{v}</button>)}</FilterGroup></div>
    <div className="match-list">{scored.map((x,i)=><button className={`match-card ${chosen===x.item.id?'winner':''}`} key={x.item.id} onClick={()=>navigate(`/title/${x.item.id}`)}><div className="match-rank">{i+1}</div><div className="match-art" style={{'--a':x.item.palette[0],'--b':x.item.palette[1]} as React.CSSProperties}>{x.item.symbol}</div><div className="match-copy"><h3>{x.item.title}</h3><strong>{x.score} % compatible</strong><p>✓ Nicolas aime fortement {x.item.genres[0].toLowerCase()} · ✓ Cathy a bien noté des titres proches · ✓ Nathan ne l’a jamais vu · ✓ compatible avec les limites d’âge · {x.item.duration}</p></div><ChevronRight/></button>)}</div>
  </>;
}
function FilterGroup({title,children}:{title:string;children:React.ReactNode}){return <div className="filter-group"><strong>{title}</strong><div>{children}</div></div>}

function DetailPage() {
  const { id } = useParams(); const navigate = useNavigate(); const item = media.find(m=>m.id===id) ?? media[0];
  return <div className="detail" style={{ '--a': item.palette[0], '--b': item.palette[1] } as React.CSSProperties}>
    <button className="back focusable" onClick={()=>navigate(-1)}><ArrowLeft/> Retour</button>
    <div className="detail__symbol">{item.symbol}<i/></div><div className="detail__content"><span className="eyebrow">{item.kind === 'film' ? 'FILM' : 'SÉRIE'} · {item.year}</span><h1>{item.title}</h1>
    <div className="detail__meta"><Star fill="currentColor"/> {item.rating}/10 <span>{item.duration}</span><span>{item.quality}</span></div><p>{item.description}</p><div className="detail__genres">{item.genres.map(g=><span key={g}>{g}</span>)}</div>
    <div className="actions"><button className="primary focusable" onClick={()=>navigate(`/player/${item.id}`)}><Play fill="currentColor"/> {item.progress ? 'Reprendre' : 'Lire'}</button><button className="secondary focusable"><Download/> Télécharger</button><button className="icon-btn focusable"><Heart/></button></div></div>
  </div>;
}

function PlayerPage() {
  const { id } = useParams(); const navigate=useNavigate(); const item=media.find(m=>m.id===id)??media[0]; const [playing,setPlaying]=useState(true); const [panel,setPanel]=useState<'sub'|'audio'|null>('sub');
  return <div className="player" style={{ '--a': item.palette[0], '--b': item.palette[1] } as React.CSSProperties}>
    <div className="player__scene"><span>{item.symbol}</span><i/></div><div className="player__top"><Brand compact/><div><h1>{item.title}</h1><p>{item.kind === 'film'?'Film':'Série'} · {item.year} · {item.duration} · {item.quality}</p></div></div>
    {panel && <div className="track-panel"><h3>{panel==='sub'?<Subtitles/>:<Volume2/>}{panel==='sub'?'Sous-titres':'Piste audio'}</h3>{['Désactivés','Français','Anglais','Charger un fichier…'].map((x,i)=><button className={i===1?'active':''} key={x}>{x}{i===1&&<Check/>}</button>)}</div>}
    <div className="player__controls"><div className="timeline"><span>0:28:17</span><i><b/></i><span>-1:13:43</span></div><div className="controls-row"><button onClick={()=>navigate(-1)}><ArrowLeft/>Retour</button><button className="round" onClick={()=>setPlaying(!playing)}>{playing?<Pause fill="currentColor"/>:<Play fill="currentColor"/>}</button><div className="controls-spacer"/><button className={panel==='sub'?'selected':''} onClick={()=>setPanel(panel==='sub'?null:'sub')}><Subtitles/>Sous-titres</button><button className={panel==='audio'?'selected':''} onClick={()=>setPanel(panel==='audio'?null:'audio')}><Volume2/>Audio</button><button><Gauge/>Qualité</button></div></div>
  </div>;
}

function RootsPage() { const navigate=useNavigate(); return <><div className="welcome"><h1>Mes <em>Roots</em></h1><p>Votre historique de visionnage personnel.</p></div><div className="stat-tabs"><button className="is-on"><Clock3/>Déjà vus</button><button><Film/>Films</button><button><Tv/>Séries</button><button><Heart/>Favoris notés</button></div><div className="grid">{media.slice(0,10).map((m,i)=><MediaCard item={{...m,progress:undefined}} active={i===0} key={m.id} onOpen={()=>navigate(`/title/${m.id}`)}/>)}</div></> }

function SettingsPage() {
  const [scan, setScan] = useState(false); const [scanMessage,setScanMessage]=useState('Surveillance active'); const [cec,setCec]=useState(true); const [updates,setUpdates]=useState(true);
  const runScan=async()=>{setScan(true);setScanMessage('Analyse des emplacements…');try{const response=await fetch('/api/library/scan',{method:'POST'});const result=await response.json() as {items?:unknown[]};setScanMessage(`${result.items?.length??0} média(s) indexé(s)`)}catch{setScanMessage('Serveur indisponible — nouvel essai au prochain scan')}finally{setScan(false)}};
  return <><div className="welcome"><h1>Paramètres</h1><p>Configurez votre médiathèque, la lecture et l’appareil.</p></div><div className="settings-grid">
    <div className="settings-card"><h2><FolderOpen/>Médiathèque</h2><p>Dossiers analysés · <span className="online">{scanMessage}</span></p><div className="path"><HardDrive/> /mnt/media <Check/></div><button className="primary" onClick={runScan} disabled={scan}><RefreshCw className={scan?'spin':''}/>{scan?'Analyse en cours…':'Analyser maintenant'}</button></div>
    <div className="settings-card"><h2><Monitor/>Téléviseur & CEC</h2><Setting label="Contrôle HDMI-CEC" value={cec} setValue={setCec}/><Setting label="Démarrer en plein écran" value={true}/><Setting label="Adapter le taux de rafraîchissement" value={true}/></div>
    <div className="settings-card"><h2><Download/>Téléchargements</h2><p>Client local</p><div className="path"><Wifi/> Transmission RPC <Check/></div><label>Limite de stockage<input type="range" defaultValue="70"/></label><small>Les torrents doivent provenir de contenus que vous êtes autorisé à télécharger.</small></div>
    <div className="settings-card storage"><h2><BarChart3/>Stockage</h2><div className="storage-number"><b>3,2 To</b> / 4 To utilisés</div><div className="storage-bar"><i/><i/><i/><i/></div><div className="storage-key"><span>Films 1,8 To</span><span>Séries 950 Go</span><span>Téléchargements 210 Go</span><span>Cache 42 Go</span></div><p><strong>127 Go</strong> peuvent potentiellement être récupérés.</p></div>
    <div className="settings-card"><h2><ShieldCheck/>Système</h2><Setting label="Mises à jour automatiques" value={updates} setValue={setUpdates}/><Setting label="Métadonnées TMDB" value={true}/><div className="version">SceneRoot v0.1.0 <span>À jour</span></div></div>
    <div className="settings-card sources"><h2><Wifi/>Sources de recherche</h2><div className="source-row"><span><b>Torznab / C411</b><small>Clé API stockée localement</small></span><i className="dot"/></div><button className="secondary"><Plus/>Ajouter une source Torznab</button><small>Utilisez uniquement des sources et contenus que vous êtes autorisé à récupérer.</small></div>
  </div></>;
}
function Setting({label,value,setValue}:{label:string;value:boolean;setValue?:(v:boolean)=>void}) { return <button className="setting" onClick={()=>setValue?.(!value)}><span>{label}</span><i className={value?'on':''}><b/></i></button> }

function App() {
  const [booting,setBooting]=useState(true);
  const [profile,setProfile]=useState<Profile|null>(()=>{try{return JSON.parse(localStorage.getItem('sceneroot-profile')||'null')}catch{return null}});
  useEffect(()=>{const timer=setTimeout(()=>setBooting(false),1450);return()=>clearTimeout(timer)},[]);
  useEffect(()=>{ const handle=(e:KeyboardEvent)=>{ if(!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].includes(e.key))return; const els=[...document.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input')].filter(x=>x.offsetParent!==null); const current=document.activeElement as HTMLElement; const r=current?.getBoundingClientRect(); if(!r){els[0]?.focus();return} const horizontal=e.key==='ArrowLeft'||e.key==='ArrowRight'; const sign=e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1; let best:HTMLElement|undefined,score=Infinity; for(const el of els){if(el===current)continue;const q=el.getBoundingClientRect();const dx=q.left+q.width/2-(r.left+r.width/2),dy=q.top+q.height/2-(r.top+r.height/2);const primary=horizontal?dx:dy;if(Math.sign(primary)!==sign)continue;const secondary=horizontal?dy:dx;const s=Math.abs(primary)+Math.abs(secondary)*2;if(s<score){score=s;best=el}} if(best){e.preventDefault();best.focus()}}; addEventListener('keydown',handle); return()=>removeEventListener('keydown',handle)},[]);
  if(booting)return <BootScreen/>;
  if(!profile)return <ProfileGate onSelect={p=>{localStorage.setItem('sceneroot-profile',JSON.stringify(p));setProfile(p)}}/>;
  return <Routes><Route path="/player/:id" element={<PlayerPage/>}/><Route path="/title/:id" element={<Shell profile={profile}><DetailPage/></Shell>}/><Route path="*" element={<Shell profile={profile}><Routes>
    <Route path="/" element={<HomePage profile={profile}/>}/><Route path="/films" element={<BrowsePage kind="film" title="Films"/>}/><Route path="/series" element={<BrowsePage kind="serie" title="Séries"/>}/><Route path="/discover" element={<BrowsePage title="Découvrir"/>}/><Route path="/tonight" element={<TonightPage/>}/><Route path="/library" element={<BrowsePage title="Ma médiathèque"/>}/><Route path="/roots" element={<RootsPage/>}/><Route path="/search" element={<SearchPage/>}/><Route path="/settings" element={<SettingsPage/>}/>
  </Routes></Shell>}/></Routes>;
}
export default App;
