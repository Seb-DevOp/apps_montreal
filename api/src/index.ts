/**
 * Point d'entrée de l'API Montréal Compagnon (Cloud Run).
 *
 * Principe : le serveur ne détient aucun état. Toute la donnée vit dans
 * Firestore/Storage et le client parle à Firestore en direct pour le
 * temps réel et le hors-ligne. L'API ne prend en charge que ce qui ne peut
 * pas être fait depuis le client en sécurité : clés tierces (météo), rôles,
 * imports en masse, ménage Storage.
 *
 * Conséquence : le service peut tomber à zéro instance sans dégrader
 * l'expérience de consultation, ce qui est exactement ce qu'il faut sur le
 * Free Tier.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { weatherRoutes } from './routes/weather.js';
import { taskRoutes } from './routes/tasks.js';

const app = Fastify({
  logger: {
    level: config.isProd ? 'info' : 'debug',
    // Cloud Logging comprend nativement `severity` et `message`.
    ...(config.isProd
      ? {
          formatters: {
            level: (label: string) => ({ severity: label.toUpperCase() }),
          },
          messageKey: 'message',
        }
      : { transport: undefined }),
  },
  trustProxy: true, // Cloud Run est derrière un load balancer Google
  bodyLimit: 5 * 1024 * 1024, // imports Takeout volumineux
});

await app.register(helmet, { contentSecurityPolicy: false });

await app.register(cors, {
  origin(origin, callback) {
    // Requêtes same-origin (via rewrite Firebase Hosting) : pas d'en-tête Origin.
    if (!origin) return callback(null, true);
    if (config.allowedOrigins.includes(origin)) return callback(null, true);
    // Prévisualisations Firebase Hosting : <site>--<canal>-<hash>.web.app
    if (/^https:\/\/[\w-]+\.(web\.app|firebaseapp\.com)$/.test(origin)) return callback(null, true);
    return callback(new Error(`Origine non autorisée : ${origin}`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
});

await app.register(rateLimit, {
  max: 120,
  timeWindow: '1 minute',
  keyGenerator: (request) => request.headers['x-forwarded-for']?.toString() ?? request.ip,
});

await app.register(healthRoutes);
await app.register(weatherRoutes);
await app.register(taskRoutes);

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, 'erreur non gérée');
  const status = error.statusCode ?? 500;
  reply.code(status).send({
    error: status === 500 ? 'internal_error' : error.code ?? 'error',
    message: status === 500 && config.isProd ? 'Erreur interne.' : error.message,
  });
});

app.setNotFoundHandler((request, reply) =>
  reply.code(404).send({ error: 'not_found', path: request.url }),
);

// Arrêt propre : Cloud Run envoie SIGTERM avant de retirer l'instance.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    app.log.info(`${signal} reçu, arrêt en cours`);
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`API prête sur :${config.port} (projet ${config.projectId || 'inconnu'})`);
} catch (error) {
  app.log.error({ err: error }, 'démarrage impossible');
  process.exit(1);
}
