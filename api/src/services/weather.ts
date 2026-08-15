/**
 * Météo « ressenti réel » pour Montréal.
 *
 * Deux indices officiels d'Environnement Canada sont recalculés côté serveur
 * plutôt que de faire confiance au `feels_like` générique d'OpenWeather :
 *   - Humidex  : inconfort dû à l'humidité l'été (canicule montréalaise).
 *   - Refroidissement éolien : température ressentie l'hiver (facteur vent).
 *
 * Le résultat est mis en cache dans Firestore (`meta/weather`) pour rester
 * largement sous le quota gratuit d'OpenWeatherMap (60 appels/min, 1M/mois)
 * même si toute la famille consulte l'app en même temps.
 */
import { config } from '../config.js';
import { db } from '../firebase.js';

const OWM_BASE = 'https://api.openweathermap.org/data/2.5';

export type WeatherMood = 'canicule' | 'chaud' | 'doux' | 'frais' | 'froid' | 'grand-froid';
export type WeatherSky = 'pluie' | 'neige' | 'orage' | 'nuageux' | 'degage' | 'brouillard';

export interface FeelsLike {
  /** Température réelle en °C. */
  temp: number;
  /** Ressenti retenu (humidex l'été, refroidissement éolien l'hiver). */
  feels: number;
  /** Nature de l'indice appliqué. */
  index: 'humidex' | 'refroidissement-eolien' | 'temperature';
  humidity: number;
  windKph: number;
}

export interface WeatherSnapshot extends FeelsLike {
  sky: WeatherSky;
  mood: WeatherMood;
  description: string;
  icon: string;
  /** Conseil d'habillement adapté au ressenti et au ciel. */
  advice: string;
  sunrise: string;
  sunset: string;
  observedAt: string;
  city: string;
  forecast: ForecastSlot[];
}

export interface ForecastSlot {
  at: string;
  temp: number;
  feels: number;
  sky: WeatherSky;
  pop: number;
  icon: string;
}

/**
 * Point de rosée à partir de T et de l'humidité relative (approximation
 * Magnus-Tetens, précise à ±0,4 °C entre -45 et +60 °C).
 */
export function dewPoint(tempC: number, humidityPct: number): number {
  const a = 17.27;
  const b = 237.7;
  const rh = Math.min(Math.max(humidityPct, 1), 100) / 100;
  const alpha = (a * tempC) / (b + tempC) + Math.log(rh);
  return (b * alpha) / (a - alpha);
}

/**
 * Humidex d'Environnement Canada.
 * H = T + 0,5555 × (e − 10), e = pression de vapeur au point de rosée (hPa).
 * Non pertinent sous 20 °C : on renvoie alors la température réelle.
 */
export function humidex(tempC: number, humidityPct: number): number {
  if (tempC < 20) return tempC;
  const td = dewPoint(tempC, humidityPct);
  const e = 6.11 * Math.exp(5417.753 * (1 / 273.16 - 1 / (td + 273.15)));
  return tempC + 0.5555 * (e - 10);
}

/**
 * Indice de refroidissement éolien (formule canadienne 2001).
 * Valide pour T ≤ 10 °C et vent ≥ 4,8 km/h ; sinon la température brute.
 */
export function windChill(tempC: number, windKph: number): number {
  if (tempC > 10 || windKph < 4.8) return tempC;
  const v = Math.pow(windKph, 0.16);
  return 13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v;
}

/** Choisit l'indice pertinent et renvoie le ressenti retenu. */
export function computeFeelsLike(tempC: number, humidityPct: number, windKph: number): FeelsLike {
  const base = { temp: round1(tempC), humidity: Math.round(humidityPct), windKph: round1(windKph) };

  if (tempC >= 20) {
    const h = humidex(tempC, humidityPct);
    // L'humidex ne s'affiche que s'il ajoute au moins 1 °C de ressenti.
    if (h - tempC >= 1) return { ...base, feels: round1(h), index: 'humidex' };
  }
  if (tempC <= 10 && windKph >= 4.8) {
    const w = windChill(tempC, windKph);
    if (tempC - w >= 1) return { ...base, feels: round1(w), index: 'refroidissement-eolien' };
  }
  return { ...base, feels: round1(tempC), index: 'temperature' };
}

export function moodFor(feels: number): WeatherMood {
  if (feels >= 33) return 'canicule';
  if (feels >= 24) return 'chaud';
  if (feels >= 14) return 'doux';
  if (feels >= 3) return 'frais';
  if (feels >= -14) return 'froid';
  return 'grand-froid';
}

function skyFor(owmId: number): WeatherSky {
  if (owmId >= 200 && owmId < 300) return 'orage';
  if (owmId >= 300 && owmId < 600) return 'pluie';
  if (owmId >= 600 && owmId < 700) return 'neige';
  if (owmId >= 700 && owmId < 800) return 'brouillard';
  if (owmId === 800) return 'degage';
  return 'nuageux';
}

/** Conseil d'habillement, calibré sur les hivers et étés montréalais. */
export function adviceFor(snapshot: Pick<WeatherSnapshot, 'mood' | 'sky' | 'feels' | 'windKph'>): string {
  const { mood, sky, feels, windKph } = snapshot;
  const parts: string[] = [];

  switch (mood) {
    case 'grand-froid':
      parts.push(
        `Ressenti ${Math.round(feels)} °C : trois couches obligatoires, tuque, cache-cou, mitaines et bottes isolées. Peau exposée à risque en moins de 15 min.`,
      );
      break;
    case 'froid':
      parts.push(
        `Ressenti ${Math.round(feels)} °C : manteau d'hiver, tuque et gants. Prévois des trajets courts entre deux stations de métro.`,
      );
      break;
    case 'frais':
      parts.push('Veste coupe-vent + une couche chaude dessous. Les matins sont plus froids que les après-midi.');
      break;
    case 'doux':
      parts.push('Une couche légère suffit, mais garde un pull : les soirées tombent vite de 8 à 10 °C.');
      break;
    case 'chaud':
      parts.push('Vêtements légers, casquette et gourde. La climatisation des commerces est très forte : emporte un haut à manches.');
      break;
    case 'canicule':
      parts.push(
        `Humidex ${Math.round(feels)} : effort extérieur déconseillé entre 11 h et 16 h. Hydratation constante, privilégie le RÉSO climatisé.`,
      );
      break;
  }

  if (sky === 'pluie') parts.push("Averses prévues : un imperméable est plus utile qu'un parapluie (vent de rue).");
  if (sky === 'neige') parts.push('Neige : semelles à bon grip, les trottoirs sont glacés en bordure de rue.');
  if (sky === 'orage') parts.push('Orages : évite le Vieux-Port et le mont Royal à découvert.');
  if (windKph >= 30) parts.push(`Vent à ${Math.round(windKph)} km/h : le ressenti chute encore dans les rues en couloir du centre-ville.`);

  return parts.join(' ');
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

interface OwmCurrent {
  weather: { id: number; description: string; icon: string }[];
  main: { temp: number; humidity: number };
  wind: { speed: number };
  sys: { sunrise: number; sunset: number };
  dt: number;
  name: string;
}

interface OwmForecast {
  list: {
    dt: number;
    main: { temp: number; humidity: number };
    wind: { speed: number };
    weather: { id: number; icon: string }[];
    pop?: number;
  }[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`OpenWeather ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** Récupère la météo, avec cache Firestore de `weatherCacheMinutes`. */
export async function getWeather(lat: number, lon: number, force = false): Promise<WeatherSnapshot> {
  const cacheRef = db.collection('meta').doc('weather');

  if (!force) {
    const cached = await cacheRef.get();
    const data = cached.data();
    if (data?.snapshot && data.fetchedAt) {
      const ageMinutes = (Date.now() - data.fetchedAt.toMillis()) / 60000;
      if (ageMinutes < config.weatherCacheMinutes) return data.snapshot as WeatherSnapshot;
    }
  }

  if (!config.openWeatherKey) {
    throw new Error('OPENWEATHER_API_KEY absent : impossible de rafraîchir la météo.');
  }

  const q = `lat=${lat}&lon=${lon}&units=metric&lang=fr&appid=${config.openWeatherKey}`;
  const [current, forecast] = await Promise.all([
    fetchJson<OwmCurrent>(`${OWM_BASE}/weather?${q}`),
    fetchJson<OwmForecast>(`${OWM_BASE}/forecast?${q}&cnt=16`),
  ]);

  const windKph = current.wind.speed * 3.6; // OpenWeather renvoie des m/s en unités metric
  const feelsLike = computeFeelsLike(current.main.temp, current.main.humidity, windKph);
  const sky = skyFor(current.weather[0]?.id ?? 800);
  const mood = moodFor(feelsLike.feels);

  const snapshot: WeatherSnapshot = {
    ...feelsLike,
    sky,
    mood,
    description: current.weather[0]?.description ?? '',
    icon: current.weather[0]?.icon ?? '01d',
    advice: adviceFor({ mood, sky, feels: feelsLike.feels, windKph: feelsLike.windKph }),
    sunrise: new Date(current.sys.sunrise * 1000).toISOString(),
    sunset: new Date(current.sys.sunset * 1000).toISOString(),
    observedAt: new Date(current.dt * 1000).toISOString(),
    city: current.name,
    forecast: forecast.list.map((slot) => {
      const w = slot.wind.speed * 3.6;
      return {
        at: new Date(slot.dt * 1000).toISOString(),
        temp: round1(slot.main.temp),
        feels: computeFeelsLike(slot.main.temp, slot.main.humidity, w).feels,
        sky: skyFor(slot.weather[0]?.id ?? 800),
        pop: Math.round((slot.pop ?? 0) * 100),
        icon: slot.weather[0]?.icon ?? '01d',
      };
    }),
  };

  await cacheRef.set(
    { snapshot, fetchedAt: new Date(), source: 'openweathermap' },
    { merge: true },
  );

  return snapshot;
}
