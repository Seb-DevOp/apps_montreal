# =============================================================================
# API Montréal Compagnon — image Cloud Run
# Multi-stage : build TypeScript puis runtime distroless-like sur node:alpine.
# Aucune clé n'est copiée dans l'image : Cloud Run fournit l'identité via ADC
# (Application Default Credentials) et les secrets via Secret Manager.
# =============================================================================

# ---------- Stage 1 : dépendances de build ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- Stage 2 : dépendances de production seules ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------- Stage 3 : runtime ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
# Cloud Run injecte PORT ; 8080 reste le défaut local.
ENV PORT=8080
WORKDIR /app

# Utilisateur non-root (l'image node fournit déjà `node`, uid 1000)
COPY --from=deps  --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

USER node
EXPOSE 8080

# dumb-init n'est pas nécessaire : Node 22 gère SIGTERM, et l'app ferme
# proprement Fastify sur signal (voir src/index.ts).
CMD ["node", "dist/index.js"]
