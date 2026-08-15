#!/usr/bin/env node
/**
 * Initialise Firestore avec le contenu de référence : voyage, spots, lexique
 * et check-list de départ.
 *
 * Idempotent : les identifiants de documents sont fixes et l'écriture se fait
 * en `merge`. Relancer le script après une migration réinstalle le contenu
 * sans écraser ce qui a été modifié depuis l'application (une tâche cochée
 * reste cochée, une note personnelle sur un spot est préservée).
 *
 * Usage :
 *   GOOGLE_CLOUD_PROJECT=mon-projet node scripts/seed-firestore.mjs
 *   node scripts/seed-firestore.mjs --force   # réécrit tout, y compris l'état
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FieldValue, getDb } from './lib/admin-app.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');

const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT_ID;
if (!projectId) {
  console.error('GOOGLE_CLOUD_PROJECT ou GCP_PROJECT_ID doit être défini.');
  process.exit(1);
}

const db = getDb(projectId);

const readSeed = (name) => JSON.parse(readFileSync(join(ROOT, 'seed', `${name}.json`), 'utf8'));

/** Écrit une collection par lots de 400 (la limite Firestore est de 500). */
async function seedCollection(name, documents, transform) {
  let written = 0;

  for (let index = 0; index < documents.length; index += 400) {
    const batch = db.batch();
    for (const document of documents.slice(index, index + 400)) {
      const { id, ...rest } = document;
      batch.set(
        db.collection(name).doc(id),
        { ...transform(rest), updatedAt: FieldValue.serverTimestamp() },
        { merge: !force },
      );
      written += 1;
    }
    await batch.commit();
  }

  console.log(`✓ ${name} : ${written} documents`);
}

async function main() {
  // ---- Configuration du voyage -------------------------------------------
  const departureDate = process.env.TRIP_DEPARTURE_DATE ?? '2026-10-12';
  const returnDate = process.env.TRIP_RETURN_DATE ?? '2026-10-26';

  await db.collection('trips').doc('current').set(
    {
      name: 'Montréal',
      departureDate,
      returnDate,
      homeTimeZone: 'Europe/Paris',
      tripTimeZone: 'America/Montreal',
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  console.log(`✓ trips/current : départ le ${departureDate}, retour le ${returnDate}`);

  // ---- Contenu de référence ----------------------------------------------
  await seedCollection('spots', readSeed('spots'), (spot) => spot);

  await seedCollection('lexicon', readSeed('lexicon'), (entry) => entry);

  await seedCollection('tasks', readSeed('tasks'), (task) => ({
    ...task,
    notes: null,
    // `done` n'est réécrit qu'en mode --force : sans ça, une tâche déjà cochée
    // dans l'app serait décochée à chaque réexécution du seed.
    ...(force ? { done: false, doneAt: null } : {}),
    source: 'manual',
    labels: [],
    createdAt: FieldValue.serverTimestamp(),
  }));

  // Les tâches nouvellement créées ont besoin d'un `done` explicite : on le
  // pose en une passe séparée, seulement là où le champ manque.
  const missing = await db.collection('tasks').get();
  const batch = db.batch();
  let patched = 0;
  for (const doc of missing.docs) {
    if (doc.data().done === undefined) {
      batch.set(doc.ref, { done: false, doneAt: null }, { merge: true });
      patched += 1;
    }
  }
  if (patched > 0) {
    await batch.commit();
    console.log(`✓ tasks : ${patched} tâches initialisées à « à faire »`);
  }

  console.log('\nContenu de référence en place.');
}

main().catch((error) => {
  console.error('Échec du seed :', error);
  process.exit(1);
});
