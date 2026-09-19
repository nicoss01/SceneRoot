export type RankCandidate = { id: string; title: string; quality: string; languages: string[]; hdr: boolean; size: number; seeders: number; codec?: string };
export type RankPrefs = { preferredQuality?: string; preferredLanguages?: string[]; preferHdr?: boolean; maxBytes?: number };

export function rankDownloads<T extends RankCandidate>(candidates: T[], prefs: RankPrefs): Array<T & { compatibilityScore: number }> {
  return candidates.map(candidate => {
    let score = Math.min(30, Math.log2(candidate.seeders + 1) * 5);
    if (candidate.quality === prefs.preferredQuality) score += 28;
    if (prefs.preferredLanguages?.some(language => candidate.languages.includes(language))) score += 22;
    if (prefs.preferHdr && candidate.hdr) score += 10;
    if (prefs.maxBytes && candidate.size > prefs.maxBytes) score -= 35;
    if (/hevc|h265/i.test(candidate.codec ?? '')) score += 6;
    return { ...candidate, compatibilityScore: Math.round(score) };
  }).sort((a, b) => b.compatibilityScore - a.compatibilityScore);
}
