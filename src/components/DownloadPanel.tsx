import { useEffect, useMemo, useState } from 'react';
import { Check, Download, Loader2, X } from 'lucide-react';
import { parseRelease } from '../lib/release';
import { formatBytes } from '../lib/format';
import type { MediaItem } from '../types';

type SourceResult = { source: string; title: string; link?: string; size: number; seeders: number; published?: string };
type RankedResult = SourceResult & { id: string; quality: string; languages: string[]; hdr: boolean; codec?: string; compatibilityScore: number };

export function DownloadPanel({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const [results, setResults] = useState<RankedResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [launching, setLaunching] = useState<string | null>(null);
  const [launched, setLaunched] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState('');
  const kind = item.kind === 'serie' ? 'tv' : 'movie';
  const query = useMemo(() => item.title, [item.title]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const params = new URLSearchParams({ q: query, kind });
        const response = await fetch(`/api/sources/search?${params}`);
        if (!response.ok) throw new Error(`Recherche indisponible (${response.status})`);
        const rows = await response.json() as SourceResult[];
        if (!rows.length) { if (active) { setResults([]); setLoading(false); } return; }
        const candidates = rows.map((row, index) => ({ ...row, id: `dl-${index}`, ...parseRelease(row.title) }));
        const ranked = await fetch('/api/downloads/rank', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: item.kind, preferredQuality: '1080p', preferredLanguages: ['multi', 'truefrench', 'vff', 'french'], preferHdr: false, candidates }),
        });
        const scored = ranked.ok ? await ranked.json() as RankedResult[] : candidates.map(c => ({ ...c, compatibilityScore: 0 }));
        if (active) { setResults(scored); setLoading(false); }
      } catch (cause) { if (active) { setError((cause as Error).message); setLoading(false); } }
    })();
    return () => { active = false; };
  }, [query, kind, item.kind]);

  const launch = async (result: RankedResult) => {
    setLaunchError('');
    if (!result.link?.startsWith('magnet:?')) { setLaunchError('Cette source ne fournit pas de lien magnet direct.'); return; }
    setLaunching(result.id);
    try {
      const response = await fetch('/api/downloads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnet: result.link, expectedBytes: result.size }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((payload as { error?: string }).error ?? `Échec (${response.status})`);
      setLaunched(result.id);
    } catch (cause) { setLaunchError((cause as Error).message); } finally { setLaunching(null); }
  };

  return <div className="modal-backdrop" onClick={onClose}>
    <div className="download-panel" onClick={event => event.stopPropagation()}>
      <button className="modal-close" onClick={onClose}><X /></button>
      <h2><Download /> Télécharger « {item.title} »</h2>
      <p className="download-legal">Utilisez uniquement des sources et des contenus que vous êtes autorisé à récupérer.</p>
      {loading && <div className="library-loading"><i /> Recherche sur vos sources…</div>}
      {error && <div className="profile-error">{error}</div>}
      {!loading && !error && !results.length && <div className="library-empty"><Download /><h3>Aucun résultat</h3><p>Aucune source configurée n’a répondu, ou aucune version ne correspond. Ajoutez une source Torznab dans les paramètres.</p></div>}
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
      {launchError && <div className="profile-error">{launchError}</div>}
    </div>
  </div>;
}
