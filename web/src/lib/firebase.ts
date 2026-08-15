/**
 * Initialisation Firebase, pilotée par la configuration runtime.
 *
 * Volontairement paresseuse : `initFirebase()` n'est appelée qu'après le
 * chargement de `/config.json` (voir src/main.tsx). Aucun `initializeApp` au
 * niveau module — sinon on figerait le projet GCP au moment du build, ce qui
 * casserait la migration trimestrielle.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  browserLocalPersistence,
  setPersistence,
  type Auth,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import type { FirebaseWebConfig } from './runtimeConfig';

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;

export async function initFirebase(config: FirebaseWebConfig): Promise<void> {
  if (app) return;

  app = initializeApp(config);

  // Cache persistant multi-onglets : c'est lui qui rend le journal, la
  // check-list et le lexique consultables dans le métro de Montréal, sans
  // aucun code de synchronisation à écrire.
  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    // Certains réseaux d'hôtel et de café bloquent gRPC : ce repli évite
    // l'app figée sur « chargement ».
    experimentalAutoDetectLongPolling: true,
  });

  authInstance = getAuth(app);
  // La session doit survivre à la fermeture de la PWA ; sans ça, iOS
  // redemande une connexion à chaque ouverture depuis l'écran d'accueil.
  await setPersistence(authInstance, browserLocalPersistence).catch(() => {
    /* mode privé : on retombe sur la persistance en mémoire */
  });

  storageInstance = getStorage(app);
}

function assertInit<T>(value: T | null, name: string): T {
  if (!value) throw new Error(`Firebase non initialisé (${name}). Appelle initFirebase() d'abord.`);
  return value;
}

export const getFirebaseApp = (): FirebaseApp => assertInit(app, 'app');
export const auth = (): Auth => assertInit(authInstance, 'auth');
export const db = (): Firestore => assertInit(dbInstance, 'firestore');
export const storage = (): FirebaseStorage => assertInit(storageInstance, 'storage');
