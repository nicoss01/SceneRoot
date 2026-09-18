#!/usr/bin/env bash
set -euo pipefail
URL="${SCENEROOT_URL:-http://127.0.0.1:4174}"
until curl --silent --fail "$URL/api/health" >/dev/null; do sleep 2; done
while true; do
  chromium --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required "$URL" || true
  sleep 2
done
