/**
 * Suivi des candidatures — accès Firestore.
 *
 * Le tri se fait côté client plutôt qu'avec `orderBy` : le classement utile
 * n'est pas chronologique mais fondé sur l'urgence (une relance en retard doit
 * remonter), ce qu'aucun index Firestore ne sait exprimer. Le volume — quelques
 * dizaines de candidatures — rend le tri local sans conséquence.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { ApplicationStatus, JobApplication } from '../../types';

/** Ordre du pipeline, du plus amont au plus aval. */
export const STATUS_ORDER: ApplicationStatus[] = [
  'reperee',
  'postulee',
  'relance',
  'entretien',
  'offre',
  'refus',
  'abandon',
];

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  reperee: 'Repérée',
  postulee: 'Postulée',
  relance: 'Relancée',
  entretien: 'Entretien',
  offre: 'Offre',
  refus: 'Refus',
  abandon: 'Abandonnée',
};

/** Couleurs Tailwind par statut, réutilisées par les pastilles et le pipeline. */
export const STATUS_STYLE: Record<ApplicationStatus, string> = {
  reperee: 'bg-white/10 text-frost/60',
  postulee: 'bg-stm/20 text-stm',
  relance: 'bg-amber/20 text-amber',
  entretien: 'bg-mint/20 text-mint',
  offre: 'bg-mint/30 text-mint',
  refus: 'bg-maple/20 text-maple',
  abandon: 'bg-white/5 text-frost/30',
};

/** Statuts encore actifs — ceux qui appellent une action. */
const OPEN_STATUSES: ApplicationStatus[] = ['reperee', 'postulee', 'relance', 'entretien', 'offre'];

export const isOpen = (status: ApplicationStatus): boolean => OPEN_STATUSES.includes(status);

export interface EnrichedApplication extends JobApplication {
  /** Jours restants avant la prochaine action. Négatif si dépassée. */
  daysUntilAction: number | null;
  overdue: boolean;
  /** Progression de la préparation d'entretien, en pourcentage. */
  prepProgress: number;
}

function today(): number {
  return Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
}

function enrich(application: JobApplication): EnrichedApplication {
  const questions = application.questions ?? [];
  const answered = questions.filter((q) => q.answer.trim().length > 0).length;

  const daysUntilAction = application.nextActionAt
    ? Math.round((Date.parse(`${application.nextActionAt}T00:00:00Z`) - today()) / 86400000)
    : null;

  return {
    ...application,
    daysUntilAction,
    overdue: daysUntilAction !== null && daysUntilAction < 0 && isOpen(application.status),
    prepProgress: questions.length > 0 ? Math.round((answered / questions.length) * 100) : 0,
  };
}

export function useApplications(): {
  applications: EnrichedApplication[];
  loading: boolean;
  error: string | null;
} {
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(
      query(collection(db(), 'applications')),
      (snapshot) => {
        setApplications(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as JobApplication));
        setLoading(false);
        setError(null);
      },
      (caught) => {
        setLoading(false);
        setError(caught.message);
      },
    );
  }, []);

  const enriched = useMemo(() => {
    return applications.map(enrich).sort((a, b) => {
      // Les candidatures closes descendent systématiquement.
      const aOpen = isOpen(a.status);
      const bOpen = isOpen(b.status);
      if (aOpen !== bOpen) return aOpen ? -1 : 1;

      // Puis l'urgence : échéance dépassée d'abord, échéance proche ensuite,
      // enfin celles sans échéance.
      const aDays = a.daysUntilAction ?? Number.POSITIVE_INFINITY;
      const bDays = b.daysUntilAction ?? Number.POSITIVE_INFINITY;
      if (aDays !== bDays) return aDays - bDays;

      return a.company.localeCompare(b.company, 'fr');
    });
  }, [applications]);

  return { applications: enriched, loading, error };
}

export function useApplicationActions() {
  const create = useCallback(async (draft: Partial<JobApplication>) => {
    const ref = await addDoc(collection(db(), 'applications'), {
      company: draft.company?.trim() ?? '',
      role: draft.role?.trim() ?? '',
      location: draft.location ?? 'Montréal',
      source: draft.source ?? '',
      url: draft.url ?? '',
      status: draft.status ?? 'reperee',
      appliedAt: draft.appliedAt ?? new Date().toISOString().slice(0, 10),
      nextActionAt: draft.nextActionAt ?? null,
      nextAction: draft.nextAction ?? '',
      salaryRange: draft.salaryRange ?? '',
      contactName: draft.contactName ?? '',
      contactEmail: draft.contactEmail ?? '',
      notes: draft.notes ?? '',
      questions: draft.questions ?? [],
      toAsk: draft.toAsk ?? [],
      links: draft.links ?? [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  }, []);

  const update = useCallback(async (id: string, patch: Partial<JobApplication>) => {
    await updateDoc(doc(db(), 'applications', id), { ...patch, updatedAt: serverTimestamp() });
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteDoc(doc(db(), 'applications', id));
  }, []);

  return { create, update, remove };
}
