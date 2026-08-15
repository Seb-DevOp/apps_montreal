/**
 * Routage et garde d'accès.
 *
 * Tout le contenu est derrière l'authentification : le journal photo montre le
 * logement, les habitudes et les enfants de la famille. Rien ne doit être
 * indexable ni accessible par URL devinée.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { useAuth } from './contexts/AuthContext';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { More } from './pages/More';
import { Admin } from './pages/Admin';
import { Journal } from './features/journal/Journal';
import { TaxCalculator } from './features/taxes/TaxCalculator';
import { Checklist } from './features/checklist/Checklist';
import { Spots } from './features/spots/Spots';
import { Weather } from './features/weather/Weather';
import { Lexicon } from './features/lexicon/Lexicon';
import { DualClock } from './features/clock/DualClock';

function Splash({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-ink-900 text-frost/50">
      <div className="text-4xl">🍁</div>
      <p className="text-sm">{message}</p>
    </div>
  );
}

export function App(): JSX.Element {
  const { user, role, loading } = useAuth();

  if (loading) return <Splash message="Ouverture du carnet…" />;
  if (!user) return <Login />;

  if (role === 'blocked') {
    return <Splash message="Ton accès a été suspendu. Contacte Seb si c’est une erreur." />;
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route path="journal" element={<Journal />} />
        <Route path="taxes" element={<TaxCalculator />} />
        <Route path="spots" element={<Spots />} />
        <Route path="plus" element={<More />} />
        <Route path="checklist" element={<Checklist />} />
        <Route path="meteo" element={<Weather />} />
        <Route path="lexique" element={<Lexicon />} />
        <Route path="horloge" element={<DualClock />} />
        <Route path="admin" element={role === 'admin' ? <Admin /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
