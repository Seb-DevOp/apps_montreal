/**
 * Coquille de l'application : en-tête, contenu, barre de navigation basse.
 *
 * Navigation en bas et non en haut : en standalone sur un grand téléphone, le
 * haut de l'écran est hors de portée du pouce. Les zones sûres iOS (encoche,
 * barre home) sont respectées via `env(safe-area-inset-*)`.
 */
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { StatusBar } from './StatusBar';
import { InstallPrompt } from './InstallPrompt';

interface Tab {
  to: string;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { to: '/', label: 'Accueil', icon: '🏠' },
  { to: '/embauche', label: 'Embauche', icon: '💼' },
  { to: '/installation', label: 'Installation', icon: '🧭' },
  { to: '/spots', label: 'Spots', icon: '📍' },
  { to: '/plus', label: 'Plus', icon: '⋯' },
];

const TITLES: Record<string, string> = {
  '/': 'Montréal Compagnon',
  '/taxes': 'Taxes & pourboires',
  '/spots': 'Micro-spots',
  '/plus': 'Plus',
  '/checklist': 'Check & Sync',
  '/meteo': 'Météo ressentie',
  '/lexique': 'Argot québécois',
  '/horloge': 'Double horloge',
  '/embauche': 'Embauche',
  '/installation': 'Installation',
  '/salaire': 'Salaire net',
  '/logement': 'Logement',
};

export function AppShell(): JSX.Element {
  const { user, logout } = useAuth();
  const location = useLocation();
  const title = TITLES[location.pathname] ?? 'Montréal Compagnon';

  return (
    <div className="flex min-h-dvh flex-col bg-ink-900 text-frost">
      <StatusBar />

      <header className="sticky top-0 z-20 border-b border-white/5 bg-ink-900/85 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <h1 className="truncate text-lg font-semibold">{title}</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void logout()}
              title={user?.email ?? ''}
              className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-white/10 text-xs"
            >
              {user?.photoURL ? (
                <img src={user.photoURL} alt="" className="h-full w-full object-cover" />
              ) : (
                (user?.displayName ?? 'V').charAt(0).toUpperCase()
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>

      <InstallPrompt />

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/5 bg-ink-800/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-2xl">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === '/'}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] transition ${
                  isActive ? 'text-stm' : 'text-frost/40'
                }`
              }
            >
              <span className="text-xl leading-none">{tab.icon}</span>
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
