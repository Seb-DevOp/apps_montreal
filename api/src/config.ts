/**
 * Configuration runtime de l'API.
 *
 * Tout est lu dans l'environnement : aucune valeur liée à un projet GCP
 * particulier n'est compilée dans l'image. C'est ce qui permet de redéployer
 * la même image sur un nouveau projet tous les 3 mois sans rebuild.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(optional('PORT', '8080')),
  host: '0.0.0.0',
  nodeEnv: optional('NODE_ENV', 'development'),
  isProd: process.env.NODE_ENV === 'production',

  /** Injecté automatiquement par Cloud Run. */
  projectId: optional('GOOGLE_CLOUD_PROJECT', optional('GCP_PROJECT_ID', '')),
  storageBucket: optional('STORAGE_BUCKET', ''),

  /** Domaine stable de la PWA — seule origine CORS autorisée en production. */
  allowedOrigins: optional('ALLOWED_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  /** Clé OpenWeatherMap (montée depuis Secret Manager). */
  openWeatherKey: optional('OPENWEATHER_API_KEY', ''),

  /** Coordonnées de Montréal centre-ville, défaut des appels météo. */
  montreal: { lat: 45.5019, lon: -73.5674 },

  /** Durée de vie du cache météo Firestore, en minutes. */
  weatherCacheMinutes: Number(optional('WEATHER_CACHE_MINUTES', '20')),

  version: optional('APP_VERSION', 'dev'),
} as const;

export { required };
