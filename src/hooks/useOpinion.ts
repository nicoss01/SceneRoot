import { useCallback, useEffect, useState } from 'react';

/**
 * Note et « déjà vu » d'un média pour le profil courant, utilisables depuis la
 * fiche — y compris pour un film absent de la médiathèque, afin d'exprimer ses
 * goûts sur ce que l'on a vu ailleurs.
 *
 * « Déjà vu » est enregistré comme une progression terminée : c'est ce que le
 * serveur considère déjà comme vu, sans inventer une note que l'on n'a pas
 * donnée.
 */
export function useOpinion(profileId: string, mediaId: string, initiallySeen = false) {
  const [score, setScore] = useState<number | null>(null);
  const [seen, setSeen] = useState(initiallySeen);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setSeen(initiallySeen) }, [initiallySeen, mediaId]);
  useEffect(() => {
    let active = true;
    setScore(null);
    fetch(`/api/ratings/${encodeURIComponent(profileId)}`)
      .then(response => response.ok ? response.json() as Promise<Array<{ mediaId: string; score: number }>> : [])
      .then(rows => { if (active) setScore(rows.find(row => row.mediaId === mediaId)?.score ?? null) })
      .catch(() => { /* hors ligne : la note reste inconnue */ });
    return () => { active = false };
  }, [profileId, mediaId]);

  const rate = useCallback(async (value: number) => {
    setScore(value); setSeen(true); setSaving(true);
    try {
      await fetch('/api/ratings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId, mediaId, score: value }) });
    } finally { setSaving(false) }
  }, [profileId, mediaId]);

  const markSeen = useCallback(async (next: boolean) => {
    setSeen(next); setSaving(true);
    const path = `/api/playback/${encodeURIComponent(profileId)}/${encodeURIComponent(mediaId)}`;
    try {
      if (next) await fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position: 1, duration: 1 }) });
      else await fetch(path, { method: 'DELETE' });
    } finally { setSaving(false) }
  }, [profileId, mediaId]);

  return { score, seen, saving, rate, markSeen };
}
