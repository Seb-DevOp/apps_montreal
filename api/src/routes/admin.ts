/**
 * Administration : gestion des rôles et ménage Storage.
 *
 * Les rôles sont des custom claims Firebase. Les règles Firestore/Storage les
 * lisent directement dans le jeton — c'est ici la seule surface qui peut les
 * modifier, et elle exige déjà le rôle admin.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { auth, bucket, db } from '../firebase.js';
import { requireAdmin } from '../middleware/auth.js';

const roleSchema = z.object({
  uid: z.string().min(1).max(128),
  role: z.enum(['admin', 'guest', 'blocked']),
});

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  /** Liste des comptes connus, avec leur rôle effectif (source : claims). */
  app.get('/api/admin/users', { preHandler: requireAdmin }, async (_request, reply) => {
    const { users } = await auth.listUsers(200);
    return reply.send({
      users: users.map((u) => ({
        uid: u.uid,
        email: u.email ?? null,
        displayName: u.displayName ?? null,
        photoURL: u.photoURL ?? null,
        role: (u.customClaims?.role as string | undefined) ?? 'guest',
        lastSignIn: u.metadata.lastSignInTime ?? null,
        createdAt: u.metadata.creationTime,
      })),
    });
  });

  /**
   * Change le rôle d'un compte. Le claim ne se propage qu'au prochain
   * rafraîchissement du jeton (≤ 1 h, ou immédiat via getIdToken(true) côté
   * client) : `revokeRefreshTokens` force la bascule tout de suite, ce qui
   * compte surtout pour une révocation.
   */
  app.post('/api/admin/role', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = roleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', details: parsed.error.flatten() });
    }
    const { uid, role } = parsed.data;

    if (uid === request.user!.uid && role !== 'admin') {
      return reply.code(400).send({ error: 'cannot_demote_self' });
    }

    await auth.setCustomUserClaims(uid, { role });
    await auth.revokeRefreshTokens(uid);
    await db.collection('users').doc(uid).set(
      { role, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    return reply.send({ uid, role });
  });

  /**
   * Suppression complète d'un post : document Firestore, sous-collections et
   * fichiers Storage. Sans ça, les images orphelines mangent le quota gratuit
   * de 5 Go.
   */
  app.delete('/api/posts/:postId', { preHandler: requireAdmin }, async (request, reply) => {
    const { postId } = request.params as { postId: string };
    const postRef = db.collection('posts').doc(postId);
    const snap = await postRef.get();
    if (!snap.exists) return reply.code(404).send({ error: 'not_found' });

    const storagePath = snap.data()?.storagePath as string | undefined;

    for (const sub of ['likes', 'comments']) {
      const docs = await postRef.collection(sub).listDocuments();
      await Promise.all(docs.map((d) => d.delete()));
    }
    await postRef.delete();

    if (storagePath) {
      // storagePath = "photos/{uid}/{postId}/full.jpg" -> on purge le dossier.
      const prefix = storagePath.split('/').slice(0, 3).join('/');
      await bucket().deleteFiles({ prefix: `${prefix}/` }).catch((err) => {
        request.log.warn({ err, prefix }, 'purge Storage partielle');
      });
    }

    return reply.send({ deleted: postId });
  });

  /** Statistiques d'usage, pour surveiller la consommation du Free Tier. */
  app.get('/api/admin/usage', { preHandler: requireAdmin }, async (_request, reply) => {
    const [files] = await bucket().getFiles({ prefix: 'photos/' });
    const totalBytes = files.reduce((sum, f) => sum + Number(f.metadata.size ?? 0), 0);
    const [posts, tasks, spots] = await Promise.all([
      db.collection('posts').count().get(),
      db.collection('tasks').count().get(),
      db.collection('spots').count().get(),
    ]);

    return reply.send({
      storage: {
        files: files.length,
        totalMB: Math.round((totalBytes / 1024 / 1024) * 10) / 10,
        freeTierMB: 5120,
      },
      documents: {
        posts: posts.data().count,
        tasks: tasks.data().count,
        spots: spots.data().count,
      },
    });
  });
}
