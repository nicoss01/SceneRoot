# SceneRoot

SceneRoot est un media center « couch-first » pour Raspberry Pi : profils, reprise de lecture, catalogue local, notes, recommandations, navigation HDMI-CEC et mises à jour automatiques depuis GitHub.

La vision détaillée Discover / Watch / Roots et l'état du pipeline sont décrits dans [docs/PRODUCT.md](docs/PRODUCT.md).

## Démarrage rapide sur PC

```bash
npm install
npm run dev
```

Ouvrez `http://localhost:5173`. Aucun profil ni média de démonstration n’est injecté : au premier démarrage, l’assistant crée uniquement les profils saisis par l’utilisateur. Le serveur API écoute sur le port `4174`.

## Installation Raspberry Pi

Raspberry Pi 4/5, un système Debian/Ubuntu 64 bits et 4 Go de RAM sont recommandés. Le bureau Ubuntu n’est pas requis : le mode par défaut lance Chromium dans un kiosque Wayland minimal avec Cage.

1. Créez votre dépôt GitHub à partir de ce projet.
2. Remplacez `OWNER` dans `scripts/install.sh` ou fournissez `SCENEROOT_REPO_URL`.
3. Sur le Pi :

```bash
git clone https://github.com/VOTRE_COMPTE/SceneRoot.git
cd SceneRoot
SCENEROOT_REPO_URL=https://github.com/VOTRE_COMPTE/SceneRoot.git bash scripts/install.sh
```

Le serveur, le pont HDMI-CEC et l’interface TV se lancent au démarrage via `systemd`. Par défaut, `sceneroot-kiosk.service` démarre directement Cage et Chromium sur `tty1`, sans GNOME ni bureau Ubuntu. Le timer `sceneroot-update.timer` vérifie `origin/main` chaque jour et ne redémarre l’application que si une nouvelle révision existe.

Pour conserver une session de bureau classique, lancez l’installation avec `SCENEROOT_KIOSK_MODE=desktop`. Le choix est mémorisé dans `/etc/sceneroot.env` et conservé par les mises à jour.

Pour déclencher immédiatement la même mise à jour depuis le terminal :

```bash
sudo /opt/sceneroot/scripts/update.sh
```

Le script refuse d’écraser des modifications Git locales, sauvegarde `/var/lib/sceneroot` et `/etc/sceneroot.env` dans `/var/backups/sceneroot`, compile la nouvelle version, vérifie l’API puis restaure automatiquement l’ancienne révision si une étape échoue. Les profils, réglages, clés, historiques et catalogues SQLite restent séparés du dépôt Git.

Après la mise à jour depuis une ancienne installation qui ne connaissait pas encore le kiosque direct et le pont CEC, réappliquez une fois les services puis redémarrez :

```bash
sudo /opt/sceneroot/scripts/update.sh --reconfigure
sudo reboot
```

Le script installé utilise automatiquement :

```bash
chromium --kiosk --noerrdialogs --disable-infobars http://127.0.0.1:4174
```

## Catalogue local et métadonnées

SceneRoot utilise désormais une architecture locale en couches :

- **IMDb Datasets** alimente les tables SQLite `catalog_titles` et `catalog_episodes` avec les films, séries, notes publiques et relations saison/épisode.
- **TMDB** enrichit paresseusement uniquement les titres réellement affichés avec le titre, le résumé et les images en français. La clé API v3 se configure dans l’assistant initial, dans les paramètres ou via `TMDB_API_KEY`; elle n’est jamais renvoyée en clair au navigateur.
- **TMDB puis TVmaze** enrichissent les épisodes. La structure reste disponible hors ligne grâce aux relations IMDb déjà enregistrées.
- **Wikidata** associe par lots les identifiants IMDb, TMDB et Wikidata dans `catalog_localized`.
- **Wikipédia francophone** n’est interrogée que pour produire un résumé de secours lorsqu’aucune clé TMDB n’est configurée.

La première synchronisation IMDb est volontairement activable depuis **Paramètres > Catalogue local**, car elle télécharge et indexe plusieurs jeux de données volumineux. Les imports suivants sont lancés en arrière-plan tous les 7 jours par défaut (`SCENEROOT_CATALOG_SYNC_DAYS`) et utilisent un jeton de génération : les anciennes lignes ne sont supprimées qu’après la réussite de la nouvelle phase. `GET /api/catalog/status` expose l’avancement et `POST /api/catalog/sync` force une synchronisation.

Les jeux de données IMDb sont proposés pour une utilisation personnelle et non commerciale. Vérifiez leurs conditions avant toute distribution ou exploitation commerciale de SceneRoot.

## Médias locaux

- Les dossiers sont définis par `SCENEROOT_MEDIA` (séparés par des virgules).
- `POST /api/library/scan` analyse récursivement MP4, MKV, WebM, AVI, MOV et M4V.
- Les fichiers inchangés réutilisent leur analyse `ffprobe`; les correspondances corrigées ne sont pas perdues au scan suivant.
- `GET /api/catalog` interroge le catalogue SQLite paginé et accepte les filtres `kind`, `genre`, `q` et `sort`. Tant que le premier import IMDb n’est pas terminé, TMDB peut fournir un catalogue transitoire si une clé est configurée ; sinon l’interface affiche un état vide explicite. Wikipédia n’est plus utilisé comme source d’inventaire.
- Les réponses distantes sont conservées dans `SCENEROOT_DATA/cache` pendant 6 à 24 heures. Un cache périmé reste utilisable si une source est temporairement inaccessible.
- Après le scan, les nouveaux fichiers sont enrichis en arrière-plan uniquement lorsque le titre et l’année donnent une correspondance unique. Les cas ambigus restent intacts.
- `GET /api/library/grouped` alimente l’écran réel « Ma médiathèque » en regroupant versions et épisodes.
- `GET /api/metadata/search` et `PUT /api/library/:id/match` permettent de corriger un média depuis l’interface avec TMDB, Wikipédia ou TVmaze ; leurs résultats sont également mis en cache.
- `GET /api/media/:id` diffuse les fichiers avec prise en charge des requêtes HTTP Range.
- La lecture TV principale passe par `mpv` (`POST /api/player/:id/play`) pour MKV, HEVC, HDR, pistes audio, sous-titres et accélération matérielle. Le lecteur web reste un mode de secours.
- FFmpeg est installé pour l’inspection/transcodage à venir.
- Une clé TMDB peut être placée dans `/etc/sceneroot.env` ou enregistrée depuis l’interface. Une clé d’environnement est prioritaire et ne peut pas être remplacée depuis le navigateur.
- Les données TVmaze sont fournies sous licence CC BY-SA, Wikidata sous CC0 et les résumés de secours Wikipédia sous CC BY-SA. Les liens vers les fiches sources sont conservés dans les résultats.
- Les écrans de catalogue utilisent une pagination déclenchée par `IntersectionObserver`; les images utilisent le chargement différé natif du navigateur.

## Téléchargements

SceneRoot sait envoyer un lien magnet à une instance Transmission locale. Il expose aussi un adaptateur Torznab multi-source ; C411 peut être activé avec `C411_API_KEY` et d’autres sources avec `SCENEROOT_TORZNAB_SOURCES`. Cette fonction est exclusivement destinée aux œuvres libres, au domaine public, à vos propres créations ou à tout contenu que vous êtes autorisé à télécharger. Les clés restent côté serveur.

## HDMI-CEC

`cec-utils` fournit `cec-client`. Le service `sceneroot-cec.service` écoute réellement le bus HDMI-CEC et transforme les touches de la télécommande en événements clavier Linux via `uinput` : directions, validation, retour, lecture/pause, arrêt et avance/retour. Cage transmet ces événements à Chromium. L’API expose aussi les actions `active`, `standby` et `scan`, et l’écran Paramètres affiche l’état du pont et l’adaptateur détecté.

Le contrôle CEC doit aussi être activé dans le menu de la TV. Selon la marque, il peut s’appeler Anynet+, Simplink, BRAVIA Sync, VIERA Link ou EasyLink. Pour diagnostiquer le Pi :

```bash
systemctl status sceneroot-cec.service
journalctl -u sceneroot-cec.service -f
cec-client -l
```

Après une première installation ou l’ajout du groupe `input`, redémarrez le Raspberry Pi afin que les droits de la session kiosque soient appliqués.

## État du produit

Cette première version est un socle fonctionnel et installable. Le scan, la médiathèque réelle, l’enrichissement automatique, la correction des correspondances, le streaming local, la persistance des notes/progressions, Transmission et CEC sont câblés. Les écrans sont alimentés uniquement par les profils persistés, la médiathèque indexée et le catalogue synchronisé ; aucune donnée de démonstration n’est installée.

Les profils créés ou modifiés depuis l’interface sont persistés par l’API. Chaque profil peut choisir l’un des dix avatars SceneRoot fournis, une limite d’âge et un code optionnel. Les codes sont dérivés avec `scrypt` et ne sont jamais stockés en clair. L’écran de fin de lecture enregistre la note et les qualificatifs du profil actif.

Les sélecteurs de découverte, de recherche et de choix familial exposent l’ensemble des genres films et séries de TMDB et TVmaze, avec leurs libellés français. La recherche charge progressivement les résultats distants filtrés et conserve les fiches consultées dans le cache de session.
