#!/usr/bin/env bash
set -euo pipefail
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

TV_SCALE="${SCENEROOT_TV_SCALE:-auto}"
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

while true; do
  "$BROWSER" "${FLAGS[@]}" "$URL" || true
  sleep 2
done
