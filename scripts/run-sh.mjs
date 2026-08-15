#!/usr/bin/env node
/**
 * Lanceur de scripts shell, portable.
 *
 * Windows n'a ni `make` ni `bash` dans le PATH de PowerShell. Plutôt que de
 * réécrire `bootstrap-ci.sh` et `deploy.sh` en PowerShell — deux vérités qui
 * divergeraient au premier correctif — ce lanceur localise le bash livré avec
 * Git et lui passe le script demandé.
 *
 * Node étant déjà un prérequis du projet, `npm run bootstrap` fonctionne donc
 * depuis PowerShell, cmd, Git Bash, macOS ou Linux sans rien installer de plus.
 *
 * Usage :
 *   node scripts/run-sh.mjs <script.sh> [arguments…]
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';

const [scriptPath, ...scriptArgs] = process.argv.slice(2);

if (!scriptPath) {
  console.error('Usage : node scripts/run-sh.mjs <script.sh> [arguments…]');
  process.exit(1);
}

const target = resolve(ROOT, scriptPath);
if (!existsSync(target)) {
  console.error(`${RED}Script introuvable : ${target}${RESET}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Localiser bash
// ---------------------------------------------------------------------------

function findBash() {
  if (process.platform !== 'win32') return '/bin/bash';

  const candidates = [
    `${process.env.ProgramFiles ?? 'C:\\Program Files'}\\Git\\bin\\bash.exe`,
    `${process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'}\\Git\\bin\\bash.exe`,
    `${process.env.LOCALAPPDATA ?? ''}\\Programs\\Git\\bin\\bash.exe`,
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Dernier recours : bash présent dans le PATH (WSL, MSYS2, Cygwin…).
  const found = spawnSync('where', ['bash'], { encoding: 'utf8' });
  const first = found.stdout?.split(/\r?\n/).find((line) => line.trim().endsWith('.exe'));
  return first?.trim() ?? null;
}

const bash = findBash();

if (!bash) {
  console.error(`\n${RED}bash est introuvable.${RESET}`);
  console.error(`${YELLOW}Installe Git for Windows, qui le fournit :${RESET}`);
  console.error('  winget install --id Git.Git -e\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Vérifier les prérequis, avec un message utile plutôt qu'une erreur du shell
// ---------------------------------------------------------------------------

function isAvailable(command) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(probe, [command], { stdio: 'ignore' }).status === 0;
}

/**
 * Emplacements d'installation habituels du SDK Google Cloud.
 *
 * L'installeur Windows modifie le PATH de l'utilisateur, mais les terminaux
 * déjà ouverts gardent l'ancien : sans ce rattrapage, on afficherait « gcloud
 * manquant » à quelqu'un qui vient précisément de l'installer.
 */
const EXTRA_PATHS =
  process.platform === 'win32'
    ? [
        `${process.env.LOCALAPPDATA ?? ''}\\Google\\Cloud SDK\\google-cloud-sdk\\bin`,
        `${process.env['ProgramFiles(x86)'] ?? ''}\\Google\\Cloud SDK\\google-cloud-sdk\\bin`,
        `${process.env.ProgramFiles ?? ''}\\Google\\Cloud SDK\\google-cloud-sdk\\bin`,
      ]
    : ['/usr/local/share/google-cloud-sdk/bin', `${process.env.HOME ?? ''}/google-cloud-sdk/bin`];

const recovered = EXTRA_PATHS.filter(
  (dir) => dir && existsSync(join(dir, process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud')),
);

if (recovered.length > 0) {
  process.env.PATH = `${process.env.PATH}${process.platform === 'win32' ? ';' : ':'}${recovered[0]}`;
}

// Le choix du bon lanceur gcloud sous Git Bash (`gcloud.cmd` et non le script
// POSIX) est traité dans les scripts shell eux-mêmes, pour qu'ils restent
// corrects lancés directement, sans passer par ce fichier.

const INSTALL_HINTS = {
  gcloud: [
    'Google Cloud SDK — indispensable : création du projet, du service account',
    'et de la fédération d’identité passent tous par gcloud.',
    '',
    '  winget install --id Google.CloudSDK -e',
    '  (ou https://cloud.google.com/sdk/docs/install)',
    '',
    'Puis, dans un NOUVEAU terminal :',
    '  gcloud auth login',
    '  gcloud auth application-default login',
  ],
};

const required = scriptArgs.includes('--no-check') ? [] : ['gcloud'];
const missing = required.filter((tool) => !isAvailable(tool));

if (missing.length > 0) {
  console.error(`\n${RED}Outils manquants : ${missing.join(', ')}${RESET}\n`);
  for (const tool of missing) {
    console.error(`${YELLOW}${(INSTALL_HINTS[tool] ?? []).join('\n')}${RESET}\n`);
  }
  process.exit(1);
}

if (recovered.length > 0) {
  console.log(`${DIM}gcloud : ${recovered[0]} (ajouté au PATH de cette exécution)${RESET}`);
}

if (!existsSync(join(ROOT, '.env'))) {
  console.error(`\n${RED}Fichier .env absent.${RESET}`);
  console.error('  cp .env.example .env       (PowerShell : Copy-Item .env.example .env)');
  console.error('  puis complète-le avant de relancer.\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Exécuter
// ---------------------------------------------------------------------------

console.log(`${DIM}bash : ${bash}${RESET}`);

const result = spawnSync(bash, [target, ...scriptArgs.filter((a) => a !== '--no-check')], {
  cwd: ROOT,
  stdio: 'inherit',
  // La conversion d'arguments de MSYS est laissée ACTIVE : gcloud en dépend
  // pour traduire le chemin interne qu'il passe à son python.exe. La désactiver
  // (MSYS_NO_PATHCONV) casse toutes les commandes gcloud sous Git Bash.
  env: process.env,
});

process.exit(result.status ?? 1);
