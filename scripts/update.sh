#!/usr/bin/env bash
set -euo pipefail
APP_DIR="${SCENEROOT_INSTALL_DIR:-/opt/sceneroot}"
APP_USER="${SCENEROOT_USER:-pi}"
cd "$APP_DIR"
sudo -u "$APP_USER" git fetch origin --quiet
CURRENT="$(sudo -u "$APP_USER" git rev-parse HEAD)"
LATEST="$(sudo -u "$APP_USER" git rev-parse origin/main)"
[[ "$CURRENT" == "$LATEST" ]] && exit 0
sudo -u "$APP_USER" git pull --ff-only
sudo -u "$APP_USER" npm ci
sudo -u "$APP_USER" npm run build
systemctl restart sceneroot
