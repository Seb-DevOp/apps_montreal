/**
 * Authentification et rôles.
 *
 * Le rôle est lu dans les *custom claims* du jeton, pas dans un document
 * Firestore : c'est la même source que celle utilisée par les règles de
 * sécurité, donc l'UI et le serveur ne peuvent pas diverger. Un invité qui
 * bidouillerait son profil ne gagnerait rien.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getRedirectResult,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

export type Role = 'admin' | 'guest' | 'blocked';

interface AuthState {
  user: User | null;
  role: Role;
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Force le rafraîchissement du jeton (après un changement de rôle). */
  refreshRole: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Traduit les codes d'erreur Firebase en messages lisibles. */
function humanizeAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  const messages: Record<string, string> = {
    'auth/invalid-email': 'Adresse e-mail invalide.',
    'auth/user-disabled': 'Ce compte a été désactivé.',
    'auth/user-not-found': 'Aucun compte avec cette adresse.',
    'auth/wrong-password': 'Mot de passe incorrect.',
    'auth/invalid-credential': 'Identifiants incorrects.',
    'auth/email-already-in-use': 'Cette adresse est déjà utilisée.',
    'auth/weak-password': 'Mot de passe trop court (6 caractères minimum).',
    'auth/popup-closed-by-user': 'Fenêtre de connexion fermée.',
    'auth/network-request-failed': 'Pas de connexion. Réessaie une fois en ligne.',
    'auth/too-many-requests': 'Trop de tentatives. Patiente quelques minutes.',
  };
  return messages[code] ?? "Connexion impossible. Réessaie dans un instant.";
}

/** Crée ou met à jour le profil public, utilisé pour afficher les auteurs. */
async function syncProfile(user: User): Promise<void> {
  await setDoc(
    doc(db(), 'users', user.uid),
    {
      displayName: user.displayName ?? user.email?.split('@')[0] ?? 'Voyageur',
      photoURL: user.photoURL ?? null,
      email: user.email ?? null,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  ).catch(() => {
    // Hors-ligne : Firestore rejouera l'écriture à la reconnexion.
  });
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<AuthState>({
    user: null,
    role: 'guest',
    isAdmin: false,
    loading: true,
    error: null,
  });

  useEffect(() => {
    // Récupère le résultat d'un signInWithRedirect (chemin iOS standalone).
    void getRedirectResult(auth()).catch(() => undefined);

    // onIdTokenChanged plutôt que onAuthStateChanged : on est aussi notifié
    // des rafraîchissements de jeton, donc d'un changement de rôle.
    return onIdTokenChanged(auth(), async (user) => {
      if (!user) {
        setState({ user: null, role: 'guest', isAdmin: false, loading: false, error: null });
        return;
      }
      const token = await user.getIdTokenResult();
      const claim = token.claims.role;
      const role: Role = claim === 'admin' || claim === 'blocked' ? claim : 'guest';

      setState({ user, role, isAdmin: role === 'admin', loading: false, error: null });
      void syncProfile(user);
    });
  }, []);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setState((s) => ({ ...s, error: null }));
    try {
      await action();
    } catch (error) {
      setState((s) => ({ ...s, error: humanizeAuthError(error), loading: false }));
      throw error;
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await run(async () => {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await signInWithPopup(auth(), provider);
      } catch (error) {
        const code = (error as { code?: string }).code;
        // En mode standalone (icône sur l'écran d'accueil), iOS bloque les
        // popups : on bascule sur la redirection, qui revient dans la PWA.
        if (
          code === 'auth/popup-blocked' ||
          code === 'auth/operation-not-supported-in-this-environment' ||
          code === 'auth/cancelled-popup-request'
        ) {
          await signInWithRedirect(auth(), provider);
          return;
        }
        throw error;
      }
    });
  }, [run]);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      await run(() => signInWithEmailAndPassword(auth(), email.trim(), password));
    },
    [run],
  );

  const registerWithEmail = useCallback(
    async (email: string, password: string, displayName: string) => {
      await run(async () => {
        const credential = await createUserWithEmailAndPassword(auth(), email.trim(), password);
        await updateProfile(credential.user, { displayName: displayName.trim() || 'Voyageur' });
        await syncProfile(credential.user);
      });
    },
    [run],
  );

  const resetPassword = useCallback(
    async (email: string) => {
      await run(() => sendPasswordResetEmail(auth(), email.trim()));
    },
    [run],
  );

  const logout = useCallback(async () => {
    await signOut(auth());
  }, []);

  const refreshRole = useCallback(async () => {
    const user = auth().currentUser;
    if (!user) return;
    await user.getIdToken(true);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      signInWithGoogle,
      signInWithEmail,
      registerWithEmail,
      resetPassword,
      logout,
      refreshRole,
    }),
    [state, signInWithGoogle, signInWithEmail, registerWithEmail, resetPassword, logout, refreshRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé dans <AuthProvider>.');
  return context;
}
