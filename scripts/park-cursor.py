#!/usr/bin/env python3
"""Pousse le pointeur dans le coin inférieur droit de l'écran.

Le compositeur dessine un curseur au centre de l'écran tant qu'aucune souris ne
l'a déplacé, et une page web ne peut ni le masquer ni le bouger tant qu'il n'est
pas entré dans sa surface. On crée donc une souris virtuelle le temps d'un
grand mouvement relatif : le compositeur borne la position à l'écran, le
pointeur se range dans le coin et n'y bouge plus.
"""

from __future__ import annotations

import sys
import time

from evdev import UInput, ecodes


# Largement plus grand que n'importe quelle définition : la position est bornée.
SWEEP = 20000


def main() -> int:
    capabilities = {ecodes.EV_REL: [ecodes.REL_X, ecodes.REL_Y], ecodes.EV_KEY: [ecodes.BTN_LEFT]}
    try:
        with UInput(capabilities, name="SceneRoot Cursor Parker", bustype=0x03) as ui:
            # Le compositeur doit voir apparaître le périphérique avant l'événement.
            time.sleep(0.4)
            ui.write(ecodes.EV_REL, ecodes.REL_X, SWEEP)
            ui.write(ecodes.EV_REL, ecodes.REL_Y, SWEEP)
            ui.syn()
            time.sleep(0.2)
    except Exception as error:  # périphérique uinput indisponible : sans conséquence
        print(f"SceneRoot : curseur non déplacé ({error})", file=sys.stderr)
        return 0
    print("SceneRoot : curseur rangé en bas à droite", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
