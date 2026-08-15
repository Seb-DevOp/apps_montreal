/**
 * Décodeur d'argot québécois.
 *
 * Recherche insensible aux accents et à la casse : on tape « ecoeurant » et on
 * trouve « écœurant ». Les données viennent de Firestore et restent
 * disponibles hors-ligne grâce au cache persistant — c'est précisément dans le
 * métro, sans réseau, qu'on a besoin de décoder ce qu'on vient d'entendre.
 */
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { LexiconEntry } from '../../types';

const CATEGORY_LABEL: Record<LexiconEntry['category'], string> = {
  expression: 'Expressions',
  nourriture: 'Nourriture',
  transport: 'Transport',
  quotidien: 'Quotidien',
  juron: 'Sacres',
  anglicisme: 'Anglicismes',
};

/** Normalise pour la recherche : minuscules, sans accents, sans ligatures. */
function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .toLowerCase();
}

export function Lexicon(): JSX.Element {
  const [entries, setEntries] = useState<LexiconEntry[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<LexiconEntry['category'] | 'toutes'>('toutes');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    return onSnapshot(query(collection(db(), 'lexicon'), orderBy('term')), (snapshot) => {
      setEntries(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as LexiconEntry));
    });
  }, []);

  const results = useMemo(() => {
    const needle = normalize(search.trim());
    return entries
      .filter((entry) => category === 'toutes' || entry.category === category)
      .filter((entry) =>
        needle.length === 0
          ? true
          : normalize(`${entry.term} ${entry.definition} ${entry.frenchEquivalent ?? ''}`).includes(needle),
      )
      .sort((a, b) => {
        // Une correspondance en début de terme passe devant.
        if (!needle) return a.term.localeCompare(b.term, 'fr');
        const aStarts = normalize(a.term).startsWith(needle) ? 0 : 1;
        const bStarts = normalize(b.term).startsWith(needle) ? 0 : 1;
        return aStarts - bStarts || a.term.localeCompare(b.term, 'fr');
      });
  }, [entries, search, category]);

  const categories = useMemo(
    () => [...new Set(entries.map((entry) => entry.category))],
    [entries],
  );

  return (
    <div className="space-y-4">
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Tabarnak, dépanneur, char…"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full rounded-xl bg-white/5 px-4 py-3 text-frost outline-none placeholder:text-frost/30"
      />

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <button
          type="button"
          onClick={() => setCategory('toutes')}
          className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
            category === 'toutes' ? 'bg-stm text-white' : 'bg-white/10 text-frost/60'
          }`}
        >
          Tout
        </button>
        {categories.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setCategory(key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
              category === key ? 'bg-stm text-white' : 'bg-white/10 text-frost/60'
            }`}
          >
            {CATEGORY_LABEL[key] ?? key}
          </button>
        ))}
      </div>

      <p className="text-xs text-frost/35">
        {results.length} expression{results.length > 1 ? 's' : ''}
      </p>

      <ul className="space-y-2">
        {results.map((entry) => {
          const open = expanded === entry.id;
          return (
            <li key={entry.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : entry.id)}
                aria-expanded={open}
                className="flex w-full items-baseline justify-between gap-3 p-4 text-left"
              >
                <span className="font-medium text-frost">{entry.term}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-frost/30">
                  {CATEGORY_LABEL[entry.category] ?? entry.category}
                </span>
              </button>

              <div className={`px-4 ${open ? 'pb-4' : 'pb-4'}`}>
                <p className="text-sm text-frost/80">{entry.definition}</p>
                {open && (
                  <div className="mt-3 space-y-2 border-t border-white/10 pt-3 animate-fade-in">
                    {entry.example && (
                      <p className="text-sm italic text-frost/60">« {entry.example} »</p>
                    )}
                    {entry.frenchEquivalent && (
                      <p className="text-xs text-frost/45">
                        En France : <span className="text-frost/70">{entry.frenchEquivalent}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {results.length === 0 && (
        <p className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-frost/40">
          Rien trouvé. Note l’expression et demande à un local : c’est encore la meilleure méthode.
        </p>
      )}
    </div>
  );
}
