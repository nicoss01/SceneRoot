# SceneRoot

SceneRoot est un media center « couch-first » pour Raspberry Pi : profils, reprise de lecture, catalogue local, notes, recommandations, navigation HDMI-CEC et mises à jour automatiques depuis GitHub.

La vision détaillée Discover / Watch / Roots et l'état du pipeline sont décrits dans [docs/PRODUCT.md](docs/PRODUCT.md).

## Démarrage rapide sur PC

```bash
npm install
npm run dev
```

Ouvrez `http://localhost:5173`. La première version inclut un catalogue de démonstration pour tester immédiatement toutes les vues. Le serveur API écoute sur le port `4174`.

## Installation Raspberry Pi

Raspberry Pi 4/5, Raspberry Pi OS Desktop 64 bits et 4 Go de RAM sont recommandés.

1. Créez votre dépôt GitHub à partir de ce projet.
2. Remplacez `OWNER` dans `scripts/install.sh` ou fournissez `SCENEROOT_REPO_URL`.
3. Sur le Pi :

```bash
git clone https://github.com/VOTRE_COMPTE/SceneRoot.git
cd SceneRoot
SCENEROOT_REPO_URL=https://github.com/VOTRE_COMPTE/SceneRoot.git bash scripts/install.sh
```

Le serveur se lance au démarrage via `systemd`. L’interface Chromium s’ouvre automatiquement en mode kiosque dès la session graphique disponible. Le timer `sceneroot-update.timer` vérifie `origin/main` chaque jour et ne redémarre l’application que si une nouvelle révision existe.

Le script installé utilise automatiquement :

```bash
chromium --kiosk --noerrdialogs --disable-infobars http://127.0.0.1:4174
```

## Médias et métadonnées

- Les dossiers sont définis par `SCENEROOT_MEDIA` (séparés par des virgules).
- `POST /api/library/scan` analyse récursivement MP4, MKV, WebM, AVI, MOV et M4V.
- `GET /api/media/:id` diffuse les fichiers avec prise en charge des requêtes HTTP Range.
- La lecture TV principale passe par `mpv` (`POST /api/player/:id/play`) pour MKV, HEVC, HDR, pistes audio, sous-titres et accélération matérielle. Le lecteur web reste un mode de secours.
- FFmpeg est installé pour l’inspection/transcodage à venir.
- Une clé TMDB peut être placée dans `/etc/sceneroot.env`. Respectez les conditions et l’attribution TMDB lors de l’activation.

## Téléchargements

SceneRoot sait envoyer un lien magnet à une instance Transmission locale. Il expose aussi un adaptateur Torznab multi-source ; C411 peut être activé avec `C411_API_KEY` et d’autres sources avec `SCENEROOT_TORZNAB_SOURCES`. Cette fonction est exclusivement destinée aux œuvres libres, au domaine public, à vos propres créations ou à tout contenu que vous êtes autorisé à télécharger. Les clés restent côté serveur.

## HDMI-CEC

`cec-utils` fournit `cec-client`. L’interface est utilisable au clavier avec les flèches, Entrée et Retour, ce qui correspond aux événements émis par la plupart des adaptateurs CEC. L’API expose aussi les actions `active`, `standby` et `scan`.

## État du produit

Cette première version est un socle fonctionnel et installable. Le scan, le streaming local, la persistance des notes/progressions, Transmission et CEC sont câblés côté serveur. Le catalogue de démo illustre le rendu final ; la prochaine étape consiste à connecter les écrans aux éléments indexés et à enrichir les fiches via la source de métadonnées choisie.
