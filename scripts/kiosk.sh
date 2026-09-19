#!/usr/bin/env bash
set -euo pipefail
URL="${SCENEROOT_URL:-http://127.0.0.1:4174}"
until curl --silent --fail "$URL/api/health" >/dev/null; do sleep 2; done

if command -v chromium >/dev/null 2>&1; then
  BROWSER=chromium
elif command -v chromium-browser >/dev/null 2>&1; then
  BROWSER=chromium-browser
else
  echo "SceneRoot : Chromium est introuvable." >&2
  exit 1
fi

FLAGS=(--kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --no-first-run --disable-translate --password-store=basic --autoplay-policy=no-user-gesture-required)
if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
  FLAGS+=(--ozone-platform=wayland --enable-features=UseOzonePlatform)
fi

while true; do
  "$BROWSER" "${FLAGS[@]}" "$URL" || true
  sleep 2
done
