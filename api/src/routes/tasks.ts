/**
 * Montréal Check & Sync — import Google Keep et génération de la timeline.
 *
 * Google Keep n'expose pas d'API publique de lecture de notes. Le chemin
 * fiable et gratuit est l'export Google Takeout (Keep -> JSON), déposé par
 * l'admin dans l'app. Cette route normalise cet export en tâches indexées sur
 * la date de départ.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase.js';
import { requireOwner } from '../middleware/auth.js';

/** Format d'une note Google Takeout (Keep/*.json). */
const keepNoteSchema = z.object({
  title: z.string().optional().default(''),
  textContent: z.string().optional().default(''),
  listContent: z
    .array(z.object({ text: z.string(), isChecked: z.boolean().optional() }))
    .optional(),
  isArchived: z.boolean().optional(),
  isTrashed: z.boolean().optional(),
  labels: z.array(z.object({ name: z.string() })).optional(),
  userEditedTimestampUsec: z.number().optional(),
});

const importSchema = z.object({
  notes: z.array(keepNoteSchema).min(1).max(500),
  defaultOffsetDays: z.number().int().min(0).max(365).optional().default(7),
});

/**
 * Devine le jalon J-N à partir du texte de la tâche.
 * Ces règles encodent le calendrier réel d'un départ France -> Canada.
 */
export function inferOffsetDays(text: string, fallback: number): number {
  const t = text.toLowerCase();

  // Un « J-12 » ou « j -12 » explicite dans la note gagne toujours.
  const explicit = t.match(/j\s*-\s*(\d{1,3})/);
  if (explicit?.[1]) return Number(explicit[1]);

  const rules: [RegExp, number][] = [
    [/passeport|validité/, 90],
    [/assurance|mutuelle|rapatriement/, 45],
    [/\bave\b|autorisation de voyage/, 30],
    [/vaccin|ordonnance|médicament/, 30],
    [/permis (de conduire )?international/, 30],
    [/logement|airbnb|réservation hôtel/, 30],
    [/banque|carte bancaire|frais de change|révolut|wise/, 21],
    [/procuration|courrier|impôts/, 21],
    [/esim|forfait|roaming|itinérance|opérateur/, 7],
    [/adaptateur|prise|110v/, 7],
    [/change|dollars canadiens|cad/, 7],
    [/valise|bagage|liste de vêtements/, 5],
    [/enregistrement|check-?in|carte d'embarquement/, 2],
    [/hors-?ligne|maps|téléchargement/, 2],
    [/taxi|747|navette|transfert aéroport/, 1],
    [/chargeur|batterie|réveil/, 1],
  ];

  for (const [pattern, offset] of rules) {
    if (pattern.test(t)) return offset;
  }
  return fallback;
}

/** Catégorie déduite, utilisée pour le regroupement visuel de la timeline. */
export function inferCategory(text: string): string {
  const t = text.toLowerCase();
  if (/passeport|ave|visa|assurance|permis/.test(t)) return 'administratif';
  if (/esim|forfait|roaming|adaptateur|chargeur|batterie/.test(t)) return 'technologie';
  if (/banque|carte|change|dollars|budget/.test(t)) return 'argent';
  if (/valise|bagage|vêtement|manteau|bottes/.test(t)) return 'bagages';
  if (/vol|enregistrement|747|navette|taxi|transfert/.test(t)) return 'transport';
  if (/vaccin|médicament|ordonnance|pharmacie/.test(t)) return 'santé';
  return 'divers';
}

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Import Takeout : chaque ligne de note ou chaque case à cocher devient une
   * tâche. L'opération est idempotente — l'id du document est dérivé du texte,
   * donc réimporter le même export ne duplique rien.
   */
  app.post('/api/tasks/import-keep', { preHandler: requireOwner }, async (request, reply) => {
    const parsed = importSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', details: parsed.error.flatten() });
    }
    const { notes, defaultOffsetDays } = parsed.data;

    const batch = db.batch();
    const collection = db.collection('tasks');
    let created = 0;

    for (const note of notes) {
      if (note.isTrashed) continue;

      const lines: { text: string; done: boolean }[] = note.listContent?.length
        ? note.listContent.map((item) => ({ text: item.text, done: Boolean(item.isChecked) }))
        : note.textContent
            .split('\n')
            .map((line) => line.replace(/^[-*•\s\[\]xX]+/, '').trim())
            .filter((line) => line.length > 1)
            .map((text) => ({ text, done: false }));

      for (const line of lines) {
        const context = `${note.title} ${line.text}`;
        const id = slugify(line.text).slice(0, 90);
        if (!id) continue;

        batch.set(
          collection.doc(id),
          {
            title: line.text.slice(0, 200),
            notes: note.title || null,
            category: inferCategory(context),
            offsetDays: inferOffsetDays(context, defaultOffsetDays),
            done: line.done,
            doneAt: line.done ? FieldValue.serverTimestamp() : null,
            source: 'keep',
            labels: note.labels?.map((l) => l.name) ?? [],
            updatedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
          },
          // merge:true préserve un `done` déjà coché dans l'app lors d'un
          // réimport, sans écraser le travail déjà fait.
          { merge: true },
        );
        created += 1;
      }
    }

    await batch.commit();
    return reply.send({ imported: created });
  });

  /** Timeline calculée : chaque tâche reçoit sa date absolue et son urgence. */
  app.get('/api/tasks/timeline', { preHandler: requireOwner }, async (_request, reply) => {
    const [tripSnap, tasksSnap] = await Promise.all([
      db.collection('trips').doc('current').get(),
      db.collection('tasks').get(),
    ]);

    const departure = tripSnap.data()?.departureDate as string | undefined;
    if (!departure) return reply.code(404).send({ error: 'trip_not_configured' });

    const departureMs = Date.parse(`${departure}T00:00:00Z`);
    const todayMs = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

    const tasks = tasksSnap.docs.map((doc) => {
      const data = doc.data();
      const offsetDays = Number(data.offsetDays ?? 0);
      const dueMs = departureMs - offsetDays * 86400000;
      return {
        id: doc.id,
        title: data.title,
        category: data.category ?? 'divers',
        offsetDays,
        done: Boolean(data.done),
        dueDate: new Date(dueMs).toISOString().slice(0, 10),
        daysLeft: Math.round((dueMs - todayMs) / 86400000),
        overdue: !data.done && dueMs < todayMs,
      };
    });

    tasks.sort((a, b) => b.offsetDays - a.offsetDays);

    return reply.send({
      departureDate: departure,
      daysToDeparture: Math.round((departureMs - todayMs) / 86400000),
      total: tasks.length,
      done: tasks.filter((t) => t.done).length,
      overdue: tasks.filter((t) => t.overdue).length,
      tasks,
    });
  });
}

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // retire les accents laissés par NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
