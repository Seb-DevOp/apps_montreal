output "project_id" {
  description = "Projet GCP provisionné."
  value       = var.project_id
}

output "storage_bucket" {
  description = "Bucket des photos du journal."
  value       = google_storage_bucket.media.name
}

output "firestore_location" {
  description = "Région de la base Firestore."
  value       = google_firestore_database.default.location_id
}

output "run_service_account" {
  description = "Compte de service utilisé par Cloud Run."
  value       = local.run_service_account
}

output "next_steps" {
  description = "Ce qu'il reste à faire après le apply."
  value       = <<-EOT
    1. ./deploy.sh --app-only        déploie l'API et la PWA
    2. make seed                     injecte spots, lexique et check-list
    3. make admin                    donne le rôle admin à ADMIN_EMAIL
    4. Console Firebase → Hosting    rattache le domaine stable
  EOT
}
