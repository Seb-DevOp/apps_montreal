/**
 * Amorçage de l'application.
 *
 * Ordre imposé et non négociable :
 *   1. charger `/config.json` (projet Firebase courant) ;
 *   2. initialiser Firebase avec CETTE configuration ;
 *   3. seulement ensuite, monter React.
 *
 * C'est ce séquencement qui rend la migration trimestrielle indolore : aucun
 * identifiant de projet n'existe dans le bundle JavaScript, donc changer de
 * projet GCP ne demande aucun rebuild ni aucune réinstallation côté client.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './contexts/AuthContext';
import { initFirebase } from './lib/firebase';
import { loadRuntimeConfig } from './lib/runtimeConfig';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Élément #root introuvable.');

const root = createRoot(container);

function FatalError({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink-900 px-8 text-center text-frost">
      <div className="text-4xl">🍁</div>
      <p className="text-sm text-frost/60">{message}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-xl bg-stm px-5 py-2.5 text-sm text-white"
      >
        Réessayer
      </button>
    </div>
  );
}

async function bootstrap(): Promise<void> {
  try {
    const { config, migrated } = await loadRuntimeConfig();

    if (migrated) {
      // L'infrastructure a changé de projet GCP : les sessions de l'ancien
      // projet ne sont plus valides. L'utilisateur se reconnectera, mais son
      // installation PWA est intacte.
      console.info('[bootstrap] nouvelle infrastructure détectée');
    }

    await initFirebase(config.firebase);

    root.render(
      <StrictMode>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </StrictMode>,
    );
  } catch (error) {
    root.render(
      <FatalError
        message={
          error instanceof Error
            ? error.message
            : "L'application n'a pas pu démarrer. Vérifie ta connexion."
        }
      />,
    );
  }
}

void bootstrap();
