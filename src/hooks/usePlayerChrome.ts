import { useEffect, useRef, useState } from 'react';

type Handlers = { onSeekBy: (deltaSeconds: number) => void; onTogglePlay: () => void; enabled?: boolean };

const HIDE_DELAY = 5000;
const SEEK_STEP = 10;

/**
 * Player chrome behaviour shared by the local and progressive players:
 * - hides the controls after 5s of inactivity (mouse/touch/key), shows them on any activity;
 * - lets the remote/keyboard seek with Left/Right arrows and toggle play with Space,
 *   intercepting those keys (capture phase) so the app's spatial navigation does not also fire.
 * Returns whether the chrome is currently visible.
 */
export function usePlayerChrome(handlers: Handlers): boolean {
  const ref = useRef(handlers);
  ref.current = handlers;
  const [visible, setVisible] = useState(true);
  const enabled = handlers.enabled !== false;

  useEffect(() => {
    if (!enabled) { setVisible(true); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = () => { setVisible(true); if (timer) clearTimeout(timer); timer = setTimeout(() => setVisible(false), HIDE_DELAY); };
    show();
    const activity = () => show();
    const onKey = (event: KeyboardEvent) => {
      show();
      if (event.key === 'ArrowRight') { event.preventDefault(); event.stopImmediatePropagation(); ref.current.onSeekBy(SEEK_STEP); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); event.stopImmediatePropagation(); ref.current.onSeekBy(-SEEK_STEP); }
      else if (event.key === ' ') { event.preventDefault(); event.stopImmediatePropagation(); ref.current.onTogglePlay(); }
    };
    window.addEventListener('mousemove', activity);
    window.addEventListener('touchstart', activity, { passive: true });
    window.addEventListener('keydown', onKey, true);
    return () => { if (timer) clearTimeout(timer); window.removeEventListener('mousemove', activity); window.removeEventListener('touchstart', activity); window.removeEventListener('keydown', onKey, true); };
  }, [enabled]);

  return visible;
}
