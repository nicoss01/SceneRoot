#!/usr/bin/env bash
set -u

logger -t sceneroot "Le kiosque direct a échoué ; tentative de restauration d'un écran utilisable."

if systemctl list-unit-files display-manager.service --no-legend 2>/dev/null | grep -q display-manager; then
  systemctl start display-manager.service && exit 0
fi

systemctl start getty@tty1.service
