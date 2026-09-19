#!/usr/bin/env bash
set -euo pipefail

# Le kiosque peut être lancé depuis un shell de login (autologin tty1), qui ne
# lit pas EnvironmentFile= : on charge la configuration nous-mêmes.
if [[ -r /etc/sceneroot.env ]]; then
  set -a
  # shellcheck disable=SC1091
  . /etc/sceneroot.env || true
  set +a
fi

URL="${SCENEROOT_URL:-http://127.0.0.1:4174}"
until curl --silent --fail "$URL/api/health" >/dev/null; do sleep 2; done

detect_tv_scale() {
  local modes mode width
  for modes in /sys/class/drm/card*-HDMI-A-*/modes /sys/class/drm/card*-HDMI-*/modes; do
    [[ -s "$modes" ]] || continue
    mode="$(head -n 1 "$modes")"
    width="${mode%%x*}"
    if [[ "$width" =~ ^[0-9]+$ ]]; then
      if (( width >= 3000 )); then echo 2; return
      elif (( width >= 2400 )); then echo 1.5; return
      fi
    fi
  done
  echo 1
}

# Échelle 1 par défaut : une échelle > 1 fait soumettre à Chromium/Wayland un
# tampon à la taille logique, affiché au quart de l'écran sur une sortie 4K.
# La lisibilité vient de la sortie forcée en 1080p, pas d'un facteur d'échelle.
TV_SCALE="${SCENEROOT_TV_SCALE:-1}"
[[ "$TV_SCALE" == "auto" ]] && TV_SCALE="$(detect_tv_scale)"

if command -v chromium >/dev/null 2>&1; then
  BROWSER=chromium
elif command -v chromium-browser >/dev/null 2>&1; then
  BROWSER=chromium-browser
else
  echo "SceneRoot : Chromium est introuvable." >&2
  exit 1
fi

FLAGS=(--kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --no-first-run --disable-translate --password-store=basic --autoplay-policy=no-user-gesture-required "--force-device-scale-factor=$TV_SCALE")
if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
  FLAGS+=(--ozone-platform=wayland --enable-features=UseOzonePlatform)
fi

echo "SceneRoot : démarrage de Chromium avec une échelle TV de ${TV_SCALE}x" >&2

# Chromium a besoin d'un bus D-Bus de session : on l'enveloppe ici plutôt que
# d'englober Cage (dbus-run-session autour de Cage fait échouer le service).
# Zoom d'interface pour la TV (lisibilité à distance). Appliqué par l'application
# elle-même via ?tv=..., et non par --force-device-scale-factor qui casse le rendu.
TV_ZOOM="${SCENEROOT_TV_ZOOM:-1.35}"
LAUNCH=("$BROWSER" "${FLAGS[@]}" "${URL%/}/?tv=$TV_ZOOM")
if command -v dbus-run-session >/dev/null 2>&1; then
  LAUNCH=(dbus-run-session -- "${LAUNCH[@]}")
fi

while true; do
  "${LAUNCH[@]}" || true
  sleep 2
done
