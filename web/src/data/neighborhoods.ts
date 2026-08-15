/**
 * Quartiers de Montréal, avec centroïde et desserte métro.
 *
 * Sert au « géocodage inverse » des photos : plutôt que d'appeler une API de
 * geocoding (payante au-delà d'un quota, et inutilisable hors-ligne), on prend
 * le quartier dont le centre est le plus proche des coordonnées EXIF. Sur une
 * île où les quartiers font 1 à 3 km, c'est suffisant pour étiqueter une photo
 * — et ça marche dans l'avion.
 */

export interface Neighborhood {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Lignes STM desservant le quartier. */
  metro: string[];
  /** Stations principales. */
  stations: string[];
  blurb: string;
}

export const NEIGHBORHOODS: Neighborhood[] = [
  {
    id: 'plateau',
    name: 'Plateau-Mont-Royal',
    lat: 45.5225,
    lng: -73.5799,
    metro: ['Orange'],
    stations: ['Mont-Royal', 'Laurier', 'Sherbrooke'],
    blurb: 'Escaliers en colimaçon, murales, terrasses sur Saint-Denis et Mont-Royal.',
  },
  {
    id: 'mile-end',
    name: 'Mile End',
    lat: 45.5232,
    lng: -73.6005,
    metro: ['Bleue', 'Orange'],
    stations: ['Outremont', 'Rosemont', 'Laurier'],
    blurb: 'Bagels au feu de bois, cafés indépendants, disquaires et ateliers.',
  },
  {
    id: 'vieux-port',
    name: 'Vieux-Port / Vieux-Montréal',
    lat: 45.5075,
    lng: -73.5533,
    metro: ['Orange'],
    stations: ['Place-d’Armes', 'Champ-de-Mars', 'Square-Victoria–OACI'],
    blurb: 'Pavés, quais du Saint-Laurent, Basilique Notre-Dame, plage urbaine l’été.',
  },
  {
    id: 'jean-talon',
    name: 'Petite-Italie / Marché Jean-Talon',
    lat: 45.5366,
    lng: -73.6146,
    metro: ['Bleue', 'Orange'],
    stations: ['Jean-Talon', 'De Castelnau', 'Beaubien'],
    blurb: 'Le plus grand marché public à ciel ouvert d’Amérique du Nord.',
  },
  {
    id: 'centre-ville',
    name: 'Centre-ville',
    lat: 45.5017,
    lng: -73.5673,
    metro: ['Verte', 'Orange'],
    stations: ['McGill', 'Peel', 'Bonaventure', 'Berri-UQAM'],
    blurb: 'Sainte-Catherine, musées, et l’accès au RÉSO souterrain.',
  },
  {
    id: 'quartier-latin',
    name: 'Quartier latin / Village',
    lat: 45.5152,
    lng: -73.5613,
    metro: ['Verte', 'Orange', 'Jaune'],
    stations: ['Berri-UQAM', 'Beaudry', 'Papineau'],
    blurb: 'Vie étudiante, festivals, rue Sainte-Catherine piétonne l’été.',
  },
  {
    id: 'mont-royal',
    name: 'Mont-Royal',
    lat: 45.5048,
    lng: -73.5878,
    metro: ['Orange', 'Bleue'],
    stations: ['Mont-Royal', 'Édouard-Montpetit'],
    blurb: 'Belvédère Kondiaronk, lac aux Castors, tam-tams du dimanche.',
  },
  {
    id: 'griffintown',
    name: 'Griffintown / Canal Lachine',
    lat: 45.4906,
    lng: -73.5626,
    metro: ['Orange'],
    stations: ['Bonaventure', 'Georges-Vanier'],
    blurb: 'Anciennes usines reconverties, piste cyclable du canal, marché Atwater.',
  },
  {
    id: 'hochelaga',
    name: 'Hochelaga-Maisonneuve',
    lat: 45.5501,
    lng: -73.5439,
    metro: ['Verte'],
    stations: ['Pie-IX', 'Viau', 'Joliette'],
    blurb: 'Stade olympique, Biodôme, Jardin botanique, marché Maisonneuve.',
  },
  {
    id: 'outremont',
    name: 'Outremont',
    lat: 45.5188,
    lng: -73.6103,
    metro: ['Bleue'],
    stations: ['Outremont', 'Édouard-Montpetit'],
    blurb: 'Avenue Laurier chic, parc Outremont, ambiance résidentielle cossue.',
  },
  {
    id: 'verdun',
    name: 'Verdun / Île-des-Sœurs',
    lat: 45.4586,
    lng: -73.5686,
    metro: ['Verte'],
    stations: ['Verdun', 'De l’Église', 'Jolicoeur'],
    blurb: 'Promenade Wellington, berges du fleuve, plage urbaine.',
  },
  {
    id: 'aeroport',
    name: 'Aéroport Montréal-Trudeau (YUL)',
    lat: 45.4657,
    lng: -73.7455,
    metro: [],
    stations: ['Bus 747 → Berri-UQAM'],
    blurb: 'Navette 747 : 24 h/24, ~45-70 min jusqu’au centre-ville.',
  },
];

/** Distance approximative en km (équirectangulaire, largement suffisant ici). */
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const x = (bLng - aLng) * rad * Math.cos(((aLat + bLat) / 2) * rad);
  const y = (bLat - aLat) * rad;
  return Math.sqrt(x * x + y * y) * R;
}

/**
 * Quartier le plus proche de coordonnées données.
 * Renvoie `null` au-delà de 6 km : inutile d'étiqueter « Plateau » une photo
 * prise à Québec ou à l'escale de Reykjavik.
 */
export function nearestNeighborhood(lat: number, lng: number, maxKm = 6): Neighborhood | null {
  let best: Neighborhood | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of NEIGHBORHOODS) {
    const distance = distanceKm(lat, lng, candidate.lat, candidate.lng);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return bestDistance <= maxKm ? best : null;
}

/** Couleurs officielles des lignes STM, pour les pastilles de l'UI. */
export const METRO_COLORS: Record<string, string> = {
  Verte: '#008e4f',
  Orange: '#ef8122',
  Jaune: '#ffe400',
  Bleue: '#0083c9',
};
