# =============================================================================
# Infrastructure Montréal Compagnon — alternative déclarative à deploy.sh.
#
# Périmètre volontairement limité : Terraform gère ce qui doit être reproduit
# à l'identique à chaque migration trimestrielle (APIs, base, bucket, IAM,
# secrets). Le déploiement du CODE reste à `deploy.sh` / Cloud Build, car
# gérer une révision Cloud Run dans un état Terraform crée plus de frictions
# qu'il n'en résout sur un projet éphémère.
#
#   terraform init
#   terraform apply -var="project_id=mtl-compagnon-2026q1"
# =============================================================================

terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Configuration partielle : le bucket est fourni à `terraform init` par
  # -backend-config, car il change à chaque migration trimestrielle et n'a donc
  # rien à faire en dur dans le code.
  #
  #   terraform init \
  #     -backend-config="bucket=<projet>-tfstate" \
  #     -backend-config="prefix=montreal-compagnon"
  #
  # Le bucket est créé par scripts/bootstrap-ci.sh et volontairement laissé
  # HORS Terraform : un état qui se détruirait lui-même au `destroy` serait
  # ingérable.
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# -----------------------------------------------------------------------------
# APIs
# -----------------------------------------------------------------------------

locals {
  services = [
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "firestore.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "identitytoolkit.googleapis.com",
    "storage.googleapis.com",
    "secretmanager.googleapis.com",
  ]
}

resource "google_project_service" "enabled" {
  for_each = toset(local.services)

  service = each.value
  project = var.project_id

  # Ne pas désactiver l'API à la destruction : cela couperait d'autres
  # ressources du projet en cours de suppression et fait échouer le destroy.
  disable_on_destroy = false
}

# -----------------------------------------------------------------------------
# Firestore
# -----------------------------------------------------------------------------

resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  # Point-in-time recovery : hors Free Tier, désactivé par défaut.
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_DISABLED"
  delete_protection_state           = "DELETE_PROTECTION_DISABLED"

  depends_on = [google_project_service.enabled]
}

# -----------------------------------------------------------------------------
# Cloud Storage — photos du journal
# -----------------------------------------------------------------------------

resource "google_storage_bucket" "media" {
  name     = "${var.project_id}.firebasestorage.app"
  project  = var.project_id
  location = var.region

  # Faux par défaut : Terraform refuse alors de détruire un bucket contenant
  # encore des photos. Le workflow « Infrastructure → destroy » le passe à vrai
  # seulement après confirmation explicite du nom du projet.
  force_destroy = var.force_destroy_media

  uniform_bucket_level_access = true

  # Les photos sont servies par des URL de téléchargement Firebase ; aucun
  # accès public direct n'est nécessaire.
  public_access_prevention = "enforced"

  cors {
    origin          = var.allowed_origins
    method          = ["GET", "HEAD", "PUT", "POST"]
    response_header = ["Content-Type", "Authorization", "Content-Length"]
    max_age_seconds = 3600
  }

  lifecycle_rule {
    action { type = "AbortIncompleteMultipartUpload" }
    condition { age = 1 }
  }

  depends_on = [google_project_service.enabled]
}

# -----------------------------------------------------------------------------
# Artifact Registry — images de l'API
# -----------------------------------------------------------------------------

resource "google_artifact_registry_repository" "mtl" {
  project       = var.project_id
  location      = var.region
  repository_id = "mtl"
  format        = "DOCKER"
  description   = "Images de l'API Montréal Compagnon"

  # Le Free Tier offre 0,5 Go : sans nettoyage, une image de 150 Mo poussée à
  # chaque commit sature le quota en une dizaine de déploiements.
  cleanup_policies {
    id     = "garder-les-5-dernieres"
    action = "KEEP"

    most_recent_versions {
      keep_count = 5
    }
  }

  cleanup_policies {
    id     = "supprimer-les-anciennes"
    action = "DELETE"

    condition {
      older_than = "2592000s" # 30 jours
    }
  }

  depends_on = [google_project_service.enabled]
}

# -----------------------------------------------------------------------------
# Secrets
# -----------------------------------------------------------------------------

resource "google_secret_manager_secret" "openweather" {
  project   = var.project_id
  secret_id = "openweather-api-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_version" "openweather" {
  count = var.openweather_api_key == "" ? 0 : 1

  secret      = google_secret_manager_secret.openweather.id
  secret_data = var.openweather_api_key
}

# -----------------------------------------------------------------------------
# IAM du service Cloud Run
# -----------------------------------------------------------------------------

data "google_project" "current" {
  project_id = var.project_id
}

locals {
  # Compte de service par défaut de Cloud Run. Pour un projet de plus grande
  # ampleur, on créerait un compte dédié au moindre privilège.
  run_service_account = "${data.google_project.current.number}-compute@developer.gserviceaccount.com"

  run_roles = [
    "roles/datastore.user",
    "roles/storage.objectAdmin",
    "roles/firebaseauth.admin",
    "roles/secretmanager.secretAccessor",
  ]
}

resource "google_project_iam_member" "run" {
  for_each = toset(local.run_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${local.run_service_account}"
}
