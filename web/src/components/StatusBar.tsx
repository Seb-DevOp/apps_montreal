/**
 * Bandeaux d'état : mise à jour disponible, hors-ligne, prêt hors-ligne.
 *
 * La mise à jour n'est jamais appliquée d'office (cf. `registerType: 'prompt'`
 * dans vite.config.ts) : recharger la page pendant un upload de photo ferait
 * perdre le travail en cours.
 */
import { useEffect, useState } from 'react';
import { registerServiceWorker } from '../lib/pwa';

export function StatusBar(): JSX.Element | null {
  const [applyUpdate, setApplyUpdate] = useState<(() => void) | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    registerServiceWorker({
      // Le state stocke une fonction : d'où le wrapper `() => fn`, sinon React
      // l'exécuterait comme un updater.
      onUpdateAvailable: (apply) => setApplyUpdate(() => apply),
      onOfflineReady: () => {
        setOfflineReady(true);
        window.setTimeout(() => setOfflineReady(false), 4000);
      },
    });

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (applyUpdate) {
    return (
      <div className="fixed inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-50 flex items-center gap-3 rounded-xl border border-stm/40 bg-ink-700/95 p-3 shadow-xl backdrop-blur animate-slide-up">
        <span className="text-sm text-frost/80">Une nouvelle version est prête.</span>
        <button
          type="button"
          onClick={applyUpdate}
          className="ml-auto rounded-lg bg-stm px-3 py-1.5 text-sm text-white"
        >
          Recharger
        </button>
        <button
          type="button"
          onClick={() => setApplyUpdate(null)}
          aria-label="Plus tard"
          className="text-frost/40"
        >
          ✕
        </button>
      </div>
    );
  }

  if (!online) {
    return (
      <div className="sticky top-0 z-30 bg-amber/20 px-4 py-1.5 text-center text-xs text-amber">
        Hors-ligne — les données affichées viennent de la mémoire de l’appareil.
      </div>
    );
  }

  if (offlineReady) {
    return (
      <div className="sticky top-0 z-30 bg-mint/15 px-4 py-1.5 text-center text-xs text-mint">
        Application disponible hors-ligne.
      </div>
    );
  }

  return null;
}
