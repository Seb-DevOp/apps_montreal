/** Menu secondaire : modules qui ne tiennent pas dans la barre basse. */
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getConfig } from '../lib/runtimeConfig';

const LINKS = [
  { to: '/checklist', icon: '✅', label: 'Check & Sync', hint: 'Timeline de préparation' },
  { to: '/meteo', icon: '🌡', label: 'Météo ressentie', hint: 'Humidex, vent, quoi faire' },
  { to: '/lexique', icon: '🗣', label: 'Argot québécois', hint: 'Lexique et exemples' },
  { to: '/horloge', icon: '🕐', label: 'Double horloge', hint: 'Fenêtre pour appeler' },
];

export function More(): JSX.Element {
  const { user, logout } = useAuth();
  const config = getConfig();

  return (
    <div className="space-y-4">
      <ul className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
        {LINKS.map((link) => (
          <li key={link.to} className="border-b border-white/5 last:border-0">
            <Link to={link.to} className="flex items-center gap-3 p-4">
              <span className="text-xl">{link.icon}</span>
              <span className="flex-1">
                <span className="block text-sm text-frost">{link.label}</span>
                <span className="block text-[11px] text-frost/40">{link.hint}</span>
              </span>
              <span className="text-frost/25">›</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-frost/40">
        <p>Connecté en tant que {user?.email}</p>
        <p className="mt-1">
          Version {config.version} · projet {config.firebase.projectId}
        </p>
        <p className="mt-2 leading-relaxed">
          Application privée, réservée à un seul compte. L’infrastructure peut être recréée sur un
          nouveau projet Google Cloud sans qu’il soit nécessaire de réinstaller quoi que ce soit.
        </p>
      </div>

      <button
        type="button"
        onClick={() => void logout()}
        className="w-full rounded-xl bg-white/10 py-3 text-sm text-frost/70"
      >
        Se déconnecter
      </button>
    </div>
  );
}
