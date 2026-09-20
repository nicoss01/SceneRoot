import { useEffect, useMemo, useState } from 'react';
import { Check, Download, Loader2, X } from 'lucide-react';
import { parseRelease } from '../lib/release';
import { formatBytes } from '../lib/format';
import { useEscapeClose } from '../hooks/useEscapeClose';
import type { MediaItem } from '../types';

type SourceResult = { source: string; title: string; link?: string; size: number; seeders: number; published?: string };
type RankedResult = SourceResult & { id: string; quality: string; languages: string[]; hdr: boolean; codec?: string; compatibilityScore: number };

const MAX_RESULTS = 6;

export function DownloadPanel({ item, onClose, priority = false, onQueued }: { item: MediaItem; onClose: () => void; priority?: boolean; onQueued?: (torrentId?: number) => void }) {
  const [results, setResults] = useState<RankedResult[]>([]);
  const [totalFound, setTotalFound] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [launching, setLaunching] = useState<string | null>(null);
  const [launched, setLaunched] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState('');
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [wholeSeason, setWholeSeason] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Array<{ source: string; status: number; count: number; error?: string; mode?: string }>>([]);
  const kind = item.kind === 'serie' ? 'tv' : 'movie';
  const query = useMemo(() => item.title, [item.title]);
  const isSeries = item.kind === 'serie';
  useEscapeClose(onClose);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const params = new URLSearchParams({ q: query, kind });
        if (isSeries) { params.set('season', String(season)); if (!wholeSeason) params.set('episode', String(episode)); }
        const response = await fetch(`/api/sources/search?${params}`);
        if (!response.ok) throw new Error(`Recherche indisponible (${response.status})`);
        try { const raw = response.headers.get('X-SceneRoot-Sources'); if (raw && active) setDiagnostics(JSON.parse(raw)); } catch { /* diagnostic facultatif */ }
        const rows = await response.json() as SourceResult[];
        if (!rows.length) { if (active) { setResults([]); setTotalFound(0); setLoading(false); } return; }
        const candidates = rows.map((row, index) => ({ ...row, id: `dl-${index}`, ...parseRelease(row.title) }));
        const ranked = await fetch('/api/downloads/rank', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: item.kind, preferredQuality: '1080p', preferredLanguages: ['multi', 'truefrench', 'vff', 'french'], preferHdr: false, candidates }),
        });
        const scored = ranked.ok ? await ranked.json() as RankedResult[] : candidates.map(c => ({ ...c, compatibilityScore: 0 }));
        // Six propositions au maximum : au-delà, la liste dépasse l'écran TV et
        // les boutons du bas deviennent inatteignables à la télécommande.
        if (active) { setResults(scored.slice(0, MAX_RESULTS)); setTotalFound(scored.length); setLoading(false); }
      } catch (cause) { if (active) { setError((cause as Error).message); setLoading(false); } }
    })();
    return () => { active = false; };
  }, [query, kind, item.kind, isSeries, season, episode, wholeSeason]);

  const launch = async (result: RankedResult) => {
    setLaunchError('');
    if (!result.link || !/^(magnet:\?|https?:\/\/)/i.test(result.link)) { setLaunchError('Cette source ne fournit pas de lien de téléchargement exploitable.'); return; }
    setLaunching(result.id);
    try {
      const response = await fetch('/api/downloads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnet: result.link, expectedBytes: result.size }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; arguments?: { 'torrent-added'?: { id?: number }; 'torrent-duplicate'?: { id?: number } } };
      if (!response.ok) throw new Error(payload.error ?? `Échec (${response.status})`);
      const torrentId = payload.arguments?.['torrent-added']?.id ?? payload.arguments?.['torrent-duplicate']?.id;
      if (priority && typeof torrentId === 'number') {
        await fetch(`/api/downloads/${torrentId}/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'queue-top' }) }).catch(() => {});
      }
      setLaunched(result.id);
      onQueued?.(typeof torrentId === 'number' ? torrentId : undefined);
    } catch (cause) { setLaunchError((cause as Error).message); } finally { setLaunching(null); }
  };

  return <div className="modal-backdrop" onClick={onClose}>
    <div className="download-panel" onClick={event => event.stopPropagation()}>
      <button className="modal-close" onClick={onClose}><X /></button>
      <h2><Download /> {priority ? 'Télécharger et regarder' : 'Télécharger'} « {item.title} »</h2>
      {priority && <p className="download-legal">Le titre sera téléchargé en priorité. La lecture sera disponible dans la médiathèque une fois le fichier prêt (reprise automatique de la progression).</p>}
      <p className="download-legal">Utilisez uniquement des sources et des contenus que vous êtes autorisé à récupérer.</p>
      {isSeries && <div className="download-episode">
        <label>Saison<input type="number" min={1} max={99} value={season} onChange={event => setSeason(Math.max(1, Number(event.target.value) || 1))} /></label>
        <label>Épisode<input type="number" min={1} max={999} value={episode} disabled={wholeSeason} onChange={event => setEpisode(Math.max(1, Number(event.target.value) || 1))} /></label>
        <button className={`chip ${wholeSeason ? 'is-on' : ''}`} onClick={() => setWholeSeason(value => !value)}>Saison complète</button>
      </div>}
      {loading && <div className="library-loading"><i /> Recherche sur vos sources…</div>}
      {error && <div className="profile-error">{error}</div>}
      {!loading && !error && !results.length && <div className="library-empty"><Download /><h3>Aucun résultat</h3><p>Aucune source configurée n’a répondu, ou aucune version ne correspond. Ajoutez une source Torznab dans les paramètres.</p>
        {diagnostics.length > 0 && <div className="source-diagnostics">{diagnostics.map(entry => <div key={entry.source}>
          <strong>{entry.source}</strong> — {entry.error
            ? entry.status === 0 ? `injoignable : ${entry.error}` : `refus de la source : ${entry.error}`
            : `HTTP ${entry.status} · ${entry.count} résultat${entry.count > 1 ? 's' : ''}`}
          {entry.mode && <em> · requête {entry.mode}</em>}
          {!entry.error && entry.status === 200 && entry.count === 0 && <em> (la source répond mais ne renvoie rien : vérifiez l’URL Torznab, la clé et les catégories)</em>}
          {!entry.error && entry.status >= 400 && <em> (URL ou clé API incorrecte)</em>}
        </div>)}</div>}
      </div>}
      {launchError && <div className="profile-error">{launchError}</div>}
      {results.length > 0 && <p className="download-legal">{totalFound > results.length ? `Les ${results.length} meilleures versions sur ${totalFound} trouvées.` : `${results.length} version${results.length > 1 ? 's' : ''} trouvée${results.length > 1 ? 's' : ''}.`}</p>}
      {results.length > 0 && <div className="download-list">{results.map(result => <div className={`download-row ${launched === result.id ? 'is-done' : ''}`} key={result.id}>
        <div className="download-info">
          <strong>{result.title}</strong>
          <div className="download-badges">
            <span>{result.quality}</span>
            {result.hdr && <span>HDR</span>}
            {result.codec && <span>{result.codec}</span>}
            {result.languages.map(lang => <span key={lang} className="lang">{lang.toUpperCase()}</span>)}
            <span>{formatBytes(result.size, '—')}</span>
            <span>{result.seeders} seeders</span>
            <span className="score">{result.compatibilityScore}% compat.</span>
            <span className="src">{result.source}</span>
          </div>
        </div>
        <button className="primary" onClick={() => void launch(result)} disabled={launching === result.id || launched === result.id}>
          {launched === result.id ? <><Check /> Envoyé</> : launching === result.id ? <><Loader2 className="spin" /> Envoi…</> : <><Download /> Télécharger</>}
        </button>
      </div>)}</div>}
    </div>
  </div>;
}
