/**
 * Simulateur de salaire net québécois.
 *
 * Sert d'abord à négocier : une offre s'annonce toujours en brut annuel, mais
 * la décision se prend sur le net mensuel. L'écart n'a rien d'intuitif quand
 * on vient de France — deux impôts superposés, un abattement fédéral, et des
 * cotisations plafonnées qui font chuter le taux marginal après 73 200 $.
 */
import { useMemo, useState } from 'react';
import {
  DEVOPS_BENCHMARKS,
  TAX_YEAR,
  computePayroll,
  formatCad,
} from './quebecPayroll';

const PREFS_KEY = 'mtl.salary.v1';

function Row({
  label,
  value,
  hint,
  strong,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
  accent?: string;
}) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className={`text-sm ${strong ? 'text-frost' : 'text-frost/60'}`}>
        {label}
        {hint && <span className="ml-1 text-xs text-frost/35">{hint}</span>}
      </span>
      <span className={`font-mono tabular-nums ${accent ?? (strong ? 'text-frost' : 'text-frost/80')}`}>
        {value}
      </span>
    </div>
  );
}

export function SalaryCalculator(): JSX.Element {
  const [raw, setRaw] = useState(() => localStorage.getItem(PREFS_KEY) ?? '');
  const [eurRate, setEurRate] = useState(0.68);

  const gross = useMemo(() => {
    const parsed = Number.parseFloat(raw.replace(/[^\d.,]/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }, [raw]);

  const payroll = useMemo(() => computePayroll(gross), [gross]);
  const hasValue = gross > 0;

  const setGross = (value: string) => {
    setRaw(value);
    localStorage.setItem(PREFS_KEY, value);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Saisie */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <label className="block text-xs uppercase tracking-wider text-frost/50">
          Salaire brut annuel proposé
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={raw}
            onChange={(event) => setGross(event.target.value)}
            placeholder="85 000"
            aria-label="Salaire brut annuel en dollars canadiens"
            className="w-full bg-transparent font-mono text-4xl tabular-nums text-frost outline-none placeholder:text-frost/20"
          />
          <span className="font-mono text-2xl text-frost/40">$</span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {[65_000, 85_000, 105_000, 130_000].map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => setGross(String(amount))}
              className={`rounded-full px-3 py-1.5 text-xs ${
                gross === amount ? 'bg-stm text-white' : 'bg-white/10 text-frost/60'
              }`}
            >
              {(amount / 1000).toFixed(0)} k
            </button>
          ))}
        </div>
      </div>

      {hasValue && (
        <>
          {/* Résultat */}
          <div className="rounded-2xl border border-mint/40 bg-mint/10 p-5">
            <div className="text-xs uppercase tracking-wider text-frost/60">Net mensuel estimé</div>
            <div className="mt-1 font-mono text-5xl font-semibold tabular-nums text-frost">
              {formatCad(payroll.netMonthly)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-frost/50">
              <span>{formatCad(payroll.netBiweekly)} par paie (aux 2 semaines)</span>
              <span>{formatCad(payroll.net)} net annuel</span>
              {eurRate > 0 && (
                <span>
                  ≈{' '}
                  {new Intl.NumberFormat('fr-FR', {
                    style: 'currency',
                    currency: 'EUR',
                    maximumFractionDigits: 0,
                  }).format(payroll.netMonthly * eurRate)}{' '}
                  / mois
                </span>
              )}
            </div>
          </div>

          {/* Détail des prélèvements */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-xs uppercase tracking-wider text-frost/50">Prélèvements</h3>
              <span className="text-xs text-frost/40">
                {Math.round(payroll.effectiveRate * 100)} % du brut
              </span>
            </div>

            <Row label="Impôt fédéral" value={`− ${formatCad(payroll.federalTax)}`} />
            <Row
              label="dont abattement du Québec"
              hint="−16,5 %"
              value={`+ ${formatCad(payroll.federalAbatement)}`}
              accent="text-mint"
            />
            <Row label="Impôt du Québec" value={`− ${formatCad(payroll.quebecTax)}`} />
            <div className="my-2 border-t border-white/10" />
            <Row label="RRQ" hint="retraite" value={`− ${formatCad(payroll.rrq)}`} />
            <Row label="RQAP" hint="congés parentaux" value={`− ${formatCad(payroll.rqap)}`} />
            <Row label="Assurance-emploi" value={`− ${formatCad(payroll.ei)}`} />
            <div className="my-2 border-t border-white/10" />
            <Row label="Total prélevé" value={`− ${formatCad(payroll.totalDeductions)}`} strong />
            <Row label="Net annuel" value={formatCad(payroll.net)} strong accent="text-mint" />

            <p className="mt-3 text-[11px] leading-relaxed text-frost/40">
              Taux marginal : {Math.round(payroll.marginalRate * 100)} % — c’est ce que coûte
              réellement le prochain dollar négocié.
            </p>
          </div>

          {/* Ce que l'abattement change */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-frost/70">
            <strong className="text-frost">L’abattement du Québec.</strong> Les résidents voient leur
            impôt fédéral réduit de 16,5 %, en compensation des programmes que la province gère
            elle-même. Ici, {formatCad(payroll.federalAbatement)} de moins par an. La plupart des
            simulateurs canadiens génériques l’omettent et surestiment l’impôt d’autant.
          </div>
        </>
      )}

      {/* Repères de marché */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <h3 className="mb-2 text-xs uppercase tracking-wider text-frost/50">
          Repères DevOps à Montréal
        </h3>
        <ul className="space-y-1.5">
          {DEVOPS_BENCHMARKS.map((benchmark) => (
            <li key={benchmark.level}>
              <button
                type="button"
                onClick={() => setGross(String(Math.round((benchmark.range[0] + benchmark.range[1]) / 2)))}
                className="flex w-full items-baseline justify-between rounded-xl bg-black/20 px-3 py-2 text-left"
              >
                <span className="text-sm text-frost/70">{benchmark.level}</span>
                <span className="font-mono text-xs text-frost/50">
                  {(benchmark.range[0] / 1000).toFixed(0)}–{(benchmark.range[1] / 1000).toFixed(0)} k
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-frost/35">
          Bruts annuels indicatifs. Montréal paie sensiblement moins que Toronto, pour un coût de la
          vie lui aussi plus bas.
        </p>
      </div>

      {/* Paramètres */}
      <details className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <summary className="cursor-pointer text-sm text-frost/60">Paramètres et limites</summary>
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-frost/60">1 CAD =</span>
            <input
              type="text"
              inputMode="decimal"
              value={String(eurRate)}
              onChange={(event) => {
                const parsed = Number.parseFloat(event.target.value.replace(',', '.'));
                setEurRate(Number.isFinite(parsed) ? parsed : 0);
              }}
              className="w-24 rounded-xl bg-black/25 px-3 py-2 font-mono text-frost outline-none"
            />
            <span className="text-sm text-frost/60">EUR</span>
          </div>

          <p className="text-[11px] leading-relaxed text-frost/40">
            Barèmes de l’année <strong className="text-frost/60">{TAX_YEAR}</strong>. Ils sont
            indexés chaque 1<sup>er</sup> janvier : à revalider auprès de Revenu Québec et de
            l’Agence du revenu du Canada. Seule la table de paramètres est à modifier, le calcul ne
            change pas.
          </p>
          <p className="text-[11px] leading-relaxed text-frost/40">
            Estimation pour une personne seule, sans REER, frais de garde ni crédits particuliers.
            Une situation familiale ou des cotisations REER peuvent changer le résultat de façon
            significative.
          </p>
        </div>
      </details>
    </div>
  );
}
