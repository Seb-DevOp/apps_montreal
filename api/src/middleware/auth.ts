/**
 * Vérification du jeton Firebase — application mono-utilisateur.
 *
 * Il n'y a plus de rôles : une seule adresse e-mail, vérifiée, a le droit
 * d'appeler l'API. Même règle et même valeur que dans firestore.rules, pour
 * qu'il n'existe qu'une définition du « propriétaire » à faire évoluer.
 *
 * L'adresse plutôt que l'UID : les UID Firebase sont propres à un projet et
 * changeraient à chaque migration trimestrielle.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { auth } from '../firebase.js';
import { config } from '../config.js';

export interface AuthUser {
  uid: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Exige le compte propriétaire. Distingue trois échecs, parce qu'ils appellent
 * des corrections différentes : jeton absent, jeton invalide, compte non
 * autorisé.
 */
export async function requireOwner(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = extractToken(request);
  if (!token) {
    return reply.code(401).send({ error: 'unauthenticated', message: 'Connexion requise.' });
  }

  let decoded;
  try {
    decoded = await auth.verifyIdToken(token);
  } catch {
    return reply.code(401).send({ error: 'invalid_token', message: 'Session expirée.' });
  }

  const email = (decoded.email ?? '').toLowerCase();
  const owner = config.ownerEmail.toLowerCase();

  if (!owner || email !== owner || decoded.email_verified !== true) {
    return reply.code(403).send({ error: 'forbidden', message: 'Compte non autorisé.' });
  }

  request.user = { uid: decoded.uid, email };
}

/**
 * Autorise le propriétaire OU le planificateur Cloud Scheduler.
 *
 * Cloud Scheduler présente un jeton OIDC signé par Google, dont l'audience est
 * l'URL du service. On le vérifie auprès de Google plutôt que d'employer un
 * secret partagé : rien à stocker, rien à faire tourner, et le jeton expire de
 * lui-même.
 */
export async function requireOwnerOrScheduler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = extractToken(request);
  if (!token) {
    return reply.code(401).send({ error: 'unauthenticated', message: 'Connexion requise.' });
  }

  // Chemin 1 : jeton Firebase du propriétaire (appel depuis l'application).
  try {
    const decoded = await auth.verifyIdToken(token);
    const email = (decoded.email ?? '').toLowerCase();
    if (email && email === config.ownerEmail.toLowerCase() && decoded.email_verified === true) {
      request.user = { uid: decoded.uid, email };
      return;
    }
  } catch {
    // Pas un jeton Firebase : on tente le second chemin.
  }

  // Chemin 2 : jeton OIDC de Cloud Scheduler.
  try {
    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client();
    const ticket = await client.verifyIdToken({ idToken: token });
    const payload = ticket.getPayload();

    const serviceAccount = payload?.email ?? '';
    const expected = config.schedulerServiceAccount.toLowerCase();

    if (expected && serviceAccount.toLowerCase() === expected && payload?.email_verified) {
      request.user = { uid: 'scheduler', email: serviceAccount };
      return;
    }
  } catch {
    // Jeton illisible ou signature invalide.
  }

  return reply.code(403).send({ error: 'forbidden', message: 'Appelant non autorisé.' });
}
