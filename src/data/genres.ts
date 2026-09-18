export const movieGenres = [
  'Action', 'Aventure', 'Animation', 'Comédie', 'Policier', 'Documentaire',
  'Drame', 'Famille', 'Fantastique', 'Histoire', 'Horreur', 'Musique',
  'Mystère', 'Romance', 'Science-fiction', 'Téléfilm', 'Thriller', 'Guerre', 'Western'
] as const;

export const seriesGenres = [
  'Action & aventure', 'Animation', 'Comédie', 'Policier', 'Documentaire',
  'Drame', 'Famille', 'Enfants', 'Mystère', 'Actualités', 'Téléréalité',
  'Science-fiction & fantastique', 'Soap', 'Talk-show', 'Guerre & politique', 'Western'
] as const;

export const allGenres = [...new Set<string>([...movieGenres, ...seriesGenres])].sort((a, b) =>
  a.localeCompare(b, 'fr')
);
