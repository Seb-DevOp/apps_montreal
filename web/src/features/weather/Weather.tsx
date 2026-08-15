/**
 * Météo « ressenti réel » + sélecteur d'activités.
 *
 * L'écran met en avant le RESSENTI, pas la température brute : à Montréal,
 * -8 °C avec du vent équivaut à -18 °C sur la peau, et 30 °C avec 80 %
 * d'humidité donne un humidex de 40. La température seule ne dit rien
 * d'utilisable pour s'habiller.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import type { Spot } from '../../types';

interface ForecastSlot {
  at: string;
  temp: number;
  feels: number;
  sky: string;
  pop: number;
  icon: string;
}

interface WeatherSnapshot {
  temp: number;
  feels: number;
  index: 'humidex' | 'refroidissement-eolien' | 'temperature';
  humidity: number;
  windKph: number;
  sky: string;
  mood: string;
  description: string;
  icon: string;
  advice: string;
  city: string;
  observedAt: string;
  forecast: ForecastSlot[];
}

interface ActivitySuggestion {
  indoors: boolean;
  reason: string;
  spots: Spot[];
}

const INDEX_LABEL: Record<WeatherSnapshot['index'], string> = {
  humidex: 'Humidex',
  'refroidissement-eolien': 'Refroidissement éolien',
  temperature: 'Température',
};

const MOOD_ACCENT: Record<string, string> = {
  canicule: 'border-maple/40 bg-maple/10',
  chaud: 'border-amber/40 bg-amber/10',
  doux: 'border-mint/40 bg-mint/10',
  frais: 'border-stm/40 bg-stm/10',
  froid: 'border-stm/40 bg-stm/10',
  'grand-froid': 'border-maple/40 bg-maple/10',
};

export function Weather(): JSX.Element {
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [activities, setActivities] = useState<ActivitySuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [snapshot, suggestion] = await Promise.all([
        api.get<WeatherSnapshot>('/weather'),
        api.get<ActivitySuggestion>('/activities'),
      ]);
      setWeather(snapshot);
      setActivities(suggestion);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 503
          ? 'Météo indisponible pour le moment. Réessaie dans quelques minutes.'
          : 'Impossible de joindre le service météo. Les données affichées peuvent dater.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !weather) {
    return <div className="h-48 animate-pulse rounded-2xl bg-white/5" />;
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-xl bg-amber/15 p-3 text-sm text-amber">{error}</p>}

      {weather && (
        <>
          <div className={`rounded-2xl border p-5 ${MOOD_ACCENT[weather.mood] ?? 'border-white/10 bg-white/5'}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-frost/60">
                  {INDEX_LABEL[weather.index]} · {weather.city}
                </div>
                <div className="mt-1 font-mono text-6xl font-semibold tabular-nums text-frost">
                  {Math.round(weather.feels)}°
                </div>
                <div className="mt-1 text-sm text-frost/60">
                  Thermomètre : {Math.round(weather.temp)} °C · {weather.description}
                </div>
              </div>
              <img
                src={`https://openweathermap.org/img/wn/${weather.icon}@2x.png`}
                alt=""
                width={80}
                height={80}
                className="shrink-0"
              />
            </div>

            <div className="mt-3 flex gap-4 text-xs text-frost/50">
              <span>💧 {weather.humidity} %</span>
              <span>💨 {Math.round(weather.windKph)} km/h</span>
              <span>
                🕒{' '}
                {new Date(weather.observedAt).toLocaleTimeString('fr-FR', {
                  timeZone: 'America/Montreal',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-xs uppercase tracking-wider text-frost/50">Comment s’habiller</h3>
            <p className="mt-2 text-sm leading-relaxed text-frost/85">{weather.advice}</p>
          </div>

          {weather.forecast.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h3 className="mb-2 text-xs uppercase tracking-wider text-frost/50">Prochaines 48 h</h3>
              <div className="-mx-4 flex gap-3 overflow-x-auto px-4">
                {weather.forecast.map((slot) => (
                  <div key={slot.at} className="shrink-0 text-center">
                    <div className="text-[11px] text-frost/40">
                      {new Date(slot.at).toLocaleTimeString('fr-FR', {
                        timeZone: 'America/Montreal',
                        hour: '2-digit',
                      })}
                    </div>
                    <img
                      src={`https://openweathermap.org/img/wn/${slot.icon}.png`}
                      alt={slot.sky}
                      width={40}
                      height={40}
                    />
                    <div className="font-mono text-sm tabular-nums text-frost">
                      {Math.round(slot.feels)}°
                    </div>
                    {slot.pop >= 30 && <div className="text-[10px] text-stm">{slot.pop} %</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {activities && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="text-xs uppercase tracking-wider text-frost/50">
            {activities.indoors ? 'Aujourd’hui, plutôt à l’abri' : 'Aujourd’hui, dehors'}
          </h3>
          <p className="mt-1 text-sm text-frost/70">{activities.reason}</p>

          <ul className="mt-3 space-y-2">
            {activities.spots.slice(0, 8).map((spot) => (
              <li key={spot.id} className="rounded-xl bg-black/20 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-frost">{spot.name}</span>
                  <span className="shrink-0 text-[11px] text-frost/40">{spot.neighborhood}</span>
                </div>
                {spot.notes && <p className="mt-0.5 text-xs text-frost/50">{spot.notes}</p>}
              </li>
            ))}
          </ul>

          {activities.spots.length === 0 && (
            <p className="mt-2 text-sm text-frost/40">
              Aucun spot enregistré pour ce type de journée. Ajoute-en depuis l’onglet Spots.
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => void load()}
        className="w-full rounded-xl bg-white/10 py-3 text-sm text-frost/70"
      >
        Actualiser
      </button>
    </div>
  );
}
