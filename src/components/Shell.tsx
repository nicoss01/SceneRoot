import { Clock3, Compass, Film, FolderHeart, Home, Search, Settings, Sparkles, Tv, Wifi } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Brand } from './Brand';
import type { Profile } from '../types';

const links = [
  ['/', Home, 'Accueil'], ['/films', Film, 'Films'], ['/series', Tv, 'Séries'], ['/discover', Compass, 'Découvrir'],
  ['/tonight', Sparkles, 'Ce soir'], ['/roots', Clock3, 'Mes Roots'], ['/library', FolderHeart, 'Ma médiathèque'], ['/search', Search, 'Rechercher'], ['/settings', Settings, 'Paramètres']
] as const;

export function Shell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const location = useLocation();
  const [clock,setClock]=useState(()=>new Date());
  useEffect(()=>{const timer=setInterval(()=>setClock(new Date()),30_000);return()=>clearInterval(timer)},[]);
  return <div className="app-shell">
    <aside className="sidebar">
      <Brand compact />
      <nav>{links.map(([to, Icon, label]) => <NavLink className="focusable" to={to} key={to}><Icon /><span>{label}</span></NavLink>)}</nav>
    </aside>
    <main className="main">
      <header className="topbar">
        <div className="profile-mini"><span style={{ background: profile.accent }}>{profile.avatar}</span><div><small>Bon retour,</small><strong>{profile.name}</strong></div></div>
        <div className="tagline">DES HISTOIRES<br/>POUR TOUS VOS SOIRS<i /></div>
        <div className="status"><Settings size={22} /><span>{clock.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' })}</span><Wifi size={21} /></div>
      </header>
      <div className="page" key={location.pathname}>{children}</div>
    </main>
  </div>;
}
