import { useEffect, useState } from 'react';

/**
 * Adresse à présenter au téléphone. Le téléviseur s'affiche lui-même sur
 * 127.0.0.1 : un QR code reprenant cette origine serait inutilisable ailleurs,
 * d'où l'adresse LAN annoncée par le serveur.
 */
export function useRemoteUrl(path: string): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/api/health')
      .then(response => response.ok ? response.json() as Promise<{ addresses?: string[]; port?: number }> : null)
      .then(health => {
        if (!active) return;
        const address = health?.addresses?.[0];
        setUrl(address && health?.port ? `http://${address}:${health.port}${path}` : `${location.origin}${path}`);
      })
      .catch(() => { if (active) setUrl(`${location.origin}${path}`) });
    return () => { active = false };
  }, [path]);
  return url;
}
