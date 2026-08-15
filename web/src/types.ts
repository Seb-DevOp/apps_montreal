/** Types partagés des documents Firestore. */
import type { Timestamp } from 'firebase/firestore';

export interface GeoPoint {
  lat: number;
  lng: number;
  /** Libellé lisible, ex. « Mile End, Montréal ». */
  label?: string;
  /** Quartier déduit localement (voir data/neighborhoods.ts). */
  neighborhood?: string;
}

export interface Post {
  id: string;
  authorUid: string;
  authorName: string;
  caption: string;
  storagePath: string;
  thumbPath: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  location: GeoPoint | null;
  neighborhood: string | null;
  takenAt: Timestamp;
  createdAt: Timestamp;
  tags: string[];
}

export interface Comment {
  id: string;
  authorUid: string;
  authorName: string;
  authorPhoto: string | null;
  text: string;
  createdAt: Timestamp;
  editedAt?: Timestamp;
}

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

export interface LexiconEntry {
  id: string;
  term: string;
  definition: string;
  example: string;
  category: 'expression' | 'nourriture' | 'transport' | 'quotidien' | 'juron' | 'anglicisme';
  /** Équivalent en français de France, quand il existe. */
  frenchEquivalent?: string;
}
