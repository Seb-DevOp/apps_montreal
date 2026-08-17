variable "project_id" {
  description = "Identifiant du projet GCP. Change à chaque migration trimestrielle."
  type        = string
}

variable "region" {
  description = "Région de toutes les ressources. europe-west1 (Belgique) : proche des lecteurs restés en France, et éligible au Free Tier."
  type        = string
  default     = "europe-west1"
}

variable "allowed_origins" {
  description = "Origines autorisées en CORS sur le bucket média."
  type        = list(string)
  default     = ["https://montreal.mondomaine.fr", "http://localhost:5173"]
}

variable "api_base_url" {
  description = <<-EOT
    URL du service Cloud Run, utilisée par Cloud Scheduler pour appeler l'API.

    Vide tant que le service n'existe pas : la tâche planifiée n'est alors pas
    créée, plutôt que de pointer dans le vide. À renseigner après le premier
    déploiement de l'API.
  EOT
  type        = string
  default     = ""
}

variable "media_bucket_location" {
  description = <<-EOT
    Région du bucket photos, volontairement dissociée de var.region.

    Firebase Storage provisionne son bucket par défaut aux États-Unis, et le
    stockage y est sensiblement moins cher qu'en Europe. Choix assumé : les
    photos restent en US-EAST1, tout le reste (Firestore, Cloud Run, Artifact
    Registry) demeure en europe-west1, au plus près des lecteurs.

    La région d'un bucket est immuable : la changer ici détruirait et
    recréerait le bucket, donc les photos avec.
  EOT
  type        = string
  default     = "us-east1"
}

variable "force_destroy_media" {
  description = "Autorise la suppression du bucket de photos même s'il n'est pas vide. Passé à vrai par le workflow de destruction, après confirmation."
  type        = bool
  default     = false
}

variable "openweather_api_key" {
  description = "Clé OpenWeatherMap. Laisser vide pour créer le secret sans version."
  type        = string
  default     = ""
  sensitive   = true
}
