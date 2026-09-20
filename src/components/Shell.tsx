import { Clock3, Compass, Download, Film, FolderHeart, Home, Search, Settings, Sparkles, Tv, Wifi } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { Brand } from './Brand';
import { ProfileAvatar } from './ProfileAvatar';
import type { Profile } from '../types';

const links = [
  ['/', Home, 'Accueil'], ['/films', Film, 'Films'], ['/series', Tv, 'Séries'], ['/discover', Compass, 'Découvrir'],
  ['/tonight', Sparkles, 'Ce soir'], ['/roots', Clock3, 'Mes Roots'], ['/library', FolderHeart, 'Ma médiathèque'], ['/downloads', Download, 'Téléchargements'], ['/search', Search, 'Rechercher'], ['/settings', Settings, 'Paramètres']
] as const;

export function Shell({ profile, onSwitchProfile, children }: { profile: Profile; onSwitchProfile: () => void; children: React.ReactNode }) {
  const location = useLocation();
  const [clock,setClock]=useState(()=>new Date());
  useEffect(()=>{const timer=setInterval(()=>setClock(new Date()),30_000);return()=>clearInterval(timer)},[]);
  useEffect(()=>{window.scrollTo({top:0,left:0,behavior:'instant'})},[location.pathname]);
  // « Retour » depuis une page ramène la télécommande sur l'entrée de menu
  // correspondante. Les modales traitent la touche avant nous (phase de
  // capture) : elles se ferment donc sans que le focus quitte leur contenu.
  const navRef=useRef<HTMLElement>(null);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(event.key!=='Escape')return;
      const current=navRef.current?.querySelector<HTMLElement>('a[aria-current="page"]')??navRef.current?.querySelector<HTMLElement>('a');
      if(!current||document.activeElement===current)return;
      event.preventDefault();
      current.focus();
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[]);
  return <div className="app-shell">
    <aside className="sidebar">
      <Brand compact />
      <nav ref={navRef}>{links.map(([to, Icon, label]) => <NavLink className="focusable" end={to==='/'} to={to} key={to} title={label}><Icon /><span>{label}</span></NavLink>)}</nav>
    </aside>
    <main className="main">
      <header className="topbar">
        <button className="profile-mini" onClick={onSwitchProfile} title="Changer de profil"><ProfileAvatar profile={profile} className="profile-avatar--mini"/><div><small>Bon retour,</small><strong>{profile.name}</strong></div></button>
        <div className="tagline">DES HISTOIRES<br/>POUR TOUS VOS SOIRS<i /></div>
        <div className="status"><Settings size={22} /><span>{clock.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' })}</span><Wifi size={21} /></div>
      </header>
      <div className="page" key={location.pathname}>{children}</div>
    </main>
  </div>;
}
