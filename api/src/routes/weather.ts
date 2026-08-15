/**
 * Routes météo et sélecteur d'activités.
 *
 * `/api/weather` sert le snapshot enrichi (humidex / refroidissement éolien).
 * `/api/activities` croise ce snapshot avec la collection `spots` pour
 * recommander de l'intérieur (RÉSO, musées, marchés couverts) ou de
 * l'extérieur selon le temps du jour.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../firebase.js';
import { getWeather, type WeatherMood, type WeatherSky, type WeatherSnapshot } from '../services/weather.js';
import { requireOwner } from '../middleware/auth.js';

const coordsSchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  force: z.coerce.boolean().optional(),
});

/**
 * Décide si la journée pousse dedans ou dehors.
 * Montréal a deux saisons hostiles : on bascule en « intérieur » dès que le
 * ressenti sort du confort ou que le ciel est mauvais.
 */
export function shouldStayIndoors(snapshot: Pick<WeatherSnapshot, 'mood' | 'sky' | 'feels'>): {
  indoors: boolean;
  reason: string;
} {
  const badSky: WeatherSky[] = ['pluie', 'orage', 'neige'];
  const badMood: WeatherMood[] = ['canicule', 'grand-froid'];

  if (badMood.includes(snapshot.mood)) {
    return {
      indoors: true,
      reason:
        snapshot.mood === 'canicule'
          ? `Humidex ${Math.round(snapshot.feels)} : journée à passer au frais.`
          : `Ressenti ${Math.round(snapshot.feels)} °C : journée à passer à l'abri.`,
    };
  }
  if (badSky.includes(snapshot.sky)) {
    return { indoors: true, reason: `Ciel : ${snapshot.sky}. Plan B intérieur recommandé.` };
  }
  if (snapshot.mood === 'froid') {
    return { indoors: true, reason: 'Froid marqué : alterne extérieur court et pauses au chaud.' };
  }
  return { indoors: false, reason: 'Fenêtre favorable : profite de l’extérieur.' };
}

interface SpotDoc {
  name: string;
  neighborhood: string;
  category: string;
  indoor: boolean;
  weatherTags?: string[];
  priority?: number;
  address?: string;
  metro?: string[];
  notes?: string;
}

export async function weatherRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/weather', { preHandler: requireOwner }, async (request, reply) => {
    const parsed = coordsSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', details: parsed.error.flatten() });
    }
    const { lat = config.montreal.lat, lon = config.montreal.lon, force = false } = parsed.data;

    try {
      // Le seul utilisateur autorisé est le propriétaire : plus de condition de rôle.
      const snapshot = await getWeather(lat, lon, force);
      return reply.send(snapshot);
    } catch (error) {
      request.log.error({ err: error }, 'échec récupération météo');
      // Dernier recours : servir le cache même périmé plutôt qu'une erreur —
      // l'app doit rester utile en voyage avec une connexion capricieuse.
      const stale = (await db.collection('meta').doc('weather').get()).data();
      if (stale?.snapshot) {
        return reply.header('X-Cache', 'stale').send(stale.snapshot);
      }
      return reply.code(503).send({ error: 'weather_unavailable' });
    }
  });

  app.get('/api/activities', { preHandler: requireOwner }, async (request, reply) => {
    const parsed = coordsSchema.safeParse(request.query);
    const { lat = config.montreal.lat, lon = config.montreal.lon } = parsed.success ? parsed.data : {};

    let snapshot: WeatherSnapshot | null = null;
    try {
      snapshot = await getWeather(lat, lon);
    } catch {
      const stale = (await db.collection('meta').doc('weather').get()).data();
      snapshot = (stale?.snapshot as WeatherSnapshot | undefined) ?? null;
    }

    const verdict = snapshot
      ? shouldStayIndoors(snapshot)
      : { indoors: false, reason: 'Météo indisponible : suggestions par défaut.' };

    const spotsSnap = await db
      .collection('spots')
      .where('indoor', '==', verdict.indoors)
      .limit(60)
      .get();

    const spots = spotsSnap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as SpotDoc) }))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    // Affinage : si des spots portent un tag correspondant à la météo du jour,
    // ils remontent en tête (ex. « canicule » -> marchés couverts climatisés).
    const tag = snapshot?.mood;
    const ranked = tag
      ? [...spots].sort((a, b) => Number(b.weatherTags?.includes(tag) ?? false) - Number(a.weatherTags?.includes(tag) ?? false))
      : spots;

    return reply.send({
      indoors: verdict.indoors,
      reason: verdict.reason,
      weather: snapshot
        ? { feels: snapshot.feels, index: snapshot.index, sky: snapshot.sky, mood: snapshot.mood }
        : null,
      spots: ranked.slice(0, 20),
    });
  });
}
