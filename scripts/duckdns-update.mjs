#!/usr/bin/env node
/**
 * Publication des enregistrements DNS DuckDNS.
 *
 * Contexte : le domaine stable est la pièce qui permet de changer de projet
 * GCP tous les 3 mois sans que personne ne réinstalle la PWA. DuckDNS a été
 * retenu parce qu'il publie des TXT (ce que No-IP gratuit ne fait pas), or
 * Firebase Hosting en exige un pour vérifier la propriété du domaine avant
 * d'émettre le certificat TLS.
 *
 * Deux enregistrements, deux durées de vie très différentes :
 *
 *   A   → 151.101.1.195 / 151.101.65.195, les IP anycast de Firebase Hosting.
 *         FIXES et publiques : elles ne dépendent ni du projet ni de la
 *         région, donc elles sont posées une fois pour toutes.
 *
 *   TXT → jeton de vérification propre au site Hosting. Il CHANGE à chaque
 *         migration, puisque le site appartient au nouveau projet.
 *
 * Usage :
 *   npm run dns:setup                     pose l'enregistrement A (une fois)
 *   npm run dns:verify -- hosting-site=…  publie le TXT donné par Firebase
 *   npm run dns:show                      état courant, sans rien modifier
 */
import { resolve4, resolveTxt } from 'node:dns/promises';

const GREEN = '[32m';
const RED = '[31m';
const YELLOW = '[33m';
const DIM = '[2m';
const RESET = '[0m';

/**
 * IP anycast de Firebase Hosting. DuckDNS n'accepte qu'une seule adresse IPv4
 * par domaine : on perd la redondance offerte par la seconde, sans conséquence
 * pratique (l'adresse retenue est elle-même anycast, donc déjà répartie).
 */
const FIREBASE_IPS = ['151.101.1.195', '151.101.65.195'];

const domain = process.env.STABLE_DOMAIN ?? '';
const token = process.env.DUCKDNS_TOKEN ?? '';

if (!domain.endsWith('.duckdns.org')) {
  console.error(`${RED}STABLE_DOMAIN doit être un domaine DuckDNS (reçu : « ${domain} »).${RESET}`);
  process.exit(1);
}

/** DuckDNS attend le libellé seul, sans le suffixe. */
const label = domain.replace(/\.duckdns\.org$/, '');

const [command, ...rest] = process.argv.slice(2);

// ---------------------------------------------------------------------------

async function show() {
  console.log(`Domaine : ${domain}\n`);

  try {
    const addresses = await resolve4(domain);
    const pointsToFirebase = addresses.some((ip) => FIREBASE_IPS.includes(ip));
    console.log(
      `  A    ${addresses.join(', ')}  ${
        pointsToFirebase ? `${GREEN}→ Firebase Hosting${RESET}` : `${YELLOW}→ pas Firebase${RESET}`
      }`,
    );
  } catch {
    console.log(`  A    ${YELLOW}absent${RESET}`);
  }

  try {
    const records = (await resolveTxt(domain)).flat().filter(Boolean);
    console.log(records.length > 0 ? `  TXT  ${records.join(' | ')}` : `  TXT  ${DIM}vide${RESET}`);
  } catch {
    console.log(`  TXT  ${YELLOW}absent${RESET}`);
  }
}

/** Un appel DuckDNS renvoie « OK » ou « KO » en texte brut. */
async function call(params) {
  if (!token) {
    console.error(`${RED}DUCKDNS_TOKEN absent de .env.${RESET}`);
    console.error('Récupère-le en haut de https://www.duckdns.org après connexion.');
    process.exit(1);
  }

  const url = new URL('https://www.duckdns.org/update');
  url.searchParams.set('domains', label);
  url.searchParams.set('token', token);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const body = (await response.text()).trim();

  if (!body.startsWith('OK')) {
    // Le jeton n'est jamais affiché : le message d'erreur DuckDNS se limite
    // de toute façon à « KO ».
    console.error(`${RED}DuckDNS a refusé la mise à jour (réponse : « ${body} »).${RESET}`);
    console.error('Vérifie le jeton et que le domaine appartient bien à ce compte.');
    process.exit(1);
  }

  return body;
}

async function setup() {
  const ip = FIREBASE_IPS[0];
  console.log(`Publication de l'enregistrement A : ${domain} → ${ip}`);
  await call({ ip });
  console.log(`${GREEN}✓ A publié.${RESET}`);
  console.log(
    `\n${YELLOW}Attention :${RESET} si un client de mise à jour DuckDNS tourne quelque part\n` +
      `(routeur, tâche planifiée, conteneur), il réécrira cette adresse avec ton IP\n` +
      `domestique et le site cessera de répondre. Désactive-le pour ce domaine.\n`,
  );
}

async function verify() {
  const value = rest.join(' ').trim();
  if (!value) {
    console.error(`${RED}Valeur TXT manquante.${RESET}`);
    console.error('  npm run dns:verify -- hosting-site=abc123');
    console.error('\nCette valeur est fournie par la console Firebase Hosting,');
    console.error('au moment où tu ajoutes le domaine personnalisé.');
    process.exit(1);
  }

  console.log(`Publication du TXT : ${value}`);
  await call({ txt: value });
  console.log(`${GREEN}✓ TXT publié.${RESET}`);
  console.log(
    `\n${DIM}La propagation prend de quelques secondes à quelques minutes.\n` +
      `Contrôle : nslookup -type=TXT ${domain}${RESET}\n`,
  );
}

// ---------------------------------------------------------------------------

switch (command) {
  case 'setup':
    await setup();
    await show();
    break;
  case 'verify':
    await verify();
    await show();
    break;
  case 'show':
  case undefined:
    await show();
    break;
  default:
    console.error(`Commande inconnue : ${command}`);
    console.error('Attendu : setup | verify <valeur> | show');
    process.exit(1);
}
