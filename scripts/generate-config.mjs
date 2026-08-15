#!/usr/bin/env node
/**
 * Génère `web/public/config.json` — la configuration runtime de la PWA.
 *
 * Ce fichier est le pivot de la migration trimestrielle : il porte l'identité
 * du projet Firebase courant, et il est le SEUL endroit où elle apparaît.
 * Aucun identifiant n'est compilé dans le bundle JavaScript.
 *
 * Partagé entre `deploy.sh` et le workflow GitHub Actions pour que les deux
 * chemins produisent exactement le même fichier.
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
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const projectId = process.env.GCP_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) {
  console.error('GCP_PROJECT_ID est requis.');
  process.exit(1);
}

const version =
  process.env.DEPLOY_VERSION ?? new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);

/** Exécute firebase-tools et renvoie stdout. `npx` évite une install globale. */
function firebase(args) {
  return execFileSync('npx', ['--yes', 'firebase-tools@13', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    // Sur Windows, npx est un .cmd : sans shell, spawn échoue.
    shell: process.platform === 'win32',
  });
}

// ---------------------------------------------------------------------------
// 1. S'assurer qu'une application web Firebase existe
// ---------------------------------------------------------------------------

let apps = '';
try {
  apps = firebase(['apps:list', 'WEB', '--project', projectId]);
} catch {
  apps = '';
}

if (!apps.includes('mtl-pwa')) {
  console.log("Création de l'application web Firebase « mtl-pwa »…");
  firebase(['apps:create', 'WEB', 'mtl-pwa', '--project', projectId]);
}

// ---------------------------------------------------------------------------
// 2. Récupérer la configuration SDK
// ---------------------------------------------------------------------------

const raw = firebase(['apps:sdkconfig', 'WEB', '--project', projectId, '--json']);

// Le format de sortie de firebase-tools a changé selon les versions : on
// accepte les trois formes plutôt que d'épingler une version du CLI.
const parsed = JSON.parse(raw);
const sdk = parsed.result?.sdkConfig ?? parsed.sdkConfig ?? parsed.result ?? parsed;

if (!sdk?.apiKey || !sdk?.projectId) {
  console.error('Configuration SDK Firebase incomplète :', JSON.stringify(sdk, null, 2));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. Écrire config.json
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
    authDomain: sdk.authDomain,
    projectId: sdk.projectId,
    storageBucket: sdk.storageBucket,
    messagingSenderId: sdk.messagingSenderId,
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
