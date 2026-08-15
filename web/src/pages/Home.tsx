/**
 * Accueil — cadré « installation » et non « voyage ».
 *
 * Un compte à rebours puis un décompte de jours n'a de sens que sur un séjour
 * court. Sur une expatriation de deux ans, l'information utile change avec le
 * temps : d'abord le départ, puis les démarches à faire, puis l'échéance de
 * décision. L'accueil suit donc quatre phases successives.
 */
import { Link } from 'react-router-dom';
import { DualClock } from '../features/clock/DualClock';
import { getConfig } from '../lib/runtimeConfig';
import { useAuth } from '../contexts/AuthContext';

const SHORTCUTS = [
  { to: '/installation', icon: '🧭', label: 'Installation', hint: 'NAS, RAMQ, permis' },
  { to: '/embauche', icon: '💼', label: 'Embauche', hint: 'Candidatures & entretiens' },
  { to: '/logement', icon: '🏠', label: 'Logement', hint: 'Visites & loyers' },
  { to: '/salaire', icon: '🧮', label: 'Salaire net', hint: 'Brut → net mensuel' },
  { to: '/meteo', icon: '🌡', label: 'Ressenti réel', hint: 'Humidex & vent' },
  { to: '/lexique', icon: '🗣', label: 'Argot', hint: 'Décoder le québécois' },
];

const DAY = 86_400_000;

interface Phase {
  label: string;
  value: string;
  detail: string;
}

/**
 * Quatre étapes, chacune avec sa propre unité de mesure. Compter en jours au
 * bout de dix-huit mois n'apprendrait rien à personne.
 */
function currentPhase(departureMs: number, decisionMs: number, todayMs: number): Phase {
  const daysToDeparture = Math.round((departureMs - todayMs) / DAY);
  const daysSince = Math.round((todayMs - departureMs) / DAY);

  if (daysToDeparture > 0) {
    return {
      label: 'Départ pour Montréal',
      value: `J-${daysToDeparture}`,
      detail: new Date(departureMs).toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    };
  }

  // Les trois premiers mois sont ceux des démarches : le décompte en jours y
  // reste pertinent, car les échéances administratives s'y comptent ainsi.
  if (daysSince <= 90) {
    return {
      label: 'Installation en cours',
      value: `Jour ${daysSince + 1}`,
      detail: 'Les démarches administratives se jouent sur ce trimestre.',
    };
  }

  const monthsToDecision = Math.round((decisionMs - todayMs) / (DAY * 30));
  if (monthsToDecision > 0) {
    return {
      label: 'À Montréal depuis',
      value: `${Math.floor(daysSince / 30)} mois`,
      detail: `Point d’étape « rester ou rentrer » dans ${monthsToDecision} mois.`,
    };
  }

  return {
    label: 'À Montréal depuis',
    value: `${Math.floor(daysSince / 30)} mois`,
    detail: 'L’échéance que tu t’étais fixée est passée.',
  };
}

export function Home(): JSX.Element {
  const { user } = useAuth();
  const { trip } = getConfig();

  const departureMs = Date.parse(`${trip.departureDate}T00:00:00Z`);
  const todayMs = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const decisionMs = trip.decisionDate
    ? Date.parse(`${trip.decisionDate}T00:00:00Z`)
    : departureMs + 365 * DAY;

  const phase = currentPhase(departureMs, decisionMs, todayMs);

  return (
    <div className="space-y-5">
      <p className="text-sm text-frost/50">Salut {user?.displayName?.split(' ')[0] ?? ''}.</p>

      <div className="rounded-2xl border border-stm/40 bg-stm/10 p-5 text-center">
        <div className="text-xs uppercase tracking-wider text-frost/60">{phase.label}</div>
        <div className="mt-1 font-mono text-5xl font-semibold tabular-nums text-frost">
          {phase.value}
        </div>
        <div className="mt-2 text-sm text-frost/60">{phase.detail}</div>
      </div>

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
