import { useEffect, useRef } from 'react';

/**
 * Closes a dialog when Escape is pressed — the key the HDMI-CEC bridge maps the
 * remote's "retour" button to. Registered in the capture phase so the dialog
 * wins over the app's spatial navigation, and stops immediate propagation so a
 * single press closes only the topmost dialog.
 */
export function useEscapeClose(onClose: () => void, enabled = true) {
  const handler = useRef(onClose);
  handler.current = onClose;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      handler.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled]);
}
