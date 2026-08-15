/**
 * Cycle de vie PWA : enregistrement du Service Worker, mise à jour et
 * invitation à l'installation.
 *
 * Deux plateformes, deux mondes :
 *  - Android/Chrome expose `beforeinstallprompt`, on peut déclencher la
 *    fenêtre native d'installation.
 *  - iOS/Safari n'expose rien : la seule voie est « Partager -> Sur l'écran
 *    d'accueil ». On détecte donc iOS pour afficher des instructions visuelles
 *    au lieu d'un bouton qui ne ferait rien.
 */
import { registerSW } from 'virtual:pwa-register';

export type InstallPlatform = 'android' | 'ios' | 'desktop' | 'installed' | 'unsupported';

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<(available: boolean) => void>();

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    navigator.standalone === true
  );
}

export function detectPlatform(): InstallPlatform {
  if (isStandalone()) return 'installed';
  const ua = navigator.userAgent;
  // iPadOS 13+ se présente comme un Mac : le test tactile lève l'ambiguïté.
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (isIOS) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if ('serviceWorker' in navigator) return 'desktop';
  return 'unsupported';
}

window.addEventListener('beforeinstallprompt', (event) => {
  // Sans preventDefault, Chrome affiche sa propre mini-infobar et on perd la
  // main sur le moment où l'on propose l'installation.
  event.preventDefault();
  deferredPrompt = event;
  installListeners.forEach((listener) => listener(true));
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  installListeners.forEach((listener) => listener(false));
});

export function onInstallAvailabilityChange(listener: (available: boolean) => void): () => void {
  installListeners.add(listener);
  listener(deferredPrompt !== null);
  return () => installListeners.delete(listener);
}

/** Déclenche la fenêtre d'installation native. Renvoie `true` si acceptée. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  await deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  // L'événement n'est utilisable qu'une fois.
  deferredPrompt = null;
  installListeners.forEach((listener) => listener(false));
  return outcome === 'accepted';
}

export interface SwController {
  /** Appelée quand une nouvelle version attend d'être activée. */
  onUpdateAvailable: (apply: () => void) => void;
  /** Appelée au premier cache complet (l'app marche hors-ligne). */
  onOfflineReady: () => void;
}

export function registerServiceWorker({ onUpdateAvailable, onOfflineReady }: SwController): void {
  if (!('serviceWorker' in navigator)) return;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      onUpdateAvailable(() => {
        // `true` -> reloadPage : le SW en attente prend la main puis la page
        // recharge. Déclenché uniquement sur clic de l'utilisateur.
        void updateSW(true);
      });
    },
    onOfflineReady,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Vérification horaire des mises à jour : sur mobile, l'onglet reste
      // ouvert des jours et le contrôle natif ne suffit pas.
      setInterval(() => void registration.update(), 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update();
      });
    },
    onRegisterError(error) {
      console.error('[pwa] enregistrement du Service Worker impossible', error);
    },
  });
}
