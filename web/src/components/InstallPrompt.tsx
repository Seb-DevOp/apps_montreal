/**
 * Invitation à l'installation sur l'écran d'accueil.
 *
 * Deux chemins irréconciliables :
 *  - Android/Chrome : bouton natif via `beforeinstallprompt`.
 *  - iOS/Safari : aucune API. On affiche les gestes à faire, parce qu'un
 *    bouton « Installer » qui ne fait rien est pire que pas de bouton.
 *
 * La bannière est reportable : refusée, elle ne revient pas avant 14 jours.
 * Personne n'a envie d'être harcelé par une PWA de voyage.
 */
import { useEffect, useState } from 'react';
import { detectPlatform, onInstallAvailabilityChange, promptInstall } from '../lib/pwa';

const SNOOZE_KEY = 'mtl.installSnoozedUntil';
const SNOOZE_DAYS = 14;

function isSnoozed(): boolean {
  const until = Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
  return Date.now() < until;
}

export function InstallPrompt(): JSX.Element | null {
  const [platform] = useState(detectPlatform);
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(isSnoozed);

  useEffect(() => onInstallAvailabilityChange(setAvailable), []);

  if (dismissed || platform === 'installed' || platform === 'unsupported') return null;
  // Sur Android/desktop, on attend le signal du navigateur : afficher la
  // bannière avant qu'il juge l'app installable ne mène nulle part.
  if (platform !== 'ios' && !available) return null;

  const snooze = () => {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86400000));
    setDismissed(true);
  };

  return (
    <div className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 rounded-2xl border border-white/15 bg-ink-700/95 p-4 shadow-2xl backdrop-blur animate-slide-up">
      <div className="flex items-start gap-3">
        <span className="text-2xl">🍁</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-frost">Installer sur l’écran d’accueil</p>

          {platform === 'ios' ? (
            <p className="mt-1 text-xs leading-relaxed text-frost/60">
              Appuie sur <strong className="text-frost/90">Partager</strong>{' '}
              <span className="inline-block rounded bg-white/10 px-1">⬆︎</span> en bas de Safari, puis{' '}
              <strong className="text-frost/90">Sur l’écran d’accueil</strong>. L’app s’ouvrira en plein
              écran, sans barre d’adresse, et fonctionnera hors-ligne.
            </p>
          ) : (
            <p className="mt-1 text-xs leading-relaxed text-frost/60">
              Accès en un tap, plein écran et consultation hors-ligne. Aucun store, aucun compte
              développeur.
            </p>
          )}

          <div className="mt-3 flex gap-2">
            {platform !== 'ios' && (
              <button
                type="button"
                onClick={() => {
                  void promptInstall().then((accepted) => {
                    if (!accepted) snooze();
                  });
                }}
                className="rounded-lg bg-stm px-4 py-2 text-sm font-medium text-white"
              >
                Installer
              </button>
            )}
            <button type="button" onClick={snooze} className="rounded-lg bg-white/10 px-4 py-2 text-sm text-frost/70">
              Plus tard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
