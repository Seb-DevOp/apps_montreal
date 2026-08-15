#!/usr/bin/env node
/**
 * Génère `web/public/config.json` — la configuration runtime de la PWA.
 *
 * Ce fichier est le pivot de la migration trimestrielle : il porte l'identité
 * du projet Firebase courant, et il est le SEUL endroit où elle apparaît.
 * Aucun identifiant n'est compilé dans le bundle JavaScript.
 *
 * Passe par l'API REST Firebase Management avec un jeton gcloud, plutôt que
 * par firebase-tools. Deux raisons :
 *   - firebase-tools s'authentifie mal via des identifiants de fédération
 *     d'identité (external_account), ce qui casse la CI ;
 *   - c'est le fichier le plus critique du dispositif, autant lui donner le
 *     chemin le plus court et le plus explicite.
 *
 * Usage :
 *   GCP_PROJECT_ID=mon-projet node scripts/generate-config.mjs
 *
 * Variables lues :
 *   GCP_PROJECT_ID        (requis) projet Firebase/GCP
 *   DEPLOY_VERSION        version affichée dans l'app (défaut : horodatage)
 *   TRIP_DEPARTURE_DATE   date de départ, AAAA-MM-JJ
 *   TRIP_RETURN_DATE      date de retour, AAAA-MM-JJ
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://firebase.googleapis.com/v1beta1';
const APP_NAME = 'mtl-pwa';

const projectId = process.env.GCP_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) {
  console.error('GCP_PROJECT_ID est requis.');
  process.exit(1);
}

// AAAAMMJJHHMMSS — 14 caractères, sans les millisecondes.
const version =
  process.env.DEPLOY_VERSION ?? new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

// ---------------------------------------------------------------------------
// Jeton d'accès
// ---------------------------------------------------------------------------

/** Chemins d'installation du SDK sous Windows, si gcloud n'est pas dans le PATH. */
function gcloudCommand() {
  const candidates =
    process.platform === 'win32'
      ? [
          `${process.env.LOCALAPPDATA ?? ''}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd`,
          `${process.env.ProgramFiles ?? ''}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd`,
        ]
      : [];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
}

function accessToken() {
  const command = gcloudCommand();
  // Sous Windows, exécuter un `.cmd` impose de passer par le shell, lequel
  // découpe la ligne sur les espaces : « C:\…\Cloud SDK\… » serait tronqué à
  // « C:\…\Cloud ». D'où les guillemets explicites.
  const needsShell = process.platform === 'win32';
  const file = needsShell && command.includes(' ') ? `"${command}"` : command;

  try {
    return execFileSync(file, ['auth', 'print-access-token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: needsShell,
    }).trim();
  } catch (error) {
    console.error("Impossible d'obtenir un jeton d'accès Google Cloud.");
    console.error(`  commande : ${file}`);
    console.error(`  détail   : ${(error.stderr ?? error.message ?? '').toString().trim().slice(0, 300)}`);
    console.error('  gcloud auth login           (poste local)');
    console.error("  ou vérifier l'étape d'authentification du workflow (CI)");
    process.exit(1);
  }
}

const token = accessToken();

/**
 * Un jeton d'utilisateur n'étant rattaché à aucun projet, l'API Firebase exige
 * qu'on désigne celui à facturer. Inoffensif avec un compte de service.
 */
async function firebaseApi(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'x-goog-user-project': projectId,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(20000),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`${options.method ?? 'GET'} ${path} → ${message}`);
  }
  return body;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 1. Vérifier que le projet est bien un projet Firebase
// ---------------------------------------------------------------------------

try {
  await firebaseApi(`/projects/${projectId}`);
} catch (error) {
  console.error(`Le projet « ${projectId} » n'est pas rattaché à Firebase.`);
  console.error(`  détail : ${error.message}`);
  console.error('');
  console.error('  Rattache-le depuis https://console.firebase.google.com/');
  console.error('  (« Ajouter un projet » puis sélectionner un projet existant),');
  console.error('  ou relance scripts/bootstrap-ci.sh une fois les CGU acceptées.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Trouver ou créer l'application web
// ---------------------------------------------------------------------------

async function findWebApp() {
  const { apps = [] } = await firebaseApi(`/projects/${projectId}/webApps`);
  return apps.find((app) => app.displayName === APP_NAME) ?? apps[0] ?? null;
}

let webApp = await findWebApp();

if (!webApp) {
  console.log(`Création de l'application web Firebase « ${APP_NAME} »…`);
  await firebaseApi(`/projects/${projectId}/webApps`, {
    method: 'POST',
    body: JSON.stringify({ displayName: APP_NAME }),
  });

  // La création est une opération asynchrone : on attend qu'elle apparaisse.
  for (let attempt = 1; attempt <= 10 && !webApp; attempt += 1) {
    await sleep(3000);
    webApp = await findWebApp();
  }

  if (!webApp) {
    console.error("L'application web n'est pas apparue après création.");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 3. Récupérer la configuration SDK
// ---------------------------------------------------------------------------

const sdk = await firebaseApi(`/${webApp.name}/config`);

if (!sdk.apiKey || !sdk.projectId) {
  console.error('Configuration SDK Firebase incomplète :', JSON.stringify(sdk, null, 2));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 4. Écrire config.json
// ---------------------------------------------------------------------------

const config = {
  version,
  deployedAt: new Date().toISOString(),
  // Chemin relatif : Firebase Hosting réécrit /api/** vers Cloud Run côté
  // serveur. La PWA n'a donc jamais connaissance de l'URL *.run.app, qui
  // change à chaque migration de projet.
  apiBaseUrl: '/api',
  firebase: {
    apiKey: sdk.apiKey,
    authDomain: sdk.authDomain ?? `${projectId}.firebaseapp.com`,
    projectId: sdk.projectId,
    storageBucket: sdk.storageBucket ?? `${projectId}.firebasestorage.app`,
    messagingSenderId: sdk.messagingSenderId ?? '',
    appId: sdk.appId,
  },
  trip: {
    name: 'Montréal',
    departureDate: process.env.TRIP_DEPARTURE_DATE || '2026-10-12',
    returnDate: process.env.TRIP_RETURN_DATE || '2026-10-26',
    homeTimeZone: 'Europe/Paris',
    tripTimeZone: 'America/Montreal',
  },
};

mkdirSync(join(ROOT, 'web', 'public'), { recursive: true });
writeFileSync(join(ROOT, 'web', 'public', 'config.json'), `${JSON.stringify(config, null, 2)}\n`);

console.log(`✓ web/public/config.json — projet ${config.firebase.projectId}, version ${version}`);
