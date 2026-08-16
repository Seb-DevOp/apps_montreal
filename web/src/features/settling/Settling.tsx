/**
 * Le parcours complet : avant le départ, puis après l'arrivée.
 *
 * Deux calendriers dans un seul écran, parce qu'ils forment une continuité —
 * mais avec deux origines de temps distinctes :
 *
 *   phase « depart »       offsetDays = jours AVANT le décollage
 *   phase « installation » offsetDays = jours APRÈS l'atterrissage
 *
 * Les mélanger dans une seule liste produirait un ordre incompréhensible. Les
 * séparer en onglets garde chaque échéance lisible dans son propre repère.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { api } from '../../lib/api';
import { getConfig } from '../../lib/runtimeConfig';

type Phase = 'depart' | 'installation';

interface Task {
  id: string;
  title: string;
  category: string;
  offsetDays: number;
  done: boolean;
  notes?: string;
  critical?: boolean;
  phase?: Phase;
}

const CATEGORY_ICON: Record<string, string> = {
  administratif: '📄',
  argent: '💳',
  santé: '💊',
  logement: '🏠',
  transport: '🚇',
  technologie: '📱',
  travail: '💼',
  bagages: '🧳',
  chat: '🐈',
  divers: '📌',
};

interface Milestone {
  key: string;
  label: string;
  min: number;
  max: number;
}

/** Jalons avant le départ : offsetDays décroît à mesure qu'on s'approche. */
const DEPARTURE_MILESTONES: Milestone[] = [
  { key: 'd120', label: 'J-120 à J-75 · les décisions lourdes', min: 75, max: 99_999 },
  { key: 'd74', label: 'J-74 à J-40 · démarches longues', min: 40, max: 74 },
  { key: 'd39', label: 'J-39 à J-15 · administratif France', min: 15, max: 39 },
  { key: 'd14', label: 'J-14 à J-6 · dernière ligne droite', min: 6, max: 14 },
  { key: 'd5', label: 'J-5 à J-0 · veille du départ', min: 0, max: 5 },
];

/** Phases après l'arrivée : offsetDays croît. */
const SETTLING_MILESTONES: Milestone[] = [
  { key: 'semaine1', label: 'Première semaine · survie administrative', min: 0, max: 7 },
  { key: 'mois1', label: 'Premier mois · ancrage', min: 8, max: 40 },
  { key: 'trimestre', label: 'Mois 2 à 4 · le logement et la carence', min: 41, max: 120 },
  { key: 'semestre', label: 'Mois 5 à 8 · échéances à ne pas rater', min: 121, max: 240 },
  { key: 'an', label: 'Première année · bilan', min: 241, max: 99_999 },
];

const DAY = 86_400_000;

function TaskRow({
  task,
  dueLabel,
  onToggle,
  onDelete,
}: {
  task: Task & { overdue: boolean };
  dueLabel: string;
  onToggle: () => void;
  onDelete?: () => void;
}) {
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={task.done}
          aria-label={task.done ? 'Marquer à faire' : 'Marquer comme fait'}
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition ${
            task.done ? 'border-mint bg-mint text-ink-900' : 'border-white/25'
          }`}
        >
          {task.done && '✓'}
        </button>

        <div className="min-w-0 flex-1">
          <p className={`text-sm ${task.done ? 'text-frost/35 line-through' : 'text-frost/90'}`}>
            {CATEGORY_ICON[task.category] ?? '📌'} {task.title}
          </p>

          <p className="mt-0.5 text-[11px] text-frost/40">
            {dueLabel}
            {task.critical && !task.done && <span className="ml-1 text-amber">· à ne pas rater</span>}
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

        {onDelete && (
          <button type="button" onClick={onDelete} aria-label="Supprimer" className="text-xs text-frost/20">
            ✕
          </button>
        )}
      </div>
    </li>
  );
}

export function Settling(): JSX.Element {
  const [tab, setTab] = useState<Phase>('depart');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const { trip } = getConfig();

  const fileRef = useRef<HTMLInputElement>(null);
  const [importState, setImportState] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newOffset, setNewOffset] = useState(7);

  useEffect(() => {
    setLoading(true);
    return onSnapshot(
      query(collection(db(), 'tasks'), where('phase', '==', tab)),
      (snapshot) => {
        setTasks(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Task));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [tab]);

  const departureMs = useMemo(
    () => Date.parse(`${trip.departureDate}T00:00:00Z`),
    [trip.departureDate],
  );
  // L'arrivée est datée au lendemain : un vol de nuit atterrit le matin, et
  // rien d'administratif ne se fait le jour même.
  const arrivalMs = departureMs + DAY;
  const todayMs = useMemo(
    () => Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`),
    [],
  );

  const daysToDeparture = Math.round((departureMs - todayMs) / DAY);
  const daysSinceArrival = Math.round((todayMs - arrivalMs) / DAY);
  const arrived = daysSinceArrival >= 0;

  const enriched = useMemo(
    () =>
      tasks
        .map((task) => {
          const dueMs =
            tab === 'depart'
              ? departureMs - task.offsetDays * DAY
              : arrivalMs + task.offsetDays * DAY;
          return {
            ...task,
            daysLeft: Math.round((dueMs - todayMs) / DAY),
            overdue: !task.done && dueMs < todayMs && (tab === 'depart' || arrived),
          };
        })
        .sort((a, b) => (tab === 'depart' ? b.offsetDays - a.offsetDays : a.offsetDays - b.offsetDays)),
    [tasks, tab, departureMs, arrivalMs, todayMs, arrived],
  );

  const done = enriched.filter((t) => t.done).length;
  const overdue = enriched.filter((t) => t.overdue).length;
  const progress = enriched.length > 0 ? Math.round((done / enriched.length) * 100) : 0;

  const toggle = useCallback(async (task: Task) => {
    await updateDoc(doc(db(), 'tasks', task.id), {
      done: !task.done,
      doneAt: !task.done ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    });
  }, []);

  const addTask = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    await addDoc(collection(db(), 'tasks'), {
      title,
      notes: null,
      category: 'divers',
      offsetDays: newOffset,
      phase: tab,
      done: false,
      doneAt: null,
      source: 'manual',
      labels: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setNewTitle('');
  }, [newTitle, newOffset, tab]);

  const importKeep = useCallback(async (files: FileList) => {
    setImportState('Lecture de l’export…');
    try {
      const notes = await Promise.all(
        [...files]
          .filter((file) => file.name.endsWith('.json'))
          .map(async (file) => JSON.parse(await file.text()) as unknown),
      );
      const result = await api.post<{ imported: number }>('/tasks/import-keep', { notes });
      setImportState(`${result.imported} tâches importées et classées.`);
    } catch (error) {
      setImportState(error instanceof Error ? error.message : 'Import impossible.');
    }
  }, []);

  const milestones = tab === 'depart' ? DEPARTURE_MILESTONES : SETTLING_MILESTONES;

  const dueLabel = (task: { offsetDays: number; daysLeft: number; done: boolean; overdue: boolean }) => {
    const anchor =
      tab === 'depart'
        ? `J-${task.offsetDays}`
        : task.offsetDays === 0
          ? 'à l’arrivée'
          : task.offsetDays < 30
            ? `J+${task.offsetDays}`
            : `mois ${Math.round(task.offsetDays / 30)}`;

    if (task.done) return anchor;
    if (task.overdue) return `${anchor} · en retard de ${Math.abs(task.daysLeft)} j`;
    if (tab === 'installation' && !arrived) return anchor;
    return `${anchor} · dans ${task.daysLeft} j`;
  };

  return (
    <div className="space-y-4">
      {/* Onglets */}
      <div className="flex gap-1 rounded-xl bg-black/25 p-1 text-sm">
        {([
          ['depart', 'Avant le départ'],
          ['installation', 'Après l’arrivée'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg py-2 transition ${
              tab === key ? 'bg-stm text-white' : 'text-frost/60'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Repère temporel */}
      <div className="rounded-2xl border border-stm/40 bg-stm/10 p-5 text-center">
        <div className="text-xs uppercase tracking-wider text-frost/60">
          {tab === 'depart'
            ? daysToDeparture > 0
              ? 'Départ pour Montréal'
              : 'Départ passé'
            : arrived
              ? 'À Montréal depuis'
              : 'Arrivée prévue le'}
        </div>
        <div className="mt-1 font-mono text-4xl font-semibold tabular-nums text-frost">
          {tab === 'depart'
            ? daysToDeparture > 0
              ? `J-${daysToDeparture}`
              : 'Envolé'
            : arrived
              ? daysSinceArrival < 60
                ? `${daysSinceArrival} jour${daysSinceArrival > 1 ? 's' : ''}`
                : `${Math.floor(daysSinceArrival / 30)} mois`
              : new Date(arrivalMs).toLocaleDateString('fr-FR', {
                  day: 'numeric',
                  month: 'long',
                  timeZone: 'UTC',
                })}
        </div>
        {tab === 'installation' && !arrived && (
          <p className="mt-2 text-xs leading-relaxed text-frost/50">
            Deux points de cette liste se traitent pourtant avant le départ : l’assurance santé
            privée pour couvrir la carence RAMQ, et le choix de la banque.
          </p>
        )}
      </div>

      {/* Progression */}
      {enriched.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-frost/70">
              {done} / {enriched.length} {tab === 'depart' ? 'tâches' : 'démarches'}
            </span>
            <span className="font-mono text-frost">{progress} %</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/30">
            <div className="h-full bg-mint transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          {overdue > 0 && (
            <p className="mt-2 text-sm text-maple">
              {overdue} en retard sur le calendrier.
            </p>
          )}
        </div>
      )}

      {loading && <div className="h-40 animate-pulse rounded-2xl bg-white/5" />}

      {!loading && enriched.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center text-sm text-frost/40">
          Aucune tâche. Lance l’injection du contenu de référence, ou ajoute la première ci-dessous.
        </div>
      )}

      {/* Jalons */}
      {milestones.map((milestone) => {
        const group = enriched.filter(
          (task) => task.offsetDays >= milestone.min && task.offsetDays <= milestone.max,
        );
        if (group.length === 0) return null;

        return (
          <section key={milestone.key} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-xs uppercase tracking-wider text-frost/50">{milestone.label}</h3>
            <ul className="mt-2 divide-y divide-white/5">
              {group.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  dueLabel={dueLabel(task)}
                  onToggle={() => void toggle(task)}
                  onDelete={
                    // Seules les tâches saisies à la main sont supprimables :
                    // celles du référentiel reviendraient au prochain seed.
                    /^(pre|inst)-/.test(task.id)
                      ? undefined
                      : () => void deleteDoc(doc(db(), 'tasks', task.id))
                  }
                />
              ))}
            </ul>
          </section>
        );
      })}

      {/* Ajout et import */}
      <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
        <h3 className="text-xs uppercase tracking-wider text-frost/50">
          Ajouter une tâche {tab === 'depart' ? 'avant le départ' : 'après l’arrivée'}
        </h3>
        <div className="flex gap-2">
          <input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder={tab === 'depart' ? 'Ex. Rendre les clés' : 'Ex. Ouvrir un compte Desjardins'}
            className="flex-1 rounded-xl bg-black/25 px-3 py-2.5 text-sm text-frost outline-none placeholder:text-frost/30"
          />
          <input
            type="number"
            min={0}
            max={730}
            value={newOffset}
            onChange={(event) => setNewOffset(Number(event.target.value))}
            aria-label={tab === 'depart' ? 'Jours avant le départ' : 'Jours après l’arrivée'}
            className="w-20 rounded-xl bg-black/25 px-3 py-2.5 text-center text-sm text-frost outline-none"
          />
          <button type="button" onClick={() => void addTask()} className="rounded-xl bg-stm px-4 text-sm text-white">
            +
          </button>
        </div>
        <p className="text-[11px] text-frost/35">
          Le nombre est le décalage en jours {tab === 'depart' ? 'avant le décollage' : 'après l’atterrissage'}.
        </p>

        {tab === 'depart' && (
          <div className="border-t border-white/10 pt-3">
            <h3 className="text-xs uppercase tracking-wider text-frost/50">Importer depuis Google Keep</h3>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) void importKeep(event.target.files);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-2 w-full rounded-xl bg-white/10 py-2.5 text-sm text-frost/80"
            >
              Choisir les fichiers Takeout (Keep/*.json)
            </button>
            <p className="mt-1.5 text-[11px] leading-relaxed text-frost/35">
              Google Keep n’expose pas d’API de lecture. Passe par takeout.google.com, coche
              uniquement Keep, puis dépose ici les fichiers JSON.
            </p>
            {importState && <p className="mt-2 text-sm text-mint">{importState}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
