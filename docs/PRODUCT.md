# Vision produit SceneRoot

SceneRoot repose sur trois piliers :

- **Discover** : découverte, recherche, recommandations individuelles et choix de groupe.
- **Watch** : lecture native, téléchargements hiérarchisés, buffer prédictif et épisode suivant.
- **Roots** : profils, historique, notes, statistiques et évolution des goûts.

## Décision de groupe

Le score n'est pas une simple moyenne :

```text
score = affinité moyenne
      - 0,42 × (affinité max - affinité min)
      + bonus de rotation équitable
      - pénalités de contraintes
```

Les contraintes strictes (âge, contenu masqué, langue obligatoire, durée maximale) éliminent un candidat avant le classement. Le bonus de rotation favorise légèrement les profils moins servis lors des choix récents. Chaque proposition conserve une explication lisible, sans exposer un calcul opaque.

## Bibliothèque invisible

Le serveur surveille périodiquement les racines locales, USB, SSD, SMB et NFS déjà montées. Le pipeline :

1. détecte les nouveaux fichiers ;
2. reconnaît films et épisodes (`S01E05`, `1x05`, `Season 1 Episode 5`) ;
3. inspecte le conteneur avec `ffprobe` (durée, codecs, résolution, HDR, pistes audio et sous-titres) ;
4. regroupe les versions d'une même œuvre ;
5. enrichit la fiche via une source de métadonnées autorisée ;
6. place les cas ambigus dans une file de validation manuelle.

Le scan réalise maintenant les étapes 1 à 5 avec TMDB lorsqu’il est configuré, ou avec Wikipédia/TVmaze sans clé. Il réutilise le résultat `ffprobe` des fichiers inchangés et enrichit silencieusement une fiche uniquement lorsqu’une correspondance stricte et unique est trouvée. Les cas ambigus sont présentés dans « Ma médiathèque » avec affiches, années et résumés ; le choix est mémorisé pour toutes les versions et tous les épisodes portant le même titre.

## Sources et téléchargements

Les recherches passent par des adaptateurs Torznab configurés côté serveur. C411 est un preset facultatif activé par clé API ; aucune clé n'est envoyée au navigateur. Les résultats sont classés selon résolution, langues, HDR, taille, disponibilité et codec. Le lancement est bloqué si le téléchargement ferait passer le disque sous la réserve, fixée à 50 Go par défaut.

Le client Transmission est le premier backend de téléchargement. Pour une vraie lecture avant fin de téléchargement, la prochaine brique doit être un moteur capable de prioriser les pièces séquentiellement et de remonter précisément la carte des blocs. L'interface calculera alors :

```text
buffer_seconds = bytes_contigus_disponibles / débit_moyen_du_média
prêt = buffer_seconds > seuil_de_sécurité
```

## Profils et invité

Un profil porte un nom, un avatar, une limite d'âge, un code optionnel, des préférences et des refus. Un invité est une session isolée avec une échéance (`extinction`, `24 h`, `7 jours`, ou conversion en profil). Ses lectures et notes ne modifient jamais les modèles familiaux.

## Lecture

L'interface est une application web locale, mais la lecture TV principale est native via `mpv` : accélération matérielle, MKV, HEVC, HDR, choix audio et sous-titres. Le navigateur sert l'interface, le fallback HTTP Range et l'administration distante.

## Déploiement

- service `systemd` au démarrage du Pi ;
- Chromium en mode kiosque à l'ouverture de la session graphique ;
- contrôle HDMI-CEC via `cec-utils` ;
- vérification quotidienne de `origin/main` et mise à jour atomique seulement après une nouvelle révision ;
- workflow GitHub de compilation et vérification TypeScript.
