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
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  // ANDROID_HOST prime sur STABLE_DOMAIN : il permet de cibler une origine
  // différente de celle visée à terme, sans dénaturer le reste de la
  // configuration. Utile tant qu'aucun domaine personnalisé n'est raccordé.
  domain: process.env.ANDROID_HOST || process.env.STABLE_DOMAIN || '',
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

  if (/\.(web\.app|firebaseapp\.com)$/.test(env.domain)) {
    if (!force) {
      fail(
        `L'origine « ${env.domain} » est liée au projet Firebase.\n` +
          "  Elle change à chaque migration : l'APK deviendrait inutilisable.\n" +
          '  Utilise un domaine personnalisé, ou --force si tu acceptes ce compromis.',
      );
    }
    warn(`Origine liée au projet : ${env.domain}`);
    info("  L'APK cessera de fonctionner si le projet GCP est recréé sous un autre nom.");
    info('  Acceptable tant que le projet reste en place ; à refaire le jour où');
    info('  un domaine personnalisé est raccordé.');
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

/**
 * Chemin absolu de keytool.
 *
 * On l'invoque SANS shell : le dépôt peut vivre dans un chemin contenant des
 * espaces (« OneDrive - Ynov »), que le shell Windows découperait. Sans shell,
 * Node passe les arguments tels quels — mais exige alors un exécutable résolu.
 */
/** Chemin absolu de java, pour les mêmes raisons que keytool. */
function javaCommand() {
  const home = process.env.JAVA_HOME?.replace(/[\\/]+$/, '');
  const binary = process.platform === 'win32' ? 'java.exe' : 'java';

  if (home) {
    const candidate = join(home, 'bin', binary);
    if (existsSync(candidate)) return candidate;
  }
  return binary;
}

function keytoolCommand() {
  const home = process.env.JAVA_HOME?.replace(/[\\/]+$/, '');
  const binary = process.platform === 'win32' ? 'keytool.exe' : 'keytool';

  if (home) {
    const candidate = join(home, 'bin', binary);
    if (existsSync(candidate)) return candidate;
  }
  return binary;
}

function requirePasswords() {
  // Un magasin PKCS12 — le format par défaut depuis Java 9 — n'accepte qu'un
  // seul mot de passe. keytool ignore silencieusement -keypass, et la
  // signature échoue plus tard si les deux valeurs diffèrent.
  if (env.keyPassword && env.storePassword && env.keyPassword !== env.storePassword) {
    fail(
      'ANDROID_KEY_PASSWORD et ANDROID_STORE_PASSWORD doivent être identiques.\n' +
        "  Le format PKCS12 ne gère qu'un mot de passe ; en imposer deux produit\n" +
        '  une clé que Bubblewrap ne saura pas ouvrir.',
    );
  }

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
    keytoolCommand(),
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
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );

  ok(`clé créée : android/keystore.jks (alias « ${env.keyAlias} »)`);
  warn('Cette clé est ignorée par git. Sauvegarde-la hors du dépôt :');
  info('  sans elle, impossible de publier une mise à jour compatible.');
}

/** Empreinte SHA-256, au format attendu par les Digital Asset Links. */
function fingerprint() {
  if (!existsSync(KEYSTORE_PATH)) fail('Aucune clé. Lance « npm run android:keystore ».');
  requirePasswords();

  // Locale forcée : keytool traduit ses libellés, et l'empreinte devient
  // introuvable dès que la machine n'est pas en anglais.
  const output = execFileSync(
    keytoolCommand(),
    [
      '-J-Duser.language=en',
      '-J-Duser.country=US',
      '-list', '-v',
      '-keystore', KEYSTORE_PATH,
      '-alias', env.keyAlias,
      '-storepass', env.storePassword,
    ],
    { encoding: 'utf8' },
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
    // Bubblewrap attend `shortName` en camelCase — `short_name`, la clé du
    // manifeste web, produit un plantage à la génération Gradle.
    shortcuts: [
      { name: 'Calculateur de taxes', shortName: 'Taxes', url: '/taxes', chosenIconUrl: `${origin}/icons/icon-192.png` },
      { name: 'Journal photo', shortName: 'Journal', url: '/journal', chosenIconUrl: `${origin}/icons/icon-192.png` },
      { name: 'Check-list départ', shortName: 'Check-list', url: '/checklist', chosenIconUrl: `${origin}/icons/icon-192.png` },
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

  writeAssetLinks(sha);
}

/**
 * Écrit `/.well-known/assetlinks.json` dans les sources de la PWA.
 *
 * Firebase Hosting sait générer ce fichier depuis les applications Android
 * déclarées, mais la génération est opaque et s'est révélée peu fiable. On le
 * produit donc explicitement, et `firebase.json` désactive la génération
 * automatique (`appAssociation: "NONE"`) pour qu'elle ne l'écrase pas.
 *
 * Le contenu est public par nature : il sert justement à prouver, depuis le
 * site, quelle application est autorisée à l'afficher sans barre d'adresse.
 */
function writeAssetLinks(sha) {
  const target = join(ROOT, 'web', 'public', '.well-known');
  mkdirSync(target, { recursive: true });

  const statements = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: env.packageId,
        sha256_cert_fingerprints: [sha],
      },
    },
  ];

  writeFileSync(join(target, 'assetlinks.json'), `${JSON.stringify(statements, null, 2)}\n`);
  ok('web/public/.well-known/assetlinks.json écrit');
  info('  Redéploie le site pour le publier, sinon Android affichera la barre d’adresse.');
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Bubblewrap cherche un JDK et un SDK Android dans ~/.bubblewrap/config.json.
 * Sans ce fichier, il tente un téléchargement interactif — impossible en CI, et
 * inutile ici puisque les deux sont déjà installés.
 *
 * Écrit par Node et non par le shell : PowerShell produit de l'UTF-8 avec BOM,
 * que le parseur JSON de Bubblewrap rejette (« Unexpected token '﻿' »).
 */
function ensureBubblewrapConfig() {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return;

  const configPath = join(home, '.bubblewrap', 'config.json');
  if (existsSync(configPath)) return;

  const jdkPath = process.env.JAVA_HOME?.replace(/[\\/]+$/, '');
  const androidSdkPath = (
    process.env.ANDROID_HOME ??
    process.env.ANDROID_SDK_ROOT ??
    (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : '')
  ).replace(/[\\/]+$/, '');

  if (!jdkPath || !androidSdkPath || !existsSync(androidSdkPath)) {
    warn('JDK ou SDK Android introuvables — Bubblewrap tentera de les télécharger.');
    info('  Définis JAVA_HOME et ANDROID_HOME pour éviter un téléchargement de ~500 Mo.');
    return;
  }

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify({ jdkPath, androidSdkPath }, null, 2)}\n`, 'utf8');
  info(`configuration Bubblewrap écrite : ${configPath}`);
}

/** Racine du SDK Android, quelle qu'en soit la provenance. */
function androidSdkPath() {
  const candidate =
    process.env.ANDROID_HOME ??
    process.env.ANDROID_SDK_ROOT ??
    (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : '');
  return candidate.replace(/[\\/]+$/, '');
}

/**
 * Bubblewrap valide le SDK en cherchant `<sdk>/tools` ou `<sdk>/bin` —
 * l'ancienne disposition. Les SDK modernes rangent ces exécutables sous
 * `cmdline-tools/latest/`, et la validation échoue sur « The provided
 * androidSdk isn't correct ». On recrée la disposition attendue.
 */
function ensureSdkLayout() {
  const sdk = androidSdkPath();
  if (!sdk || !existsSync(sdk)) return;
  if (existsSync(join(sdk, 'bin')) || existsSync(join(sdk, 'tools'))) return;

  const source = join(sdk, 'cmdline-tools', 'latest');
  if (!existsSync(join(source, 'bin'))) {
    warn('cmdline-tools introuvables dans le SDK Android.');
    info(`  Installe-les via sdkmanager, ou dépose-les dans ${source}`);
    return;
  }

  cpSync(join(source, 'bin'), join(sdk, 'bin'), { recursive: true });
  cpSync(join(source, 'lib'), join(sdk, 'lib'), { recursive: true });
  info('disposition du SDK ajustée pour Bubblewrap (bin/ et lib/ à la racine)');
}

/** Version la plus récente des build-tools installées. */
function buildToolsPath() {
  const root = join(androidSdkPath(), 'build-tools');
  if (!existsSync(root)) fail('build-tools absentes du SDK Android.');

  const versions = readdirSync(root)
    .filter((entry) => /^\d+/.test(entry))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

  if (versions.length === 0) fail('Aucune version de build-tools installée.');
  return join(root, versions[0]);
}

/**
 * Aligne puis signe l'APK produit par Gradle.
 * Gradle le laisse non signé : la signature est portée par la clé locale, que
 * le projet généré ne connaît pas.
 */
function signApk() {
  const tools = buildToolsPath();
  const exe = (name) => join(tools, process.platform === 'win32' ? `${name}.exe` : name);

  const unsigned = join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk');
  if (!existsSync(unsigned)) fail(`APK introuvable après compilation : ${unsigned}`);

  const aligned = join(ANDROID_DIR, 'app-release-aligned.apk');
  const signed = join(ANDROID_DIR, 'app-release-signed.apk');

  // zipalign avant signature : l'inverse invaliderait la signature.
  const align = spawnSync(exe('zipalign'), ['-p', '-f', '4', unsigned, aligned], { stdio: 'inherit' });
  if (align.status !== 0) fail('Échec de zipalign.');

  // apksigner est distribué comme lanceur .bat, qui impose un shell — lequel
  // découpe les chemins contenant des espaces (« OneDrive - Ynov »). Le .jar
  // sous-jacent s'exécute directement par Java, sans shell ni quoting.
  const jar = join(tools, 'lib', 'apksigner.jar');
  if (!existsSync(jar)) fail(`apksigner.jar introuvable dans ${tools}`);

  const sign = spawnSync(
    javaCommand(),
    [
      '-jar', jar,
      'sign',
      '--ks', KEYSTORE_PATH,
      '--ks-key-alias', env.keyAlias,
      '--ks-pass', `pass:${env.storePassword}`,
      '--key-pass', `pass:${env.keyPassword}`,
      '--out', signed,
      aligned,
    ],
    { stdio: 'inherit' },
  );
  if (sign.status !== 0) fail('Échec de la signature.');

  rmSync(aligned, { force: true });

  const size = Math.round(readFileSync(signed).length / 1024);
  ok(`APK signé : android/app-release-signed.apk (${size} Ko)`);
}

function build() {
  if (!existsSync(MANIFEST_PATH)) fail('Manifeste absent. Lance « npm run android:manifest ».');
  if (!existsSync(KEYSTORE_PATH)) fail('Clé absente. Lance « npm run android:keystore ».');
  requirePasswords();
  ensureSdkLayout();
  ensureBubblewrapConfig();

  const bubblewrapEnv = {
    ...process.env,
    // Évite les invites de mot de passe au moment de la signature.
    BUBBLEWRAP_KEYSTORE_PASSWORD: env.storePassword,
    BUBBLEWRAP_KEY_PASSWORD: env.keyPassword,
  };

  const bubblewrap = (subArgs) =>
    spawnSync('npx', ['--yes', '@bubblewrap/cli@1.24.1', ...subArgs], {
      cwd: ANDROID_DIR,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: bubblewrapEnv,
    });

  // 1. (Re)génère le projet Android à partir du manifeste.
  //    --skipVersionUpgrade est indispensable : sans lui, Bubblewrap réclame
  //    interactivement un nouveau versionName et la construction se fige.
  //    C'est ce script qui pilote les versions, via le manifeste.
  console.log('Génération du projet Android…');
  if (bubblewrap(['update', '--skipVersionUpgrade']).status !== 0) {
    fail('Échec de la génération du projet (bubblewrap update).');
  }

  // 2. Déclare le manifeste comme « à jour ». Sans ce fichier, `build` ouvre
  //    une invite interactive pour proposer de régénérer le projet.
  writeFileSync(
    join(ANDROID_DIR, 'manifest-checksum.txt'),
    createHash('sha1').update(readFileSync(MANIFEST_PATH)).digest('hex'),
  );

  // 3. Compile via Gradle, puis aligne et signe avec les outils du SDK.
  //
  //    `bubblewrap build` ferait les trois d'un coup, mais il invoque
  //    `gradlew.bat` à travers un environnement de remplacement où cmd.exe ne
  //    le retrouve pas (« n'est pas reconnu »). Piloter Gradle et apksigner
  //    directement supprime cette dépendance et donne le même résultat sur
  //    Windows comme sur un runner Linux.
  console.log('Compilation Gradle…');
  const gradleCmd = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';
  const gradle = spawnSync(gradleCmd, ['assembleRelease', '--no-daemon'], {
    cwd: ANDROID_DIR,
    stdio: 'inherit',
    shell: true,
    env: bubblewrapEnv,
  });
  if (gradle.status !== 0) fail('Échec de la compilation Gradle.');

  signApk();
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
