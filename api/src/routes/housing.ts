/**
 * Vérification périodique des annonces de logement.
 *
 * Appelée deux fois par jour par Cloud Scheduler, et à la demande depuis
 * l'application.
 *
 * Règle centrale : une annonce ne bascule en « disparue » qu'après DEUX
 * constats successifs, soit environ 24 h. Un unique échec — coupure réseau,
 * blocage passager, maintenance du site — ne doit jamais faire abandonner un
 * logement encore disponible. L'erreur coûteuse n'est pas de vérifier une
 * annonce morte un jour de trop, c'est de rayer une annonce vivante.
 */
import type { FastifyInstance } from 'fastify';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase.js';
import { requireOwnerOrScheduler } from '../middleware/auth.js';
import { checkListing } from '../services/linkCheck.js';

/** Nombre de constats concordants avant de déclarer une annonce disparue. */
const CONFIRMATIONS_REQUIRED = 2;

interface HousingDoc {
  title?: string;
  url?: string;
  verdict?: string;
  linkStatus?: string;
  goneStreak?: number;
}

export async function housingRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/housing/check', { preHandler: requireOwnerOrScheduler }, async (request, reply) => {
    const snapshot = await db.collection('housing').get();

    const candidates = snapshot.docs.filter((doc) => {
      const data = doc.data() as HousingDoc;
      // Inutile de surveiller ce qui est déjà écarté ou refusé.
      return Boolean(data.url?.trim()) && !['ecarte', 'refuse'].includes(data.verdict ?? '');
    });

    if (candidates.length === 0) {
      return reply.send({ checked: 0, gone: 0, blocked: 0, live: 0 });
    }

    // Les requêtes partent par petits lots : une rafale de plusieurs dizaines
    // d'appels simultanés vers le même hôte se fait bloquer, et ce serait
    // interprété à tort comme des annonces retirées.
    const results: { id: string; status: string }[] = [];
    const BATCH = 4;

    for (let index = 0; index < candidates.length; index += BATCH) {
      const slice = candidates.slice(index, index + BATCH);

      await Promise.all(
        slice.map(async (doc) => {
          const data = doc.data() as HousingDoc;
          const result = await checkListing(data.url!.trim());

          // Le compteur ne progresse que sur un constat de retrait, et se
          // remet à zéro dès que l'annonce répond normalement.
          const previousStreak = data.goneStreak ?? 0;
          const goneStreak = result.status === 'gone' ? previousStreak + 1 : 0;
          const confirmed = goneStreak >= CONFIRMATIONS_REQUIRED;

          const linkStatus =
            result.status === 'gone' && !confirmed
              ? // Premier constat : on n'affiche pas encore « disparue ».
                'suspect'
              : result.status;

          await doc.ref.set(
            {
              linkStatus,
              linkReason: result.reason,
              linkHttpStatus: result.httpStatus,
              linkCheckedAt: FieldValue.serverTimestamp(),
              goneStreak,
              ...(result.redirectedTo ? { linkRedirectedTo: result.redirectedTo } : {}),
            },
            { merge: true },
          );

          results.push({ id: doc.id, status: linkStatus });
        }),
      );

      // Respiration entre deux lots, par correction envers les sites visés.
      if (index + BATCH < candidates.length) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
    }

    const count = (status: string) => results.filter((r) => r.status === status).length;

    const summary = {
      checked: results.length,
      live: count('live'),
      gone: count('gone'),
      suspect: count('suspect'),
      blocked: count('blocked'),
    };

    request.log.info(summary, 'vérification des annonces terminée');
    return reply.send(summary);
  });
}
