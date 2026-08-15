/**
 * Calcul des taxes et pourboires du Québec.
 *
 * Trois pièges que ce module encode explicitement, parce qu'ils coûtent cher
 * en pratique à un Français fraîchement débarqué :
 *
 *  1. Les prix affichés en vitrine sont HORS TAXES. Le montant réel est
 *     toujours supérieur d'environ 15 %. C'est le sens du calcul par défaut.
 *
 *  2. Depuis 2013, la TVQ ne se calcule plus sur (prix + TPS) mais sur le prix
 *     hors taxes, comme la TPS. Les deux taxes s'appliquent donc à la même
 *     base : 5 % + 9,975 % = 14,975 %. Beaucoup de calculateurs en ligne sont
 *     restés sur l'ancienne règle en cascade et surestiment la note.
 *
 *  3. L'usage local veut que le pourboire se calcule sur le montant AVANT
 *     taxes. Les terminaux de paiement, eux, proposent presque toujours des
 *     pourcentages appliqués au total taxes comprises — soit ~15 % de plus que
 *     l'usage. Le module calcule les deux et affiche l'écart.
 */

export const TPS_RATE = 0.05; // Taxe sur les produits et services (fédérale)
export const TVQ_RATE = 0.09975; // Taxe de vente du Québec (provinciale)
export const COMBINED_RATE = TPS_RATE + TVQ_RATE; // 0,14975

export type TipBase = 'pre-tax' | 'post-tax';

export interface TaxInput {
  /** Prix affiché, hors taxes, en dollars canadiens. */
  displayPrice: number;
  /** Taux de pourboire (0,15 / 0,18 / 0,20 ou personnalisé). 0 = aucun. */
  tipRate: number;
  /** Base de calcul du pourboire. */
  tipBase: TipBase;
  /** Nombre de convives pour le partage de l'addition. */
  splitBetween: number;
}

export interface TaxBreakdown {
  subtotal: number;
  tps: number;
  tvq: number;
  totalTaxes: number;
  /** Prix taxes comprises, sans pourboire. */
  totalWithTaxes: number;
  tip: number;
  /** Montant exact à saisir sur le terminal de paiement. */
  grandTotal: number;
  perPerson: number;
  /** Ce que coûterait le même pourboire calculé sur l'autre base. */
  alternateTip: number;
  /** Économie (ou surcoût) entre les deux bases, en dollars. */
  tipDifference: number;
  /** Part du prix affiché réellement payée, ex. 1,3237 -> « +32 % ». */
  realCostMultiplier: number;
}

/** Arrondi bancaire à 2 décimales, sans erreur de flottant sur les .005. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeTaxes(input: TaxInput): TaxBreakdown {
  const subtotal = Math.max(0, input.displayPrice);
  const tipRate = Math.max(0, input.tipRate);
  const split = Math.max(1, Math.floor(input.splitBetween));

  const tps = round2(subtotal * TPS_RATE);
  const tvq = round2(subtotal * TVQ_RATE);
  const totalTaxes = round2(tps + tvq);
  const totalWithTaxes = round2(subtotal + totalTaxes);

  const tipOnPreTax = round2(subtotal * tipRate);
  const tipOnPostTax = round2(totalWithTaxes * tipRate);

  const tip = input.tipBase === 'pre-tax' ? tipOnPreTax : tipOnPostTax;
  const alternateTip = input.tipBase === 'pre-tax' ? tipOnPostTax : tipOnPreTax;

  const grandTotal = round2(totalWithTaxes + tip);

  return {
    subtotal: round2(subtotal),
    tps,
    tvq,
    totalTaxes,
    totalWithTaxes,
    tip,
    grandTotal,
    perPerson: round2(grandTotal / split),
    alternateTip,
    tipDifference: round2(Math.abs(tip - alternateTip)),
    realCostMultiplier: subtotal > 0 ? grandTotal / subtotal : 1,
  };
}

/**
 * Opération inverse : à partir d'un montant taxes comprises (ticket de caisse,
 * relevé bancaire), retrouver le prix hors taxes.
 */
export function reverseTaxes(totalWithTaxes: number): {
  subtotal: number;
  tps: number;
  tvq: number;
  totalTaxes: number;
} {
  const subtotal = round2(totalWithTaxes / (1 + COMBINED_RATE));
  const tps = round2(subtotal * TPS_RATE);
  const tvq = round2(subtotal * TVQ_RATE);
  return { subtotal, tps, tvq, totalTaxes: round2(tps + tvq) };
}

/**
 * Astuce de terrain : la somme des deux taxes (14,975 %) est presque exactement
 * un pourboire de 15 %. Sur une addition au restaurant, laisser « le montant
 * des taxes » comme pourboire tombe juste, sans calcul mental.
 */
export function taxesAsTipHint(subtotal: number): { amount: number; equivalentRate: number } {
  const taxes = round2(subtotal * COMBINED_RATE);
  return { amount: taxes, equivalentRate: COMBINED_RATE };
}

const CAD = new Intl.NumberFormat('fr-CA', {
  style: 'currency',
  currency: 'CAD',
  minimumFractionDigits: 2,
});

export const formatCad = (value: number): string => CAD.format(value);

/**
 * Conversion indicative CAD -> EUR. Le taux est stocké localement et saisi par
 * l'utilisateur : appeler une API de change à chaque frappe serait un gaspillage
 * de quota pour une information qui bouge de 1 % par semaine.
 */
export function toEuros(cad: number, rate: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cad * rate);
}

export const TIP_PRESETS = [
  { rate: 0.15, label: '15 %', hint: 'service correct' },
  { rate: 0.18, label: '18 %', hint: 'standard actuel' },
  { rate: 0.2, label: '20 %', hint: 'service soigné' },
] as const;
