import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Éléments réellement atteignables : un bouton masqué ne doit pas capter le focus. */
export function focusableWithin(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element => element.offsetParent !== null);
}

/**
 * Enferme le focus dans une boîte modale : à la télécommande comme au clavier,
 * rien de ce qui se trouve derrière ne doit être atteignable. Le focus part sur
 * le premier élément utile et revient à son point de départ à la fermeture.
 */
export function useModalFocus<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const container = enabled ? ref.current : null;
    if (!container) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = () => focusableWithin(container)[0];
    if (!container.contains(document.activeElement)) first()?.focus();

    // Le focus peut s'échapper par Tab, par un clic ou par la navigation
    // spatiale : on le ramène dans la modale quoi qu'il arrive.
    const onFocusIn = (event: FocusEvent) => {
      if (container.contains(event.target as Node)) return;
      event.stopPropagation();
      first()?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = focusableWithin(container);
      if (!elements.length) return;
      const edge = event.shiftKey ? elements[0] : elements[elements.length - 1];
      if (document.activeElement !== edge) return;
      event.preventDefault();
      (event.shiftKey ? elements[elements.length - 1] : elements[0]).focus();
    };
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('keydown', onKeyDown, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [enabled]);
  return ref;
}
