#!/usr/bin/env node
/**
 * Empaquetage Android — PWA → APK via une Trusted Web Activity.
 *
 * Une TWA est une application Android qui affiche la PWA en plein écran, sans
 * barre d'adresse, à condition que le site prouve qu'il autorise cet APK :
 * c'est le rôle des Digital Asset Links (`/.well-known/assetlinks.json`), qui
 * doivent contenir l'empreinte SHA-256 de la clé de signature.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CONTRAINTE STRUCTURANTE
 *
 * L'origine est FIGÉE dans l'APK. Construire contre `<projet>.web.app`
 * produirait une application qui cesse de fonctionner à la première migration
 * trimestrielle — précisément ce que toute l'architecture évite. La TWA vise
 * donc STABLE_DOMAIN, et le script refuse de faire autrement sans --force.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Commandes :
 *   node scripts/android.mjs keystore    crée la clé de signature (une fois)
 *   node scripts/android.mjs manifest    génère android/twa-manifest.json
 *   node scripts/android.mjs fingerprint affiche l'empreinte SHA-256
 *   node scripts/android.mjs register    déclare l'app dans Firebase (assetlinks)
 *   node scripts/android.mjs build       construit l'APK signé
 *   node scripts/android.mjs release     enchaîne manifest + build
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_DIR = join(ROOT, 'android');
const MANIFEST_PATH = join(ANDROID_DIR, 'twa-manifest.json');
const KEYSTORE_PATH = join(ANDROID_DIR, 'keystore.jks');

const RED = '[31m';
const GREEN = '[32m';
const YELLOW = '[33m';
const DIM = '[2m';
const RESET = '[0m';

const args = process.argv.slice(2);
const command = args[0];
const force = args.includes('--force');

const env = {
  domain: process.env.STABLE_DOMAIN ?? '',
  projectId: process.env.GCP_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? '',
  packageId: process.env.ANDROID_PACKAGE_ID ?? 'org.duckdns.appsmontreal.twa',
  keyAlias: process.env.ANDROID_KEY_ALIAS ?? 'montreal',
  keyPassword: process.env.ANDROID_KEY_PASSWORD ?? '',
  storePassword: process.env.ANDROID_STORE_PASSWORD ?? '',
  versionName: process.env.ANDROID_VERSION_NAME ?? '1.0.0',
  versionCode: Number(process.env.ANDROID_VERSION_CODE ?? '1'),
};

const fail = (message) => {
  console.error(`\n${RED}✗ ${message}${RESET}\n`);
  process.exit(1);
};
const ok = (message) => console.log(`${GREEN}✓${RESET} ${message}`);
const info = (message) => console.log(`${DIM}${message}${RESET}`);
const warn = (message) => console.log(`${YELLOW}!${RESET} ${message}`);

// ---------------------------------------------------------------------------
// Garde : l'origine visée
// ---------------------------------------------------------------------------

function resolveOrigin() {
  if (!env.domain) {
    fail(
      'STABLE_DOMAIN est vide.\n' +
        "  Une TWA fige son origine dans l'APK. Sans domaine stable, l'application\n" +
        '  cesserait de fonctionner à la prochaine migration trimestrielle.\n' +
        '  Renseigne STABLE_DOMAIN dans .env et raccorde le domaine à Firebase Hosting.',
    );
  }

  if (/\.(web\.app|firebaseapp\.com)$/.test(env.domain) && !force) {
    fail(
      `STABLE_DOMAIN vaut « ${env.domain} », une URL liée au projet Firebase.\n` +
        "  Elle change à chaque migration : l'APK deviendrait inutilisable.\n" +
        '  Utilise ton domaine personnalisé, ou --force si tu acceptes ce compromis.',
    );
  }

  return `https://${env.domain}`;
}

/** Vérifie que le site répond en HTTPS et sert bien un manifeste PWA. */
async function checkOriginReachable(origin) {
  const probe = async (path) => {
    try {
      const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10000) });
      return response.status;
    } catch {
      return 0;
    }
  };

  const [root, manifest, assetlinks] = await Promise.all([
    probe('/'),
    probe('/manifest.webmanifest'),
    probe('/.well-known/assetlinks.json'),
  ]);

  info(`  /                            HTTP ${root || 'injoignable'}`);
  info(`  /manifest.webmanifest        HTTP ${manifest || 'injoignable'}`);
  info(`  /.well-known/assetlinks.json HTTP ${assetlinks || 'injoignable'}`);

  if (root !== 200 || manifest !== 200) {
    if (!force) {
      fail(
        `${origin} ne répond pas encore en HTTPS avec son manifeste.\n` +
          "  Raccorde le domaine dans la console Firebase Hosting, attends l'émission\n" +
          '  du certificat, puis relance. (--force pour passer outre.)',
      );
    }
    warn('Origine injoignable, poursuite forcée.');
  }
}

// ---------------------------------------------------------------------------
// Clé de signature
// ---------------------------------------------------------------------------

function requirePasswords() {
  if (!env.keyPassword || !env.storePassword) {
    fail(
      'ANDROID_KEY_PASSWORD et ANDROID_STORE_PASSWORD sont requis.\n' +
        '  Choisis-les une fois, note-les dans .env, et conserve-les :\n' +
        '  sans la clé ET ses mots de passe, aucune mise à jour de l’APK\n' +
        '  ne pourra être installée par-dessus la précédente.',
    );
  }
}

function createKeystore() {
  requirePasswords();

  if (existsSync(KEYSTORE_PATH) && !force) {
    fail(
      `Une clé existe déjà : ${KEYSTORE_PATH}\n` +
        '  La remplacer rendrait impossible la mise à jour des APK déjà installés\n' +
        '  (Android refuse une signature différente). Utilise --force en connaissance de cause.',
    );
  }

  mkdirSync(ANDROID_DIR, { recursive: true });

  // Validité longue : une clé expirée empêche toute nouvelle publication.
  execFileSync(
    'keytool',
    [
      '-genkeypair',
      '-v',
      '-keystore', KEYSTORE_PATH,
      '-alias', env.keyAlias,
      '-keyalg', 'RSA',
      '-keysize', '2048',
      '-validity', '10000',
      '-storepass', env.storePassword,
      '-keypass', env.keyPassword,
      '-dname', 'CN=Montreal Compagnon, OU=Perso, O=Perso, L=Paris, C=FR',
    ],
    { stdio: ['ignore', 'inherit', 'inherit'], shell: process.platform === 'win32' },
  );

  ok(`clé créée : android/keystore.jks (alias « ${env.keyAlias} »)`);
  warn('Cette clé est ignorée par git. Sauvegarde-la hors du dépôt :');
  info('  sans elle, impossible de publier une mise à jour compatible.');
}

/** Empreinte SHA-256, au format attendu par les Digital Asset Links. */
function fingerprint() {
  if (!existsSync(KEYSTORE_PATH)) fail('Aucune clé. Lance « npm run android:keystore ».');
  requirePasswords();

  const output = execFileSync(
    'keytool',
    ['-list', '-v', '-keystore', KEYSTORE_PATH, '-alias', env.keyAlias, '-storepass', env.storePassword],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  );

  const match = output.match(/SHA256:\s*([A-F0-9:]+)/i);
  if (!match) fail("Empreinte SHA-256 introuvable dans la sortie de keytool.");
  return match[1].toUpperCase();
}

// ---------------------------------------------------------------------------
// Manifeste TWA
// ---------------------------------------------------------------------------

function writeManifest(origin) {
  mkdirSync(ANDROID_DIR, { recursive: true });

  const manifest = {
    packageId: env.packageId,
    host: env.domain,
    name: 'Montréal Compagnon',
    launcherName: 'Montréal',
    display: 'standalone',
    orientation: 'portrait',
    themeColor: '#0b1220',
    themeColorDark: '#0b1220',
    navigationColor: '#0b1220',
    navigationColorDark: '#0b1220',
    navigationDividerColor: '#0b1220',
    navigationDividerColorDark: '#0b1220',
    backgroundColor: '#0b1220',
    enableNotifications: false,
    startUrl: '/?source=twa',
    iconUrl: `${origin}/icons/icon-512.png`,
    maskableIconUrl: `${origin}/icons/maskable-512.png`,
    splashScreenFadeOutDuration: 300,
    signingKey: { path: KEYSTORE_PATH, alias: env.keyAlias },
    appVersionName: env.versionName,
    appVersionCode: env.versionCode,
    shortcuts: [
      { name: 'Calculateur de taxes', short_name: 'Taxes', url: '/taxes', chosenIconUrl: `${origin}/icons/icon-192.png` },
      { name: 'Journal photo', short_name: 'Journal', url: '/journal', chosenIconUrl: `${origin}/icons/icon-192.png` },
      { name: 'Check-list départ', short_name: 'Check-list', url: '/checklist', chosenIconUrl: `${origin}/icons/icon-192.png` },
    ],
    generatorApp: 'montreal-compagnon',
    webManifestUrl: `${origin}/manifest.webmanifest`,
    // customtabs : si la vérification Digital Asset Links échoue, l'app
    // s'ouvre dans un onglet Chrome plutôt que d'afficher une page d'erreur.
    fallbackType: 'customtabs',
    features: {},
    alphaDependencies: { enabled: false },
    enableSiteSettingsShortcut: true,
    isChromeOSOnly: false,
    isMetaQuest: false,
    fullScopeUrl: `${origin}/`,
    minSdkVersion: 21,
    appVersion: env.versionName,
  };

  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  ok(`android/twa-manifest.json — origine ${origin}, version ${env.versionName} (${env.versionCode})`);
}

// ---------------------------------------------------------------------------
// Enregistrement dans Firebase (pour assetlinks.json)
// ---------------------------------------------------------------------------

function gcloudToken() {
  const command =
    process.platform === 'win32'
      ? `"${process.env.LOCALAPPDATA}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd"`
      : 'gcloud';
  try {
    return execFileSync(command, ['auth', 'print-access-token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    }).trim();
  } catch {
    fail("Impossible d'obtenir un jeton gcloud (gcloud auth login).");
  }
}

/**
 * Déclare l'application Android dans le projet Firebase et y attache
 * l'empreinte SHA-256. Firebase Hosting sert alors automatiquement le bon
 * `/.well-known/assetlinks.json` — rien à héberger à la main, et le fichier
 * suit le projet à chaque migration.
 */
async function registerAndroidApp() {
  if (!env.projectId) fail('GCP_PROJECT_ID est requis.');

  const sha = fingerprint();
  const token = gcloudToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'x-goog-user-project': env.projectId,
    'Content-Type': 'application/json',
  };
  const base = 'https://firebase.googleapis.com/v1beta1';

  const listed = await fetch(`${base}/projects/${env.projectId}/androidApps`, { headers })
    .then((r) => r.json())
    .catch(() => ({}));

  let app = (listed.apps ?? []).find((a) => a.packageName === env.packageId);

  if (!app) {
    console.log(`Déclaration de l'application Android « ${env.packageId} »…`);
    await fetch(`${base}/projects/${env.projectId}/androidApps`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ packageName: env.packageId, displayName: 'Montréal Compagnon' }),
    });

    for (let attempt = 1; attempt <= 10 && !app; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const again = await fetch(`${base}/projects/${env.projectId}/androidApps`, { headers })
        .then((r) => r.json())
        .catch(() => ({}));
      app = (again.apps ?? []).find((a) => a.packageName === env.packageId);
    }
    if (!app) fail("L'application Android n'est pas apparue après création.");
  }
  ok(`application Android : ${app.packageName}`);

  const certs = await fetch(`${base}/${app.name}/sha`, { headers })
    .then((r) => r.json())
    .catch(() => ({}));

  const normalized = sha.replace(/:/g, '').toLowerCase();
  const already = (certs.certificates ?? []).some(
    (c) => c.shaHash?.replace(/:/g, '').toLowerCase() === normalized,
  );

  if (already) {
    ok('empreinte SHA-256 déjà enregistrée');
  } else {
    const response = await fetch(`${base}/${app.name}/sha`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ shaHash: sha, certType: 'SHA_256' }),
    });
    if (!response.ok) {
      const body = await response.text();
      fail(`Enregistrement de l'empreinte refusé : ${body.slice(0, 300)}`);
    }
    ok(`empreinte SHA-256 enregistrée : ${sha}`);
  }

  info('');
  info('Firebase Hosting publiera assetlinks.json au prochain déploiement.');
  info(`  https://${env.domain}/.well-known/assetlinks.json`);
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function build() {
  if (!existsSync(MANIFEST_PATH)) fail('Manifeste absent. Lance « npm run android:manifest ».');
  if (!existsSync(KEYSTORE_PATH)) fail('Clé absente. Lance « npm run android:keystore ».');
  requirePasswords();

  const result = spawnSync(
    'npx',
    ['--yes', '@bubblewrap/cli@1.24.1', 'build', '--skipPwaValidation'],
    {
      cwd: ANDROID_DIR,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        // Bubblewrap lit ces variables plutôt que d'ouvrir une invite.
        BUBBLEWRAP_KEYSTORE_PASSWORD: env.storePassword,
        BUBBLEWRAP_KEY_PASSWORD: env.keyPassword,
      },
    },
  );

  if (result.status !== 0) fail('Échec de la construction Bubblewrap.');

  const apk = join(ANDROID_DIR, 'app-release-signed.apk');
  if (existsSync(apk)) {
    const size = Math.round(readFileSync(apk).length / 1024);
    ok(`APK signé : android/app-release-signed.apk (${size} Ko)`);
  } else {
    warn('Construction terminée, mais app-release-signed.apk est introuvable.');
  }
}

// ---------------------------------------------------------------------------

switch (command) {
  case 'keystore':
    createKeystore();
    break;

  case 'fingerprint':
    console.log(fingerprint());
    break;

  case 'manifest': {
    const origin = resolveOrigin();
    await checkOriginReachable(origin);
    writeManifest(origin);
    break;
  }

  case 'register':
    await registerAndroidApp();
    break;

  case 'build':
    build();
    break;

  case 'release': {
    const origin = resolveOrigin();
    await checkOriginReachable(origin);
    writeManifest(origin);
    build();
    break;
  }

  default:
    console.error('Commandes : keystore | manifest | fingerprint | register | build | release');
    process.exit(1);
}
