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
- Les fichiers inchangés réutilisent leur analyse `ffprobe`; les correspondances corrigées ne sont pas perdues au scan suivant.
- `GET /api/catalog` expose un catalogue paginé et accepte les filtres `kind`, `genre` et `q`. TMDB est utilisé lorsqu'une clé est configurée ; sinon SceneRoot utilise Wikipédia pour les films et TVmaze pour les séries.
- Les réponses distantes sont conservées dans `SCENEROOT_DATA/cache` pendant 6 à 24 heures. Un cache périmé reste utilisable si une source est temporairement inaccessible.
- Après le scan, les nouveaux fichiers sont enrichis en arrière-plan uniquement lorsque le titre et l’année donnent une correspondance unique. Les cas ambigus restent intacts.
- `GET /api/library/grouped` alimente l’écran réel « Ma médiathèque » en regroupant versions et épisodes.
- `GET /api/metadata/search` et `PUT /api/library/:id/match` permettent de corriger un média depuis l’interface avec TMDB, Wikipédia ou TVmaze ; leurs résultats sont également mis en cache.
- `GET /api/media/:id` diffuse les fichiers avec prise en charge des requêtes HTTP Range.
- La lecture TV principale passe par `mpv` (`POST /api/player/:id/play`) pour MKV, HEVC, HDR, pistes audio, sous-titres et accélération matérielle. Le lecteur web reste un mode de secours.
- FFmpeg est installé pour l’inspection/transcodage à venir.
- Une clé TMDB peut être placée dans `/etc/sceneroot.env`. Respectez les conditions et l’attribution TMDB lors de l’activation.
- Les données TVmaze sont fournies sous licence CC BY-SA et les fiches de films proviennent de Wikipédia anglophone sous CC BY-SA. Les liens vers les fiches sources sont conservés dans chaque résultat distant.
- Les écrans de catalogue utilisent une pagination déclenchée par `IntersectionObserver`; les images utilisent le chargement différé natif du navigateur.

## Téléchargements

SceneRoot sait envoyer un lien magnet à une instance Transmission locale. Il expose aussi un adaptateur Torznab multi-source ; C411 peut être activé avec `C411_API_KEY` et d’autres sources avec `SCENEROOT_TORZNAB_SOURCES`. Cette fonction est exclusivement destinée aux œuvres libres, au domaine public, à vos propres créations ou à tout contenu que vous êtes autorisé à télécharger. Les clés restent côté serveur.

## HDMI-CEC

`cec-utils` fournit `cec-client`. L’interface est utilisable au clavier avec les flèches, Entrée et Retour, ce qui correspond aux événements émis par la plupart des adaptateurs CEC. L’API expose aussi les actions `active`, `standby` et `scan`.

## État du produit

Cette première version est un socle fonctionnel et installable. Le scan, la médiathèque réelle, l’enrichissement automatique, la correction des correspondances, le streaming local, la persistance des notes/progressions, Transmission et CEC sont câblés. Le catalogue de démonstration reste utilisé pour les écrans qui nécessitent un historique familial prérempli.

Les profils créés ou modifiés depuis l’interface sont persistés par l’API. Chaque profil peut choisir l’un des dix avatars SceneRoot fournis, une limite d’âge et un code optionnel. Les codes sont dérivés avec `scrypt` et ne sont jamais stockés en clair. L’écran de fin de lecture enregistre la note et les qualificatifs du profil actif.

Les sélecteurs de découverte, de recherche et de choix familial exposent l’ensemble des genres films et séries de TMDB et TVmaze, avec leurs libellés français. La recherche charge progressivement les résultats distants filtrés et conserve les fiches consultées dans le cache de session.
