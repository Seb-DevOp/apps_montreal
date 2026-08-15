/**
 * Installation à Montréal — timeline post-arrivée.
 *
 * Symétrique de la check-list de départ, mais indexée sur la date d'ARRIVÉE
 * et non sur celle du décollage. C'est la distinction structurante : préparer
 * un départ et s'installer sont deux calendriers différents, le second
 * s'étalant sur une année.
 *
 * Deux échéances valent d'être signalées comme telles, parce que les rater
 * coûte cher et qu'elles arrivent longtemps après l'euphorie de l'arrivée :
 * la carence RAMQ d'environ trois mois, et la fenêtre d'échange du permis de
 * conduire.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { getConfig } from '../../lib/runtimeConfig';

interface SettlingTask {
  id: string;
  title: string;
  category: string;
  /** Nombre de jours APRÈS l'arrivée. */
  offsetDays: number;
  done: boolean;
  notes?: string;
  /** Jalon dont l'oubli a des conséquences durables. */
  critical?: boolean;
}

const CATEGORY_ICON: Record<string, string> = {
  administratif: '📄',
  argent: '💳',
  santé: '💊',
  logement: '🏠',
  transport: '🚇',
  technologie: '📱',
  travail: '💼',
  divers: '📌',
};

interface Phase {
  key: string;
  label: string;
  min: number;
  max: number;
}

const PHASES: Phase[] = [
  { key: 'semaine1', label: 'Première semaine · survie administrative', min: 0, max: 7 },
  { key: 'mois1', label: 'Premier mois · ancrage', min: 8, max: 40 },
  { key: 'trimestre', label: 'Mois 2 à 4 · le logement et la carence', min: 41, max: 120 },
  { key: 'semestre', label: 'Mois 5 à 8 · échéances à ne pas rater', min: 121, max: 240 },
  { key: 'an', label: 'Première année · bilan', min: 241, max: 99_999 },
];

export function Settling(): JSX.Element {
  const [tasks, setTasks] = useState<SettlingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const { trip } = getConfig();

  useEffect(() => {
    return onSnapshot(
      query(collection(db(), 'tasks'), where('phase', '==', 'installation')),
      (snapshot) => {
        setTasks(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as SettlingTask));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  // L'arrivée est le lendemain du départ : un vol France → Montréal atterrit
  // le jour même, mais le décalage et l'heure d'arrivée font que rien
  // d'administratif ne se fait avant le lendemain.
  const arrivalMs = useMemo(
    () => Date.parse(`${trip.departureDate}T00:00:00Z`) + 86400000,
    [trip.departureDate],
  );
  const todayMs = useMemo(
    () => Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`),
    [],
  );
  const daysSinceArrival = Math.round((todayMs - arrivalMs) / 86400000);
  const arrived = daysSinceArrival >= 0;

  const enriched = useMemo(
    () =>
      tasks
        .map((task) => {
          const dueMs = arrivalMs + task.offsetDays * 86400000;
          return {
            ...task,
            dueDate: new Date(dueMs),
            daysLeft: Math.round((dueMs - todayMs) / 86400000),
            overdue: !task.done && arrived && dueMs < todayMs,
          };
        })
        .sort((a, b) => a.offsetDays - b.offsetDays),
    [tasks, arrivalMs, todayMs, arrived],
  );

  const done = enriched.filter((t) => t.done).length;
  const overdue = enriched.filter((t) => t.overdue).length;
  const progress = enriched.length > 0 ? Math.round((done / enriched.length) * 100) : 0;

  const toggle = useCallback(async (task: SettlingTask) => {
    await updateDoc(doc(db(), 'tasks', task.id), {
      done: !task.done,
      doneAt: !task.done ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    });
  }, []);

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="rounded-2xl border border-stm/40 bg-stm/10 p-5 text-center">
        <div className="text-xs uppercase tracking-wider text-frost/60">
          {arrived ? 'À Montréal depuis' : 'Arrivée prévue le'}
        </div>
        <div className="mt-1 font-mono text-4xl font-semibold tabular-nums text-frost">
          {arrived
            ? daysSinceArrival < 60
              ? `${daysSinceArrival} jour${daysSinceArrival > 1 ? 's' : ''}`
              : `${Math.floor(daysSinceArrival / 30)} mois`
            : new Date(arrivalMs).toLocaleDateString('fr-FR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
              })}
        </div>
        {!arrived && (
          <p className="mt-2 text-xs text-frost/50">
            Cette liste se débloquera à l’atterrissage. Deux points sont toutefois à traiter avant
            le départ : l’assurance santé privée et le choix de la banque.
          </p>
        )}
      </div>

      {/* Progression */}
      {enriched.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-frost/70">
              {done} / {enriched.length} démarches
            </span>
            <span className="font-mono text-frost">{progress} %</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/30">
            <div className="h-full bg-mint transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          {overdue > 0 && (
            <p className="mt-2 text-sm text-maple">
              {overdue} démarche{overdue > 1 ? 's' : ''} en retard.
            </p>
          )}
        </div>
      )}

      {loading && <div className="h-40 animate-pulse rounded-2xl bg-white/5" />}

      {!loading && enriched.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center text-sm text-frost/40">
          Aucune démarche enregistrée. Lance l’injection du contenu de référence.
        </div>
      )}

      {/* Phases */}
      {PHASES.map((phase) => {
        const group = enriched.filter(
          (task) => task.offsetDays >= phase.min && task.offsetDays <= phase.max,
        );
        if (group.length === 0) return null;

        return (
          <section key={phase.key} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-xs uppercase tracking-wider text-frost/50">{phase.label}</h3>
            <ul className="mt-2 divide-y divide-white/5">
              {group.map((task) => (
                <li key={task.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => void toggle(task)}
                      aria-pressed={task.done}
                      aria-label={task.done ? 'Marquer à faire' : 'Marquer comme fait'}
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition ${
                        task.done ? 'border-mint bg-mint text-ink-900' : 'border-white/25'
                      }`}
                    >
                      {task.done && '✓'}
                    </button>

                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm ${
                          task.done ? 'text-frost/35 line-through' : 'text-frost/90'
                        }`}
                      >
                        {CATEGORY_ICON[task.category] ?? '📌'} {task.title}
                      </p>

                      <p className="mt-0.5 text-[11px] text-frost/40">
                        {task.offsetDays === 0
                          ? 'à l’arrivée'
                          : task.offsetDays < 30
                            ? `J+${task.offsetDays}`
                            : `mois ${Math.round(task.offsetDays / 30)}`}
                        {arrived &&
                          !task.done &&
                          (task.overdue
                            ? ` · en retard de ${Math.abs(task.daysLeft)} j`
                            : ` · dans ${task.daysLeft} j`)}
                        {task.critical && !task.done && (
                          <span className="ml-1 text-amber">· à ne pas rater</span>
                        )}
                      </p>

                      {task.notes && !task.done && (
                        <p
                          className={`mt-1.5 rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed ${
                            task.critical ? 'bg-amber/10 text-amber' : 'bg-black/20 text-frost/50'
                          }`}
                        >
                          {task.notes}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
