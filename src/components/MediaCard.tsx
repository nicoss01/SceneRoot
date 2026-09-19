import { Eye, Play, Star } from 'lucide-react';
import { useWatched } from '../context/watched';
import type { MediaItem } from '../types';

export function MediaCard({ item, active, onOpen, wide = false }: { item: MediaItem; active?: boolean; onOpen: () => void; wide?: boolean }) {
  const seen = useWatched().has(item.id);
  return <button className={`media-card focusable ${active ? 'is-active' : ''} ${wide ? 'media-card--wide' : ''}`} onClick={onOpen}>
    <div className="media-card__art" style={{ '--a': item.palette[0], '--b': item.palette[1] } as React.CSSProperties}>
      <img src={item.art??'/assets/sceneroot-landscape.png'} alt="" loading="lazy" decoding="async" onError={event=>{event.currentTarget.onerror=null;event.currentTarget.src='/assets/sceneroot-landscape.png'}} />
      <span className="media-card__orb" />
      <span className="media-card__symbol">{item.symbol}</span>
      {item.badge && <span className={`media-badge media-badge--${item.badge}`}>{item.badge === 'episode' ? 'Nouvel épisode' : 'Nouveau'}</span>}
      {seen && <span className="media-seen" title="Déjà vu"><Eye size={14} /></span>}
      {item.progress !== undefined && <span className="media-card__play"><Play size={18} fill="currentColor" /></span>}
      <span className="quality">{item.quality}</span>
    </div>
    <div className="media-card__body">
      <strong>{item.title}</strong>
      <small>{item.kind === 'film' ? 'Film' : 'Série'} · {item.year} · {item.duration}</small>
      {item.rating > 0 && <span className="media-card__rating"><Star size={14} fill="currentColor" /> {item.rating}</span>}
      {item.progress !== undefined && <span className="progress"><i style={{ width: `${item.progress}%` }} /></span>}
    </div>
  </button>;
}
