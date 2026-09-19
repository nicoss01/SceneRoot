#!/usr/bin/env bash
set -Eeuo pipefail

# SceneRoot — mise à jour sûre depuis GitHub.
# Usage : sudo /opt/sceneroot/scripts/update.sh [--reconfigure]

ENV_FILE="${SCENEROOT_ENV_FILE:-/etc/sceneroot.env}"
APP_DIR="${SCENEROOT_INSTALL_DIR:-/opt/sceneroot}"
config_value() { [[ -r "$ENV_FILE" ]] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 || true; }
DATA_DIR="${SCENEROOT_DATA:-$(config_value SCENEROOT_DATA)}"
DATA_DIR="${DATA_DIR:-/var/lib/sceneroot}"
BACKUP_DIR="${SCENEROOT_BACKUP_DIR:-/var/backups/sceneroot}"
UPDATE_REF="${SCENEROOT_UPDATE_REF:-origin/main}"
SERVICE="${SCENEROOT_SERVICE:-sceneroot.service}"
KIOSK_MODE="${SCENEROOT_KIOSK_MODE:-$(config_value SCENEROOT_KIOSK_MODE)}"
KIOSK_MODE="${KIOSK_MODE:-direct}"
RECONFIGURE=0
[[ "${1:-}" == "--reconfigure" ]] && RECONFIGURE=1

if [[ "${EUID}" -ne 0 ]]; then
  echo "Cette mise à jour doit être lancée avec sudo :" >&2
  echo "  sudo $0" >&2
  exit 1
fi

[[ -d "$APP_DIR/.git" ]] || { echo "Dépôt SceneRoot introuvable : $APP_DIR" >&2; exit 1; }
APP_USER="${SCENEROOT_USER:-$(stat -c '%U' "$APP_DIR")}"
[[ "$APP_USER" != "root" ]] || { echo "Impossible de déterminer l’utilisateur SceneRoot. Définissez SCENEROOT_USER." >&2; exit 1; }

log() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗ %s\033[0m\n' "$1" >&2; }
as_app() { sudo -u "$APP_USER" -- "$@"; }

cd "$APP_DIR"

log "Vérification du dépôt"
# install.sh rend ce fichier exécutable. Cette permission locale ne doit pas
# être confondue avec une modification du code suivie par Git.
as_app git config core.fileMode false
if ! as_app git diff --quiet || ! as_app git diff --cached --quiet; then
  fail "Des modifications locales suivies par Git sont présentes. Committez-les ou mettez-les de côté avant la mise à jour."
  exit 1
fi

as_app git fetch origin --prune
CURRENT="$(as_app git rev-parse HEAD)"
LATEST="$(as_app git rev-parse "$UPDATE_REF")"
if [[ "$CURRENT" == "$LATEST" && "$RECONFIGURE" == 0 ]]; then
  ok "SceneRoot est déjà à jour ($CURRENT)."
  exit 0
fi
if [[ "$CURRENT" == "$LATEST" ]]; then
  ok "Code à jour ; réapplication de la configuration système demandée."
else
  ok "Nouvelle version détectée : ${CURRENT:0:8} → ${LATEST:0:8}"
fi

log "Sauvegarde des réglages"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$BACKUP_DIR/sceneroot-$STAMP.tar.gz"
WAS_ACTIVE=0
restart_if_needed() {
  if ((WAS_ACTIVE)) && ! systemctl is-active --quiet "$SERVICE"; then systemctl start "$SERVICE" || true; fi
}
trap restart_if_needed EXIT
if systemctl is-active --quiet "$SERVICE"; then
  WAS_ACTIVE=1
  systemctl stop "$SERVICE"
fi

# L’arrêt très bref du service garantit une copie cohérente de SQLite, y compris
# lorsque le journal WAL était actif juste avant la sauvegarde.
TAR_PATHS=()
[[ -d "$DATA_DIR" ]] && TAR_PATHS+=("${DATA_DIR#/}")
[[ -f "$ENV_FILE" ]] && TAR_PATHS+=("${ENV_FILE#/}")
if ((${#TAR_PATHS[@]})); then
  tar -C / --exclude="${DATA_DIR#/}/cache" -czf "$BACKUP" "${TAR_PATHS[@]}"
else
  tar -C / -czf "$BACKUP" --files-from /dev/null
fi
tar -tzf "$BACKUP" >/dev/null
chmod 600 "$BACKUP"
sha256sum "$BACKUP" > "$BACKUP.sha256"
chmod 600 "$BACKUP.sha256"

if ((WAS_ACTIVE)); then systemctl start "$SERVICE"; fi
ok "Sauvegarde créée : $BACKUP"

rollback() {
  local exit_code=$?
  trap - ERR
  fail "La mise à jour a échoué. Restauration du code ${CURRENT:0:8}."
  as_app git reset --hard "$CURRENT" || true
  as_app npm ci --no-audit --no-fund || true
  as_app npm run build || true
  systemctl restart "$SERVICE" || true
  echo "Les réglages n’ont pas été modifiés. Sauvegarde : $BACKUP" >&2
  exit "$exit_code"
}
trap rollback ERR

log "Installation de la nouvelle version"
as_app git merge --ff-only "$UPDATE_REF"
as_app npm ci --no-audit --no-fund
as_app npm run build
chmod +x scripts/update.sh scripts/kiosk.sh scripts/cec-input.py

# Les unités sont réinstallées pour appliquer aussi les évolutions du service
# et du minuteur sans devoir relancer l’installateur complet.
sed "s/@SCENEROOT_USER@/$APP_USER/g" scripts/sceneroot.service > /etc/systemd/system/sceneroot.service
sed "s/@SCENEROOT_USER@/$APP_USER/g" scripts/sceneroot-update.service > /etc/systemd/system/sceneroot-update.service
sed "s/@SCENEROOT_USER@/$APP_USER/g" scripts/sceneroot-kiosk.service > /etc/systemd/system/sceneroot-kiosk.service
install -m 0644 scripts/sceneroot-cec.service /etc/systemd/system/sceneroot-cec.service
install -m 0644 scripts/sceneroot-update.timer /etc/systemd/system/sceneroot-update.timer
echo uinput > /etc/modules-load.d/sceneroot-uinput.conf
modprobe uinput || true
for group in video render input seat; do getent group "$group" >/dev/null && usermod -aG "$group" "$APP_USER"; done
systemctl daemon-reload
systemctl enable --now sceneroot-cec.service
if [[ "$KIOSK_MODE" == "direct" ]]; then
  systemctl disable display-manager.service >/dev/null 2>&1 || true
  systemctl set-default multi-user.target >/dev/null
  systemctl enable sceneroot-kiosk.service
else
  systemctl disable sceneroot-kiosk.service >/dev/null 2>&1 || true
fi

log "Redémarrage de SceneRoot"
systemctl restart "$SERVICE"

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${SCENEROOT_PORT:-4174}/api/health" >/dev/null 2>&1; then
    trap - ERR
    ok "Mise à jour terminée. SceneRoot répond correctement."
    echo "  Version : $(as_app git rev-parse --short HEAD)"
    echo "  Sauvegarde : $BACKUP"
    exit 0
  fi
  sleep 1
done

fail "La nouvelle version ne répond pas après 30 secondes."
false
