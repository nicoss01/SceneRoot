export type ParsedRelease = { quality: string; hdr: boolean; codec?: string; languages: string[] };

export function parseRelease(title: string): ParsedRelease {
  const t = title.toLowerCase();
  const quality = /2160p|4k|uhd/.test(t) ? '2160p' : /1080p/.test(t) ? '1080p' : /720p/.test(t) ? '720p' : /480p/.test(t) ? '480p' : 'SD';
  const hdr = /hdr|dolby.?vision|\bdv\b/.test(t);
  const codec = /x265|hevc|h\.?265/.test(t) ? 'HEVC' : /x264|h\.?264|avc/.test(t) ? 'H.264' : undefined;
  const languages: string[] = [];
  if (/multi/.test(t)) languages.push('multi');
  if (/truefrench|\btruefr\b/.test(t)) languages.push('truefrench');
  if (/\bvff\b/.test(t)) languages.push('vff');
  if (/french|\bfr\b|\bvf\b|\bvfi\b/.test(t)) languages.push('french');
  if (/vostfr/.test(t)) languages.push('vostfr');
  if (/english|\beng\b|\ben\b/.test(t)) languages.push('english');
  if (!languages.length) languages.push('inconnu');
  return { quality, hdr, codec, languages: [...new Set(languages)] };
}
