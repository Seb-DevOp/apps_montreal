/**
 * Routage et garde d'accès.
 *
 * Application mono-utilisateur : une seule adresse entre. Trois états
 * distincts, à ne pas confondre — non connecté, connecté mais non autorisé,
 * et autorisé. Le deuxième mérite un message explicite : quelqu'un qui s'est
 * authentifié avec le mauvais compte Google doit comprendre pourquoi il ne
 * voit rien, plutôt que de tomber sur un écran vide.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { useAuth } from './contexts/AuthContext';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { More } from './pages/More';
import { TaxCalculator } from './features/taxes/TaxCalculator';
import { Checklist } from './features/checklist/Checklist';
import { Spots } from './features/spots/Spots';
import { Weather } from './features/weather/Weather';
import { Lexicon } from './features/lexicon/Lexicon';
import { DualClock } from './features/clock/DualClock';
import { Applications } from './features/jobs/Applications';

function Splash({ message, action }: { message: string; action?: JSX.Element }): JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink-900 px-8 text-center text-frost/50">
      <div className="text-4xl">🍁</div>
      <p className="max-w-xs text-sm leading-relaxed">{message}</p>
      {action}
    </div>
  );
}

export function App(): JSX.Element {
  const { user, authorized, loading, logout } = useAuth();

  if (loading) return <Splash message="Ouverture du carnet…" />;
  if (!user) return <Login />;

  if (!authorized) {
    return (
      <Splash
        message={`Le compte ${user.email ?? ''} n’a pas accès à cette application. Elle est réservée à un seul utilisateur.`}
        action={
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-xl bg-white/10 px-5 py-2.5 text-sm text-frost"
          >
            Changer de compte
          </button>
        }
      />
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route path="taxes" element={<TaxCalculator />} />
        <Route path="spots" element={<Spots />} />
        <Route path="plus" element={<More />} />
        <Route path="checklist" element={<Checklist />} />
        <Route path="meteo" element={<Weather />} />
        <Route path="lexique" element={<Lexicon />} />
        <Route path="horloge" element={<DualClock />} />
        <Route path="embauche" element={<Applications />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
