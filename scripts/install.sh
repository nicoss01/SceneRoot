#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${SCENEROOT_INSTALL_DIR:-/opt/sceneroot}"
REPO_URL="${SCENEROOT_REPO_URL:-https://github.com/OWNER/SceneRoot.git}"

if [[ "$(uname -m)" != "aarch64" && "$(uname -m)" != "armv7l" ]]; then
  echo "Attention : cette installation est optimisée pour Raspberry Pi OS."
fi

sudo apt-get update
sudo apt-get install -y git curl cec-utils chromium ffmpeg mpv socat transmission-daemon
if ! command -v node >/dev/null || [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if [[ -d "$APP_DIR/.git" ]]; then sudo git -C "$APP_DIR" pull --ff-only; else sudo git clone "$REPO_URL" "$APP_DIR"; fi
sudo chown -R "$USER":"$USER" "$APP_DIR"
cd "$APP_DIR"
npm ci
npm run build
chmod +x scripts/update.sh scripts/kiosk.sh
sudo mkdir -p /var/lib/sceneroot /mnt/media
sudo chown -R "$USER":"$USER" /var/lib/sceneroot
sed "s/@SCENEROOT_USER@/$USER/g" scripts/sceneroot.service | sudo tee /etc/systemd/system/sceneroot.service >/dev/null
sed "s/@SCENEROOT_USER@/$USER/g" scripts/sceneroot-update.service | sudo tee /etc/systemd/system/sceneroot-update.service >/dev/null
sudo cp scripts/sceneroot-update.timer /etc/systemd/system/sceneroot-update.timer
install -Dm755 scripts/kiosk.sh "$HOME/.local/bin/sceneroot-kiosk"
install -Dm644 scripts/sceneroot-kiosk.desktop "$HOME/.config/autostart/sceneroot-kiosk.desktop"
sudo systemctl daemon-reload
sudo systemctl enable --now sceneroot.service sceneroot-update.timer
echo "SceneRoot est disponible sur http://$(hostname -I | awk '{print $1}'):4174"
echo "L'interface TV se lancera automatiquement à la prochaine ouverture de session graphique."
