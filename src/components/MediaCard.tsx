import { Play, Star } from 'lucide-react';
import type { MediaItem } from '../types';

export function MediaCard({ item, active, onOpen, wide = false }: { item: MediaItem; active?: boolean; onOpen: () => void; wide?: boolean }) {
  const position = `${20 + (item.id.charCodeAt(0) % 5) * 17}% ${25 + (item.id.length % 4) * 20}%`;
  return <button className={`media-card focusable ${active ? 'is-active' : ''} ${wide ? 'media-card--wide' : ''}`} onClick={onOpen}>
    <div className="media-card__art" style={{ '--a': item.palette[0], '--b': item.palette[1], '--position': position } as React.CSSProperties}>
      <span className="media-card__orb" />
      <span className="media-card__symbol">{item.symbol}</span>
      {item.progress !== undefined && <span className="media-card__play"><Play size={18} fill="currentColor" /></span>}
      <span className="quality">{item.quality}</span>
    </div>
    <div className="media-card__body">
      <strong>{item.title}</strong>
      <small>{item.kind === 'film' ? 'Film' : 'Série'} · {item.year} · {item.duration}</small>
      <span className="media-card__rating"><Star size={14} fill="currentColor" /> {item.rating}</span>
      {item.progress !== undefined && <span className="progress"><i style={{ width: `${item.progress}%` }} /></span>}
    </div>
  </button>;
}
