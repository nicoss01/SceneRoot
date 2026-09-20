#!/usr/bin/env bash
set -Eeuo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# SceneRoot — installateur Raspberry Pi
# ─────────────────────────────────────────────────────────────────────────────

APP_DIR="${SCENEROOT_INSTALL_DIR:-/opt/sceneroot}"
REPO_URL="${SCENEROOT_REPO_URL:-https://github.com/nicoss01/SceneRoot.git}"
ENV_FILE="/etc/sceneroot.env"
TOTAL_STEPS=9
STEP=0

# Couleurs (désactivées si la sortie n'est pas un terminal)
if [[ -t 1 ]]; then
  C_RESET=$'\e[0m'; C_CYAN=$'\e[38;5;44m'; C_DIM=$'\e[2m'; C_GREEN=$'\e[38;5;42m'
  C_YELLOW=$'\e[38;5;220m'; C_RED=$'\e[38;5;203m'; C_BOLD=$'\e[1m'
else
  C_RESET=; C_CYAN=; C_DIM=; C_GREEN=; C_YELLOW=; C_RED=; C_BOLD=
fi
trap 'printf "\n  %s✗ Installation interrompue (ligne %s, code %s).%s\n" "$C_RED" "$LINENO" "$?" "$C_RESET" >&2' ERR

banner() {
  printf '%s' "$C_CYAN"
  cat <<'ART'
   ___                       ___          _
  / __| __ ___ _ _  ___ ___ | _ \___  ___| |_
  \__ \/ _/ -_) ' \/ -_)___||   / _ \/ _ \  _|
  |___/\__\___|_||_\___|    |_|_\___/\___/\__|
ART
  printf '%s' "$C_RESET"
  echo "  ${C_DIM}Media center familial pour Raspberry Pi${C_RESET}"
  echo
}
step()  { STEP=$((STEP+1)); echo; echo "${C_CYAN}${C_BOLD}▶ [${STEP}/${TOTAL_STEPS}] $1${C_RESET}"; }
ok()    { echo "  ${C_GREEN}✓${C_RESET} $1"; }
info()  { echo "  ${C_DIM}$1${C_RESET}"; }
warn()  { echo "  ${C_YELLOW}!${C_RESET} $1"; }
die()   { echo "  ${C_RED}✗ $1${C_RESET}" >&2; exit 1; }
have()  { command -v "$1" >/dev/null 2>&1; }

# Exécute une commande en masquant sa sortie, avec un message d'état
run() {
  local msg="$1"; shift
  printf '  %s… ' "$msg"
  if "$@" >/tmp/sceneroot-install.log 2>&1; then
    echo "${C_GREEN}ok${C_RESET}"
  else
    echo "${C_RED}échec${C_RESET}"
    echo "${C_DIM}--- dernières lignes du journal ---${C_RESET}" >&2
    tail -n 15 /tmp/sceneroot-install.log >&2
    die "Étape « $msg » échouée."
  fi
}

banner
[[ "$(uname -m)" =~ ^(aarch64|armv7l)$ ]] || warn "Architecture $(uname -m) : optimisé pour Raspberry Pi OS 64-bit."

# ── Étape 1 : configuration interactive (whiptail) ───────────────────────────
step "Configuration"
USE_TUI=0
if have whiptail && [[ -t 0 ]]; then USE_TUI=1; fi

# Valeurs par défaut (env ou existantes)
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE" || true
CFG_MEDIA="${SCENEROOT_MEDIA:-/mnt/media}"
CFG_TMDB="${TMDB_API_KEY:-}"
CFG_TOKEN="${SCENEROOT_ADMIN_TOKEN:-}"
CFG_KIOSK_MODE="${SCENEROOT_KIOSK_MODE:-direct}"
CFG_TV_SCALE="${SCENEROOT_TV_SCALE:-auto}"
CFG_TRANSMISSION="${TRANSMISSION_RPC_URL:-http://127.0.0.1:9091/transmission/rpc}"

if [[ "$USE_TUI" == 1 ]]; then
  CFG_MEDIA=$(whiptail --title "SceneRoot" --inputbox "Dossier(s) média à indexer (séparés par des virgules) :" 10 70 "$CFG_MEDIA" 3>&1 1>&2 2>&3) || die "Installation annulée."
  CFG_TMDB=$(whiptail --title "SceneRoot" --inputbox "Clé API TMDB (facultatif — laissez vide pour Wikipédia + TVmaze) :" 10 70 "$CFG_TMDB" 3>&1 1>&2 2>&3) || CFG_TMDB="$CFG_TMDB"
  if whiptail --title "SceneRoot" --yesno "Autoriser la configuration à distance depuis un mobile ?\n(génère un jeton d'administration)" 10 70; then
    [[ -z "$CFG_TOKEN" ]] && CFG_TOKEN="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)" || true
  fi
  if whiptail --title "SceneRoot" --yesno "Lancer SceneRoot directement sur la TV sans bureau Ubuntu ?\n\nOui : kiosque léger Cage/Wayland (recommandé)\nNon : démarrage dans la session graphique existante" 13 74; then
    CFG_KIOSK_MODE=direct
  else
    CFG_KIOSK_MODE=desktop
  fi
else
  info "Mode non-interactif — valeurs par défaut / variables d'environnement."
fi
ok "Médias : $CFG_MEDIA"
[[ -n "$CFG_TMDB" ]] && ok "TMDB : configuré" || info "TMDB : non configuré (repli Wikipédia + TVmaze)"
[[ -n "$CFG_TOKEN" ]] && ok "Admin mobile : activé" || info "Admin mobile : réglages locaux uniquement"
[[ "$CFG_KIOSK_MODE" == "direct" ]] && ok "Affichage : kiosque TV direct (sans bureau)" || ok "Affichage : session graphique existante"

# ── Étape 2 : paquets système ────────────────────────────────────────────────
step "Installation des paquets système"
run "Mise à jour des dépôts" sudo apt-get update -qq
run "Composants système, vidéo, CEC et kiosque Wayland" \
  sudo apt-get install -y -qq git curl cec-utils ffmpeg mpv socat transmission-daemon cage seatd dbus-user-session python3-evdev
if ! have chromium && ! have chromium-browser; then
  if apt-cache show chromium >/dev/null 2>&1; then
    run "Chromium" sudo apt-get install -y -qq chromium
  elif have snap; then
    run "Chromium (snap Ubuntu)" sudo snap install chromium
  else
    run "Chromium" sudo apt-get install -y -qq chromium-browser
  fi
fi

# ── Étape 3 : Node.js ────────────────────────────────────────────────────────
step "Node.js 22"
if ! have node || [[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 20 ]]; then
  run "Ajout du dépôt NodeSource" bash -c "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
  run "Installation de Node.js" sudo apt-get install -y -qq nodejs
else
  ok "Node.js $(node -v) déjà présent"
fi

# ── Étape 4 : récupération du code ───────────────────────────────────────────
step "Récupération de SceneRoot"
if [[ -d "$APP_DIR/.git" ]]; then
  sudo git -C "$APP_DIR" config core.fileMode false
  run "Mise à jour du dépôt" sudo git -C "$APP_DIR" pull --ff-only
else
  run "Clonage depuis $REPO_URL" sudo git clone --depth 1 "$REPO_URL" "$APP_DIR"
  sudo git -C "$APP_DIR" config core.fileMode false
fi
sudo chown -R "$USER":"$USER" "$APP_DIR"
cd "$APP_DIR"

# ── Étape 5 : build ──────────────────────────────────────────────────────────
step "Dépendances et compilation"
run "npm ci" npm ci --no-audit --no-fund
run "npm run build" npm run build
chmod +x scripts/update.sh scripts/kiosk.sh scripts/kiosk-fallback.sh scripts/cec-input.py scripts/doctor.sh scripts/transmission-setup.sh scripts/park-cursor.py

# ── Étape 6 : configuration persistante ──────────────────────────────────────
step "Écriture de la configuration ($ENV_FILE)"
sudo mkdir -p /var/lib/sceneroot /mnt/media
sudo chown -R "$USER":"$USER" /var/lib/sceneroot
{
  echo "# Généré par install.sh — $(date -Iseconds)"
  echo "SCENEROOT_MEDIA=$CFG_MEDIA"
  echo "SCENEROOT_KIOSK_MODE=$CFG_KIOSK_MODE"
  echo "SCENEROOT_TV_SCALE=$CFG_TV_SCALE"
  echo "TRANSMISSION_RPC_URL=$CFG_TRANSMISSION"
  echo "SCENEROOT_MPV_HWDEC=no"
  echo "SCENEROOT_MPV_ARGS=--vo=gpu-next --gpu-context=wayland"
  [[ -n "$CFG_TMDB" ]]  && echo "TMDB_API_KEY=$CFG_TMDB"
  [[ -n "$CFG_TOKEN" ]] && echo "SCENEROOT_ADMIN_TOKEN=$CFG_TOKEN"
  true  # garantit un code de sortie 0 du bloc (sinon set -e+pipefail tue le script)
} | sudo tee "$ENV_FILE" >/dev/null
sudo chmod 600 "$ENV_FILE"
ok "Configuration enregistrée"
# Transmission : démon actif et dossier de téléchargement accessible en écriture
DOWNLOAD_DIR="${CFG_MEDIA%%,*}/downloads"
sudo mkdir -p "$DOWNLOAD_DIR"
if getent passwd debian-transmission >/dev/null; then
  sudo chown -R debian-transmission:debian-transmission "$DOWNLOAD_DIR"
  sudo chmod 775 "$DOWNLOAD_DIR"
fi
sudo systemctl enable --now transmission-daemon >/dev/null 2>&1 && ok "Transmission actif ($CFG_TRANSMISSION)" || warn "Transmission n'a pas pu démarrer : les téléchargements seront indisponibles."
# Debian protège le RPC par des identifiants inconnus de nous : on en pose de
# dédiés, sans quoi le serveur reçoit un 401 et annonce « Transmission indisponible ».
sudo scripts/transmission-setup.sh "$DOWNLOAD_DIR" "$ENV_FILE" >/dev/null 2>&1 \
  && ok "Identifiants RPC Transmission configurés" \
  || warn "Configuration RPC Transmission incomplète — lancez scripts/doctor.sh --fix"
TR_AUTH="$(sudo grep -m1 '^TRANSMISSION_RPC_AUTH=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
# 409 = Transmission réclame un jeton de session : c'est la réponse d'un démon sain.
TR_CODE="$(curl -s -o /dev/null -m 5 ${TR_AUTH:+-u "$TR_AUTH"} -w '%{http_code}' "$CFG_TRANSMISSION" 2>/dev/null || true)"
[[ "$TR_CODE" == "409" ]] && ok "RPC Transmission joignable" || warn "RPC Transmission : HTTP ${TR_CODE:-0} — diagnostiquez avec scripts/doctor.sh --fix"

# ── Étape 7 : services systemd ───────────────────────────────────────────────
step "Services systemd"
sed "s/@SCENEROOT_USER@/$USER/g" scripts/sceneroot.service | sudo tee /etc/systemd/system/sceneroot.service >/dev/null
sed "s/@SCENEROOT_USER@/$USER/g" scripts/sceneroot-update.service | sudo tee /etc/systemd/system/sceneroot-update.service >/dev/null
sed "s/@SCENEROOT_USER@/$USER/g" scripts/sceneroot-kiosk.service | sudo tee /etc/systemd/system/sceneroot-kiosk.service >/dev/null
sudo cp scripts/sceneroot-cec.service /etc/systemd/system/sceneroot-cec.service
sudo cp scripts/sceneroot-kiosk-fallback.service /etc/systemd/system/sceneroot-kiosk-fallback.service
sudo cp scripts/sceneroot-update.timer /etc/systemd/system/sceneroot-update.timer
echo uinput | sudo tee /etc/modules-load.d/sceneroot-uinput.conf >/dev/null
sudo modprobe uinput || warn "Le module uinput sera chargé au prochain démarrage."
for group in video render input seat; do getent group "$group" >/dev/null && sudo usermod -aG "$group" "$USER"; done
run "Rechargement de systemd" sudo systemctl daemon-reload
sudo systemctl enable --now seatd.service >/dev/null 2>&1 || warn "seatd indisponible (Cage utilisera logind)."
run "Activation du serveur, des mises à jour et du pont CEC" sudo systemctl enable --now sceneroot.service sceneroot-update.timer sceneroot-cec.service

# ── Étape 8 : kiosque ────────────────────────────────────────────────────────
step "Interface TV (kiosque Chromium)"
if [[ "$CFG_KIOSK_MODE" == "direct" ]]; then
  rm -f "$HOME/.config/autostart/sceneroot-kiosk.desktop"
  sudo systemctl disable display-manager.service >/dev/null 2>&1 || true
  sudo systemctl set-default multi-user.target >/dev/null
  # Sortie forcée en 1080p : affichage plein écran fiable et composition légère sur TV 4K.
  CMDLINE=/boot/firmware/cmdline.txt; [[ -f $CMDLINE ]] || CMDLINE=/boot/cmdline.txt
  if [[ -f $CMDLINE ]] && ! grep -q 'video=HDMI' "$CMDLINE"; then
    sudo sed -i 's/[[:space:]]*$/ video=HDMI-A-1:1920x1080M@60/' "$CMDLINE" && ok "Sortie HDMI forcée en 1080p"
  fi
  sudo sed -i '/^SCENEROOT_TV_SCALE=/d' "$ENV_FILE"; echo 'SCENEROOT_TV_SCALE=1' | sudo tee -a "$ENV_FILE" >/dev/null
  # Lancement fiable : autologin sur tty1 + Cage depuis le shell (le service systemd
  # n'obtient pas de seat actif ; une session de login interactive, si).
  sudo systemctl disable sceneroot-kiosk.service >/dev/null 2>&1 || true
  sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
  printf '[Service]\nExecStart=\nExecStart=-/sbin/agetty --autologin %s --noclear %%I $TERM\n' "$USER" | sudo tee /etc/systemd/system/getty@tty1.service.d/sceneroot-autologin.conf >/dev/null
  sudo systemctl enable getty@tty1.service >/dev/null 2>&1 || true
  if ! grep -q 'SceneRoot kiosk' "$HOME/.bash_profile" 2>/dev/null; then
    cat >> "$HOME/.bash_profile" <<'PROFILE'

# SceneRoot kiosk — interface TV sur tty1
if [[ -z "${WAYLAND_DISPLAY:-}" && "${XDG_VTNR:-}" == "1" ]]; then
  # Curseur réduit à un pixel : le compositeur le dessine avant que la page
  # puisse le masquer, et rien ne le déplace jamais sur un téléviseur.
  export XCURSOR_SIZE=1
  while true; do cage -- /bin/bash /opt/sceneroot/scripts/kiosk.sh; echo "SceneRoot : kiosque arrêté, relance dans 3 s (Ctrl+C pour un shell)"; sleep 3; done
fi
PROFILE
  fi
  run "Rechargement de systemd" sudo systemctl daemon-reload
  ok "Autologin + Cage configurés sur tty1 — l'interface s'affichera au prochain redémarrage"
else
  sudo systemctl disable sceneroot-kiosk.service >/dev/null 2>&1 || true
  install -Dm755 scripts/kiosk.sh "$HOME/.local/bin/sceneroot-kiosk"
  install -Dm644 scripts/sceneroot-kiosk.desktop "$HOME/.config/autostart/sceneroot-kiosk.desktop"
  ok "Chromium se lancera à l'ouverture de la session graphique"
fi

# ── Étape 9 : vérification ───────────────────────────────────────────────────
step "Vérification"
IP="$(hostname -I | awk '{print $1}')"
printf '  Attente du serveur… '
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:4174/api/health" >/dev/null 2>&1; then echo "${C_GREEN}en ligne${C_RESET}"; READY=1; break; fi
  sleep 1
done
[[ "${READY:-0}" == 1 ]] || warn "Le serveur n'a pas répondu à temps — vérifiez : systemctl status sceneroot"

echo
echo "${C_GREEN}${C_BOLD}  ╭──────────────────────────────────────────────────────────╮${C_RESET}"
echo "${C_GREEN}${C_BOLD}  │  SceneRoot est installé.                                 │${C_RESET}"
echo "${C_GREEN}${C_BOLD}  ╰──────────────────────────────────────────────────────────╯${C_RESET}"
echo
echo "  ${C_BOLD}Interface TV${C_RESET}    : http://127.0.0.1:4174  (kiosque au prochain redémarrage)"
echo "  ${C_BOLD}Depuis le réseau${C_RESET}: http://${IP}:4174"
echo "  ${C_BOLD}Réglages mobile${C_RESET} : http://${IP}:4174/admin.html"
[[ -n "$CFG_TOKEN" ]] && echo "  ${C_BOLD}Jeton admin${C_RESET}     : ${C_YELLOW}${CFG_TOKEN}${C_RESET}  ${C_DIM}(à saisir sur le mobile)${C_RESET}" || true
echo
echo "  ${C_DIM}Au premier lancement, l'assistant vous aidera à créer les profils.${C_RESET}"
echo
