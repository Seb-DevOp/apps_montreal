#!/usr/bin/env bash
#
# =============================================================================
# Bootstrap CI — la seule étape qui doit tourner depuis ta machine.
#
#   ./scripts/bootstrap-ci.sh
#
# Pourquoi ce n'est pas dans GitHub Actions : sur un compte Google personnel
# (sans organisation), la création d'un projet GCP n'est autorisée qu'à un
# compte UTILISATEUR. Un service account, même Owner ailleurs, n'a pas le
# droit `resourcemanager.projects.create`. La CI ne peut donc pas s'auto-
# amorcer — mais elle peut ensuite tout gérer, y compris SUPPRIMER le projet.
#
# Ce que fait le script :
#   1. crée le projet GCP et y rattache la facturation
#   2. active les APIs strictement nécessaires au bootstrap
#   3. crée le bucket d'état Terraform
#   4. crée le service account de CI et lui donne ses droits
#   5. configure Workload Identity Federation (CI sans clé de longue durée)
#   6. affiche les secrets et variables à coller dans GitHub
#
# À relancer tel quel à chaque migration trimestrielle, avec un nouveau
# GCP_PROJECT_ID dans .env.
# =============================================================================

set -euo pipefail

# Sous Git Bash, le lanceur `gcloud` du SDK est le script POSIX prévu pour
# Linux/macOS : il fait `exec python`, or aucun `python` n'est dans le PATH
# MSYS. Le SDK embarque le sien — on le désigne, en chemin POSIX.
#
# Ne PAS désactiver la conversion d'arguments de MSYS (MSYS_NO_PATHCONV,
# MSYS2_ARG_CONV_EXCL) : c'est elle qui traduit le chemin interne passé à
# python.exe. Elle est par ailleurs inoffensive sur nos arguments — vérifié,
# « roles/owner » arrive intact, MSYS ne convertissant que ce qui commence par
# une barre oblique. Le lanceur `gcloud.cmd` a été essayé et écarté : cmd.exe
# casse les arguments contenant un espace, comme --name="Montreal Compagnon".
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

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

readonly BOLD=$'\033[1m' DIM=$'\033[2m' RED=$'\033[31m' GREEN=$'\033[32m' YELLOW=$'\033[33m' BLUE=$'\033[34m' RESET=$'\033[0m'
step()  { printf '\n%s▸ %s%s\n' "$BOLD$BLUE" "$*" "$RESET"; }
ok()    { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
info()  { printf '  %s%s%s\n' "$DIM" "$*" "$RESET"; }
warn()  { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
fail()  { printf '\n%s✗ %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

# ------------------------------- Options -------------------------------------

USE_SA_KEY=false
for arg in "$@"; do
  case "$arg" in
    # Repli si l'organisation GitHub interdit OIDC, ou pour un dépôt privé
    # sur un plan qui ne l'expose pas.
    --sa-key) USE_SA_KEY=true ;;
    -h|--help) sed -n '3,25p' "$0"; exit 0 ;;
    *) fail "Option inconnue : $arg" ;;
  esac
done

# ------------------------------- Environnement -------------------------------

[[ -f .env ]] || fail "Fichier .env absent. Copie .env.example en .env et complète-le."
set -a; source .env; set +a

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID manquant dans .env}"
: "${GCP_REGION:=europe-west1}"

# Le dépôt se déduit du remote git : une faute de frappe ici verrouillerait la
# condition d'attribut WIF sur le mauvais nom, et la CI échouerait plus tard
# avec un message d'autorisation incompréhensible.
if [[ -z "${GITHUB_REPOSITORY:-}" ]]; then
  origin="$(git remote get-url origin 2>/dev/null || true)"
  GITHUB_REPOSITORY="$(sed -E 's#^.*github\.com[:/]##; s#\.git$##' <<<"$origin")"
  [[ -n "$GITHUB_REPOSITORY" ]] \
    || fail "GITHUB_REPOSITORY absent de .env et remote git « origin » introuvable."
  info "dépôt déduit du remote git : $GITHUB_REPOSITORY"
fi

[[ "$GITHUB_REPOSITORY" == */* ]] \
  || fail "GITHUB_REPOSITORY doit être au format proprietaire/depot (reçu : $GITHUB_REPOSITORY)"

# firebase-tools : binaire global s'il existe, sinon npx. Node étant déjà
# requis, ça évite d'imposer une installation globale de plus.
if command -v firebase >/dev/null 2>&1; then
  firebase() { command firebase "$@"; }
else
  firebase() { npx --yes firebase-tools@13 "$@"; }
fi

readonly CI_SA_NAME="mtl-ci"
readonly CI_SA_EMAIL="${CI_SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
readonly STATE_BUCKET="${GCP_PROJECT_ID}-tfstate"
readonly WIF_POOL="github"
readonly WIF_PROVIDER="github-oidc"

command -v gcloud >/dev/null || fail $'gcloud est introuvable.\n  Installe le SDK Google Cloud : https://cloud.google.com/sdk/docs/install\n  Sur Windows : winget install --id Google.CloudSDK -e'
command -v node >/dev/null || fail "node est introuvable (requis pour firebase-tools)."
command -v curl >/dev/null || fail "curl est introuvable (fourni par Git for Windows)."

# Un jeton périmé ou un compte supprimé produisent plus loin des erreurs
# obscures : autant le détecter tout de suite.
gcloud auth print-access-token >/dev/null 2>&1 \
  || fail $'Aucune session gcloud valide.\n  gcloud auth login\n  gcloud auth application-default login'

printf '%s\n  🍁 Bootstrap CI — Montréal Compagnon%s\n' "$BOLD" "$RESET"
info "projet : $GCP_PROJECT_ID"
info "dépôt  : $GITHUB_REPOSITORY"
info "auth   : $([[ "$USE_SA_KEY" == true ]] && echo 'clé de service' || echo 'Workload Identity Federation')"

# =============================================================================
# 1. Projet
# =============================================================================

step "Projet Google Cloud"

if gcloud projects describe "$GCP_PROJECT_ID" >/dev/null 2>&1; then
  ok "projet déjà présent"
else
  gcloud projects create "$GCP_PROJECT_ID" --name="Montreal Compagnon" >/dev/null
  ok "projet créé"
fi

if [[ -n "${GCP_BILLING_ACCOUNT:-}" ]]; then
  gcloud billing projects link "$GCP_PROJECT_ID" \
    --billing-account="$GCP_BILLING_ACCOUNT" >/dev/null 2>&1 || true
  ok "facturation rattachée"
else
  warn "GCP_BILLING_ACCOUNT vide : Cloud Run et Artifact Registry refuseront de démarrer."
  info "Récupère l'identifiant avec : gcloud billing accounts list"
fi

gcloud config set project "$GCP_PROJECT_ID" >/dev/null 2>&1

# =============================================================================
# 2. APIs de bootstrap
#
# Le reste (Firestore, Cloud Run, Storage, Secret Manager…) est activé par
# Terraform. On n'active ici que ce dont le bootstrap lui-même a besoin.
# =============================================================================

step "APIs de bootstrap"

gcloud services enable \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  storage.googleapis.com \
  firebase.googleapis.com \
  --project="$GCP_PROJECT_ID" >/dev/null
ok "APIs activées"

# =============================================================================
# 3. Firebase
# =============================================================================

step "Firebase"

# On passe par l'API REST plutôt que par firebase-tools : le jeton gcloud
# suffit, ce qui évite d'imposer un `firebase login` séparé au bootstrap.
# Le CLI reste le repli si l'appel REST échoue.
fb_token="$(gcloud auth print-access-token 2>/dev/null || true)"

# Un jeton d'utilisateur (par opposition à un compte de service) n'est rattaché
# à aucun projet : l'API Firebase exige alors qu'on désigne explicitement celui
# à facturer, via l'en-tête x-goog-user-project. Sans lui, elle répond
# « requires a quota project ».
fb_headers=(-H "Authorization: Bearer ${fb_token}" -H "x-goog-user-project: ${GCP_PROJECT_ID}")

if [[ -n "$fb_token" ]] && curl -sf "${fb_headers[@]}" \
     "https://firebase.googleapis.com/v1beta1/projects/${GCP_PROJECT_ID}" >/dev/null 2>&1; then
  ok "projet Firebase déjà rattaché"
else
  fb_response="$(curl -s -X POST "${fb_headers[@]}" \
    -H "Content-Type: application/json" \
    -d '{}' \
    "https://firebase.googleapis.com/v1beta1/projects/${GCP_PROJECT_ID}:addFirebase" 2>/dev/null || true)"

  if grep -q '"error"' <<<"${fb_response:-}"; then
    if firebase projects:addfirebase "$GCP_PROJECT_ID" >/dev/null 2>&1; then
      ok "Firebase activé (via firebase-tools)"
    else
      warn "Rattachement Firebase impossible."
      info "  détail : $(grep -o '"message"[^,]*' <<<"$fb_response" | head -1)"
      info ""
      # Un 403 alors que le compte est déjà Owner du projet ne vient pas des
      # droits IAM : l'API Firebase refuse tant que le compte Google n'a pas
      # accepté ses conditions d'utilisation. C'est une action unique, valable
      # ensuite pour tous les projets — les migrations suivantes ne la
      # redemanderont pas.
      info "  Si le message est « The caller does not have permission » alors que"
      info "  tu es Owner du projet, il s'agit des conditions Firebase, jamais"
      info "  acceptées par ce compte Google. Une seule fois, au choix :"
      info "    • https://console.firebase.google.com/ → Ajouter un projet → $GCP_PROJECT_ID"
      info "    • npx firebase-tools login   puis relancer ce script"
    fi
  else
    ok "Firebase activé"
  fi
fi

printf '{\n  "projects": {\n    "default": "%s"\n  }\n}\n' "$GCP_PROJECT_ID" > .firebaserc
ok ".firebaserc écrit"

# =============================================================================
# 4. Bucket d'état Terraform
#
# Volontairement HORS Terraform : un état qui se détruit lui-même au `destroy`
# est ingérable. Le versioning permet de rattraper un apply malheureux.
# =============================================================================

step "État Terraform"

if gcloud storage buckets describe "gs://${STATE_BUCKET}" >/dev/null 2>&1; then
  ok "bucket $STATE_BUCKET existant"
else
  gcloud storage buckets create "gs://${STATE_BUCKET}" \
    --location="$GCP_REGION" \
    --uniform-bucket-level-access \
    --project="$GCP_PROJECT_ID" >/dev/null
  gcloud storage buckets update "gs://${STATE_BUCKET}" --versioning >/dev/null
  ok "bucket $STATE_BUCKET créé (versionné)"
fi

# =============================================================================
# 5. Service account de CI
# =============================================================================

step "Compte de service CI"

if gcloud iam service-accounts describe "$CI_SA_EMAIL" \
     --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
  ok "compte $CI_SA_NAME existant"
else
  gcloud iam service-accounts create "$CI_SA_NAME" \
    --display-name="GitHub Actions — Montréal Compagnon" \
    --project="$GCP_PROJECT_ID" >/dev/null
  ok "compte $CI_SA_NAME créé"
fi

# roles/owner assumé et documenté : ce projet est jetable et ne contient que
# cette application. Le workflow « nuke » doit pouvoir supprimer le projet, ce
# qui exige resourcemanager.projects.delete — permission présente uniquement
# dans Owner. Découper en dix rôles ne protégerait rien de plus ici, puisque
# la CI doit de toute façon pouvoir tout créer et tout détruire.
gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
  --member="serviceAccount:${CI_SA_EMAIL}" \
  --role="roles/owner" \
  --condition=None >/dev/null
ok "rôle Owner accordé sur $GCP_PROJECT_ID (et sur lui seul)"

# =============================================================================
# 6. Authentification GitHub → GCP
# =============================================================================

if [[ "$USE_SA_KEY" == true ]]; then
  step "Clé de service (repli)"

  KEY_FILE="$(mktemp -t mtl-ci-key.XXXXXX.json)"
  gcloud iam service-accounts keys create "$KEY_FILE" \
    --iam-account="$CI_SA_EMAIL" --project="$GCP_PROJECT_ID" >/dev/null
  SA_KEY_JSON="$(cat "$KEY_FILE")"
  rm -f "$KEY_FILE"
  ok "clé générée (affichée plus bas, jamais écrite sur disque)"
else
  step "Workload Identity Federation"

  PROJECT_NUMBER="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"

  if gcloud iam workload-identity-pools describe "$WIF_POOL" \
       --location=global --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    ok "pool $WIF_POOL existant"
  else
    gcloud iam workload-identity-pools create "$WIF_POOL" \
      --location=global --display-name="GitHub Actions" \
      --project="$GCP_PROJECT_ID" >/dev/null
    ok "pool $WIF_POOL créé"
  fi

  if gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" \
       --location=global --workload-identity-pool="$WIF_POOL" \
       --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    ok "provider $WIF_PROVIDER existant"
  else
    # attribute-condition est OBLIGATOIRE depuis 2023 : sans elle, n'importe
    # quel dépôt GitHub du monde pourrait présenter un jeton et prendre
    # l'identité de ce service account.
    gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" \
      --location=global \
      --workload-identity-pool="$WIF_POOL" \
      --display-name="GitHub OIDC" \
      --issuer-uri="https://token.actions.githubusercontent.com" \
      --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
      --attribute-condition="assertion.repository == '${GITHUB_REPOSITORY}'" \
      --project="$GCP_PROJECT_ID" >/dev/null
    ok "provider $WIF_PROVIDER créé, restreint à $GITHUB_REPOSITORY"
  fi

  gcloud iam service-accounts add-iam-policy-binding "$CI_SA_EMAIL" \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/attribute.repository/${GITHUB_REPOSITORY}" \
    --project="$GCP_PROJECT_ID" >/dev/null
  ok "dépôt $GITHUB_REPOSITORY autorisé à emprunter $CI_SA_NAME"

  WIF_PROVIDER_PATH="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}"
fi

# =============================================================================
# 7. Récapitulatif
# =============================================================================

printf '\n%s═══ À configurer dans GitHub ═══%s\n' "$BOLD$GREEN" "$RESET"
printf '\n%sSettings → Secrets and variables → Actions%s\n' "$DIM" "$RESET"

printf '\n%s▸ Onglet « Variables » (valeurs non sensibles)%s\n' "$BOLD" "$RESET"
printf '  %-24s %s\n' 'GCP_PROJECT_ID'      "$GCP_PROJECT_ID"
printf '  %-24s %s\n' 'GCP_REGION'          "$GCP_REGION"
printf '  %-24s %s\n' 'CLOUD_RUN_SERVICE'   "${CLOUD_RUN_SERVICE:-mtl-api}"
printf '  %-24s %s\n' 'ADMIN_EMAIL'         "${ADMIN_EMAIL:-}"
printf '  %-24s %s\n' 'TRIP_DEPARTURE_DATE' "${TRIP_DEPARTURE_DATE:-2026-10-12}"
printf '  %-24s %s\n' 'TRIP_RETURN_DATE'    "${TRIP_RETURN_DATE:-2026-10-26}"
printf '  %-24s %s\n' 'STABLE_DOMAIN'       "${STABLE_DOMAIN:-}"
printf '  %-24s %s\n' 'TF_STATE_BUCKET'     "$STATE_BUCKET"

printf '\n%s▸ Onglet « Secrets »%s\n' "$BOLD" "$RESET"
if [[ "$USE_SA_KEY" == true ]]; then
  printf '  %-24s (le JSON ci-dessous, en entier)\n' 'GCP_SA_KEY'
  printf '\n%s%s%s\n' "$DIM" "$SA_KEY_JSON" "$RESET"
else
  printf '  %-24s %s\n' 'GCP_WIF_PROVIDER' "$WIF_PROVIDER_PATH"
  printf '  %-24s %s\n' 'GCP_SERVICE_ACCOUNT' "$CI_SA_EMAIL"
fi
printf '  %-24s %s\n' 'OPENWEATHER_API_KEY' "${OPENWEATHER_API_KEY:+(celle de ton .env)}"

printf '\n%sEn une commande (nécessite la CLI gh) :%s\n' "$DIM" "$RESET"
cat <<EOF

  gh variable set GCP_PROJECT_ID      --body "$GCP_PROJECT_ID"
  gh variable set GCP_REGION          --body "$GCP_REGION"
  gh variable set CLOUD_RUN_SERVICE   --body "${CLOUD_RUN_SERVICE:-mtl-api}"
  gh variable set ADMIN_EMAIL         --body "${ADMIN_EMAIL:-}"
  gh variable set TRIP_DEPARTURE_DATE --body "${TRIP_DEPARTURE_DATE:-2026-10-12}"
  gh variable set TRIP_RETURN_DATE    --body "${TRIP_RETURN_DATE:-2026-10-26}"
  gh variable set STABLE_DOMAIN       --body "${STABLE_DOMAIN:-}"
  gh variable set TF_STATE_BUCKET     --body "$STATE_BUCKET"
EOF

if [[ "$USE_SA_KEY" == true ]]; then
  printf '  gh secret set GCP_SA_KEY < cle.json\n'
else
  cat <<EOF
  gh secret   set GCP_WIF_PROVIDER    --body "$WIF_PROVIDER_PATH"
  gh secret   set GCP_SERVICE_ACCOUNT --body "$CI_SA_EMAIL"
EOF
fi
printf '  gh secret   set OPENWEATHER_API_KEY --body "…"\n'

printf '\n%sEnsuite :%s\n' "$BOLD" "$RESET"
printf '  1. Actions → « Infrastructure » → Run workflow → action: %sapply%s\n' "$BOLD" "$RESET"
printf '  2. Actions → « Déploiement » → Run workflow (ou pousse sur main)\n'
printf '  3. Connecte-toi une fois dans l'"'"'app, puis relance « Déploiement »\n'
printf '     pour que %s reçoive le rôle admin\n\n' "${ADMIN_EMAIL:-ton compte}"
