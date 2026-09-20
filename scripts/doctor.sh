#!/usr/bin/env bash
# SceneRoot — diagnostic et réparation des dépendances de téléchargement.
#   ./scripts/doctor.sh        → rapport seul
#   ./scripts/doctor.sh --fix  → installe et répare ce qui manque
set -uo pipefail

ENV_FILE="/etc/sceneroot.env"
FIX=0
[[ "${1:-}" == "--fix" ]] && FIX=1

if [[ -t 1 ]]; then C_R=$'\e[0m'; C_G=$'\e[38;5;42m'; C_Y=$'\e[38;5;220m'; C_E=$'\e[38;5;203m'; C_B=$'\e[1m'
else C_R=; C_G=; C_Y=; C_E=; C_B=; fi
ok()   { echo "  ${C_G}✓${C_R} $1"; }
warn() { echo "  ${C_Y}!${C_R} $1"; }
bad()  { echo "  ${C_E}✗${C_R} $1"; FAILED=$((FAILED+1)); }
head_() { echo; echo "${C_B}$1${C_R}"; }
FAILED=0

head_ "Configuration ($ENV_FILE)"
# Le fichier est en 600 root : seul sudo peut le lire, y compris pour ce test.
if sudo test -r "$ENV_FILE"; then
  ok "Fichier présent"
  RPC="$(sudo grep -m1 '^TRANSMISSION_RPC_URL=' "$ENV_FILE" | cut -d= -f2-)"
  if [[ -n "$RPC" ]]; then ok "TRANSMISSION_RPC_URL=$RPC"
  else
    RPC="http://127.0.0.1:9091/transmission/rpc"
    if (( FIX )); then
      echo "TRANSMISSION_RPC_URL=$RPC" | sudo tee -a "$ENV_FILE" >/dev/null && ok "TRANSMISSION_RPC_URL ajouté ($RPC)"
    else
      warn "TRANSMISSION_RPC_URL absent — le serveur utilise le défaut $RPC (relancez avec --fix pour l'écrire)"
    fi
  fi
else
  bad "$ENV_FILE illisible — relancez scripts/install.sh"
  RPC="http://127.0.0.1:9091/transmission/rpc"
fi

head_ "Démon Transmission"
if ! command -v transmission-daemon >/dev/null 2>&1; then
  if (( FIX )); then sudo apt-get install -y -qq transmission-daemon && ok "transmission-daemon installé"
  else bad "transmission-daemon n'est pas installé (--fix l'installe)"; fi
else ok "transmission-daemon installé"; fi

STATE="$(systemctl is-active transmission-daemon 2>/dev/null)"
if [[ "$STATE" == active ]]; then ok "Service actif"
else
  if (( FIX )); then
    sudo systemctl enable --now transmission-daemon >/dev/null 2>&1 && ok "Service démarré" || bad "Démarrage impossible : journalctl -u transmission-daemon -n 30"
  else bad "Service $STATE (--fix le démarre)"; fi
fi

# Avec authentification, Transmission renvoie 401 avant même de réclamer son
# jeton de session : on interroge donc le RPC avec les identifiants du serveur.
probe_rpc() {
  local auth; auth="$(sudo grep -m1 '^TRANSMISSION_RPC_AUTH=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)"
  if [[ -n "$auth" ]]; then curl -s -o /dev/null -m 5 -u "$auth" -w '%{http_code}' "$RPC" 2>/dev/null
  else curl -s -o /dev/null -m 5 -w '%{http_code}' "$RPC" 2>/dev/null; fi
}
CODE="$(probe_rpc)"
if [[ "$CODE" == 401 ]] && (( FIX )); then
  # Debian impose des identifiants RPC que nous ne connaissons pas : on en pose
  # de nouveaux, réutilisables par le serveur.
  DL_FOR_TR="$(sudo grep -m1 '^SCENEROOT_MEDIA=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | cut -d, -f1)"
  if sudo "$(dirname "$0")/transmission-setup.sh" "${DL_FOR_TR:-/mnt/media}/downloads" "$ENV_FILE"; then
    ok "Identifiants RPC dédiés installés"
    sleep 2  # laisse le démon recharger sa configuration
    CODE="$(probe_rpc)"
  fi
fi
case "$CODE" in
  409) ok "RPC joignable (409 = demande de jeton de session, réponse normale)";;
  401) bad "RPC protégé par mot de passe : relancez ./scripts/doctor.sh --fix pour poser des identifiants dédiés";;
  403) bad "RPC refusé : ajoutez l'adresse à rpc-whitelist dans /etc/transmission-daemon/settings.json";;
  000) bad "RPC injoignable sur $RPC (démon arrêté ou port différent)";;
  *)   warn "RPC : HTTP $CODE";;
esac

head_ "Dossier de téléchargement"
MEDIA="$(sudo grep -m1 '^SCENEROOT_MEDIA=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | cut -d, -f1)"
DL="${MEDIA:-/mnt/media}/downloads"
if [[ -d "$DL" ]]; then ok "$DL présent"; else
  if (( FIX )); then sudo mkdir -p "$DL" && ok "$DL créé"; else bad "$DL absent (--fix le crée)"; fi
fi
if getent passwd debian-transmission >/dev/null && [[ -d "$DL" ]]; then
  if sudo -u debian-transmission test -w "$DL"; then ok "Accessible en écriture par debian-transmission"
  else
    if (( FIX )); then sudo chown -R debian-transmission:debian-transmission "$DL" && sudo chmod 775 "$DL" && ok "Droits corrigés"
    else bad "debian-transmission ne peut pas écrire dans $DL (--fix corrige les droits)"; fi
  fi
fi
if [[ -d "$DL" ]]; then
  FREE="$(df -BG --output=avail "$DL" 2>/dev/null | tail -1 | tr -dc '0-9')"
  [[ -n "$FREE" ]] && { (( FREE > 5 )) && ok "${FREE} Go libres" || warn "${FREE} Go libres : baissez la réserve d'espace dans les réglages"; }
fi

head_ "Serveur SceneRoot"
# Le serveur ne relit /etc/sceneroot.env qu'au démarrage : on le relance avant
# de le tester, sinon il travaille encore avec l'ancienne configuration.
if (( FIX )); then
  sudo systemctl restart sceneroot && ok "Serveur relancé avec la configuration à jour"
  for _ in $(seq 1 15); do curl -fsS -m 2 http://127.0.0.1:4174/api/health >/dev/null 2>&1 && break; sleep 1; done
fi
if [[ "$(systemctl is-active sceneroot 2>/dev/null)" == active ]]; then ok "Service actif"; else bad "Service inactif : journalctl -u sceneroot -n 30"; fi
DLCODE="$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:4174/api/downloads 2>/dev/null)"
[[ "$DLCODE" == 200 ]] && ok "/api/downloads répond 200" || bad "/api/downloads répond $DLCODE : $(curl -s -m 5 http://127.0.0.1:4174/api/downloads | head -c 300)"

echo
(( FAILED == 0 )) && echo "  ${C_G}${C_B}Tout est en place.${C_R}" || echo "  ${C_E}${C_B}${FAILED} problème(s) — relancez avec --fix si proposé.${C_R}"
echo
exit 0
