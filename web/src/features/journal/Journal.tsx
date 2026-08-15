/**
 * Flux du journal d'aventures : publication (admin) + galerie temps réel.
 */
import { useMemo, useState } from 'react';
import { usePosts } from './usePosts';
import { PhotoCard } from './PhotoCard';
import { PhotoUploader } from './PhotoUploader';
import { NEIGHBORHOODS } from '../../data/neighborhoods';

export function Journal(): JSX.Element {
  const [filter, setFilter] = useState<string>('');
  const { posts, loading, fromCache, error } = usePosts({ neighborhood: filter || undefined });

  const usedNeighborhoods = useMemo(() => {
    const present = new Set(posts.map((post) => post.neighborhood).filter(Boolean) as string[]);
    // Quand un filtre est actif, la liste des quartiers présents se réduit au
    // seul filtre : on garde donc le référentiel complet comme repli.
    return filter ? NEIGHBORHOODS.map((n) => n.name) : [...present];
  }, [posts, filter]);

  return (
    <div className="space-y-4">
      <PhotoUploader />

      {usedNeighborhoods.length > 1 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <button
            type="button"
            onClick={() => setFilter('')}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
              filter === '' ? 'bg-stm text-white' : 'bg-white/10 text-frost/60'
            }`}
          >
            Tout
          </button>
          {usedNeighborhoods.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setFilter(name)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${
                filter === name ? 'bg-stm text-white' : 'bg-white/10 text-frost/60'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {fromCache && posts.length > 0 && (
        <p className="rounded-xl bg-white/5 px-3 py-2 text-xs text-frost/50">
          Hors-ligne — flux affiché depuis la mémoire du téléphone.
        </p>
      )}

      {error && <p className="rounded-xl bg-maple/15 p-3 text-sm text-maple">{error}</p>}

      {loading && posts.length === 0 && (
        <div className="space-y-4">
          {[0, 1].map((index) => (
            <div key={index} className="h-64 animate-pulse rounded-2xl bg-white/5" />
          ))}
        </div>
      )}

      {!loading && posts.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center text-frost/40">
          Le journal est encore vide.
          <br />
          La première photo de Montréal arrive bientôt.
        </div>
      )}

      {posts.map((post) => (
        <PhotoCard key={post.id} post={post} />
      ))}
    </div>
  );
}
