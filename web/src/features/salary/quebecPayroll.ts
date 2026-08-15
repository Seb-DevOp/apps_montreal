/**
 * Salaire brut → net au Québec.
 *
 * Un salarié québécois subit quatre prélèvements distincts, dont deux impôts
 * sur le revenu superposés :
 *
 *   1. impôt FÉDÉRAL, réduit de 16,5 % par l'abattement propre au Québec —
 *      compensation du fait que la province perçoit elle-même certains
 *      programmes ; l'oublier surestime l'impôt de plusieurs milliers ;
 *   2. impôt PROVINCIAL, aux barèmes les plus progressifs du pays ;
 *   3. RRQ, le régime de retraite, avec depuis 2024 une seconde tranche
 *      « supplémentaire » au-delà du maximum classique ;
 *   4. RQAP (congés parentaux) et assurance-emploi, à taux réduit au Québec
 *      précisément parce que le RQAP existe.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PARAMÈTRES FISCAUX — À REVALIDER CHAQUE ANNÉE
 *
 * Les barèmes ci-dessous sont ceux de l'année indiquée par TAX_YEAR. Ils sont
 * indexés chaque 1er janvier. Le moteur de calcul, lui, ne change pas : seule
 * cette section est à mettre à jour, à partir des barèmes publiés par Revenu
 * Québec et l'Agence du revenu du Canada.
 *
 * Le résultat est une ESTIMATION : il ignore les crédits personnels autres que
 * le montant de base, les REER, les frais de garde et toute situation
 * familiale particulière.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const TAX_YEAR = 2024;

interface Bracket {
  /** Plafond de la tranche. Infinity pour la dernière. */
  upTo: number;
  rate: number;
}

/** Barème fédéral. */
const FEDERAL_BRACKETS: Bracket[] = [
  { upTo: 55_867, rate: 0.15 },
  { upTo: 111_733, rate: 0.205 },
  { upTo: 173_205, rate: 0.26 },
  { upTo: 246_752, rate: 0.29 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.33 },
];

/** Barème provincial québécois. */
const QUEBEC_BRACKETS: Bracket[] = [
  { upTo: 51_780, rate: 0.14 },
  { upTo: 103_545, rate: 0.19 },
  { upTo: 126_000, rate: 0.24 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.2575 },
];

/** Montant personnel de base : première tranche de revenu non imposée. */
const FEDERAL_BASIC_AMOUNT = 15_705;
const QUEBEC_BASIC_AMOUNT = 18_056;

/**
 * Abattement du Québec : les résidents voient leur impôt fédéral réduit de
 * 16,5 %. C'est la ligne que les simulateurs génériques oublient le plus
 * souvent, et elle pèse lourd.
 */
const QUEBEC_ABATEMENT = 0.165;

/** Régime de rentes du Québec (retraite). */
const RRQ = {
  exemption: 3_500,
  /** Plafond de la cotisation de base. */
  maxEarnings: 68_500,
  baseRate: 0.064,
  /** Seconde tranche, introduite en 2024, entre maxEarnings et maxEarnings2. */
  maxEarnings2: 73_200,
  additionalRate: 0.04,
};

/** Régime québécois d'assurance parentale. */
const RQAP = { maxEarnings: 94_000, rate: 0.00494 };

/** Assurance-emploi — taux réduit au Québec, du fait de l'existence du RQAP. */
const EI = { maxEarnings: 63_200, rate: 0.0132 };

export interface PayrollBreakdown {
  gross: number;
  federalTax: number;
  /** Réduction de l'impôt fédéral au titre de l'abattement québécois. */
  federalAbatement: number;
  quebecTax: number;
  rrq: number;
  rqap: number;
  ei: number;
  totalDeductions: number;
  net: number;
  netMonthly: number;
  netBiweekly: number;
  /** Part du brut réellement prélevée. */
  effectiveRate: number;
  /** Taux appliqué au prochain dollar gagné. */
  marginalRate: number;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Impôt progressif : chaque tranche n'impose que la part qui la traverse. */
function progressiveTax(taxable: number, brackets: Bracket[]): number {
  let tax = 0;
  let previous = 0;

  for (const bracket of brackets) {
    if (taxable <= previous) break;
    const slice = Math.min(taxable, bracket.upTo) - previous;
    tax += slice * bracket.rate;
    previous = bracket.upTo;
  }
  return tax;
}

function marginalRate(taxable: number, brackets: Bracket[]): number {
  for (const bracket of brackets) {
    if (taxable <= bracket.upTo) return bracket.rate;
  }
  return brackets[brackets.length - 1]?.rate ?? 0;
}

export function computePayroll(gross: number): PayrollBreakdown {
  const income = Math.max(0, gross);

  // --- Cotisations sociales, plafonnées ------------------------------------
  const rrqBase = Math.max(0, Math.min(income, RRQ.maxEarnings) - RRQ.exemption) * RRQ.baseRate;
  const rrqAdditional =
    Math.max(0, Math.min(income, RRQ.maxEarnings2) - RRQ.maxEarnings) * RRQ.additionalRate;
  const rrq = rrqBase + rrqAdditional;

  const rqap = Math.min(income, RQAP.maxEarnings) * RQAP.rate;
  const ei = Math.min(income, EI.maxEarnings) * EI.rate;

  // --- Impôts ---------------------------------------------------------------
  // Les cotisations n'entrent pas dans le revenu imposable : elles ouvrent
  // droit à des crédits qui, en pratique, les neutralisent à la base.
  const federalTaxable = Math.max(0, income - FEDERAL_BASIC_AMOUNT);
  const quebecTaxable = Math.max(0, income - QUEBEC_BASIC_AMOUNT);

  const federalGross = progressiveTax(federalTaxable, FEDERAL_BRACKETS);
  const federalAbatement = federalGross * QUEBEC_ABATEMENT;
  const federalTax = federalGross - federalAbatement;

  const quebecTax = progressiveTax(quebecTaxable, QUEBEC_BRACKETS);

  const totalDeductions = federalTax + quebecTax + rrq + rqap + ei;
  const net = income - totalDeductions;

  const marginal =
    marginalRate(federalTaxable, FEDERAL_BRACKETS) * (1 - QUEBEC_ABATEMENT) +
    marginalRate(quebecTaxable, QUEBEC_BRACKETS);

  return {
    gross: round2(income),
    federalTax: round2(federalTax),
    federalAbatement: round2(federalAbatement),
    quebecTax: round2(quebecTax),
    rrq: round2(rrq),
    rqap: round2(rqap),
    ei: round2(ei),
    totalDeductions: round2(totalDeductions),
    net: round2(net),
    netMonthly: round2(net / 12),
    netBiweekly: round2(net / 26),
    effectiveRate: income > 0 ? totalDeductions / income : 0,
    marginalRate: marginal,
  };
}

const CAD = new Intl.NumberFormat('fr-CA', {
  style: 'currency',
  currency: 'CAD',
  maximumFractionDigits: 0,
});

export const formatCad = (value: number): string => CAD.format(value);

/**
 * Repères de rémunération DevOps à Montréal, en dollars canadiens bruts
 * annuels. Ordres de grandeur : le marché montréalais est nettement sous
 * Toronto, et le coût de la vie aussi.
 */
export const DEVOPS_BENCHMARKS: { level: string; range: [number, number] }[] = [
  { level: 'DevOps junior (0-2 ans)', range: [65_000, 80_000] },
  { level: 'DevOps intermédiaire (3-5 ans)', range: [85_000, 105_000] },
  { level: 'DevOps senior (6+ ans)', range: [105_000, 130_000] },
  { level: 'SRE / Platform lead', range: [125_000, 155_000] },
  { level: 'Architecte cloud', range: [140_000, 175_000] },
];
