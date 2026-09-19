#!/usr/bin/env python3
"""Transforme les touches HDMI-CEC de libCEC en clavier Linux virtuel."""

from __future__ import annotations

import re
import signal
import subprocess
import sys
import time

from evdev import UInput, ecodes


KEYS = {
    "select": (ecodes.KEY_ENTER,),
    "enter": (ecodes.KEY_ENTER,),
    "up": (ecodes.KEY_UP,),
    "down": (ecodes.KEY_DOWN,),
    "left": (ecodes.KEY_LEFT,),
    "right": (ecodes.KEY_RIGHT,),
    "exit": (ecodes.KEY_LEFTALT, ecodes.KEY_LEFT),
    "back": (ecodes.KEY_LEFTALT, ecodes.KEY_LEFT),
    "previous channel": (ecodes.KEY_LEFTALT, ecodes.KEY_LEFT),
    "play": (ecodes.KEY_SPACE,),
    "pause": (ecodes.KEY_SPACE,),
    "play/pause": (ecodes.KEY_SPACE,),
    "stop": (ecodes.KEY_ESC,),
    "rewind": (ecodes.KEY_LEFT,),
    "fast forward": (ecodes.KEY_RIGHT,),
    "forward": (ecodes.KEY_RIGHT,),
}

PRESS = re.compile(r"key pressed:\s*([^\r\n(]+)", re.IGNORECASE)


def emit(ui: UInput, keys: tuple[int, ...]) -> None:
    for key in keys:
        ui.write(ecodes.EV_KEY, key, 1)
    ui.syn()
    time.sleep(0.045)
    for key in reversed(keys):
        ui.write(ecodes.EV_KEY, key, 0)
    ui.syn()


def run() -> None:
    capabilities = {ecodes.EV_KEY: sorted({key for chord in KEYS.values() for key in chord})}
    with UInput(capabilities, name="SceneRoot HDMI-CEC Remote", bustype=0x03) as ui:
        print("SceneRoot CEC: périphérique virtuel prêt", flush=True)
        while True:
            process = subprocess.Popen(
                ["cec-client", "-d", "31", "-t", "p", "-o", "SceneRoot"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            try:
                if process.stdin:
                    process.stdin.write("as\n")
                    process.stdin.flush()
                assert process.stdout is not None
                for line in process.stdout:
                    match = PRESS.search(line)
                    if not match:
                        continue
                    name = " ".join(match.group(1).strip().lower().split())
                    chord = KEYS.get(name)
                    if chord:
                        emit(ui, chord)
                        print(f"SceneRoot CEC: {name}", flush=True)
            finally:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
            time.sleep(3)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        run()
    except KeyboardInterrupt:
        pass
