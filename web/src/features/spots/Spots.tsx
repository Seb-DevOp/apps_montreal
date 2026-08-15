/**
 * Micro-spots et itinéraires par quartier.
 *
 * Le tri se fait par quartier plutôt que par catégorie : sur place, la
 * question n'est jamais « où sont les cafés ? » mais « je suis dans le Mile
 * End, qu'est-ce qu'il y a autour ? ». Chaque quartier affiche ses lignes de
 * métro STM, et l'aéroport rappelle la navette 747.
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { METRO_COLORS, NEIGHBORHOODS } from '../../data/neighborhoods';
import type { Spot } from '../../types';

function MetroBadge({ line }: { line: string }): JSX.Element {
  const color = METRO_COLORS[line] ?? '#666';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
      style={{ backgroundColor: color, color: line === 'Jaune' ? '#111' : '#fff' }}
    >
      ● {line}
    </span>
  );
}

export function Spots(): JSX.Element {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [active, setActive] = useState<string>(NEIGHBORHOODS[0]?.name ?? '');
  const [search, setSearch] = useState('');

  useEffect(() => {
    return onSnapshot(query(collection(db(), 'spots')), (snapshot) => {
      setSpots(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Spot));
    });
  }, []);

  const zone = useMemo(() => NEIGHBORHOODS.find((n) => n.name === active), [active]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return spots
      .filter((spot) => (needle ? true : spot.neighborhood === active))
      .filter((spot) =>
        needle
          ? `${spot.name} ${spot.notes} ${spot.category} ${spot.neighborhood}`.toLowerCase().includes(needle)
          : true,
      )
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }, [spots, active, search]);

  return (
    <div className="space-y-4">
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Chercher un spot, une adresse…"
        className="w-full rounded-xl bg-white/5 px-4 py-3 text-sm text-frost outline-none placeholder:text-frost/30"
      />

      {!search && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {NEIGHBORHOODS.map((neighborhood) => (
            <button
              key={neighborhood.id}
              type="button"
              onClick={() => setActive(neighborhood.name)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
                active === neighborhood.name ? 'bg-stm text-white' : 'bg-white/10 text-frost/60'
              }`}
            >
              {neighborhood.name}
            </button>
          ))}
        </div>
      )}

      {!search && zone && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm text-frost/70">{zone.blurb}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {zone.metro.map((line) => (
              <MetroBadge key={line} line={line} />
            ))}
            {zone.stations.map((station) => (
              <span key={station} className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-frost/60">
                {station}
              </span>
            ))}
          </div>
        </div>
      )}

      {visible.length === 0 && (
        <p className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-frost/40">
          {search ? 'Aucun spot ne correspond.' : 'Pas encore de spot dans ce quartier.'}
        </p>
      )}

      <ul className="space-y-2">
        {visible.map((spot) => (
          <li key={spot.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-medium text-frost">{spot.name}</h3>
                <p className="mt-0.5 text-xs text-frost/40">
                  {spot.category}
                  {search && ` · ${spot.neighborhood}`}
                  {spot.indoor && ' · intérieur'}
                </p>
              </div>
              {spot.geo && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${spot.geo.lat},${spot.geo.lng}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs text-frost/70"
                >
                  Itinéraire
                </a>
              )}
            </div>

            {spot.notes && <p className="mt-2 text-sm text-frost/70">{spot.notes}</p>}
            {spot.address && <p className="mt-1 text-xs text-frost/35">{spot.address}</p>}

            {spot.metro?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {spot.metro.map((line) => (
                  <MetroBadge key={line} line={line} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-frost/70">
        <h3 className="text-xs uppercase tracking-wider text-frost/50">Depuis l’aéroport</h3>
        <p className="mt-2">
          <strong className="text-frost">Bus 747</strong> — YUL ↔ Berri-UQAM, 24 h/24, environ 45 à 70 min.
          Le titre est valable 24 h sur tout le réseau STM (métro compris) : achète-le au distributeur de
          la zone des arrivées, la monnaie n’est pas rendue à bord.
        </p>
      </div>
    </div>
  );
}
