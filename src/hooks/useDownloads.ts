import { useCallback, useEffect, useState } from 'react';

export type Torrent = {
  id: number;
  name: string;
  percentDone: number;
  rateDownload: number;
  rateUpload: number;
  status: number;
  totalSize: number;
  sizeWhenDone: number;
  eta: number;
  errorString?: string;
  peersConnected: number;
};

export function useDownloads(pollMs = 2000) {
  const [torrents, setTorrents] = useState<Torrent[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/downloads');
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? `Indisponible (${response.status})`);
      }
      setTorrents(await response.json() as Torrent[]);
      setError('');
    } catch (cause) { setError((cause as Error).message); } finally { setLoading(false); }
  }, []);
  const control = useCallback(async (id: number, action: 'start' | 'stop' | 'remove', deleteData = false) => {
    await fetch(`/api/downloads/${id}/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, deleteData }) });
    await refresh();
  }, [refresh]);
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(interval);
  }, [pollMs, refresh]);
  return { torrents, error, loading, control, refresh };
}
