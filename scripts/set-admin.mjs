#!/usr/bin/env node
/**
 * Attribue le custom claim { role: "admin" } à un compte.
 *
 * C'est le seul moyen d'obtenir les droits d'écriture : les règles Firestore
 * et Storage lisent ce claim dans le jeton signé par Firebase. Impossible à
 * forger côté client, et vérifiable sans lecture Firestore supplémentaire.
 *
 * Usage :
 *   node scripts/set-admin.mjs sebwow73@gmail.com
 *   node scripts/set-admin.mjs quelquun@exemple.fr guest
 *
 * Le compte doit déjà exister (s'être connecté au moins une fois).
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// À défaut d'argument, on retombe sur ADMIN_EMAIL — ce qui rend
// `npm run admin` utilisable tel quel, sans répéter l'adresse.
const [emailArg, role = 'admin'] = process.argv.slice(2);
const email = emailArg ?? process.env.ADMIN_EMAIL;

if (!email) {
  console.error('Usage : node scripts/set-admin.mjs <email> [admin|guest|blocked]');
  console.error('        (ou définis ADMIN_EMAIL dans .env)');
  process.exit(1);
}

if (!['admin', 'guest', 'blocked'].includes(role)) {
  console.error(`Rôle invalide : ${role}`);
  process.exit(1);
}

const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT_ID;
initializeApp({ credential: applicationDefault(), projectId });

try {
  const user = await getAuth().getUserByEmail(email);
  await getAuth().setCustomUserClaims(user.uid, { role });

  // Les jetons déjà émis portent l'ancien rôle et restent valides jusqu'à 1 h.
  // La révocation rend le changement immédiat.
  await getAuth().revokeRefreshTokens(user.uid);

  await getFirestore()
    .collection('users')
    .doc(user.uid)
    .set(
      { email, role, displayName: user.displayName ?? email, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

  console.log(`✓ ${email} (${user.uid}) → rôle « ${role} »`);
  console.log('  La personne devra rouvrir l’application pour recevoir ses nouveaux droits.');
} catch (error) {
  if (error.code === 'auth/user-not-found') {
    console.error(
      `Aucun compte pour ${email}.\n` +
        'Connecte-toi une première fois dans l’application, puis relance cette commande.',
    );
  } else {
    console.error('Échec :', error.message);
  }
  process.exit(1);
}
