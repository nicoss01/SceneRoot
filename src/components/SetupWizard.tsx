import { useState } from 'react';
import { Check, ChevronRight, Download, Monitor, Plus, Sparkles, Users } from 'lucide-react';
import { Brand } from './Brand';
import { ProfileAvatar } from './ProfileAvatar';
import { ProfileEditor } from './ProfileEditor';
import { accentForAvatar, avatarChoices } from '../data/avatars';
import type { Profile } from '../types';

const SUGGESTIONS = ['Papa', 'Maman', 'Ado', 'Enfant'];

export function SetupWizard({ onDone }: { onDone: (profiles: Profile[]) => void }) {
  const [step, setStep] = useState(0);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editing, setEditing] = useState(false);
  const [reserve, setReserve] = useState(50);
  const [quality, setQuality] = useState('1080p');
  const [hdr, setHdr] = useState(false);
  const [tmdbApiKey, setTmdbApiKey] = useState('');
  const [error, setError] = useState('');
  const [finishing, setFinishing] = useState(false);

  const quickAdd = async (name: string) => {
    const avatar = avatarChoices[profiles.length % avatarChoices.length];
    try {
      const response = await fetch('/api/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ageLimit: 18, avatar: avatar.src, accent: accentForAvatar(avatar.src) }) });
      if (response.ok) { const created = await response.json() as Profile; setProfiles(current => [...current, created]); }
    } catch { /* réseau indisponible : l'utilisateur peut réessayer */ }
  };

  const finish = async () => {
    setFinishing(true); setError('');
    try {
      const response = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minFreeGb: reserve, preferredQuality: quality, preferHdr: hdr, setupComplete: true, catalogSyncEnabled: true, ...(tmdbApiKey.trim() ? { tmdbApiKey: tmdbApiKey.trim() } : {}) }) });
      if (!response.ok) { const payload = await response.json().catch(() => ({})) as { error?: string }; throw new Error(payload.error ?? 'Impossible de finaliser la configuration.'); }
      fetch('/api/library/scan', { method: 'POST' }).catch(() => {});
      onDone(profiles);
    } catch (cause) { setError((cause as Error).message); } finally { setFinishing(false); }
  };

  const steps = ['Bienvenue', 'Profils', 'Préférences', 'C’est prêt'];

  return <div className="gate starscape setup">
    <div className="gate__head"><Brand /><span className="setup-dots">{steps.map((label, index) => <i key={label} className={index === step ? 'on' : index < step ? 'done' : ''} title={label} />)}</span></div>

    {step === 0 && <div className="setup-panel">
      <div className="setup-icon"><Sparkles /></div>
      <h1>Bienvenue sur SceneRoot</h1>
      <p>Votre media center familial. En trois étapes, créons vos profils et vos préférences pour démarrer.</p>
      <button className="primary setup-next" onClick={() => setStep(1)}>Commencer <ChevronRight /></button>
    </div>}

    {step === 1 && <div className="setup-panel wide">
      <div className="setup-icon"><Users /></div>
      <h1>Qui va utiliser SceneRoot ?</h1>
      <p>Ajoutez les membres de la famille. Vous pourrez tout modifier plus tard.</p>
      <div className="setup-suggestions">{SUGGESTIONS.map(name => <button key={name} className="chip" onClick={() => void quickAdd(name)} disabled={profiles.some(profile => profile.name === name)}><Plus size={15} />{name}</button>)}</div>
      {profiles.length > 0 && <div className="setup-profiles">{profiles.map(profile => <div className="setup-profile" key={profile.id}><ProfileAvatar profile={profile} /><strong>{profile.name}</strong><small>{profile.ageLimit === 18 ? 'Tout public' : `-${profile.ageLimit}`}</small></div>)}</div>}
      <button className="add-profile" onClick={() => setEditing(true)}><Plus /> Profil personnalisé</button>
      <div className="setup-actions"><button className="secondary" onClick={() => setStep(0)}>Retour</button><button className="primary" disabled={!profiles.length} onClick={() => setStep(2)}>Continuer <ChevronRight /></button></div>
      {editing && <ProfileEditor onClose={() => setEditing(false)} onSaved={saved => { setProfiles(current => [...current, saved]); setEditing(false); }} />}
    </div>}

    {step === 2 && <div className="setup-panel wide">
      <div className="setup-icon"><Download /></div>
      <h1>Préférences de lecture</h1>
      <p>Réglages par défaut pour les téléchargements et la qualité. Modifiables dans les paramètres.</p>
      <label className="setup-field">Réserve d’espace disque : <b>{reserve} Go</b><input type="range" min={5} max={500} step={5} value={reserve} onChange={event => setReserve(Number(event.target.value))} /></label>
      <label className="setup-field">Qualité préférée<select value={quality} onChange={event => setQuality(event.target.value)}><option value="720p">720p</option><option value="1080p">1080p</option><option value="2160p">4K (2160p)</option></select></label>
      <button className={`chip toggle ${hdr ? 'on' : ''}`} onClick={() => setHdr(value => !value)}><Monitor size={15} /> Préférer le HDR : {hdr ? 'oui' : 'non'}</button>
      <label className="setup-field">Clé API TMDB v3 <small>Facultative · permet les titres, résumés et images en français. Sans clé, Wikipédia sert uniquement de secours.</small><input type="password" autoComplete="off" placeholder="Clé API TMDB" value={tmdbApiKey} onChange={event => setTmdbApiKey(event.target.value)} /></label>
      <div className="setup-actions"><button className="secondary" onClick={() => setStep(1)}>Retour</button><button className="primary" onClick={() => setStep(3)}>Continuer <ChevronRight /></button></div>
    </div>}

    {step === 3 && <div className="setup-panel">
      <div className="setup-icon"><Check /></div>
      <h1>Tout est prêt</h1>
      <p>{profiles.length} profil{profiles.length > 1 ? 's' : ''} créé{profiles.length > 1 ? 's' : ''}. SceneRoot va analyser votre médiathèque et vous laisser choisir un profil.</p>
      {error && <div className="profile-error">{error}</div>}
      <button className="primary setup-next" disabled={finishing} onClick={() => void finish()}>{finishing ? 'Finalisation…' : 'Lancer SceneRoot'} <ChevronRight /></button>
    </div>}
  </div>;
}
