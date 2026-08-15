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
