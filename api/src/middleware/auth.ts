/**
 * Vérification du jeton Firebase et exposition du rôle sur la requête.
 *
 * Le rôle vit dans un custom claim, posé par `scripts/set-admin.mjs` ou par la
 * route d'administration. Il est donc signé par Firebase : un client ne peut
 * pas le forger.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { auth } from '../firebase.js';

export type Role = 'admin' | 'guest' | 'blocked';

export interface AuthUser {
  uid: string;
  email?: string;
  name?: string;
  role: Role;
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

/** Attache `request.user` si un jeton valide est présent, sans jamais rejeter. */
export async function optionalAuth(request: FastifyRequest): Promise<void> {
  const token = extractToken(request);
  if (!token) return;
  try {
    const decoded = await auth.verifyIdToken(token);
    const claimRole = decoded.role;
    request.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name as string | undefined,
      role: claimRole === 'admin' || claimRole === 'blocked' ? claimRole : 'guest',
    };
  } catch {
    // Jeton expiré ou invalide : on laisse `request.user` vide, les gardes
    // ci-dessous produiront un 401 explicite.
  }
}

/** Exige un utilisateur connecté et non bloqué. */
export async function requireGuest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await optionalAuth(request);
  if (!request.user) {
    return reply.code(401).send({ error: 'unauthenticated', message: 'Connexion requise.' });
  }
  if (request.user.role === 'blocked') {
    return reply.code(403).send({ error: 'forbidden', message: 'Accès révoqué.' });
  }
}

/** Exige le rôle admin. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await optionalAuth(request);
  if (!request.user) {
    return reply.code(401).send({ error: 'unauthenticated', message: 'Connexion requise.' });
  }
  if (request.user.role !== 'admin') {
    return reply.code(403).send({ error: 'forbidden', message: 'Réservé à l’administrateur.' });
  }
}
