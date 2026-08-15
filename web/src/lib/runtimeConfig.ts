/**
 * Configuration runtime — la pièce maîtresse de la migration transparente.
 *
 * Rien de spécifique à un projet GCP n'est compilé dans le bundle. Au
 * démarrage, l'app lit `/config.json`, un fichier généré par `deploy.sh` et
 * servi par Firebase Hosting avec `Cache-Control: no-cache`.
 *
 * Conséquence concrète : quand le projet GCP est recréé au bout de 3 mois,
 * on redéploie ce fichier sur le MÊME domaine stable. Les PWA déjà installées
 * sur les téléphones récupèrent la nouvelle configuration à leur prochain
 * lancement en ligne. Aucune réinstallation, aucun changement d'icône, aucune
 * perte du raccourci sur l'écran d'accueil.
 *
 * Ordre de résolution :
 *   1. `/config.json` frais (réseau)
 *   2. dernière copie valide en localStorage (démarrage hors-ligne)
 *   3. variables de build `VITE_*` (dev local uniquement)
 */

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface TripConfig {
  name: string;
  departureDate: string; // AAAA-MM-JJ
  returnDate: string;
  homeTimeZone: string; // ex. Europe/Paris
  tripTimeZone: string; // ex. America/Montreal
}

export interface RuntimeConfig {
  /** Version de déploiement, sert à détecter une migration. */
  version: string;
  /** Base des appels API. `/api` par défaut : même origine via rewrite Hosting. */
  apiBaseUrl: string;
  firebase: FirebaseWebConfig;
  trip: TripConfig;
  /** Adresse autorisée à ouvrir l application. Miroir de firestore.rules. */
  ownerEmail: string;
  /** Horodatage de génération du fichier par deploy.sh. */
  deployedAt?: string;
}

const STORAGE_KEY = 'mtl.runtimeConfig.v1';

const buildTimeFallback = (): RuntimeConfig | null => {
  const env = import.meta.env;
  if (!env.VITE_FIREBASE_API_KEY) return null;
  return {
    version: env.VITE_APP_VERSION ?? 'dev',
    apiBaseUrl: env.VITE_API_BASE_URL ?? '/api',
    ownerEmail: env.VITE_OWNER_EMAIL ?? '',
    firebase: {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
      projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
      appId: env.VITE_FIREBASE_APP_ID ?? '',
    },
    trip: {
      name: env.VITE_TRIP_NAME ?? 'Montréal',
      departureDate: env.VITE_TRIP_DEPARTURE ?? '2026-10-12',
      returnDate: env.VITE_TRIP_RETURN ?? '2026-10-26',
      homeTimeZone: 'Europe/Paris',
      tripTimeZone: 'America/Montreal',
    },
  };
};

function isValid(config: unknown): config is RuntimeConfig {
  if (!config || typeof config !== 'object') return false;
  const c = config as Partial<RuntimeConfig>;
  return Boolean(c.firebase?.apiKey && c.firebase?.projectId && c.trip?.departureDate);
}

function readCache(): RuntimeConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(config: RuntimeConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Mode privé Safari : on continue sans cache, l'app reste utilisable en ligne.
  }
}

let current: RuntimeConfig | null = null;

/** Configuration active. Lève si appelée avant `loadRuntimeConfig()`. */
export function getConfig(): RuntimeConfig {
  if (!current) throw new Error('Configuration runtime non chargée.');
  return current;
}

export interface LoadResult {
  config: RuntimeConfig;
  /** Vraie si la config vient du réseau (et non d'un cache local). */
  fresh: boolean;
  /** Vraie si le projet Firebase a changé depuis le dernier lancement. */
  migrated: boolean;
}

/**
 * Charge la configuration. À appeler AVANT tout `initializeApp` Firebase.
 * Ne lève que si aucune source n'est exploitable (premier lancement hors-ligne).
 */
export async function loadRuntimeConfig(): Promise<LoadResult> {
  const cached = readCache();

  try {
    const response = await fetch('/config.json', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      const fetched: unknown = await response.json();
      if (isValid(fetched)) {
        const migrated =
          cached !== null && cached.firebase.projectId !== fetched.firebase.projectId;

        if (migrated) {
          // Le backend a changé de projet GCP. Les caches applicatifs (jetons
          // d'auth périmés, données Firestore de l'ancien projet) doivent
          // partir, mais surtout PAS l'installation PWA elle-même.
          await purgeAfterMigration(cached.firebase.projectId, fetched.firebase.projectId);
        }

        writeCache(fetched);
        current = fetched;
        return { config: fetched, fresh: true, migrated };
      }
    }
  } catch {
    // Hors-ligne : on continue sur le cache.
  }

  const fallback = cached ?? buildTimeFallback();
  if (!fallback) {
    throw new Error(
      "Impossible de charger la configuration de l'application. Connecte-toi à Internet pour le premier lancement.",
    );
  }
  current = fallback;
  return { config: fallback, fresh: false, migrated: false };
}

/**
 * Nettoyage post-migration. On vide les bases IndexedDB de Firestore (liées à
 * l'ancien projectId) et les caches HTTP de données, puis on force le SW à
 * oublier son `config.json`. L'enregistrement du Service Worker et l'entrée
 * sur l'écran d'accueil sont préservés.
 */
async function purgeAfterMigration(oldProjectId: string, newProjectId: string): Promise<void> {
  console.info(`[migration] projet ${oldProjectId} -> ${newProjectId}, purge des caches locaux`);

  try {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('mtl-api') || k.startsWith('mtl-config')).map((k) => caches.delete(k)),
    );
  } catch {
    /* non bloquant */
  }

  try {
    const databases = (await indexedDB.databases?.()) ?? [];
    await Promise.all(
      databases
        .map((d) => d.name)
        .filter((name): name is string => Boolean(name && name.includes('firestore')))
        .map(
          (name) =>
            new Promise<void>((resolve) => {
              const request = indexedDB.deleteDatabase(name);
              request.onsuccess = request.onerror = request.onblocked = () => resolve();
            }),
        ),
    );
  } catch {
    /* non bloquant */
  }

  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    registration?.active?.postMessage({ type: 'CLEAR_CONFIG_CACHE' });
  } catch {
    /* non bloquant */
  }
}
