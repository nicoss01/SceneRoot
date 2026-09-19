export type RecoRating = { profileId: string; mediaId: string; score: number };
export type RecoPlayback = { profileId: string; mediaId: string; progress: number };
export type RecoCandidate = { id: string; genres: string[]; ageRating?: number };
export type RecoDeps = {
  ratings: RecoRating[];
  playback: RecoPlayback[];
  genresOf: (mediaId: string) => string[];
  ageLimits: Record<string, number | undefined>;
};
export type RecoResult = { id: string; score: number; average: number; disagreement: number; affinities: number[]; seenBy: string[]; allowed: boolean };

const NEUTRAL = 65;
const COMPLETED = 0.9;

export function recommendGroup(profileIds: string[], candidates: RecoCandidate[], deps: RecoDeps, preferUnseen = true): RecoResult[] {
  const taste = new Map<string, Record<string, { sum: number; weight: number }>>();
  const seen = new Map<string, Set<string>>();
  for (const profileId of profileIds) {
    const profileTaste: Record<string, { sum: number; weight: number }> = {};
    const profileSeen = new Set<string>();
    for (const rating of deps.ratings.filter(r => r.profileId === profileId)) {
      const value = Math.max(0, Math.min(100, rating.score * 10));
      for (const genre of deps.genresOf(rating.mediaId)) {
        const bucket = profileTaste[genre] ?? { sum: 0, weight: 0 };
        bucket.sum += value; bucket.weight += 1; profileTaste[genre] = bucket;
      }
      profileSeen.add(rating.mediaId);
    }
    for (const entry of deps.playback.filter(p => p.profileId === profileId && p.progress >= COMPLETED)) {
      profileSeen.add(entry.mediaId);
      if (deps.ratings.some(r => r.profileId === profileId && r.mediaId === entry.mediaId)) continue;
      for (const genre of deps.genresOf(entry.mediaId)) {
        const bucket = profileTaste[genre] ?? { sum: 0, weight: 0 };
        bucket.sum += 75 * 0.5; bucket.weight += 0.5; profileTaste[genre] = bucket;
      }
    }
    taste.set(profileId, profileTaste); seen.set(profileId, profileSeen);
  }
  const genreAffinity = (profileId: string, genre: string) => {
    const bucket = taste.get(profileId)?.[genre];
    return bucket && bucket.weight > 0 ? bucket.sum / bucket.weight : NEUTRAL;
  };
  const predict = (profileId: string, candidate: RecoCandidate) => {
    const rating = deps.ratings.find(r => r.profileId === profileId && r.mediaId === candidate.id);
    if (rating) return Math.max(0, Math.min(100, rating.score * 10));
    const genres = candidate.genres.length ? candidate.genres : ['(inconnu)'];
    const average = genres.map(genre => genreAffinity(profileId, genre)).reduce((a, b) => a + b, 0) / genres.length;
    return Math.max(0, Math.min(100, average));
  };
  return candidates.map(candidate => {
    const affinities = profileIds.map(profileId => Math.round(predict(profileId, candidate)));
    const average = affinities.reduce((a, b) => a + b, 0) / Math.max(1, affinities.length);
    const disagreement = affinities.length ? Math.max(...affinities) - Math.min(...affinities) : 0;
    const seenBy = profileIds.filter(profileId => seen.get(profileId)?.has(candidate.id));
    let score = average - 0.42 * disagreement;
    if (preferUnseen && seenBy.length) score -= 12 * (seenBy.length / Math.max(1, profileIds.length));
    let allowed = true;
    if (typeof candidate.ageRating === 'number') {
      for (const profileId of profileIds) {
        const limit = deps.ageLimits[profileId];
        if (typeof limit === 'number' && candidate.ageRating > limit) allowed = false;
      }
    }
    return { id: candidate.id, score: Math.round(score), average: Math.round(average), disagreement: Math.round(disagreement), affinities, seenBy, allowed };
  }).filter(candidate => candidate.allowed).sort((a, b) => b.score - a.score);
}
