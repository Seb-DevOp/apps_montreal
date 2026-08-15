/**
 * Horloge double France / Montréal + indicateur de fenêtre de contact.
 *
 * Rafraîchissement à la seconde, mais suspendu quand l'onglet est masqué :
 * une PWA laissée ouverte dans la poche ne doit pas réveiller le CPU toutes
 * les secondes pour rien.
 */
import { useEffect, useMemo, useState } from 'react';
import { getConfig } from '../../lib/runtimeConfig';
import {
  contactWindow,
  formatDuration,
  hoursBetween,
  zonedTime,
  type ContactStatus,
} from './timezones';

function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: number | undefined;

    const start = () => {
      setNow(new Date());
      timer = window.setInterval(() => setNow(new Date()), intervalMs);
    };
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };

    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);

  return now;
}

const STATUS_STYLE: Record<ContactStatus, { dot: string; ring: string; text: string }> = {
  ideal: { dot: 'bg-mint', ring: 'ring-mint/40', text: 'text-mint' },
  acceptable: { dot: 'bg-amber', ring: 'ring-amber/40', text: 'text-amber' },
  tardif: { dot: 'bg-amber', ring: 'ring-amber/40', text: 'text-amber' },
  interdit: { dot: 'bg-maple', ring: 'ring-maple/40', text: 'text-maple' },
};

interface ClockFaceProps {
  label: string;
  flag: string;
  timeZone: string;
  reference: string;
  now: Date;
  accent: string;
  primary?: boolean;
}

function ClockFace({ label, flag, timeZone, reference, now, accent, primary }: ClockFaceProps) {
  const zone = useMemo(() => zonedTime(now, timeZone, reference), [now, timeZone, reference]);
  const [hhmm, ss] = [zone.time.slice(0, 5), zone.time.slice(6, 8)];

  return (
    <div
      className={`flex-1 rounded-2xl border p-4 ${
        primary ? 'border-stm/40 bg-stm/10' : 'border-white/10 bg-white/5'
      }`}
    >
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-frost/60">
        <span>
          {flag} {label}
        </span>
        {zone.isDst && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px]">heure d’été</span>}
      </div>

      <div className="mt-2 flex items-baseline gap-1">
        <span className={`font-mono text-4xl font-semibold tabular-nums ${accent}`}>{hhmm}</span>
        <span className="font-mono text-lg tabular-nums text-frost/40">:{ss}</span>
      </div>

      <div className="mt-1 text-sm text-frost/70">
        {zone.date}
        {zone.dayShift === 1 && <span className="ml-1 text-frost/40">(J+1)</span>}
        {zone.dayShift === -1 && <span className="ml-1 text-frost/40">(J-1)</span>}
      </div>
      <div className="mt-0.5 text-xs text-frost/40">{zone.abbreviation}</div>
    </div>
  );
}

export function DualClock(): JSX.Element {
  const now = useNow();
  const { trip } = getConfig();
  const homeTz = trip.homeTimeZone;
  const tripTz = trip.tripTimeZone;

  const delta = useMemo(() => hoursBetween(now, homeTz, tripTz), [now, homeTz, tripTz]);
  const window_ = useMemo(() => contactWindow(now, homeTz, tripTz), [now, homeTz, tripTz]);
  const style = STATUS_STYLE[window_.status];

  return (
    <section className="space-y-4">
      <div className="flex gap-3">
        <ClockFace
          label="Montréal"
          flag="🇨🇦"
          timeZone={tripTz}
          reference={homeTz}
          now={now}
          accent="text-frost"
          primary
        />
        <ClockFace
          label="France"
          flag="🇫🇷"
          timeZone={homeTz}
          reference={tripTz}
          now={now}
          accent="text-frost/80"
        />
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="text-sm text-frost/70">
          Montréal est{' '}
          <strong className="text-frost">
            {Math.abs(delta)} h {delta < 0 ? 'derrière' : 'devant'}
          </strong>{' '}
          la France.
          {Math.abs(delta) !== 6 && (
            <span className="ml-1 text-amber">
              Écart inhabituel : les deux pays ne sont pas encore alignés sur le même changement d’heure.
            </span>
          )}
        </div>
      </div>

      <div className={`rounded-2xl border border-white/10 bg-white/5 p-4 ring-1 ${style.ring}`}>
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${style.dot} ${window_.status === 'ideal' ? 'animate-pulse' : ''}`} />
          <span className={`font-medium ${style.text}`}>{window_.label}</span>
        </div>
        <p className="mt-1.5 text-sm text-frost/70">{window_.detail}</p>

        {window_.next && (
          <p className="mt-3 rounded-xl bg-black/20 p-3 text-sm text-frost/80">
            Prochaine bonne fenêtre dans{' '}
            <strong className="text-frost">{formatDuration(window_.next.inMinutes)}</strong>
            <br />
            <span className="text-frost/50">
              {window_.next.tripTime} à Montréal · {window_.next.homeTime} en France
            </span>
          </p>
        )}
      </div>
    </section>
  );
}
