/** Types partagés des documents Firestore. */
import type { Timestamp } from 'firebase/firestore';

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  category: string;
  /** Nombre de jours AVANT le départ. 30 -> « J-30 ». */
  offsetDays: number;
  done: boolean;
  source: 'keep' | 'manual';
  labels: string[];
}

export interface Spot {
  id: string;
  name: string;
  neighborhood: string;
  category: string;
  address: string;
  geo: { lat: number; lng: number } | null;
  /** Lignes de métro STM desservant le lieu, ex. ['Orange', 'Verte']. */
  metro: string[];
  notes: string;
  url: string | null;
  priority: number;
  indoor: boolean;
  /** Météos pour lesquelles ce spot est particulièrement pertinent. */
  weatherTags: string[];
}

/** Étapes du suivi de candidature, dans l'ordre du pipeline. */
export type ApplicationStatus =
  | 'reperee'
  | 'postulee'
  | 'relance'
  | 'entretien'
  | 'offre'
  | 'refus'
  | 'abandon';

export interface InterviewQuestion {
  question: string;
  /** Réponse préparée. Vide tant qu'elle n'est pas travaillée. */
  answer: string;
}

export interface JobApplication {
  id: string;
  company: string;
  role: string;
  location: string;
  /** LinkedIn, Indeed, cooptation, candidature spontanée… */
  source: string;
  url: string;
  status: ApplicationStatus;
  /** Date de candidature, AAAA-MM-JJ. */
  appliedAt: string;
  /** Prochaine échéance (relance, entretien), AAAA-MM-JJ. */
  nextActionAt: string | null;
  nextAction: string;
  salaryRange: string;
  contactName: string;
  contactEmail: string;
  notes: string;
  /** Préparation d'entretien, propre à cette candidature. */
  questions: InterviewQuestion[];
  /** Questions à poser au recruteur. */
  toAsk: string[];
  /** Liens utiles : offre archivée, CV envoyé, portfolio. */
  links: { label: string; url: string }[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface LexiconEntry {
  id: string;
  term: string;
  definition: string;
  example: string;
  category:
    | 'expression'
    | 'nourriture'
    | 'transport'
    | 'quotidien'
    | 'juron'
    | 'anglicisme'
    | 'travail';
  /** Équivalent en français de France, quand il existe. */
  frenchEquivalent?: string;
}
