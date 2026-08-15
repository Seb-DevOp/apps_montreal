# 🍁 Montréal Compagnon

PWA de préparation et de carnet de voyage pour Montréal, sur le Free Tier Google Cloud.
Installable sur iOS et Android sans store ni compte développeur, et conçue pour survivre
à une recréation complète de l'infrastructure tous les 3 mois — sans que personne
n'ait à réinstaller quoi que ce soit.

---

## 1. Architecture

| Couche | Choix | Pourquoi |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite + TailwindCSS | Bundle léger (~26 Ko gzip hors SDK), pas de framework serveur à héberger, PWA de première classe via `vite-plugin-pwa`. |
| Service Worker | Workbox, stratégie `injectManifest` | Écrit à la main : `config.json` ne doit jamais être mis en cache (cf. §3), les photos ont une politique dédiée. |
| Backend | Node 22 + Fastify sur Cloud Run | Conteneurisé, scale-to-zero, aucun coût au repos. |
| Données | Cloud Firestore | Temps réel + cache hors-ligne natif : le journal, la check-list et le lexique fonctionnent dans le métro sans une ligne de code de synchronisation. |
| Médias | Cloud Storage | Upload direct depuis le navigateur, sans passer par Cloud Run. |
| Auth | Firebase Authentication | Google + e-mail/mot de passe, rôles portés par des *custom claims*. |
| Hébergement | Firebase Hosting | CDN mondial, HTTPS automatique, domaine personnalisé gratuit, et **rewrite serveur vers Cloud Run**. |
| Région | `europe-west1` (Belgique) | Les lecteurs réguliers du journal sont les proches restés en France. Le voyageur encaisse ~90 ms de latence depuis Montréal — sans effet perceptible, le cache Firestore local sert la lecture. Hosting reste servi par le CDN mondial. |

### Principe directeur : un backend qui peut disparaître

Le client parle **directement** à Firestore et à Storage. Cloud Run ne porte que ce qui ne
peut pas être fait depuis le navigateur en sécurité : clés tierces (météo), gestion des
rôles, imports en masse, ménage Storage.

Conséquence : l'API peut être à zéro instance, en cours de redéploiement ou injoignable —
la consultation du journal, la check-list, le calculateur de taxes, l'horloge et le
lexique continuent de fonctionner. C'est exactement le comportement qu'on veut sur un
Free Tier.

---

## 2. Arborescence

```
apps_montreal/
├── .github/
│   ├── workflows/
│   │   ├── deploy.yml           ★ CI/CD du code, sur push
│   │   └── infra.yml            ★ plan / apply / destroy / nuke, à la demande
│   └── actions/gcp-auth/        authentification WIF ou clé de service
├── deploy.sh                    déploiement complet en local (alternative)
├── Makefile                     raccourcis de développement
├── firebase.json                Hosting, en-têtes, rewrite /api/** → Cloud Run
├── firestore.rules              rôles admin / invité / bloqué
├── firestore.indexes.json       index composites des requêtes de l'app
├── storage.rules                quotas et types MIME des photos
├── .env.example                 variables de déploiement
│
├── api/                         ── Backend Cloud Run ──
│   ├── Dockerfile               multi-stage, runtime non-root
│   └── src/
│       ├── index.ts             serveur Fastify, CORS, rate limit, arrêt propre
│       ├── config.ts            configuration 100 % environnement
│       ├── firebase.ts          Admin SDK via ADC (aucune clé dans l'image)
│       ├── middleware/auth.ts   vérification du jeton et du rôle
│       ├── routes/
│       │   ├── health.ts        sondes + configuration publique
│       │   ├── weather.ts       météo ressentie + sélecteur d'activités
│       │   ├── tasks.ts         import Google Keep + timeline J-N
│       │   └── admin.ts         rôles, suppression de post, quotas
│       └── services/weather.ts  humidex, refroidissement éolien, cache
│
├── web/                         ── PWA ──
│   ├── index.html               méta iOS, safe areas, préconnexions
│   ├── vite.config.ts           manifeste PWA, découpage des chunks
│   ├── public/icons/            icônes générées (any + maskable + Apple)
│   └── src/
│       ├── main.tsx             ★ amorçage : config.json → Firebase → React
│       ├── App.tsx              routage et garde d'accès
│       ├── sw.ts                ★ Service Worker (4 politiques de cache)
│       ├── index.css            safe areas, cibles tactiles 44 px
│       ├── lib/
│       │   ├── runtimeConfig.ts ★ résilience aux migrations
│       │   ├── firebase.ts      init paresseuse, cache persistant
│       │   ├── api.ts           client HTTP (base `/api`)
│       │   ├── image.ts         EXIF + compression canvas
│       │   └── pwa.ts           install prompt, mises à jour
│       ├── contexts/AuthContext.tsx
│       ├── components/          AppShell, StatusBar, InstallPrompt
│       ├── data/neighborhoods.ts  quartiers, métro STM, géocodage local
│       └── features/
│           ├── clock/           timezones.ts + DualClock.tsx
│           ├── taxes/           quebecTax.ts + TaxCalculator.tsx
│           ├── journal/         usePosts, PhotoUploader, PhotoCard, Journal
│           ├── checklist/       timeline rétroactive
│           ├── weather/         ressenti réel + activités
│           ├── spots/           micro-spots par quartier
│           └── lexicon/         décodeur d'argot
│
├── scripts/
│   ├── bootstrap-ci.sh          ★ amorçage projet + service account CI
│   ├── generate-config.mjs      ★ config.json (partagé local / CI)
│   ├── generate-icons.mjs       encodeur PNG maison, zéro dépendance
│   ├── seed-firestore.mjs       contenu de référence, idempotent
│   └── set-admin.mjs            attribution des rôles
│
├── seed/                        spots.json · lexicon.json · tasks.json
└── infra/terraform/             infrastructure déclarative (état dans GCS)
```

---

## 3. La contrainte centrale : migrer sans réinstaller

Tous les 3 mois, un nouveau projet GCP, de nouvelles IP, de nouvelles clés. Les proches
ne doivent rien avoir à faire. Trois mécanismes s'empilent.

### a. Le domaine stable découple l'URL de l'infrastructure

L'identité d'une PWA installée, c'est son **origine** (`https://appsmontrealseb.ddns.net`).
Tant qu'elle ne change pas, l'icône sur l'écran d'accueil, le Service Worker enregistré et
les permissions accordées survivent. À la migration, on repointe le domaine sur le nouveau
site Firebase Hosting : côté téléphone, rien n'a bougé.

C'est la seule étape manuelle du processus, et elle se fait chez le registrar.

#### Ce que le domaine doit permettre

Rattacher un domaine à Firebase Hosting exige **deux capacités DNS** :

1. un enregistrement **TXT** — vérification unique de la propriété (`hosting-site=…`) ;
2. deux enregistrements **A** vers les IP de Firebase, une fois la propriété vérifiée.

Le TXT est la contrainte discriminante. Sans lui, Firebase n'émet pas le certificat TLS,
et le domaine reste inutilisable — pointer les A records « à la main » ne suffit pas :
la requête arriverait avec un `Host` inconnu et sans certificat valide.

| Option | TXT possible ? | Coût |
|---|---|---|
| **DuckDNS** — retenu ici | ✅ un TXT à l'apex, via l'API | gratuit |
| Domaine à soi (OVH, Gandi, Cloudflare…) | ✅ | ~7 €/an |
| No-IP gratuit (`*.ddns.net`) | ❌ A/CNAME seulement | gratuit |

Si le fournisseur ne publie pas de TXT, l'application fonctionne parfaitement sur
`https://<projet>.web.app`, mais **la promesse « aucune réinstallation » tombe** : cette
URL contient l'identifiant du projet, elle change à chaque rotation trimestrielle, et
l'origine d'une PWA installée change avec elle.

#### Les A records ne pointent pas sur un serveur à nous

Contresens fréquent : il n'y a **aucune IP dynamique à maintenir**. Firebase Hosting est
un CDN anycast, et les adresses qu'il publie — `151.101.1.195` et `151.101.65.195` — sont
fixes, publiques, identiques pour tout le monde. Elles ne dépendent ni du projet GCP, ni
de la région, ni du déploiement.

D'où un partage net des durées de vie :

| Enregistrement | Valeur | Fréquence de changement |
|---|---|---|
| `A` | IP anycast Firebase | **jamais** — posé une fois |
| `TXT` | jeton du site Hosting | à **chaque migration trimestrielle** |

C'est ce qui rend la rotation indolore : une seule valeur TXT à republier, en une commande.

```bash
npm run dns:show                        # état courant des enregistrements
npm run dns:setup                       # pose le A vers Firebase (une fois)
npm run dns:verify -- hosting-site=abc  # publie le TXT donné par la console
```

⚠️ **Désactive tout client de mise à jour DuckDNS** (routeur, tâche planifiée, conteneur)
pour ce domaine. Son rôle est justement de réécrire le A record avec l'IP domestique
courante — ce qui ferait tomber le site à la première exécution.

Voir [`scripts/duckdns-update.mjs`](scripts/duckdns-update.mjs).

### b. `config.json` porte l'identité du projet, pas le bundle

Aucun identifiant Firebase n'est compilé dans le JavaScript. Au démarrage,
[`main.tsx`](web/src/main.tsx) charge `/config.json`, **puis** initialise Firebase :

```
fetch('/config.json')  →  initFirebase(config.firebase)  →  render(<App />)
```

`deploy.sh` régénère ce fichier à chaque déploiement à partir de
`firebase apps:sdkconfig`. Firebase Hosting le sert en `no-cache`, et le Service Worker le
traite en *network-only* avec repli hors-ligne. Une PWA installée depuis six mois récupère
donc la nouvelle infrastructure à sa prochaine ouverture en ligne.

[`runtimeConfig.ts`](web/src/lib/runtimeConfig.ts) détecte le changement de `projectId` et
purge ce qu'il faut — caches API, bases IndexedDB de l'ancien Firestore — **sans jamais
toucher à l'enregistrement du Service Worker ni à l'installation**.

### c. Le rewrite Hosting masque l'URL Cloud Run

`firebase.json` réécrit `/api/**` vers le service Cloud Run côté serveur. La PWA appelle
`/api/weather` en relatif : elle ne connaît jamais l'URL `*.run.app`, qui change à chaque
migration. Bénéfices annexes : pas de CORS, pas de préflight, une seule origine.

### Procédure de migration (≈ 15 minutes)

```bash
# 1. Nouveau projet dans .env
sed -i 's/^GCP_PROJECT_ID=.*/GCP_PROJECT_ID=mtl-compagnon-2026q2/' .env

# 2. Amorçage local — la seule étape que la CI ne peut pas faire
make bootstrap
```

Le script affiche les nouvelles valeurs. Trois d'entre elles changent à chaque migration :
`GCP_PROJECT_ID`, `TF_STATE_BUCKET` (variables) et `GCP_WIF_PROVIDER` (secret) — le
provider Workload Identity vit dans le projet, il est donc recréé avec lui.

```bash
# 3. Mettre à jour le dépôt (les commandes gh sont affichées par le script)
gh variable set GCP_PROJECT_ID --body "mtl-compagnon-2026q2"
gh variable set TF_STATE_BUCKET --body "mtl-compagnon-2026q2-tfstate"
gh secret   set GCP_WIF_PROVIDER --body "projects/…/providers/github-oidc"

# 4. Actions → Infrastructure → apply
# 5. Actions → Déploiement → Run workflow (seed: true)
# 6. Repointer le DNS du domaine stable vers les nouvelles IP Firebase
# 7. Une fois le DNS propagé : Infrastructure → nuke sur l'ANCIEN projet
```

Le pas 7 mérite d'être fait dans cet ordre — garder l'ancien projet vivant jusqu'à la
propagation DNS permet de revenir en arrière si quelque chose cloche.

Côté utilisateurs : ils se reconnecteront une fois, les jetons de l'ancien projet n'étant
plus valides. C'est le seul effet visible. L'icône, le Service Worker et l'installation
sur l'écran d'accueil ne bougent pas.

---

## 4. Modèle de données Firestore

```jsonc
// users/{uid} — profil public, sert à afficher les auteurs de commentaires
{
  "displayName": "Camille",
  "photoURL": "https://…",
  "email": "camille@exemple.fr",
  "role": "guest",              // miroir informatif ; l'autorité est le custom claim
  "createdAt": "<timestamp>",
  "updatedAt": "<timestamp>"
}

// trips/current — document unique de configuration du voyage
{
  "name": "Montréal",
  "departureDate": "2026-10-12",   // AAAA-MM-JJ, référence de toute la timeline
  "returnDate": "2026-10-26",
  "homeTimeZone": "Europe/Paris",
  "tripTimeZone": "America/Montreal"
}

// posts/{postId} — journal photo
{
  "authorUid": "abc123",
  "authorName": "Seb",
  "caption": "Bagels à 2 h du matin sur Saint-Viateur.",
  "storagePath": "photos/abc123/postId/full.webp",
  "thumbPath":   "photos/abc123/postId/thumb.webp",
  "url": "https://firebasestorage.googleapis.com/…",
  "thumbUrl": "https://firebasestorage.googleapis.com/…",
  "width": 1600, "height": 1200,
  "location": { "lat": 45.5232, "lng": -73.6027, "neighborhood": "Mile End" },
  "neighborhood": "Mile End",      // dupliqué à plat pour permettre le filtrage
  "takenAt": "<timestamp>",        // EXIF DateTimeOriginal, sinon date du fichier
  "createdAt": "<timestamp>",      // serverTimestamp, imposé par les règles
  "tags": []
}

// posts/{postId}/likes/{uid} — l'id du document EST l'uid
{ "uid": "abc123", "createdAt": "<timestamp>" }

// posts/{postId}/comments/{commentId}
{
  "authorUid": "def456",
  "authorName": "Maman",
  "authorPhoto": "https://…",
  "text": "Magnifique !",
  "createdAt": "<timestamp>",
  "editedAt": "<timestamp>"        // optionnel
}

// tasks/{taskId} — check-list pré-départ
{
  "title": "Demander l'AVE Canada",
  "notes": null,
  "category": "administratif",     // administratif · technologie · argent · bagages · transport · santé · divers
  "offsetDays": 30,                // ★ 30 → J-30. Jamais de date absolue.
  "done": false,
  "doneAt": null,
  "source": "keep",                // keep · manual
  "labels": ["Voyage"]
}

// spots/{spotId} — micro-spots par quartier
{
  "name": "Marché Jean-Talon",
  "neighborhood": "Petite-Italie / Marché Jean-Talon",
  "category": "marché",
  "address": "7070 Av. Henri-Julien",
  "geo": { "lat": 45.5366, "lng": -73.6146 },
  "metro": ["Bleue"],
  "notes": "Partiellement couvert et chauffé l'hiver.",
  "url": "https://…",
  "priority": 10,                  // 0-10, ordre d'affichage
  "indoor": true,                  // ★ pivot du sélecteur météo
  "weatherTags": ["canicule", "froid", "pluie"]
}

// lexicon/{termId} — argot québécois
{
  "term": "Dépanneur (dep)",
  "definition": "Petite épicerie de quartier ouverte tard.",
  "example": "Je passe au dep chercher une pinte de lait.",
  "category": "quotidien",         // expression · nourriture · transport · quotidien · juron · anglicisme
  "frenchEquivalent": "superette"
}

// meta/weather — cache serveur, écrit par Cloud Run uniquement
{ "snapshot": { /* WeatherSnapshot */ }, "fetchedAt": "<timestamp>" }
```

### Choix de modélisation notables

**`offsetDays` plutôt qu'une date.** Un vol décalé ne demande de changer qu'un seul champ
dans `trips/current` : toute la timeline suit.

**Pas de compteur de likes.** L'id du document de like est l'uid, ce qui rend l'opération
idempotente et le décompte lisible directement dans le snapshot. Aucune transaction, aucun
risque de dérive, et un like posé hors-ligne est rejoué à la reconnexion.

**`neighborhood` dupliqué à plat.** Firestore ne sait pas filtrer sur un champ imbriqué
dans une requête composée avec un tri : le doublon paye un index et évite un filtrage
client sur tout le flux.

---

## 5. Sécurité

Le rôle vit dans un **custom claim** signé par Firebase, pas dans un document Firestore.
Deux conséquences : aucune lecture supplémentaire n'est facturée à chaque requête, et
un invité qui modifierait son propre profil ne gagne aucun droit.

- [`firestore.rules`](firestore.rules) — admin en écriture, invités en lecture + likes +
  commentaires, validation de taille et de forme sur chaque champ écrit, `createdAt` forcé
  à `request.time`, `authorUid` et `storagePath` immuables après création.
- [`storage.rules`](storage.rules) — écriture réservée à l'admin **sur son propre
  préfixe**, types MIME restreints, plafond de 3 Mo par fichier, noms de fichiers
  contraints (`full.webp` / `thumb.webp`).

Tout le contenu est derrière l'authentification, et `index.html` porte
`noindex, nofollow` : le journal montre le logement et les proches, il n'a rien à faire
dans un moteur de recherche.

---

## 6. CI/CD — GitHub Actions

Deux workflows, volontairement séparés : on pousse du code plusieurs fois par semaine,
on touche à l'infrastructure une fois par trimestre.

| Workflow | Déclenchement | Rôle |
|---|---|---|
| **Déploiement** ([`deploy.yml`](.github/workflows/deploy.yml)) | push sur `main`, ou manuel | typecheck → image API → Cloud Run → PWA → Hosting → contenu et rôles |
| **Infrastructure** ([`infra.yml`](.github/workflows/infra.yml)) | manuel uniquement | `plan` · `apply` · `destroy` · `nuke` |

### Ce que la CI ne peut pas faire

**La création du projet GCP reste locale.** Sur un compte Google personnel (sans
organisation), `resourcemanager.projects.create` n'est accordé qu'à un compte
*utilisateur* : un service account, même Owner, ne peut pas créer de projet. La CI ne
peut donc pas s'auto-amorcer.

En revanche elle peut **tout le reste, suppression du projet comprise** — un SA `owner`
a bien `resourcemanager.projects.delete`. Le bootstrap est donc une commande locale, une
fois par projet.

### Mise en service

**Prérequis** : Node ≥ 22, Git, et le SDK Google Cloud. `firebase-tools` n'a pas besoin
d'être installé — les scripts passent par `npx`.

```powershell
# Windows
winget install --id Google.CloudSDK -e
winget install --id OpenJS.NodeJS.LTS -e   # si Node absent
```

```bash
# macOS / Linux
brew install --cask google-cloud-sdk       # ou https://cloud.google.com/sdk/docs/install
```

Puis, dans un **nouveau** terminal (le PATH vient d'être modifié) :

```bash
gcloud auth login
gcloud auth application-default login
```

**Configuration et amorçage** :

```bash
cp .env.example .env      # PowerShell : Copy-Item .env.example .env
# → renseigne GCP_PROJECT_ID, GCP_BILLING_ACCOUNT, ADMIN_EMAIL, STABLE_DOMAIN

npm run bootstrap         # portable : PowerShell, cmd, bash, macOS, Linux
```

> `make` n'existe pas sur Windows. Toutes les cibles du Makefile ont un équivalent
> `npm run` (voir [`package.json`](package.json)) : `bootstrap`, `deploy`, `seed`, `admin`,
> `typecheck`, `build`… Le lanceur [`run-sh.mjs`](scripts/run-sh.mjs) localise le bash
> fourni avec Git, de sorte qu'une seule implémentation des scripts shell soit maintenue.

Le script crée le projet, rattache la facturation, active Firebase, crée le bucket d'état
Terraform, crée le service account de CI, configure Workload Identity Federation — puis
**affiche les secrets et variables à coller dans GitHub**, avec les commandes `gh`
correspondantes.

```bash
# 4. Infrastructure     Actions → Infrastructure → Run workflow → action: apply
# 5. Application        Actions → Déploiement → Run workflow (ou push sur main)
# 6. Rôle admin         connecte-toi une fois dans l'app, puis relance Déploiement
```

### Secrets et variables du dépôt

*Settings → Secrets and variables → Actions*

Le strict minimum est de **trois entrées** : `GCP_PROJECT_ID`, plus les deux qui
permettent de s'authentifier. Tout le reste a un défaut, et le job `preflight` affiche
en début de run un tableau de ce qui est configuré, de ce qui prend un défaut et de ce
qui manque.

**Variables** (non sensibles, visibles dans les logs)

| Nom | Statut | Défaut si absent |
|---|---|---|
| `GCP_PROJECT_ID` | **obligatoire** | — *(bloque le déploiement)* |
| `GCP_REGION` | optionnel | `europe-west1` |
| `CLOUD_RUN_SERVICE` | optionnel | `mtl-api` |
| `TF_STATE_BUCKET` | optionnel | `<projet>-tfstate` |
| `ADMIN_EMAIL` | recommandé | aucun compte ne pourra publier de photo |
| `STABLE_DOMAIN` | recommandé | la migration cesse d'être transparente |
| `TRIP_DEPARTURE_DATE` | optionnel | `2026-10-12` |
| `TRIP_RETURN_DATE` | optionnel | `2026-10-26` |

**Secrets**

| Nom | Statut | Sans lui |
|---|---|---|
| `GCP_WIF_PROVIDER` | **obligatoire** (mode OIDC) | — |
| `GCP_SERVICE_ACCOUNT` | **obligatoire** (mode OIDC) | — |
| `GCP_SA_KEY` | alternative aux deux précédents | — |
| `OPENWEATHER_API_KEY` | recommandé | écrans Météo et Activités en erreur |

⚠️ **`GCP_SERVICE_ACCOUNT` seul ne sert à rien.** L'action d'authentification ne bascule
sur OIDC que si `GCP_WIF_PROVIDER` est renseigné ; sinon elle retombe sur `GCP_SA_KEY`.
Renseigner l'un sans l'autre produit un échec d'authentification, que le `preflight`
détecte et explique. Voir [`.github/actions/gcp-auth`](.github/actions/gcp-auth/action.yml).

Ces deux valeurs ne se devinent pas : `GCP_WIF_PROVIDER` contient le **numéro** du projet,
attribué par Google à sa création. `make bootstrap` les affiche, avec les commandes `gh`
prêtes à copier.

### Détruire ce qui a été créé

*Actions → Infrastructure → Run workflow*

| Action | Effet | Réversible |
|---|---|---|
| `plan` | affiche les changements, ne touche à rien | — |
| `apply` | crée / met à jour les ressources | — |
| `destroy` | détruit les ressources, **garde le projet** et le bucket d'état | relancer `apply` |
| `nuke` | supprime le projet GCP entier | 30 jours (`gcloud projects undelete`) |

`destroy` et `nuke` exigent de **retaper l'identifiant exact du projet** dans le champ
« confirm ». Un workflow destructeur déclenchable en deux clics est un accident qui attend
son heure.

Deux garde-fous supplémentaires sur `destroy` :

- le bucket de photos a `force_destroy = false` par défaut — Terraform refuse de le
  supprimer s'il contient encore des images. La case `keep_photos` inverse ce choix ;
- le service Cloud Run n'étant pas géré par Terraform, le workflow le supprime
  explicitement pour ne pas laisser de révision orpheline.

Les deux jobs destructeurs ciblent l'environnement GitHub `production-destroy` : si tu y
ajoutes une règle de *required reviewer*, ils demanderont une approbation avant de partir.

### Développement local

| Tâche | Windows / portable | macOS · Linux |
|---|---|---|
| Dépendances | `npm run install:all` | `make install` |
| API + PWA | `npm run dev:api` / `npm run dev:web` | `make dev` |
| Émulateurs Firebase | `npm run emulators` | `make emulators` |
| Typecheck | `npm run typecheck` | `make check` |

### Exploitation

| Tâche | Windows / portable | macOS · Linux |
|---|---|---|
| Déploiement complet local | `npm run deploy` | `make deploy` |
| Code seul | `npm run deploy:app` | `make deploy-app` |
| Contenu de référence | `npm run seed` | `make seed` |
| Rôle admin | `npm run admin` | `make admin` |
| Journaux Cloud Run | — | `make logs` |

`deploy.sh` reste pleinement fonctionnel : il partage
[`generate-config.mjs`](scripts/generate-config.mjs) avec la CI, donc les deux chemins
produisent un `config.json` identique. Utile pour déboguer sans attendre un run GitHub.

---

## 7. Modules

### Double horloge — [`features/clock/`](web/src/features/clock/)

Aucun offset codé en dur. « Montréal UTC-5, France UTC+1 » est faux la moitié de l'année,
et les deux pays changent d'heure à trois semaines d'intervalle — il existe donc deux
fenêtres annuelles où l'écart est de 5 h et non 6 h. Tout passe par `Intl` et la base
IANA, qui connaît ces règles.

L'indicateur de **fenêtre de contact** classe l'heure française courante (idéale,
acceptable, tardive, interdite) et calcule le prochain créneau favorable en avançant par
pas de 15 minutes — méthode insensible aux changements d'heure.

### Taxes et pourboires — [`features/taxes/`](web/src/features/taxes/)

Trois pièges encodés explicitement :

1. Les prix affichés sont **hors taxes**. Le montant réel est ~15 % plus élevé.
2. Depuis 2013 la TVQ ne se calcule plus en cascade sur la TPS : les deux taxes
   s'appliquent à la même base (5 % + 9,975 % = 14,975 %). Beaucoup de calculateurs en
   ligne surestiment encore la note.
3. L'usage local veut un pourboire calculé **avant taxes**, alors que les terminaux
   proposent des pourcentages sur le total. L'app calcule les deux et affiche l'écart.

L'écran met une seule information au sommet — le montant à taper sur le TPE — parce qu'on
s'en sert debout, devant un serveur qui attend.

### Journal photo — [`features/journal/`](web/src/features/journal/)

`EXIF → compression → upload Storage → document Firestore`, entièrement côté client.

La compression est le point sensible du quota : une photo d'iPhone brute pèse 3 à 5 Mo,
comprimée en WebP 1600 px elle tombe à ~250 Ko. Sur deux semaines à 20 photos par jour, on
passe de ~1 Go à ~70 Mo sur les 5 Go gratuits.

L'EXIF est lu **avant** la compression (le passage par `<canvas>` détruit les métadonnées).
Effet de bord souhaitable : les fichiers publiés ne transportent plus la position GPS
exacte du logement. Le quartier est déduit localement par proximité de centroïde
([`data/neighborhoods.ts`](web/src/data/neighborhoods.ts)) — gratuit, instantané, et
fonctionne dans l'avion.

### Météo ressentie — [`api/src/services/weather.ts`](api/src/services/weather.ts)

Humidex et refroidissement éolien recalculés selon les formules d'Environnement Canada,
plutôt que le `feels_like` générique d'OpenWeather. Cache Firestore de 20 minutes : toute
la famille peut consulter sans entamer le quota gratuit. En cas de panne de l'API tierce,
le cache périmé est servi avec un en-tête `X-Cache: stale` — une donnée d'il y a deux
heures reste plus utile qu'une erreur.

### Check & Sync — [`features/checklist/`](web/src/features/checklist/)

Google Keep n'a pas d'API publique de lecture. Le chemin fiable et gratuit est l'export
Google Takeout : l'admin dépose les fichiers JSON dans l'app, et
[`api/src/routes/tasks.ts`](api/src/routes/tasks.ts) déduit le jalon J-N et la catégorie
par mots-clés (`AVE` → J-30, `eSIM` → J-7, `enregistrement` → J-2…). L'import est
idempotent : l'id est dérivé du texte, et un réimport ne décoche pas ce qui est fait.

---

## 8. Empreinte Free Tier

| Service | Gratuit / mois | Usage estimé |
|---|---|---|
| Firebase Hosting | 10 Go transfert, 360 Mo stockage | ~1 Mo de bundle, servi par CDN |
| Cloud Run | 2 M requêtes, 180 k vCPU-s | ~2 000 requêtes (météo + admin) |
| Firestore | 50 k lectures, 20 k écritures / jour | ~1 000 lectures/jour à 20 utilisateurs |
| Cloud Storage | 5 Go | ~70 Mo pour 300 photos compressées |
| Firebase Auth | 50 k MAU | ~20 comptes |

Le poste à surveiller est Storage. L'écran d'administration affiche la consommation
réelle, et `DELETE /api/posts/:id` purge bien les fichiers en même temps que le document —
sans quoi les images orphelines s'accumulent.

Point d'attention connu : le SDK Firebase pèse 147 Ko gzip, soit l'essentiel du poids de
l'app. Il est isolé dans son propre chunk pour être mis en cache une fois pour toutes ;
le passer en import dynamique gagnerait du temps au premier chargement, au prix d'un
écran de connexion plus lent.

---

## 9. Installation côté utilisateur

**Android / Chrome** — une bannière propose l'installation native (`beforeinstallprompt`).

**iOS / Safari** — aucune API n'existe. L'app détecte iOS et affiche les gestes :
*Partager → Sur l'écran d'accueil*. Un bouton « Installer » qui ne ferait rien serait pire
que pas de bouton.

La bannière est reportable de 14 jours : personne n'a envie d'être harcelé par une PWA de
voyage.
