/**
 * Accueil : ce dont on a besoin en trois secondes, sans naviguer.
 * L'ordre suit l'usage réel — l'heure et le compte à rebours d'abord, les
 * raccourcis ensuite.
 */
import { Link } from 'react-router-dom';
import { DualClock } from '../features/clock/DualClock';
import { getConfig } from '../lib/runtimeConfig';
import { useAuth } from '../contexts/AuthContext';

const SHORTCUTS = [
  { to: '/embauche', icon: '💼', label: 'Embauche', hint: 'Candidatures & entretiens' },
  { to: '/checklist', icon: '✅', label: 'Check & Sync', hint: 'Timeline J-30 → J-0' },
  { to: '/taxes', icon: '💵', label: 'Taxes', hint: 'TPS + TVQ + pourboire' },
  { to: '/meteo', icon: '🌡', label: 'Ressenti réel', hint: 'Humidex & vent' },
  { to: '/spots', icon: '📍', label: 'Spots', hint: 'Par quartier' },
  { to: '/lexique', icon: '🗣', label: 'Argot', hint: 'Décoder le québécois' },
];

export function Home(): JSX.Element {
  const { user } = useAuth();
  const { trip } = getConfig();

  const departureMs = Date.parse(`${trip.departureDate}T00:00:00Z`);
  const returnMs = Date.parse(`${trip.returnDate}T00:00:00Z`);
  const todayMs = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const daysToDeparture = Math.round((departureMs - todayMs) / 86400000);
  const inTrip = todayMs >= departureMs && todayMs <= returnMs;

  return (
    <div className="space-y-5">
      <p className="text-sm text-frost/50">
        Salut {user?.displayName?.split(' ')[0] ?? ''} —{' '}
        {inTrip
          ? `jour ${Math.round((todayMs - departureMs) / 86400000) + 1} à Montréal.`
          : daysToDeparture > 0
            ? `plus que ${daysToDeparture} jour${daysToDeparture > 1 ? 's' : ''} avant le décollage.`
            : 'le voyage est derrière, les souvenirs sont là.'}
      </p>

      <DualClock />

      <div className="grid grid-cols-2 gap-3">
        {SHORTCUTS.map((shortcut) => (
          <Link
            key={shortcut.to}
            to={shortcut.to}
            className="rounded-2xl border border-white/10 bg-white/5 p-4"
          >
            <div className="text-2xl">{shortcut.icon}</div>
            <div className="mt-2 text-sm font-medium text-frost">{shortcut.label}</div>
            <div className="text-[11px] text-frost/40">{shortcut.hint}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
