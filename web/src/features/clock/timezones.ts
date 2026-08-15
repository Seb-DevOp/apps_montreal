/**
 * Logique de double fuseau horaire — France ↔ Montréal.
 *
 * Aucune constante d'offset codée en dur (« UTC-5 », « UTC+1 »). Ces valeurs
 * sont fausses la moitié de l'année : la France et le Québec passent à l'heure
 * d'été à des dates différentes (dernier dimanche de mars vs. deuxième dimanche
 * de mars), ce qui crée deux fenêtres de 3 semaines par an où l'écart n'est
 * plus de 6 h mais de 5 h. Tout est donc dérivé de la base IANA via `Intl`,
 * qui connaît ces règles et les met à jour avec le navigateur.
 */

export const HOME_TZ = 'Europe/Paris';
export const TRIP_TZ = 'America/Montreal';

export interface ZonedTime {
  timeZone: string;
  /** Heure locale formatée, ex. « 14:07:33 ». */
  time: string;
  /** Date locale formatée, ex. « jeu. 15 août ». */
  date: string;
  hour: number;
  minute: number;
  second: number;
  /** Décalage par rapport à UTC, en minutes (négatif à l'ouest). */
  offsetMinutes: number;
  /** Nom court du fuseau tel que rendu par le navigateur, ex. « UTC−4 ». */
  abbreviation: string;
  /** Vrai si le fuseau est actuellement à l'heure d'été. */
  isDst: boolean;
  /** Jour suivant / précédent par rapport à l'autre fuseau. */
  dayShift: -1 | 0 | 1;
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsIn(date: Date, timeZone: string): Parts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const lookup: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') lookup[part.type] = part.value;
  }

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    second: Number(lookup.second),
  };
}

/** Décalage UTC d'un fuseau à un instant donné, en minutes. */
export function offsetMinutes(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // On tronque à la seconde des deux côtés pour éviter un reste de millisecondes.
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/**
 * Détection de l'heure d'été : on compare l'offset courant au plus petit
 * offset observé sur l'année (l'heure d'hiver, par définition).
 */
export function isDaylightSaving(date: Date, timeZone: string): boolean {
  const year = date.getUTCFullYear();
  const january = offsetMinutes(new Date(Date.UTC(year, 0, 15)), timeZone);
  const july = offsetMinutes(new Date(Date.UTC(year, 6, 15)), timeZone);
  return offsetMinutes(date, timeZone) > Math.min(january, july);
}

function abbreviationFor(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('fr-FR', { timeZone, timeZoneName: 'shortOffset' });
  const part = formatter.formatToParts(date).find((p) => p.type === 'timeZoneName');
  return part?.value ?? '';
}

export function zonedTime(date: Date, timeZone: string, reference?: string): ZonedTime {
  const p = partsIn(date, timeZone);

  let dayShift: -1 | 0 | 1 = 0;
  if (reference) {
    const r = partsIn(date, reference);
    const self = Date.UTC(p.year, p.month - 1, p.day);
    const other = Date.UTC(r.year, r.month - 1, r.day);
    dayShift = self > other ? 1 : self < other ? -1 : 0;
  }

  return {
    timeZone,
    time: new Intl.DateTimeFormat('fr-FR', {
      timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date),
    date: new Intl.DateTimeFormat('fr-FR', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'long',
    }).format(date),
    hour: p.hour,
    minute: p.minute,
    second: p.second,
    offsetMinutes: offsetMinutes(date, timeZone),
    abbreviation: abbreviationFor(date, timeZone),
    isDst: isDaylightSaving(date, timeZone),
    dayShift,
  };
}

/** Écart entre deux fuseaux à un instant donné, en heures (peut être décimal). */
export function hoursBetween(date: Date, from: string, to: string): number {
  return (offsetMinutes(date, to) - offsetMinutes(date, from)) / 60;
}

// ---------------------------------------------------------------------------
// Fenêtre de contact
// ---------------------------------------------------------------------------

export type ContactStatus = 'ideal' | 'acceptable' | 'tardif' | 'interdit';

export interface ContactWindow {
  status: ContactStatus;
  label: string;
  detail: string;
  /** Heure locale (côté France) au moment du calcul. */
  homeHour: number;
  /** Prochain créneau favorable, exprimé dans les deux fuseaux. */
  next: { homeTime: string; tripTime: string; inMinutes: number } | null;
}

/** Bornes en heure française, du point de vue des proches qu'on appelle. */
const IDEAL = { start: 9, end: 21 };
const ACCEPTABLE = { start: 8, end: 22.5 };

function classify(homeHourDecimal: number): ContactStatus {
  if (homeHourDecimal >= IDEAL.start && homeHourDecimal < IDEAL.end) return 'ideal';
  if (homeHourDecimal >= ACCEPTABLE.start && homeHourDecimal < ACCEPTABLE.end) {
    return homeHourDecimal < IDEAL.start ? 'acceptable' : 'tardif';
  }
  return 'interdit';
}

/**
 * Évalue s'il est raisonnable d'appeler la France maintenant, et sinon quand.
 * La recherche du prochain créneau avance par pas de 15 min sur 48 h : ça
 * traverse correctement un changement d'heure sans arithmétique fragile.
 */
export function contactWindow(
  now: Date,
  homeTz: string = HOME_TZ,
  tripTz: string = TRIP_TZ,
): ContactWindow {
  const home = partsIn(now, homeTz);
  const homeHourDecimal = home.hour + home.minute / 60;
  const status = classify(homeHourDecimal);

  const labels: Record<ContactStatus, string> = {
    ideal: 'Bon moment pour appeler',
    acceptable: 'Tôt, mais ça passe',
    tardif: 'Tard — message plutôt qu’appel',
    interdit: 'Ils dorment',
  };

  const details: Record<ContactStatus, string> = {
    ideal: `Il est ${String(home.hour).padStart(2, '0')} h en France : journée pleine.`,
    acceptable: `Il est ${String(home.hour).padStart(2, '0')} h en France, le réveil est frais.`,
    tardif: `Il est ${String(home.hour).padStart(2, '0')} h en France : évite la sonnerie.`,
    interdit: `Il est ${String(home.hour).padStart(2, '0')} h en France. Un message attendra le matin.`,
  };

  let next: ContactWindow['next'] = null;
  if (status !== 'ideal') {
    for (let step = 1; step <= 192; step += 1) {
      const candidate = new Date(now.getTime() + step * 15 * 60000);
      const p = partsIn(candidate, homeTz);
      if (classify(p.hour + p.minute / 60) === 'ideal') {
        const format = (tz: string) =>
          new Intl.DateTimeFormat('fr-FR', {
            timeZone: tz,
            hourCycle: 'h23',
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }).format(candidate);
        next = { homeTime: format(homeTz), tripTime: format(tripTz), inMinutes: step * 15 };
        break;
      }
    }
  }

  return { status, label: labels[status], detail: details[status], homeHour: home.hour, next };
}

/** « 3 h 15 » à partir d'un nombre de minutes. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, '0')}`;
}
