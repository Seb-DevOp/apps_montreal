/**
 * Accès temps réel au journal photo.
 *
 * `onSnapshot` fait tout le travail : les proches restés en France voient la
 * photo apparaître en une seconde, et le cache persistant Firestore ressert le
 * flux hors-ligne sans une ligne de code de synchronisation.
 *
 * Détail qui compte en voyage : `snapshot.metadata.fromCache` permet de dire
 * honnêtement à l'utilisateur qu'il regarde des données locales, plutôt que de
 * laisser croire que le flux est à jour.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type QuerySnapshot,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';
import type { Comment, Post } from '../../types';

interface FeedState {
  posts: Post[];
  loading: boolean;
  fromCache: boolean;
  error: string | null;
}

export function usePosts(options: { neighborhood?: string; max?: number } = {}): FeedState {
  const { neighborhood, max = 100 } = options;
  const [state, setState] = useState<FeedState>({
    posts: [],
    loading: true,
    fromCache: false,
    error: null,
  });

  useEffect(() => {
    const constraints = neighborhood
      ? [where('neighborhood', '==', neighborhood), orderBy('takenAt', 'desc'), limit(max)]
      : [orderBy('takenAt', 'desc'), limit(max)];

    const unsubscribe = onSnapshot(
      query(collection(db(), 'posts'), ...constraints),
      // includeMetadataChanges : sans ça, on ne serait pas notifié du passage
      // « données du cache » -> « données du serveur ».
      { includeMetadataChanges: true },
      (snapshot: QuerySnapshot) => {
        setState({
          posts: snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Post),
          loading: false,
          fromCache: snapshot.metadata.fromCache,
          error: null,
        });
      },
      (error) => {
        setState((s) => ({ ...s, loading: false, error: error.message }));
      },
    );

    return unsubscribe;
  }, [neighborhood, max]);

  return state;
}

/** Likes d'un post : liste des uid, et bascule optimiste. */
export function useLikes(postId: string): {
  likes: string[];
  liked: boolean;
  toggle: () => Promise<void>;
} {
  const { user } = useAuth();
  const [likes, setLikes] = useState<string[]>([]);

  useEffect(() => {
    return onSnapshot(collection(db(), 'posts', postId, 'likes'), (snapshot) => {
      setLikes(snapshot.docs.map((d) => d.id));
    });
  }, [postId]);

  const liked = useMemo(() => (user ? likes.includes(user.uid) : false), [likes, user]);

  const toggle = useCallback(async () => {
    if (!user) return;
    const ref = doc(db(), 'posts', postId, 'likes', user.uid);
    // Pas de compteur agrégé : l'id du document EST l'uid, donc un like est
    // idempotent et le décompte se lit directement dans le snapshot. Une
    // écriture hors-ligne est rejouée automatiquement à la reconnexion.
    if (liked) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, { uid: user.uid, createdAt: serverTimestamp() });
    }
  }, [user, postId, liked]);

  return { likes, liked, toggle };
}

/** Commentaires d'un post, du plus ancien au plus récent. */
export function useComments(postId: string, enabled = true): {
  comments: Comment[];
  add: (text: string) => Promise<void>;
  remove: (commentId: string) => Promise<void>;
} {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);

  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      query(collection(db(), 'posts', postId, 'comments'), orderBy('createdAt', 'asc'), limit(200)),
      (snapshot) => {
        setComments(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Comment));
      },
    );
  }, [postId, enabled]);

  const add = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!user || trimmed.length === 0) return;
      const ref = doc(collection(db(), 'posts', postId, 'comments'));
      await setDoc(ref, {
        authorUid: user.uid,
        authorName: user.displayName ?? 'Voyageur',
        authorPhoto: user.photoURL ?? null,
        text: trimmed.slice(0, 500),
        createdAt: serverTimestamp(),
      });
    },
    [user, postId],
  );

  const remove = useCallback(
    async (commentId: string) => {
      await deleteDoc(doc(db(), 'posts', postId, 'comments', commentId));
    },
    [postId],
  );

  return { comments, add, remove };
}
