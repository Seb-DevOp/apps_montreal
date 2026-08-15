/**
 * Initialisation de l'Admin SDK.
 *
 * Sur Cloud Run, aucune clé de service n'est nécessaire : le SDK utilise
 * l'identité du service (ADC). En local, exporter
 * GOOGLE_APPLICATION_CREDENTIALS ou lancer `firebase emulators:start`.
 */
import { initializeApp, applicationDefault, getApps, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { config } from './config.js';

let app: App;

if (getApps().length === 0) {
  app = initializeApp({
    credential: applicationDefault(),
    projectId: config.projectId || undefined,
    storageBucket: config.storageBucket || undefined,
  });
} else {
  app = getApps()[0]!;
}

export const db: Firestore = getFirestore(app);
export const auth: Auth = getAuth(app);
export const bucket = () => getStorage(app).bucket();

// `ignoreUndefinedProperties` évite les 500 sur un champ optionnel absent.
db.settings({ ignoreUndefinedProperties: true });

export { app };
