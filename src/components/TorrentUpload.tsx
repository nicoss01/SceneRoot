import { Check, Download, Loader2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/** Un .torrent est binaire : on le transmet en base64, par tranches pour ne pas saturer la pile. */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(binary);
}

/**
 * Dépôt d'un fichier .torrent ou d'un lien magnet, pour lancer un
 * téléchargement sans passer par une recherche de source.
 */
export function TorrentUpload() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [magnet, setMagnet] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const submit = async () => {
    setError(''); setDone('');
    if (!file && !magnet.trim()) { setError('Choisissez un fichier .torrent ou collez un lien magnet.'); return; }
    setSending(true);
    try {
      const body = file
        ? { name: file.name, metainfo: await toBase64(file) }
        : { magnet: magnet.trim() };
      const response = await fetch('/api/downloads/torrent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; arguments?: { 'torrent-added'?: { name?: string }; 'torrent-duplicate'?: { name?: string } } };
      if (!response.ok) throw new Error(payload.error ?? `Échec (${response.status})`);
      const added = payload.arguments?.['torrent-added'] ?? payload.arguments?.['torrent-duplicate'];
      setDone(added?.name ? `« ${added.name} » ajouté à la file.` : 'Téléchargement ajouté à la file.');
      setFile(null); setMagnet('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (cause) { setError((cause as Error).message); } finally { setSending(false); }
  };

  return <div className="torrent-upload">
    <h2><Upload /> Charger un torrent</h2>
    <p>Déposez un fichier <code>.torrent</code> récupéré ailleurs, ou collez un lien magnet : le téléchargement rejoint la file, avec les mêmes limites que les autres.</p>
    <label className="torrent-file focusable">
      <input ref={fileRef} type="file" accept=".torrent,application/x-bittorrent" onChange={event => { setFile(event.target.files?.[0] ?? null); setError(''); setDone(''); }} />
      <Upload /> {file ? file.name : 'Choisir un fichier .torrent'}
    </label>
    <label className="torrent-magnet">Ou coller un lien magnet
      <input value={magnet} onChange={event => { setMagnet(event.target.value); setError(''); setDone(''); }} placeholder="magnet:?xt=urn:btih:…" spellCheck={false} />
    </label>
    {error && <div className="profile-error">{error}</div>}
    {done && <div className="torrent-done"><Check /> {done}</div>}
    <div className="torrent-actions">
      <button className="primary focusable" onClick={() => void submit()} disabled={sending}>
        {sending ? <><Loader2 className="spin" /> Envoi…</> : <><Download /> Lancer le téléchargement</>}
      </button>
      <button className="secondary focusable" onClick={() => navigate('/downloads')}><Download /> Voir les téléchargements</button>
    </div>
    <p className="download-legal">Utilisez uniquement des contenus que vous êtes autorisé à télécharger.</p>
  </div>;
}
