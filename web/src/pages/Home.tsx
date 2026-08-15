/**
 * Accueil : ce dont on a besoin en trois secondes, sans naviguer.
 * L'ordre des blocs suit l'usage réel — l'heure et le compte à rebours
 * d'abord, la dernière photo ensuite, les raccourcis en bas.
 */
import { Link } from 'react-router-dom';
import { DualClock } from '../features/clock/DualClock';
import { usePosts } from '../features/journal/usePosts';
import { getConfig } from '../lib/runtimeConfig';
import { useAuth } from '../contexts/AuthContext';

export function Home(): JSX.Element {
  const { user } = useAuth();
  const { trip } = getConfig();
  const { posts } = usePosts({ max: 1 });
  const latest = posts[0];

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

      {latest && (
        <Link to="/journal" className="block overflow-hidden rounded-2xl border border-white/10">
          <img
            src={latest.thumbUrl}
            alt={latest.caption || 'Dernière photo'}
            className="h-48 w-full object-cover"
            loading="lazy"
          />
          <div className="bg-white/5 p-3">
            <p className="text-xs uppercase tracking-wider text-frost/40">Dernière photo</p>
            <p className="mt-0.5 line-clamp-2 text-sm text-frost/80">
              {latest.caption || latest.neighborhood || 'Sans légende'}
            </p>
          </div>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3">
        {[
          { to: '/checklist', icon: '✅', label: 'Check & Sync', hint: 'Timeline J-30 → J-0' },
          { to: '/meteo', icon: '🌡', label: 'Ressenti réel', hint: 'Humidex & vent' },
          { to: '/lexique', icon: '🗣', label: 'Argot', hint: 'Décoder le québécois' },
          { to: '/taxes', icon: '💵', label: 'Taxes', hint: 'TPS + TVQ + pourboire' },
        ].map((shortcut) => (
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
