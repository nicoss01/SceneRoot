export function formatBytes(bytes: number, empty = '0 o'): string {
  if (!bytes) return empty;
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i >= 3 ? 1 : 0)} ${units[i]}`;
}

/** Date lisible pour la TV : « 20/09/2026 à 03:12 », ou « jamais » sans valeur. */
export function formatDateTime(value?: string, empty = 'jamais'): string {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return empty;
  return `${date.toLocaleDateString('fr-FR')} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}
