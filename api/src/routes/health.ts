/**
 * Santé du service + configuration publique.
 *
 * `/api/config` est le second filet de sécurité de la migration : si le
 * `config.json` servi par Hosting était périmé dans un cache client, la PWA
 * peut redemander sa configuration au backend, qui la tient de son propre
 * environnement d'exécution.
 */
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { db } from '../firebase.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /** Sonde Cloud Run : ne touche à rien, doit répondre même Firestore éteint. */
  app.get('/api/health', async (_request, reply) =>
    reply.send({ status: 'ok', version: config.version, uptime: Math.round(process.uptime()) }),
  );

  /** Sonde profonde : vérifie l'accès Firestore (utilisée par deploy.sh). */
  app.get('/api/health/deep', async (_request, reply) => {
    try {
      await db.collection('meta').doc('health').set({ pingedAt: new Date() }, { merge: true });
      return reply.send({ status: 'ok', firestore: 'reachable', project: config.projectId });
    } catch (error) {
      app.log.error({ err: error }, 'firestore injoignable');
      return reply.code(503).send({ status: 'degraded', firestore: 'unreachable' });
    }
  });

  /** Configuration du voyage, publique côté invités connectés comme anonymes. */
  app.get('/api/config', async (_request, reply) => {
    const trip = (await db.collection('trips').doc('current').get()).data() ?? null;
    return reply
      .header('Cache-Control', 'public, max-age=60')
      .send({
        version: config.version,
        projectId: config.projectId,
        trip: trip
          ? {
              name: trip.name,
              departureDate: trip.departureDate,
              returnDate: trip.returnDate,
              homeTimeZone: trip.homeTimeZone ?? 'Europe/Paris',
              tripTimeZone: trip.tripTimeZone ?? 'America/Montreal',
            }
          : null,
      });
  });
}
