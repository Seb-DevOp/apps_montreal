# =============================================================================
# Montréal Compagnon — raccourcis de développement (macOS / Linux).
#
# Windows n'a pas `make` : chaque cible a un équivalent `npm run` déclaré dans
# package.json (bootstrap, deploy, seed, admin, typecheck, build…). Les deux
# chemins appellent les mêmes scripts — aucune logique n'est dupliquée.
# =============================================================================

SHELL := /bin/bash
-include .env
export

.DEFAULT_GOAL := help

.PHONY: help
help: ## Affiche cette aide
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ------------------------------ Installation ---------------------------------

.PHONY: install
install: ## Installe les dépendances (web + api) et génère les icônes
	cd web && npm install
	cd api && npm install
	node scripts/generate-icons.mjs

# ------------------------------ Développement --------------------------------

.PHONY: dev
dev: ## Lance l'API et la PWA en parallèle
	@trap 'kill 0' EXIT; \
	(cd api && npm run dev) & \
	(cd web && npm run dev) & \
	wait

.PHONY: dev-api
dev-api: ## API seule (http://localhost:8080)
	cd api && npm run dev

.PHONY: dev-web
dev-web: ## PWA seule (http://localhost:5173)
	cd web && npm run dev

.PHONY: emulators
emulators: ## Émulateurs Firebase (Auth, Firestore, Storage)
	firebase emulators:start --only auth,firestore,storage

# ------------------------------ Qualité --------------------------------------

.PHONY: check
check: ## Vérification TypeScript des deux projets
	cd api && npm run typecheck
	cd web && npm run typecheck

.PHONY: build
build: ## Build de production complet
	node scripts/generate-icons.mjs
	cd api && npm run build
	cd web && npm run build

.PHONY: preview
preview: build ## Sert le build de production localement
	cd web && npm run preview

# ------------------------------ CI / Infrastructure --------------------------

.PHONY: bootstrap
bootstrap: ## Amorce le projet GCP et la CI (à lancer en local, une fois par projet)
	./scripts/bootstrap-ci.sh

.PHONY: tf-init
tf-init: ## Initialise Terraform sur le bucket d'état du projet courant
	cd infra/terraform && terraform init \
		-backend-config="bucket=$(GCP_PROJECT_ID)-tfstate" \
		-backend-config="prefix=montreal-compagnon"

.PHONY: tf-plan
tf-plan: ## Aperçu des changements d'infrastructure
	cd infra/terraform && TF_VAR_project_id=$(GCP_PROJECT_ID) \
		TF_VAR_region=$(GCP_REGION) \
		TF_VAR_openweather_api_key=$(OPENWEATHER_API_KEY) \
		terraform plan

# ------------------------------ Déploiement ----------------------------------

.PHONY: deploy
deploy: ## Déploiement complet en local (infra + code, alternative à la CI)
	./deploy.sh

.PHONY: deploy-app
deploy-app: ## Redéploie uniquement le code
	./deploy.sh --app-only

.PHONY: migrate
migrate: ## Bascule vers un nouveau projet GCP (à faire tous les 3 mois)
	./deploy.sh --migrate

.PHONY: rules
rules: ## Déploie seulement les règles de sécurité
	firebase deploy --only firestore:rules,storage --project $(GCP_PROJECT_ID)

.PHONY: seed
seed: ## Réinjecte le contenu de référence (spots, lexique, check-list)
	GOOGLE_CLOUD_PROJECT=$(GCP_PROJECT_ID) node scripts/seed-firestore.mjs

.PHONY: admin
admin: ## Donne le rôle admin à ADMIN_EMAIL
	GOOGLE_CLOUD_PROJECT=$(GCP_PROJECT_ID) node scripts/set-admin.mjs $(ADMIN_EMAIL)

# ------------------------------ Exploitation ---------------------------------

.PHONY: logs
logs: ## Journaux Cloud Run en direct
	gcloud beta run services logs tail $(CLOUD_RUN_SERVICE) \
		--region=$(GCP_REGION) --project=$(GCP_PROJECT_ID)

.PHONY: usage
usage: ## Consommation des quotas Free Tier
	@gcloud storage du -s gs://$(GCP_PROJECT_ID).firebasestorage.app 2>/dev/null \
		|| echo "bucket introuvable"

.PHONY: clean
clean: ## Supprime les artefacts de build
	rm -rf web/dist web/node_modules web/dev-dist api/dist api/node_modules node_modules
