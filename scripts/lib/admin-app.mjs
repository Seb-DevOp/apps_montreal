/**
 * Accès administrateur à Firebase, compatible fédération d'identité.
 *
 * Le problème : `applicationDefault()` de firebase-admin ne sait interpréter
 * que deux formats de fichier d'identifiants — `service_account` et
 * `authorized_user`. Or GitHub Actions authentifié par Workload Identity
 * Federation produit un fichier de type `external_account`, rejeté avec un
 * laconique « Invalid contents in the credentials file ».
 *
 * Revenir à une clé de service reviendrait à réintroduire le secret de longue
 * durée qu'on cherche justement à éviter. On délègue donc l'obtention du jeton
 * à `google-auth-library`, qui gère tous les formats.
 *
 * Deux chemins distincts, car firebase-admin ne traite pas ses services de la
 * même façon :
 *
 *   Auth      accepte n'importe quel objet exposant `getAccessToken()`.
 *   Firestore refuse : il vérifie le TYPE du credential et n'admet qu'une clé
 *             de service ou l'ADC intégrée. On contourne en utilisant
 *             directement `@google-cloud/firestore`, qui s'appuie nativement
 *             sur google-auth-library — et gère donc `external_account`.
 *
 * Fonctionne sans changement en local (identifiants utilisateur), en CI
 * (fédération) et sur Cloud Run (compte de service attaché).
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth } from 'google-auth-library';

const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/datastore',
  'https://www.googleapis.com/auth/firebase',
  'https://www.googleapis.com/auth/identitytoolkit',
];

function requireProjectId(projectId) {
  const resolved =
    projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT_ID;
  if (!resolved) {
    throw new Error('projectId requis (GOOGLE_CLOUD_PROJECT ou GCP_PROJECT_ID).');
  }
  return resolved;
}

/**
 * Application firebase-admin, pour les opérations Auth (rôles, jetons).
 * Idempotent : un second appel réutilise l'instance existante.
 */
export async function initAdminApp(projectId) {
  const existing = getApps();
  if (existing.length > 0) return existing[0];

  const resolved = requireProjectId(projectId);
  const client = await new GoogleAuth({ scopes: SCOPES, projectId: resolved }).getClient();

  return initializeApp({
    projectId: resolved,
    credential: {
      async getAccessToken() {
        const { token } = await client.getAccessToken();
        if (!token) throw new Error("Aucun jeton d'accès obtenu depuis les identifiants ambiants.");

        // firebase-admin attend une durée de vie en secondes. On la dérive de
        // l'expiration réelle quand la bibliothèque la connaît, avec un
        // plancher pour éviter un rafraîchissement en boucle.
        const expiry = client.credentials?.expiry_date;
        const expiresIn = expiry ? Math.max(60, Math.floor((expiry - Date.now()) / 1000)) : 3600;

        return { access_token: token, expires_in: expiresIn };
      },
    },
  });
}

let firestore = null;

/** Client Firestore, indépendant de firebase-admin. */
export function getDb(projectId) {
  if (!firestore) {
    firestore = new Firestore({
      projectId: requireProjectId(projectId),
      // Évite un 500 sur un champ optionnel absent des données de référence.
      ignoreUndefinedProperties: true,
    });
  }
  return firestore;
}

export { FieldValue, Timestamp } from '@google-cloud/firestore';
