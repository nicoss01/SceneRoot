#!/usr/bin/env bash
set -euo pipefail

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

if [[ "$USE_TUI" == 1 ]]; then
  CFG_MEDIA=$(whiptail --title "SceneRoot" --inputbox "Dossier(s) média à indexer (séparés par des virgules) :" 10 70 "$CFG_MEDIA" 3>&1 1>&2 2>&3) || die "Installation annulée."
  CFG_TMDB=$(whiptail --title "SceneRoot" --inputbox "Clé API TMDB (facultatif — laissez vide pour Wikipédia + TVmaze) :" 10 70 "$CFG_TMDB" 3>&1 1>&2 2>&3) || CFG_TMDB="$CFG_TMDB"
  if whiptail --title "SceneRoot" --yesno "Autoriser la configuration à distance depuis un mobile ?\n(génère un jeton d'administration)" 10 70; then
    [[ -z "$CFG_TOKEN" ]] && CFG_TOKEN="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
  fi
else
  info "Mode non-interactif — valeurs par défaut / variables d'environnement."
fi
ok "Médias : $CFG_MEDIA"
[[ -n "$CFG_TMDB" ]] && ok "TMDB : configuré" || info "TMDB : non configuré (repli Wikipédia + TVmaze)"
[[ -n "$CFG_TOKEN" ]] && ok "Admin mobile : activé" || info "Admin mobile : réglages locaux uniquement"

# ── Étape 2 : paquets système ────────────────────────────────────────────────
step "Installation des paquets système"
run "Mise à jour des dépôts" sudo apt-get update -qq
run "git, chromium, ffmpeg, mpv, socat, cec-utils, transmission" \
  sudo apt-get install -y -qq git curl cec-utils chromium ffmpeg mpv socat transmission-daemon

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
  run "Mise à jour du dépôt" sudo git -C "$APP_DIR" pull --ff-only
else
  run "Clonage depuis $REPO_URL" sudo git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi
sudo chown -R "$USER":"$USER" "$APP_DIR"
cd "$APP_DIR"

# ── Étape 5 : build ──────────────────────────────────────────────────────────
step "Dépendances et compilation"
run "npm ci" npm ci --no-audit --no-fund
run "npm run build" npm run build
chmod +x scripts/update.sh scripts/kiosk.sh

# ── Étape 6 : configuration persistante ──────────────────────────────────────
step "Écriture de la configuration ($ENV_FILE)"
sudo mkdir -p /var/lib/sceneroot /mnt/media
sudo chown -R "$USER":"$USER" /var/lib/sceneroot
{
  echo "# Généré par install.sh — $(date -Iseconds)"
  echo "SCENEROOT_MEDIA=$CFG_MEDIA"
  [[ -n "$CFG_TMDB" ]]  && echo "TMDB_API_KEY=$CFG_TMDB"
  [[ -n "$CFG_TOKEN" ]] && echo "SCENEROOT_ADMIN_TOKEN=$CFG_TOKEN"
} | sudo tee "$ENV_FILE" >/dev/null
sudo chmod 600 "$ENV_FILE"
ok "Configuration enregistrée"

# ── Étape 7 : services systemd ───────────────────────────────────────────────
step "Services systemd"
sed "s/@SCENEROOT_USER@/$USER/g" scripts/sceneroot.service | sudo tee /etc/systemd/system/sceneroot.service >/dev/null
sed "s/@SCENEROOT_USER@/$USER/g" scripts/sceneroot-update.service | sudo tee /etc/systemd/system/sceneroot-update.service >/dev/null
sudo cp scripts/sceneroot-update.timer /etc/systemd/system/sceneroot-update.timer
run "Rechargement de systemd" sudo systemctl daemon-reload
run "Activation des services" sudo systemctl enable --now sceneroot.service sceneroot-update.timer

# ── Étape 8 : kiosque ────────────────────────────────────────────────────────
step "Interface TV (kiosque Chromium)"
install -Dm755 scripts/kiosk.sh "$HOME/.local/bin/sceneroot-kiosk"
install -Dm644 scripts/sceneroot-kiosk.desktop "$HOME/.config/autostart/sceneroot-kiosk.desktop"
ok "Chromium se lancera à l'ouverture de la session graphique"

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
echo "  ${C_BOLD}Interface TV${C_RESET}    : http://127.0.0.1:4174  (kiosque au prochain démarrage graphique)"
echo "  ${C_BOLD}Depuis le réseau${C_RESET}: http://${IP}:4174"
echo "  ${C_BOLD}Réglages mobile${C_RESET} : http://${IP}:4174/admin.html"
[[ -n "$CFG_TOKEN" ]] && echo "  ${C_BOLD}Jeton admin${C_RESET}     : ${C_YELLOW}${CFG_TOKEN}${C_RESET}  ${C_DIM}(à saisir sur le mobile)${C_RESET}"
echo
echo "  ${C_DIM}Au premier lancement, l'assistant vous aidera à créer les profils.${C_RESET}"
echo
