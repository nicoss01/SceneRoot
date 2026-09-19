export type StatsRating = { mediaId: string; score: number; tags: string[]; at: string };
export type StatsPlayback = { mediaId: string; progress: number; updatedAt: string };
export type StatsDeps = {
  ratings: StatsRating[];
  playback: StatsPlayback[];
  genresOf: (mediaId: string) => string[];
  kindOf: (mediaId: string) => 'film' | 'serie' | undefined;
};
export type ProfileStats = {
  watched: number;
  rated: number;
  averageRating: number | null;
  films: number;
  series: number;
  topGenres: Array<{ genre: string; count: number }>;
  topTags: Array<{ tag: string; count: number }>;
  activity: Array<{ month: string; count: number }>;
};

const COMPLETED = 0.92;

function topEntries(counts: Map<string, number>, limit: number) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

export function computeStats(deps: StatsDeps, now = new Date()): ProfileStats {
  // Latest "watched" timestamp per media (completed playback or a rating).
  const watchedAt = new Map<string, string>();
  for (const entry of deps.playback) if (entry.progress >= COMPLETED) watchedAt.set(entry.mediaId, entry.updatedAt);
  for (const rating of deps.ratings) {
    const previous = watchedAt.get(rating.mediaId);
    if (!previous || rating.at > previous) watchedAt.set(rating.mediaId, rating.at);
  }

  const genreCounts = new Map<string, number>();
  let films = 0, series = 0;
  for (const mediaId of watchedAt.keys()) {
    for (const genre of deps.genresOf(mediaId)) genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    const kind = deps.kindOf(mediaId);
    if (kind === 'film') films++; else if (kind === 'serie') series++;
  }

  const tagCounts = new Map<string, number>();
  for (const rating of deps.ratings) for (const tag of rating.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);

  const averageRating = deps.ratings.length
    ? Math.round((deps.ratings.reduce((sum, rating) => sum + rating.score, 0) / deps.ratings.length) * 10) / 10
    : null;

  // Activity over the last 6 calendar months, oldest first.
  const months: string[] = [];
  for (let offset = 5; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  }
  const monthCounts = new Map(months.map(month => [month, 0]));
  for (const timestamp of watchedAt.values()) {
    const month = timestamp.slice(0, 7);
    if (monthCounts.has(month)) monthCounts.set(month, monthCounts.get(month)! + 1);
  }

  return {
    watched: watchedAt.size,
    rated: deps.ratings.length,
    averageRating,
    films,
    series,
    topGenres: topEntries(genreCounts, 6).map(([genre, count]) => ({ genre, count })),
    topTags: topEntries(tagCounts, 6).map(([tag, count]) => ({ tag, count })),
    activity: months.map(month => ({ month, count: monthCounts.get(month) ?? 0 })),
  };
}
