/**
 * Montréal Check & Sync — timeline rétroactive indexée sur la date de départ.
 *
 * Chaque tâche porte un `offsetDays` (30 = J-30) plutôt qu'une date absolue.
 * Deux raisons : un décalage du vol ne demande alors qu'à changer une seule
 * date dans `trips/current`, et les tâches importées de Google Keep peuvent
 * être classées automatiquement par mot-clé (voir api/src/routes/tasks.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { api } from '../../lib/api';
import { getConfig } from '../../lib/runtimeConfig';
import { useAuth } from '../../contexts/AuthContext';
import type { Task } from '../../types';

const CATEGORY_ICON: Record<string, string> = {
  administratif: '📄',
  technologie: '📱',
  argent: '💳',
  bagages: '🧳',
  transport: '✈️',
  santé: '💊',
  divers: '📌',
};

/** Groupe d'échéance, du plus lointain au plus proche. */
interface Milestone {
  key: string;
  label: string;
  min: number;
  max: number;
}

const MILESTONES: Milestone[] = [
  { key: 'j90', label: 'J-90 à J-45 · anticipation', min: 45, max: 9999 },
  { key: 'j30', label: 'J-44 à J-15 · démarches', min: 15, max: 44 },
  { key: 'j14', label: 'J-14 à J-8 · logistique', min: 8, max: 14 },
  { key: 'j7', label: 'J-7 à J-3 · dernière ligne droite', min: 3, max: 7 },
  { key: 'j2', label: 'J-2 à J-0 · veille du départ', min: 0, max: 2 },
];

function useTasks(): { tasks: Task[]; loading: boolean } {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onSnapshot(
      query(collection(db(), 'tasks'), orderBy('offsetDays', 'desc')),
      (snapshot) => {
        setTasks(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Task));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  return { tasks, loading };
}

export function Checklist(): JSX.Element {
  const { isAdmin } = useAuth();
  const { tasks, loading } = useTasks();
  const { trip } = getConfig();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importState, setImportState] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newOffset, setNewOffset] = useState(7);

  const departureMs = useMemo(() => Date.parse(`${trip.departureDate}T00:00:00Z`), [trip.departureDate]);
  const todayMs = useMemo(() => Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`), []);
  const daysToDeparture = Math.round((departureMs - todayMs) / 86400000);

  const enriched = useMemo(
    () =>
      tasks.map((task) => {
        const dueMs = departureMs - task.offsetDays * 86400000;
        return {
          ...task,
          dueDate: new Date(dueMs),
          daysLeft: Math.round((dueMs - todayMs) / 86400000),
          overdue: !task.done && dueMs < todayMs,
        };
      }),
    [tasks, departureMs, todayMs],
  );

  const doneCount = enriched.filter((task) => task.done).length;
  const overdueCount = enriched.filter((task) => task.overdue).length;
  const progress = enriched.length > 0 ? Math.round((doneCount / enriched.length) * 100) : 0;

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
      done: false,
      doneAt: null,
      source: 'manual',
      labels: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setNewTitle('');
  }, [newTitle, newOffset]);

  /**
   * Import Google Takeout. Keep n'a pas d'API publique : on lit les fichiers
   * JSON de l'export, un par note, et l'API se charge du classement.
   */
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

  return (
    <div className="space-y-4">
      {/* Compte à rebours */}
      <div className="rounded-2xl border border-stm/40 bg-stm/10 p-5 text-center">
        <div className="text-xs uppercase tracking-wider text-frost/60">Départ pour Montréal</div>
        <div className="mt-1 font-mono text-5xl font-semibold tabular-nums text-frost">
          {daysToDeparture > 0 ? `J-${daysToDeparture}` : daysToDeparture === 0 ? "C'est aujourd'hui" : 'En voyage'}
        </div>
        <div className="mt-1 text-sm text-frost/60">
          {new Date(departureMs).toLocaleDateString('fr-FR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          })}
        </div>
      </div>

      {/* Progression */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-frost/70">
            {doneCount} / {enriched.length} tâches
          </span>
          <span className="font-mono text-frost">{progress} %</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/30">
          <div
            className="h-full bg-mint transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        {overdueCount > 0 && (
          <p className="mt-2 text-sm text-maple">
            {overdueCount} tâche{overdueCount > 1 ? 's' : ''} en retard sur le calendrier.
          </p>
        )}
      </div>

      {/* Timeline */}
      {loading && <div className="h-40 animate-pulse rounded-2xl bg-white/5" />}

      {MILESTONES.map((milestone) => {
        const group = enriched.filter(
          (task) => task.offsetDays >= milestone.min && task.offsetDays <= milestone.max,
        );
        if (group.length === 0) return null;

        return (
          <section key={milestone.key} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-xs uppercase tracking-wider text-frost/50">{milestone.label}</h3>
            <ul className="mt-2 divide-y divide-white/5">
              {group.map((task) => (
                <li key={task.id} className="flex items-start gap-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => void toggle(task)}
                    disabled={!isAdmin}
                    aria-pressed={task.done}
                    aria-label={task.done ? 'Marquer à faire' : 'Marquer comme fait'}
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition ${
                      task.done ? 'border-mint bg-mint text-ink-900' : 'border-white/25'
                    } ${!isAdmin ? 'opacity-60' : ''}`}
                  >
                    {task.done && '✓'}
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${task.done ? 'text-frost/35 line-through' : 'text-frost/90'}`}>
                      {CATEGORY_ICON[task.category] ?? '📌'} {task.title}
                    </p>
                    <p className="mt-0.5 text-[11px] text-frost/40">
                      J-{task.offsetDays} ·{' '}
                      {task.dueDate.toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'short',
                        timeZone: 'UTC',
                      })}
                      {task.overdue && <span className="ml-1 text-maple">· en retard</span>}
                      {task.source === 'keep' && <span className="ml-1 text-frost/25">· Keep</span>}
                    </p>
                  </div>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => void deleteDoc(doc(db(), 'tasks', task.id))}
                      aria-label="Supprimer la tâche"
                      className="text-xs text-frost/20"
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {/* Outils admin */}
      {isAdmin && (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="text-xs uppercase tracking-wider text-frost/50">Ajouter une tâche</h3>
          <div className="flex gap-2">
            <input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="Ex. Activer l’eSIM Fizz"
              className="flex-1 rounded-xl bg-black/25 px-3 py-2.5 text-sm text-frost outline-none placeholder:text-frost/30"
            />
            <input
              type="number"
              min={0}
              max={365}
              value={newOffset}
              onChange={(event) => setNewOffset(Number(event.target.value))}
              aria-label="Jours avant le départ"
              className="w-20 rounded-xl bg-black/25 px-3 py-2.5 text-center text-sm text-frost outline-none"
            />
            <button
              type="button"
              onClick={() => void addTask()}
              className="rounded-xl bg-stm px-4 text-sm text-white"
            >
              +
            </button>
          </div>

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
              uniquement Keep, puis dépose ici les fichiers JSON : les jalons J-30 / J-7 / J-2 sont
              déduits automatiquement des mots-clés.
            </p>
            {importState && <p className="mt-2 text-sm text-mint">{importState}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
