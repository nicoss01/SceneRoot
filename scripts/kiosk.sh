#!/usr/bin/env bash
# Lanceur du kiosque TV. Volontairement tolérant : une erreur ne doit jamais
# faire sortir ce script, sinon le compositeur se ferme et l'écran repart dans
# une boucle de relance illisible. Tout est journalisé pour pouvoir diagnostiquer.
set -uo pipefail

LOG=/tmp/sceneroot-kiosk.log
exec > >(tee -a "$LOG") 2>&1
echo "=== $(date -Iseconds) démarrage du kiosque ==="

# Le kiosque peut être lancé depuis un shell de login (autologin tty1), qui ne
# lit pas EnvironmentFile= : on charge la configuration nous-mêmes. Les valeurs
# contenant des espaces sont gérées ici, là où « source » exécuterait la suite.
if [[ -r /etc/sceneroot.env ]]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# || -z "${line//[[:space:]]/}" ]] && continue
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    export "${BASH_REMATCH[1]}=${BASH_REMATCH[2]}"
  done < /etc/sceneroot.env
fi

URL="${SCENEROOT_URL:-http://127.0.0.1:4174}"
echo "Attente du serveur sur $URL"
until curl --silent --fail "$URL/api/health" >/dev/null; do sleep 2; done
echo "Serveur prêt"

# Définition réellement utilisée par le compositeur, à titre indicatif : une
# sortie 4K fait parfois échouer Chromium sur un Raspberry Pi. Le mode se force
# dans cmdline.txt (video=HDMI-A-1:1920x1080M@60), pas ici.
for modes in /sys/class/drm/card*-HDMI-A-*/modes; do
  [[ -s "$modes" ]] && echo "Mode HDMI préféré : $(head -n 1 "$modes")"
done

if command -v chromium >/dev/null 2>&1; then
  BROWSER=chromium
elif command -v chromium-browser >/dev/null 2>&1; then
  BROWSER=chromium-browser
else
  echo "SceneRoot : Chromium est introuvable, installez-le (apt install chromium)." >&2
  # On garde le compositeur en vie : sans cela l'écran clignote sans fin.
  sleep infinity
fi

FLAGS=(--kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --no-first-run
  --disable-translate --password-store=basic --autoplay-policy=no-user-gesture-required
  --force-device-scale-factor=1)
if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
  FLAGS+=(--ozone-platform=wayland --enable-features=UseOzonePlatform)
fi
# Échappatoire pour ajuster le rendu sur une machine particulière.
read -r -a EXTRA_FLAGS <<< "${SCENEROOT_CHROMIUM_ARGS:-}"
[[ ${#EXTRA_FLAGS[@]} -gt 0 ]] && FLAGS+=("${EXTRA_FLAGS[@]}")

# Zoom d'interface pour la TV (lisibilité à distance). Appliqué par l'application
# elle-même via ?tv=..., et non par --force-device-scale-factor qui casse le rendu.
TV_ZOOM="${SCENEROOT_TV_ZOOM:-1.35}"
LAUNCH=("$BROWSER" "${FLAGS[@]}" "${URL%/}/?tv=$TV_ZOOM")
# Chromium a besoin d'un bus D-Bus de session : on l'enveloppe ici plutôt que
# d'englober Cage (dbus-run-session autour de Cage fait échouer le service).
if command -v dbus-run-session >/dev/null 2>&1; then
  LAUNCH=(dbus-run-session -- "${LAUNCH[@]}")
fi

# Le compositeur affiche un curseur au centre tant qu'aucune souris n'a bougé :
# on le range dans un coin, hors du champ de vision.
( sleep 4; python3 /opt/sceneroot/scripts/park-cursor.py >/dev/null 2>&1 || true ) &

echo "Lancement : ${LAUNCH[*]}"
while true; do
  "${LAUNCH[@]}" || echo "Chromium s'est arrêté (code $?), relance dans 2 s"
  sleep 2
done
