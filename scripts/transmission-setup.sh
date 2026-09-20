#!/usr/bin/env bash
# Configure le démon Transmission pour SceneRoot : identifiants RPC connus,
# file d'attente à 3 téléchargements et dossier de destination.
#
#   sudo scripts/transmission-setup.sh <dossier-de-telechargement> [fichier-env]
#
# Debian active l'authentification RPC par défaut avec un mot de passe que nous
# ne connaissons pas (et qui est haché dès le premier démarrage) : le serveur
# recevait un 401 et annonçait « Transmission indisponible ». On fixe donc un
# identifiant dédié, puis on l'écrit dans /etc/sceneroot.env.
set -Eeuo pipefail

DOWNLOAD_DIR="${1:-/mnt/media/downloads}"
ENV_FILE="${2:-/etc/sceneroot.env}"
SETTINGS=/etc/transmission-daemon/settings.json
USERNAME=sceneroot

[[ -f "$SETTINGS" ]] || { echo "Transmission n'est pas installé ($SETTINGS absent)." >&2; exit 1; }

# Mot de passe conservé s'il a déjà été posé par une exécution précédente.
PASSWORD="$(grep -m1 '^TRANSMISSION_RPC_AUTH=' "$ENV_FILE" 2>/dev/null | cut -d: -f2- || true)"
[[ -n "$PASSWORD" ]] || PASSWORD="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)"

# Le démon réécrit settings.json en s'arrêtant : toute modification à chaud serait perdue.
systemctl stop transmission-daemon >/dev/null 2>&1 || true

python3 - "$SETTINGS" "$USERNAME" "$PASSWORD" "$DOWNLOAD_DIR" <<'PY'
import json, sys
path, user, password, download_dir = sys.argv[1:5]
with open(path, encoding='utf-8') as handle: settings = json.load(handle)
settings.update({
  'rpc-enabled': True,
  'rpc-authentication-required': True,
  'rpc-username': user,
  'rpc-password': password,          # le démon le remplace par son empreinte au démarrage
  'rpc-bind-address': '127.0.0.1',
  'rpc-whitelist-enabled': True,
  'rpc-whitelist': '127.0.0.1',
  'download-dir': download_dir,
  'incomplete-dir-enabled': False,
  'download-queue-enabled': True,
  'download-queue-size': 3,
})
with open(path, 'w', encoding='utf-8') as handle: json.dump(settings, handle, indent=4, sort_keys=True)
PY

chown debian-transmission:debian-transmission "$SETTINGS" 2>/dev/null || true
systemctl start transmission-daemon

# Le serveur ne lit ces variables qu'à son démarrage : à l'appelant de le relancer.
touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
sed -i '/^TRANSMISSION_RPC_AUTH=/d;/^TRANSMISSION_RPC_URL=/d' "$ENV_FILE"
{ echo "TRANSMISSION_RPC_URL=http://127.0.0.1:9091/transmission/rpc"; echo "TRANSMISSION_RPC_AUTH=$USERNAME:$PASSWORD"; } >> "$ENV_FILE"

echo "Transmission configuré pour SceneRoot (utilisateur $USERNAME, dossier $DOWNLOAD_DIR)."
