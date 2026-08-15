/**
 * Carte photo du journal : image, contexte, likes et commentaires.
 *
 * L'image pleine résolution n'est chargée que lorsque la carte entre dans le
 * viewport (`loading="lazy"` + `IntersectionObserver` pour la bascule
 * vignette → plein format). Sur un forfait itinérance limité, charger 80
 * photos d'un coup au chargement du flux serait ruineux.
 */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useComments, useLikes } from './usePosts';
import { api } from '../../lib/api';
import type { Post } from '../../types';

function relativeTime(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
  const thresholds: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [604800, 'day'],
    [2629800, 'week'],
  ];
  let previous = 1;
  for (const [limit, unit] of thresholds) {
    if (seconds < limit) return formatter.format(-Math.round(seconds / previous), unit);
    previous = limit;
  }
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

export function PhotoCard({ post }: { post: Post }): JSX.Element {
  const { user, isAdmin } = useAuth();
  const { likes, liked, toggle } = useLikes(post.id);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const { comments, add, remove } = useComments(post.id, commentsOpen);
  const [draft, setDraft] = useState('');
  const [showFull, setShowFull] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShowFull(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const takenAt = post.takenAt?.toDate?.() ?? new Date();

  const handleDelete = async () => {
    if (!window.confirm('Supprimer cette photo et son fichier ? Action définitive.')) return;
    setDeleting(true);
    try {
      // Passe par l'API : elle purge aussi les fichiers Storage et les
      // sous-collections, ce que le client ne peut pas faire seul.
      await api.del(`/posts/${post.id}`);
    } catch {
      setDeleting(false);
    }
  };

  return (
    <article
      ref={cardRef}
      className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 animate-slide-up"
    >
      <div className="relative bg-black/40" style={{ aspectRatio: `${post.width} / ${post.height}` }}>
        <img
          src={showFull ? post.url : post.thumbUrl}
          alt={post.caption || 'Photo du journal'}
          loading="lazy"
          decoding="async"
          width={post.width}
          height={post.height}
          className="h-full w-full object-cover"
        />
        {post.neighborhood && (
          <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2.5 py-1 text-xs text-frost backdrop-blur">
            📍 {post.neighborhood}
          </span>
        )}
      </div>

      <div className="p-4">
        {post.caption && <p className="whitespace-pre-wrap text-frost/90">{post.caption}</p>}

        <div className="mt-2 flex items-center gap-2 text-xs text-frost/40">
          <span>{post.authorName}</span>
          <span>·</span>
          <time dateTime={takenAt.toISOString()} title={takenAt.toLocaleString('fr-FR')}>
            {relativeTime(takenAt)}
          </time>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void toggle()}
            disabled={!user}
            aria-pressed={liked}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${
              liked ? 'bg-maple/20 text-maple' : 'bg-white/10 text-frost/60'
            }`}
          >
            <span className={liked ? 'scale-110' : ''}>{liked ? '❤️' : '🤍'}</span>
            {likes.length > 0 && <span className="tabular-nums">{likes.length}</span>}
          </button>

          <button
            type="button"
            onClick={() => setCommentsOpen((open) => !open)}
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm text-frost/60"
          >
            💬 {commentsOpen ? 'Masquer' : 'Commenter'}
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="ml-auto rounded-full bg-white/5 px-3 py-1.5 text-sm text-frost/40 disabled:opacity-40"
            >
              {deleting ? '…' : '🗑'}
            </button>
          )}
        </div>

        {commentsOpen && (
          <div className="mt-4 space-y-3 border-t border-white/10 pt-3">
            {comments.length === 0 && (
              <p className="text-sm text-frost/40">Personne n’a encore réagi. À toi de commencer.</p>
            )}

            {comments.map((comment) => (
              <div key={comment.id} className="flex gap-2">
                {comment.authorPhoto ? (
                  <img src={comment.authorPhoto} alt="" className="h-7 w-7 shrink-0 rounded-full" />
                ) : (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs text-frost/60">
                    {comment.authorName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium text-frost/80">{comment.authorName}</span>{' '}
                    <span className="text-frost/70">{comment.text}</span>
                  </p>
                  {comment.createdAt && (
                    <span className="text-[11px] text-frost/30">
                      {relativeTime(comment.createdAt.toDate())}
                    </span>
                  )}
                </div>
                {(isAdmin || comment.authorUid === user?.uid) && (
                  <button
                    type="button"
                    onClick={() => void remove(comment.id)}
                    aria-label="Supprimer le commentaire"
                    className="text-xs text-frost/25"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}

            {user && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void add(draft);
                  setDraft('');
                }}
                className="flex gap-2"
              >
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Un mot pour Seb…"
                  maxLength={500}
                  className="flex-1 rounded-full bg-black/25 px-4 py-2 text-sm text-frost outline-none placeholder:text-frost/30"
                />
                <button
                  type="submit"
                  disabled={draft.trim().length === 0}
                  className="rounded-full bg-stm px-4 py-2 text-sm text-white disabled:opacity-30"
                >
                  Envoyer
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
