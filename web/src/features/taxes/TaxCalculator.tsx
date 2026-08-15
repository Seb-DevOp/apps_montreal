/**
 * Calculateur de taxes et pourboires.
 *
 * Contrainte d'usage : on s'en sert debout, une main sur le téléphone, devant
 * un serveur qui attend. La hiérarchie visuelle place donc UNE information au
 * sommet — le montant à taper sur le terminal — et relègue le détail en
 * dessous. Le clavier numérique est forcé (`inputMode="decimal"`), et les
 * préférences (taux, base, couverts) survivent au rechargement.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  COMBINED_RATE,
  TIP_PRESETS,
  computeTaxes,
  formatCad,
  reverseTaxes,
  taxesAsTipHint,
  toEuros,
  type TipBase,
} from './quebecTax';

const PREFS_KEY = 'mtl.taxPrefs.v1';

interface Prefs {
  tipRate: number;
  tipBase: TipBase;
  splitBetween: number;
  eurRate: number;
}

const DEFAULT_PREFS: Prefs = { tipRate: 0.18, tipBase: 'pre-tax', splitBetween: 1, eurRate: 0.68 };

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function Row({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className={`text-sm ${strong ? 'text-frost' : 'text-frost/60'}`}>
        {label}
        {muted && <span className="ml-1 text-xs text-frost/35">{muted}</span>}
      </span>
      <span className={`font-mono tabular-nums ${strong ? 'text-frost' : 'text-frost/80'}`}>{value}</span>
    </div>
  );
}

export function TaxCalculator(): JSX.Element {
  const [rawPrice, setRawPrice] = useState('');
  const [mode, setMode] = useState<'forward' | 'reverse'>('forward');
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [customTip, setCustomTip] = useState('');

  useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }, [prefs]);

  // La virgule est le séparateur décimal naturel d'un clavier français, mais
  // les claviers nord-américains produisent un point : on accepte les deux.
  const price = useMemo(() => {
    const normalized = rawPrice.replace(',', '.').replace(/[^\d.]/g, '');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [rawPrice]);

  const result = useMemo(
    () =>
      computeTaxes({
        displayPrice: price,
        tipRate: prefs.tipRate,
        tipBase: prefs.tipBase,
        splitBetween: prefs.splitBetween,
      }),
    [price, prefs],
  );

  const reversed = useMemo(() => reverseTaxes(price), [price]);
  const hint = useMemo(() => taxesAsTipHint(price), [price]);
  const hasValue = price > 0;

  const setTipRate = (rate: number) => {
    setCustomTip('');
    setPrefs((p) => ({ ...p, tipRate: rate }));
  };

  return (
    <section className="space-y-4 animate-fade-in">
      {/* ---------------- Saisie ---------------- */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="mb-3 flex gap-1 rounded-xl bg-black/25 p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode('forward')}
            className={`flex-1 rounded-lg py-2 transition ${
              mode === 'forward' ? 'bg-stm text-white' : 'text-frost/60'
            }`}
          >
            Prix affiché → à payer
          </button>
          <button
            type="button"
            onClick={() => setMode('reverse')}
            className={`flex-1 rounded-lg py-2 transition ${
              mode === 'reverse' ? 'bg-stm text-white' : 'text-frost/60'
            }`}
          >
            Ticket → hors taxes
          </button>
        </div>

        <label className="block text-xs uppercase tracking-wider text-frost/50">
          {mode === 'forward' ? 'Prix sur l’étiquette (hors taxes)' : 'Montant payé (taxes comprises)'}
        </label>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-mono text-3xl text-frost/40">$</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            value={rawPrice}
            onChange={(event) => setRawPrice(event.target.value)}
            placeholder="0,00"
            aria-label="Montant en dollars canadiens"
            className="w-full bg-transparent font-mono text-4xl tabular-nums text-frost outline-none placeholder:text-frost/20"
          />
          {rawPrice && (
            <button
              type="button"
              onClick={() => setRawPrice('')}
              aria-label="Effacer"
              className="rounded-full bg-white/10 px-3 py-1 text-sm text-frost/60"
            >
              ✕
            </button>
          )}
        </div>
        {hasValue && prefs.eurRate > 0 && (
          <p className="mt-1 text-xs text-frost/40">≈ {toEuros(price, prefs.eurRate)}</p>
        )}
      </div>

      {mode === 'reverse' ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <Row label="Prix hors taxes" value={formatCad(reversed.subtotal)} strong />
          <Row label="TPS" muted="5 %" value={formatCad(reversed.tps)} />
          <Row label="TVQ" muted="9,975 %" value={formatCad(reversed.tvq)} />
          <div className="my-2 border-t border-white/10" />
          <Row label="Total des taxes" value={formatCad(reversed.totalTaxes)} />
          <p className="mt-3 text-xs text-frost/40">
            Utile pour vérifier un relevé bancaire ou remplir une note de frais.
          </p>
        </div>
      ) : (
        <>
          {/* ---------------- Pourboire ---------------- */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-frost/50">Pourboire</span>
              <button
                type="button"
                onClick={() =>
                  setPrefs((p) => ({ ...p, tipBase: p.tipBase === 'pre-tax' ? 'post-tax' : 'pre-tax' }))
                }
                className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-frost/70"
              >
                base : {prefs.tipBase === 'pre-tax' ? 'avant taxes' : 'taxes comprises'}
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setTipRate(0)}
                className={`rounded-xl py-2.5 text-sm transition ${
                  prefs.tipRate === 0 ? 'bg-stm text-white' : 'bg-black/25 text-frost/60'
                }`}
              >
                0 %
              </button>
              {TIP_PRESETS.map((preset) => (
                <button
                  key={preset.rate}
                  type="button"
                  onClick={() => setTipRate(preset.rate)}
                  className={`rounded-xl py-2.5 text-sm transition ${
                    prefs.tipRate === preset.rate ? 'bg-stm text-white' : 'bg-black/25 text-frost/60'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={customTip}
                onChange={(event) => {
                  const value = event.target.value;
                  setCustomTip(value);
                  const parsed = Number.parseFloat(value.replace(',', '.'));
                  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
                    setPrefs((p) => ({ ...p, tipRate: parsed / 100 }));
                  }
                }}
                placeholder="Autre %"
                aria-label="Pourboire personnalisé en pourcentage"
                className="w-24 rounded-xl bg-black/25 px-3 py-2 text-sm text-frost outline-none placeholder:text-frost/30"
              />
              <span className="text-xs text-frost/40">
                {TIP_PRESETS.find((p) => p.rate === prefs.tipRate)?.hint ?? 'taux personnalisé'}
              </span>
            </div>

            {prefs.tipRate > 0 && hasValue && result.tipDifference >= 0.01 && (
              <p className="mt-3 rounded-xl bg-amber/10 p-2.5 text-xs text-amber">
                Le terminal proposera sans doute {formatCad(result.alternateTip)} (calcul sur le total taxes
                comprises), soit {formatCad(result.tipDifference)} de plus que l’usage québécois.
              </p>
            )}
          </div>

          {/* ---------------- Résultat ---------------- */}
          <div className="rounded-2xl border border-stm/40 bg-stm/10 p-5">
            <div className="text-xs uppercase tracking-wider text-frost/60">
              À saisir sur le terminal
            </div>
            <div className="mt-1 font-mono text-5xl font-semibold tabular-nums text-frost">
              {formatCad(result.grandTotal)}
            </div>
            {prefs.splitBetween > 1 && (
              <div className="mt-2 text-sm text-frost/70">
                {formatCad(result.perPerson)} par personne ({prefs.splitBetween} couverts)
              </div>
            )}
            {hasValue && (
              <div className="mt-2 text-xs text-frost/50">
                soit {Math.round((result.realCostMultiplier - 1) * 100)} % de plus que le prix affiché
                {prefs.eurRate > 0 && ` · ≈ ${toEuros(result.grandTotal, prefs.eurRate)}`}
              </div>
            )}
          </div>

          {/* ---------------- Détail ---------------- */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <Row label="Sous-total" value={formatCad(result.subtotal)} />
            <Row label="TPS" muted="5 %" value={formatCad(result.tps)} />
            <Row label="TVQ" muted="9,975 %" value={formatCad(result.tvq)} />
            <div className="my-2 border-t border-white/10" />
            <Row label="Total taxes comprises" value={formatCad(result.totalWithTaxes)} strong />
            {prefs.tipRate > 0 && (
              <Row
                label="Pourboire"
                muted={`${Math.round(prefs.tipRate * 1000) / 10} % ${
                  prefs.tipBase === 'pre-tax' ? 'avant taxes' : 'sur le total'
                }`}
                value={formatCad(result.tip)}
              />
            )}
            <div className="my-2 border-t border-white/10" />
            <Row label="Total" value={formatCad(result.grandTotal)} strong />

            <div className="mt-4 flex items-center gap-3">
              <span className="text-sm text-frost/60">Partager entre</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPrefs((p) => ({ ...p, splitBetween: Math.max(1, p.splitBetween - 1) }))}
                  aria-label="Un couvert de moins"
                  className="h-9 w-9 rounded-full bg-white/10 text-lg text-frost"
                >
                  −
                </button>
                <span className="w-8 text-center font-mono text-frost">{prefs.splitBetween}</span>
                <button
                  type="button"
                  onClick={() => setPrefs((p) => ({ ...p, splitBetween: Math.min(20, p.splitBetween + 1) }))}
                  aria-label="Un couvert de plus"
                  className="h-9 w-9 rounded-full bg-white/10 text-lg text-frost"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          {/* ---------------- Astuce locale ---------------- */}
          {hasValue && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-frost/70">
              <strong className="text-frost">Astuce de calcul mental.</strong> Les deux taxes réunies font{' '}
              {(COMBINED_RATE * 100).toFixed(3).replace('.', ',')} %, presque exactement 15 %. Sur ce
              montant, laisser {formatCad(hint.amount)} de pourboire — c’est-à-dire recopier le total des
              taxes du ticket — tombe juste, sans sortir le téléphone.
            </div>
          )}
        </>
      )}

      {/* ---------------- Taux de change ---------------- */}
      <details className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <summary className="cursor-pointer text-sm text-frost/60">Taux de change CAD → EUR</summary>
        <div className="mt-3 flex items-center gap-3">
          <span className="text-sm text-frost/60">1 CAD =</span>
          <input
            type="text"
            inputMode="decimal"
            value={String(prefs.eurRate)}
            onChange={(event) => {
              const parsed = Number.parseFloat(event.target.value.replace(',', '.'));
              setPrefs((p) => ({ ...p, eurRate: Number.isFinite(parsed) ? parsed : 0 }));
            }}
            aria-label="Taux de change"
            className="w-24 rounded-xl bg-black/25 px-3 py-2 font-mono text-frost outline-none"
          />
          <span className="text-sm text-frost/60">EUR</span>
        </div>
        <p className="mt-2 text-xs text-frost/40">
          Saisi à la main volontairement : la conversion sert d’ordre de grandeur, pas de comptabilité.
          Mets-le à jour au départ, il ne bougera pas de plus de 2 % sur le voyage.
        </p>
      </details>
    </section>
  );
}
