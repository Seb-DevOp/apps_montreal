#!/usr/bin/env bash
#
# =============================================================================
# Montréal Compagnon — déploiement complet en une commande.
#
#   ./deploy.sh              déploiement complet (création incluse)
#   ./deploy.sh --app-only   redéploie seulement le code (itération rapide)
#   ./deploy.sh --migrate    bascule vers un nouveau projet GCP (trimestriel)
#
# Le script est idempotent : chaque étape vérifie l'existant avant de créer.
# On peut le relancer sans rien casser.
#
# Prérequis : gcloud, firebase-tools, node ≥ 20, un fichier .env (cf. .env.example).
# =============================================================================

set -euo pipefail

# Sous Git Bash, le lanceur POSIX du SDK Google Cloud cherche un `python`
# absent du PATH MSYS. Le SDK embarque le sien : on le désigne en chemin POSIX.
# Détail du raisonnement dans scripts/bootstrap-ci.sh.
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*)
    for sdk_root in \
      "$(cygpath -u "${LOCALAPPDATA:-}" 2>/dev/null)/Google/Cloud SDK/google-cloud-sdk" \
      "/c/Program Files/Google/Cloud SDK/google-cloud-sdk" \
      "/c/Program Files (x86)/Google/Cloud SDK/google-cloud-sdk"; do
      if [[ -x "${sdk_root}/platform/bundledpython/python.exe" ]]; then
        export CLOUDSDK_PYTHON="${sdk_root}/platform/bundledpython/python.exe"
        export PATH="${PATH}:${sdk_root}/bin"
        break
      fi
    done
    ;;
esac

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ------------------------------- Présentation --------------------------------

readonly BOLD=$'\033[1m' DIM=$'\033[2m' RED=$'\033[31m' GREEN=$'\033[32m' YELLOW=$'\033[33m' BLUE=$'\033[34m' RESET=$'\033[0m'

step()  { printf '\n%s▸ %s%s\n' "$BOLD$BLUE" "$*" "$RESET"; }
ok()    { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
info()  { printf '  %s%s%s\n' "$DIM" "$*" "$RESET"; }
warn()  { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
fail()  { printf '\n%s✗ %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

# ------------------------------- Options -------------------------------------

APP_ONLY=false
MIGRATE=false
for arg in "$@"; do
  case "$arg" in
    --app-only) APP_ONLY=true ;;
    --migrate)  MIGRATE=true ;;
    -h|--help)  sed -n '3,16p' "$0"; exit 0 ;;
    *) fail "Option inconnue : $arg" ;;
  esac
done

# ------------------------------- Environnement -------------------------------

[[ -f .env ]] || fail "Fichier .env absent. Copie .env.example en .env et complète-le."
set -a; source .env; set +a

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID manquant dans .env}"
: "${GCP_REGION:=europe-west1}"
: "${CLOUD_RUN_SERVICE:=mtl-api}"
: "${ADMIN_EMAIL:?ADMIN_EMAIL manquant dans .env}"
: "${STABLE_DOMAIN:=}"

readonly DEPLOY_VERSION="$(date -u +%Y%m%d-%H%M%S)"

for binary in gcloud node npm; do
  command -v "$binary" >/dev/null 2>&1 || fail "$binary est introuvable dans le PATH."
done

# firebase-tools : binaire global s'il existe, sinon npx. Node étant déjà
# requis, ça évite d'imposer une installation globale de plus.
if command -v firebase >/dev/null 2>&1; then
  firebase() { command firebase "$@"; }
else
  firebase() { npx --yes firebase-tools@13 "$@"; }
fi

printf '%s\n' "$BOLD"
printf '  🍁 Montréal Compagnon — déploiement\n'
printf '%s' "$RESET"
info "projet   : $GCP_PROJECT_ID"
info "région   : $GCP_REGION"
info "version  : $DEPLOY_VERSION"
[[ -n "$STABLE_DOMAIN" ]] && info "domaine  : $STABLE_DOMAIN"

# =============================================================================
# 1. Projet GCP et APIs
# =============================================================================

if [[ "$APP_ONLY" == false ]]; then
  step "Projet Google Cloud"

  if gcloud projects describe "$GCP_PROJECT_ID" >/dev/null 2>&1; then
    ok "projet $GCP_PROJECT_ID déjà présent"
  else
    info "création du projet…"
    gcloud projects create "$GCP_PROJECT_ID" --name="Montreal Compagnon" >/dev/null
    ok "projet créé"

    if [[ -n "${GCP_BILLING_ACCOUNT:-}" ]]; then
      # Sans compte de facturation, Cloud Run et Cloud Build refusent de
      # démarrer — même en restant intégralement dans le Free Tier.
      gcloud billing projects link "$GCP_PROJECT_ID" \
        --billing-account="$GCP_BILLING_ACCOUNT" >/dev/null
      ok "compte de facturation rattaché"
    else
      warn "GCP_BILLING_ACCOUNT non renseigné : rattache la facturation à la main."
    fi
  fi

  gcloud config set project "$GCP_PROJECT_ID" >/dev/null 2>&1

  step "Activation des APIs"
  # Une seule commande : gcloud parallélise, ce qui évite ~3 min d'attente.
  gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com \
    firestore.googleapis.com \
    firebase.googleapis.com \
    firebasehosting.googleapis.com \
    identitytoolkit.googleapis.com \
    storage.googleapis.com \
    secretmanager.googleapis.com \
    --project="$GCP_PROJECT_ID" >/dev/null
  ok "APIs activées"

  # ---------------------------------------------------------------------------
  step "Firebase"

  if firebase projects:list 2>/dev/null | grep -q "$GCP_PROJECT_ID"; then
    ok "projet Firebase déjà rattaché"
  else
    firebase projects:addfirebase "$GCP_PROJECT_ID" >/dev/null
    ok "Firebase activé sur le projet"
  fi

  printf '{\n  "projects": {\n    "default": "%s"\n  }\n}\n' "$GCP_PROJECT_ID" > .firebaserc
  ok ".firebaserc écrit"

  # ---------------------------------------------------------------------------
  step "Base de données Firestore"

  if gcloud firestore databases describe --database='(default)' \
       --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    ok "base Firestore existante"
  else
    # europe-west1 (Belgique) : les principaux lecteurs du journal sont les
    # proches restés en France. Le voyageur, lui, encaisse ~90 ms de latence
    # depuis Montréal — sans conséquence, le cache Firestore local absorbe.
    gcloud firestore databases create \
      --location="$GCP_REGION" \
      --type=firestore-native \
      --project="$GCP_PROJECT_ID" >/dev/null
    ok "base Firestore créée dans $GCP_REGION"
  fi

  # ---------------------------------------------------------------------------
  step "Cloud Storage"

  STORAGE_BUCKET="${GCP_PROJECT_ID}.firebasestorage.app"
  if gcloud storage buckets describe "gs://${STORAGE_BUCKET}" >/dev/null 2>&1; then
    ok "bucket $STORAGE_BUCKET existant"
  else
    gcloud storage buckets create "gs://${STORAGE_BUCKET}" \
      --location="$GCP_REGION" \
      --uniform-bucket-level-access \
      --project="$GCP_PROJECT_ID" >/dev/null
    ok "bucket $STORAGE_BUCKET créé"
  fi

  # Cycle de vie : purge les uploads incomplets qui grignotent le quota.
  cat > /tmp/mtl-lifecycle.json <<'JSON'
{
  "rule": [
    {
      "action": { "type": "AbortIncompleteMultipartUpload" },
      "condition": { "age": 1 }
    }
  ]
}
JSON
  gcloud storage buckets update "gs://${STORAGE_BUCKET}" \
    --lifecycle-file=/tmp/mtl-lifecycle.json >/dev/null 2>&1 || true

  # ---------------------------------------------------------------------------
  step "Secrets"

  if [[ -n "${OPENWEATHER_API_KEY:-}" ]]; then
    if gcloud secrets describe openweather-api-key --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
      printf '%s' "$OPENWEATHER_API_KEY" | \
        gcloud secrets versions add openweather-api-key --data-file=- \
          --project="$GCP_PROJECT_ID" >/dev/null
      ok "clé OpenWeather mise à jour"
    else
      printf '%s' "$OPENWEATHER_API_KEY" | \
        gcloud secrets create openweather-api-key --data-file=- \
          --replication-policy=automatic --project="$GCP_PROJECT_ID" >/dev/null
      ok "clé OpenWeather enregistrée dans Secret Manager"
    fi
  else
    warn "OPENWEATHER_API_KEY absent : le module météo restera indisponible."
  fi
else
  gcloud config set project "$GCP_PROJECT_ID" >/dev/null 2>&1
  STORAGE_BUCKET="${GCP_PROJECT_ID}.firebasestorage.app"
fi

# =============================================================================
# 2. Backend — Cloud Run
# =============================================================================

step "Déploiement de l'API sur Cloud Run"

RUN_ARGS=(
  --source=api
  --region="$GCP_REGION"
  --platform=managed
  --allow-unauthenticated
  --port=8080
  --memory="${CLOUD_RUN_MEMORY:-512Mi}"
  --cpu=1
  --min-instances="${CLOUD_RUN_MIN_INSTANCES:-0}"
  --max-instances="${CLOUD_RUN_MAX_INSTANCES:-3}"
  --timeout=60
  --concurrency=80
  --project="$GCP_PROJECT_ID"
  --quiet
)

ENV_VARS="NODE_ENV=production,APP_VERSION=${DEPLOY_VERSION},STORAGE_BUCKET=${STORAGE_BUCKET}"
[[ -n "$STABLE_DOMAIN" ]] && ENV_VARS="${ENV_VARS},ALLOWED_ORIGINS=https://${STABLE_DOMAIN},https://${GCP_PROJECT_ID}.web.app"
RUN_ARGS+=(--set-env-vars="$ENV_VARS")

if gcloud secrets describe openweather-api-key --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
  RUN_ARGS+=(--set-secrets="OPENWEATHER_API_KEY=openweather-api-key:latest")
fi

gcloud run deploy "$CLOUD_RUN_SERVICE" "${RUN_ARGS[@]}"

RUN_URL="$(gcloud run services describe "$CLOUD_RUN_SERVICE" \
  --region="$GCP_REGION" --project="$GCP_PROJECT_ID" --format='value(status.url)')"
ok "API en ligne : $RUN_URL"

# Le compte de service de Cloud Run doit lire/écrire Firestore et Storage.
if [[ "$APP_ONLY" == false ]]; then
  PROJECT_NUMBER="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"
  RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

  for role in roles/datastore.user roles/storage.objectAdmin roles/firebaseauth.admin; do
    gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
      --member="serviceAccount:${RUN_SA}" --role="$role" \
      --condition=None >/dev/null 2>&1 || true
  done
  ok "droits IAM du service accordés"
fi

# =============================================================================
# 3. Configuration runtime de la PWA
# =============================================================================

step "Génération de config.json"

# La région du service Cloud Run est injectée dans firebase.json : c'est elle
# qui permet au rewrite /api/** de trouver le backend, quel que soit le projet.
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
const config = JSON.parse(readFileSync('firebase.json', 'utf8'));
config.hosting.rewrites[0].run = {
  serviceId: process.env.CLOUD_RUN_SERVICE,
  region: process.env.GCP_REGION,
};
writeFileSync('firebase.json', JSON.stringify(config, null, 2) + '\n');
"
ok "firebase.json pointé sur ${CLOUD_RUN_SERVICE} (${GCP_REGION})"

# Même script que celui utilisé par GitHub Actions : les deux chemins de
# déploiement produisent un config.json strictement identique.
GCP_PROJECT_ID="$GCP_PROJECT_ID" \
DEPLOY_VERSION="$DEPLOY_VERSION" \
TRIP_DEPARTURE_DATE="${TRIP_DEPARTURE_DATE:-2026-10-12}" \
TRIP_RETURN_DATE="${TRIP_RETURN_DATE:-2026-10-26}" \
  node scripts/generate-config.mjs

# =============================================================================
# 4. Frontend — build et Hosting
# =============================================================================

step "Construction de la PWA"

node scripts/generate-icons.mjs >/dev/null
ok "icônes générées"

(cd web && npm ci --silent && npm run build)
ok "bundle construit"

step "Déploiement Firebase Hosting, règles et index"

# --force : autorise la suppression des index absents de firestore.indexes.json,
# qui fait autorité. Sans lui, firebase-tools s'arrête en mode non interactif.
firebase deploy \
  --only hosting,firestore:rules,firestore:indexes,storage \
  --project "$GCP_PROJECT_ID" \
  --non-interactive \
  --force

ok "PWA en ligne : https://${GCP_PROJECT_ID}.web.app"

# =============================================================================
# 5. Contenu initial et rôles
# =============================================================================

if [[ "$APP_ONLY" == false ]]; then
  step "Contenu de référence"

  if [[ ! -d node_modules/firebase-admin ]]; then
    npm install --silent --no-save firebase-admin >/dev/null
  fi

  GOOGLE_CLOUD_PROJECT="$GCP_PROJECT_ID" \
  TRIP_DEPARTURE_DATE="${TRIP_DEPARTURE_DATE:-}" \
  TRIP_RETURN_DATE="${TRIP_RETURN_DATE:-}" \
    node scripts/seed-firestore.mjs

  step "Rôle administrateur"
  if GOOGLE_CLOUD_PROJECT="$GCP_PROJECT_ID" node scripts/set-admin.mjs "$ADMIN_EMAIL" 2>/dev/null; then
    :
  else
    warn "Le compte $ADMIN_EMAIL n'existe pas encore."
    info "Connecte-toi une fois dans l'application, puis lance :"
    info "  GOOGLE_CLOUD_PROJECT=$GCP_PROJECT_ID node scripts/set-admin.mjs $ADMIN_EMAIL"
  fi
fi

# =============================================================================
# 6. Domaine stable — la clé de la migration transparente
# =============================================================================

if [[ -n "$STABLE_DOMAIN" ]]; then
  step "Domaine stable"

  if firebase hosting:sites:list --project "$GCP_PROJECT_ID" 2>/dev/null | grep -q "$STABLE_DOMAIN"; then
    ok "$STABLE_DOMAIN déjà rattaché"
  else
    warn "Rattachement du domaine à faire une fois, dans la console :"
    info "  https://console.firebase.google.com/project/$GCP_PROJECT_ID/hosting/sites"
    info "  → Ajouter un domaine personnalisé → $STABLE_DOMAIN"
    info ""
    info "Chez ton registrar, fais pointer $STABLE_DOMAIN vers les IP fournies"
    info "par Firebase (enregistrements A). À la prochaine migration, seule"
    info "cette étape sera à refaire : l'URL vue par les utilisateurs, elle,"
    info "ne change jamais — donc aucune réinstallation de la PWA."
  fi
fi

# =============================================================================
# 7. Vérification
# =============================================================================

step "Vérification"

if curl -fsS --max-time 30 "${RUN_URL}/api/health" >/dev/null 2>&1; then
  ok "API : /api/health répond"
else
  warn "L'API n'a pas répondu (démarrage à froid ?). Réessaie dans une minute."
fi

if curl -fsS --max-time 15 "https://${GCP_PROJECT_ID}.web.app/config.json" >/dev/null 2>&1; then
  ok "PWA : config.json servi"
else
  warn "config.json pas encore propagé sur le CDN Hosting."
fi

printf '\n%s🍁 Déploiement terminé.%s\n\n' "$BOLD$GREEN" "$RESET"
printf '  Application  : %s\n' "https://${GCP_PROJECT_ID}.web.app"
[[ -n "$STABLE_DOMAIN" ]] && printf '  Domaine      : %s\n' "https://${STABLE_DOMAIN}"
printf '  API          : %s\n' "$RUN_URL"
printf '  Console      : %s\n' "https://console.firebase.google.com/project/${GCP_PROJECT_ID}"
printf '  Version      : %s\n\n' "$DEPLOY_VERSION"

if [[ "$MIGRATE" == true ]]; then
  printf '%s  Migration : pense à repointer le DNS de %s vers ce projet.%s\n' \
    "$YELLOW" "$STABLE_DOMAIN" "$RESET"
  printf '  Les PWA installées récupéreront la nouvelle configuration\n'
  printf '  à leur prochaine ouverture en ligne. Aucune réinstallation.\n\n'
fi
