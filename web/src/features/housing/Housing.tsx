/**
 * Recherche de logement à Montréal.
 *
 * Deux parties : un suivi des visites, et un rappel des règles québécoises qui
 * surprennent un locataire français — le dépôt de garantie est illégal, le
 * chauffage peut être inclus ou non (« chauffé/éclairé »), et la taille se
 * compte en pièces et demies.
 *
 * La clause animaux est un champ de premier plan, pas un détail : elle élimine
 * une part importante du marché montréalais, et se découvre souvent trop tard.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { NEIGHBORHOODS } from '../../data/neighborhoods';
import { api } from '../../lib/api';

type Verdict = 'a-visiter' | 'visite' | 'candidature' | 'refuse' | 'ecarte';

interface Listing {
  id: string;
  title: string;
  neighborhood: string;
  /** Taille québécoise : 3 ½, 4 ½… */
  size: string;
  rent: number;
  /** Chauffage et électricité inclus dans le loyer. */
  heatedIncluded: boolean;
  petsAllowed: boolean | null;
  url: string;
  verdict: Verdict;
  availableAt: string;
  notes: string;
  /** État du dernier contrôle automatique de l'annonce. */
  linkStatus?: 'live' | 'gone' | 'suspect' | 'blocked' | 'unknown';
  linkReason?: string;
  linkCheckedAt?: { toDate: () => Date };
}

const VERDICT_LABEL: Record<Verdict, string> = {
  'a-visiter': 'À visiter',
  visite: 'Visité',
  candidature: 'Candidature',
  refuse: 'Refusé',
  ecarte: 'Écarté',
};

const VERDICT_STYLE: Record<Verdict, string> = {
  'a-visiter': 'bg-white/10 text-frost/60',
  visite: 'bg-stm/20 text-stm',
  candidature: 'bg-amber/20 text-amber',
  refuse: 'bg-maple/20 text-maple',
  ecarte: 'bg-white/5 text-frost/30',
};

/**
 * Trois états de lien, jamais deux.
 *
 * « Non vérifiable » ne signifie PAS « disparue » : les sites d'annonces
 * refusent couramment les requêtes venant d'un datacenter, et prendre ce refus
 * pour un retrait ferait écarter des logements encore libres. Seul un retrait
 * constaté deux fois de suite passe en rouge.
 */
const LINK_STATUS: Record<string, { label: string; style: string; border: string }> = {
  live: { label: 'En ligne', style: 'bg-mint/20 text-mint', border: 'border-white/10' },
  suspect: { label: 'Peut-être retirée', style: 'bg-amber/20 text-amber', border: 'border-amber/40' },
  gone: { label: 'Disparue', style: 'bg-maple/25 text-maple', border: 'border-maple/50' },
  blocked: { label: 'Non vérifiable', style: 'bg-white/10 text-frost/40', border: 'border-white/10' },
  unknown: { label: 'Jamais vérifiée', style: 'bg-white/10 text-frost/40', border: 'border-white/10' },
};

const inputClass =
  'w-full rounded-xl bg-black/25 px-3 py-2.5 text-sm text-frost outline-none placeholder:text-frost/30';

/** Loyers mensuels indicatifs pour un 4 ½, en dollars canadiens. */
const RENT_BENCHMARKS: { area: string; range: string }[] = [
  { area: 'Plateau / Mile End', range: '1 500 – 2 000 $' },
  { area: 'Villeray / Rosemont', range: '1 300 – 1 700 $' },
  { area: 'Hochelaga / Verdun', range: '1 200 – 1 600 $' },
  { area: 'Centre-ville / Griffintown', range: '1 800 – 2 400 $' },
  { area: 'Outremont / Westmount', range: '1 900 – 2 600 $' },
];

function useListings() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onSnapshot(
      query(collection(db(), 'housing')),
      (snapshot) => {
        setListings(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Listing));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  return { listings, loading };
}

export function Housing(): JSX.Element {
  const { listings, loading } = useListings();
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [petsOnly, setPetsOnly] = useState(false);

  const [draft, setDraft] = useState({ title: '', neighborhood: 'Plateau-Mont-Royal', rent: '', url: '' });

  const create = useCallback(async () => {
    if (!draft.title.trim()) return;
    await addDoc(collection(db(), 'housing'), {
      title: draft.title.trim(),
      neighborhood: draft.neighborhood,
      size: '4 ½',
      rent: Number.parseInt(draft.rent, 10) || 0,
      heatedIncluded: false,
      petsAllowed: null,
      url: draft.url.trim(),
      verdict: 'a-visiter' as Verdict,
      availableAt: '',
      notes: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setDraft({ title: '', neighborhood: 'Plateau-Mont-Royal', rent: '', url: '' });
    setAdding(false);
  }, [draft]);

  const patch = (id: string, values: Partial<Listing>) =>
    void updateDoc(doc(db(), 'housing', id), { ...values, updatedAt: serverTimestamp() });

  const visible = useMemo(() => {
    const filtered = petsOnly ? listings.filter((l) => l.petsAllowed === true) : listings;
    // Les logements écartés ou refusés descendent, le reste se classe par loyer.
    const rank: Record<Verdict, number> = {
      candidature: 0,
      visite: 1,
      'a-visiter': 2,
      refuse: 3,
      ecarte: 4,
    };
    return [...filtered].sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.rent - b.rent);
  }, [listings, petsOnly]);

  const petsUnknown = listings.filter((l) => l.petsAllowed === null).length;
  const goneCount = listings.filter((l) => l.linkStatus === 'gone').length;

  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);

  const checkNow = useCallback(async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const r = await api.post<{
        checked: number;
        live: number;
        gone: number;
        suspect: number;
        blocked: number;
      }>('/housing/check');

      setCheckResult(
        r.checked === 0
          ? 'Aucune annonce à vérifier.'
          : `${r.checked} vérifiées · ${r.live} en ligne · ${r.gone} disparues · ${r.suspect} douteuses · ${r.blocked} non vérifiables`,
      );
    } catch (error) {
      setCheckResult(error instanceof Error ? error.message : 'Vérification impossible.');
    } finally {
      setChecking(false);
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* Rappels québécois */}
      <div className="space-y-2 rounded-2xl border border-amber/30 bg-amber/10 p-4 text-sm text-frost/80">
        <p>
          <strong className="text-frost">Le dépôt de garantie est illégal au Québec.</strong> Un
          propriétaire ne peut exiger que le premier mois de loyer. Toute demande de « caution »
          est une infraction — et un signal d’alarme.
        </p>
        <p>
          <strong className="text-frost">« Chauffé / éclairé »</strong> signifie chauffage et
          électricité inclus. Sans cette mention, ajoute 60 à 120 $ par mois l’hiver.
        </p>
        <p>
          <strong className="text-frost">Le 1<sup>er</sup> juillet</strong> est la date de
          déménagement traditionnelle : l’essentiel des baux y démarre, et le marché s’y concentre.
        </p>
      </div>

      {/* Surveillance automatique des annonces */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-frost">🔗 Surveillance des annonces</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-frost/50">
              Contrôle automatique deux fois par jour. Une annonce ne passe en rouge qu’après{' '}
              <strong className="text-frost/70">deux constats successifs</strong> : un blocage
              passager ne doit pas te faire renoncer à un logement encore libre.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void checkNow()}
            disabled={checking}
            className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs text-frost/70 disabled:opacity-40"
          >
            {checking ? 'En cours…' : 'Vérifier'}
          </button>
        </div>
        {goneCount > 0 && (
          <p className="mt-2 text-xs text-maple">
            {goneCount} annonce{goneCount > 1 ? 's' : ''} disparue{goneCount > 1 ? 's' : ''} — à écarter.
          </p>
        )}
        {checkResult && <p className="mt-2 text-xs text-frost/50">{checkResult}</p>}
      </div>

      {/* Alerte animaux */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-frost">🐈 Clause animaux</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-frost/50">
              Beaucoup de baux montréalais l’interdisent. À vérifier avant la visite, pas après :
              c’est le premier filtre du marché.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPetsOnly((v) => !v)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${
              petsOnly ? 'bg-mint/25 text-mint' : 'bg-white/10 text-frost/60'
            }`}
          >
            {petsOnly ? 'Filtre actif' : 'Filtrer'}
          </button>
        </div>
        {petsUnknown > 0 && (
          <p className="mt-2 text-xs text-amber">
            {petsUnknown} logement{petsUnknown > 1 ? 's' : ''} sans réponse sur les animaux.
          </p>
        )}
      </div>

      {/* Ajout */}
      {adding ? (
        <div className="space-y-2 rounded-2xl border border-stm/40 bg-stm/10 p-4">
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Rue ou intitulé de l'annonce"
            className={inputClass}
          />
          <select
            value={draft.neighborhood}
            onChange={(e) => setDraft({ ...draft, neighborhood: e.target.value })}
            className={inputClass}
          >
            {NEIGHBORHOODS.map((n) => (
              <option key={n.id} value={n.name}>{n.name}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <input
              value={draft.rent}
              onChange={(e) => setDraft({ ...draft, rent: e.target.value })}
              placeholder="Loyer $"
              inputMode="numeric"
              className={inputClass}
            />
            <input
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              placeholder="Lien"
              inputMode="url"
              className={inputClass}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setAdding(false)} className="flex-1 rounded-xl bg-white/10 py-2.5 text-sm text-frost/70">
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void create()}
              disabled={!draft.title.trim()}
              className="flex-[2] rounded-xl bg-stm py-2.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Ajouter
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="w-full rounded-xl bg-stm py-3.5 font-medium text-white">
          + Ajouter un logement
        </button>
      )}

      {loading && <div className="h-32 animate-pulse rounded-2xl bg-white/5" />}

      {!loading && visible.length === 0 && (
        <p className="rounded-2xl border border-dashed border-white/15 p-10 text-center text-sm text-frost/40">
          {listings.length === 0
            ? 'Aucun logement suivi. Centris, Kijiji et les groupes Facebook sont les sources principales.'
            : 'Aucun logement acceptant les animaux pour l’instant.'}
        </p>
      )}

      <ul className="space-y-2">
        {visible.map((listing) => (
          <li
            key={listing.id}
            className={`overflow-hidden rounded-2xl border bg-white/5 ${
              LINK_STATUS[listing.linkStatus ?? 'unknown']?.border ?? 'border-white/10'
            }`}
          >
            <button
              type="button"
              onClick={() => setExpanded(expanded === listing.id ? null : listing.id)}
              className="w-full p-4 text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-medium text-frost">{listing.title}</h3>
                  <p className="truncate text-sm text-frost/60">
                    {listing.neighborhood} · {listing.size}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${VERDICT_STYLE[listing.verdict]}`}>
                  {VERDICT_LABEL[listing.verdict]}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                {listing.rent > 0 && (
                  <span className="rounded-full bg-white/10 px-2.5 py-1 text-frost/70">
                    {listing.rent} $/mois
                    {listing.heatedIncluded ? ' · chauffé' : ''}
                  </span>
                )}
                {listing.url && listing.linkStatus && listing.linkStatus !== 'live' && (
                  <span
                    className={`rounded-full px-2.5 py-1 ${LINK_STATUS[listing.linkStatus]?.style ?? ''}`}
                    title={listing.linkReason ?? ''}
                  >
                    🔗 {LINK_STATUS[listing.linkStatus]?.label}
                  </span>
                )}
                <span
                  className={`rounded-full px-2.5 py-1 ${
                    listing.petsAllowed === true
                      ? 'bg-mint/20 text-mint'
                      : listing.petsAllowed === false
                        ? 'bg-maple/20 text-maple'
                        : 'bg-white/10 text-frost/40'
                  }`}
                >
                  🐈 {listing.petsAllowed === true ? 'accepté' : listing.petsAllowed === false ? 'refusé' : 'à demander'}
                </span>
              </div>
            </button>

            {expanded === listing.id && (
              <div className="space-y-3 border-t border-white/10 p-4">
                <select
                  value={listing.verdict}
                  onChange={(e) => patch(listing.id, { verdict: e.target.value as Verdict })}
                  className={inputClass}
                >
                  {(Object.keys(VERDICT_LABEL) as Verdict[]).map((v) => (
                    <option key={v} value={v}>{VERDICT_LABEL[v]}</option>
                  ))}
                </select>

                <div className="grid grid-cols-2 gap-2">
                  <input
                    defaultValue={listing.size}
                    onBlur={(e) => patch(listing.id, { size: e.target.value })}
                    placeholder="4 ½"
                    className={inputClass}
                  />
                  <input
                    defaultValue={String(listing.rent || '')}
                    onBlur={(e) => patch(listing.id, { rent: Number.parseInt(e.target.value, 10) || 0 })}
                    placeholder="Loyer"
                    inputMode="numeric"
                    className={inputClass}
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => patch(listing.id, { heatedIncluded: !listing.heatedIncluded })}
                    className={`flex-1 rounded-xl py-2.5 text-xs ${
                      listing.heatedIncluded ? 'bg-mint/20 text-mint' : 'bg-black/25 text-frost/50'
                    }`}
                  >
                    {listing.heatedIncluded ? 'Chauffé / éclairé' : 'Charges en sus'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      patch(listing.id, {
                        petsAllowed:
                          listing.petsAllowed === null ? true : listing.petsAllowed ? false : null,
                      })
                    }
                    className={`flex-1 rounded-xl py-2.5 text-xs ${
                      listing.petsAllowed === true
                        ? 'bg-mint/20 text-mint'
                        : listing.petsAllowed === false
                          ? 'bg-maple/20 text-maple'
                          : 'bg-black/25 text-frost/50'
                    }`}
                  >
                    🐈 {listing.petsAllowed === true ? 'accepté' : listing.petsAllowed === false ? 'refusé' : 'inconnu'}
                  </button>
                </div>

                <input
                  type="date"
                  defaultValue={listing.availableAt}
                  onBlur={(e) => patch(listing.id, { availableAt: e.target.value })}
                  className={inputClass}
                />

                <textarea
                  defaultValue={listing.notes}
                  onBlur={(e) => patch(listing.id, { notes: e.target.value })}
                  placeholder="Luminosité, bruit, voisinage, état, distance du métro…"
                  rows={3}
                  className={`${inputClass} resize-none`}
                />

                {listing.url && (
                  <a href={listing.url} target="_blank" rel="noreferrer noopener" className="block text-xs text-stm">
                    Ouvrir l’annonce ↗
                  </a>
                )}

                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Supprimer ${listing.title} ?`)) {
                      void deleteDoc(doc(db(), 'housing', listing.id));
                    }
                  }}
                  className="w-full rounded-xl bg-maple/15 py-2.5 text-sm text-maple"
                >
                  Supprimer
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Repères de loyer */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <h3 className="mb-2 text-xs uppercase tracking-wider text-frost/50">
          Loyers indicatifs pour un 4 ½
        </h3>
        <ul className="space-y-1 text-xs">
          {RENT_BENCHMARKS.map((benchmark) => (
            <li key={benchmark.area} className="flex justify-between text-frost/60">
              <span>{benchmark.area}</span>
              <span className="font-mono text-frost/80">{benchmark.range}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-frost/35">
          Un « 4 ½ » compte trois pièces plus la salle de bain — l’équivalent d’un T3.
        </p>
      </div>
    </div>
  );
}
