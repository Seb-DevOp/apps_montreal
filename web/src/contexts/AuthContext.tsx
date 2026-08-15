/**
 * Authentification — application mono-utilisateur.
 *
 * Il n'y a plus ni rôles ni invités : une seule adresse e-mail a le droit
 * d'entrer. Le contexte expose `authorized`, qui distingue « connecté » de
 * « autorisé » — un tiers peut parfaitement s'authentifier auprès de Google,
 * il n'obtiendra simplement rien.
 *
 * Cette vérification côté client n'est qu'un confort d'affichage : la garde
 * réelle est dans firestore.rules, qui n'accorde l'accès qu'à cette même
 * adresse, vérifiée. Sans cela, un client modifié suffirait à tout lire.
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
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { getConfig } from '../lib/runtimeConfig';

interface AuthState {
  user: User | null;
  /** Connecté ET reconnu comme propriétaire. */
  authorized: boolean;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function humanizeAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  const messages: Record<string, string> = {
    'auth/popup-closed-by-user': 'Fenêtre de connexion fermée.',
    'auth/network-request-failed': 'Pas de connexion. Réessaie une fois en ligne.',
    'auth/too-many-requests': 'Trop de tentatives. Patiente quelques minutes.',
  };
  return messages[code] ?? 'Connexion impossible. Réessaie dans un instant.';
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<AuthState>({
    user: null,
    authorized: false,
    loading: true,
    error: null,
  });

  useEffect(() => {
    // Récupère le résultat d'un signInWithRedirect (chemin iOS standalone).
    void getRedirectResult(auth()).catch(() => undefined);

    return onAuthStateChanged(auth(), (user) => {
      if (!user) {
        setState({ user: null, authorized: false, loading: false, error: null });
        return;
      }

      const owner = getConfig().ownerEmail.trim().toLowerCase();
      const email = (user.email ?? '').trim().toLowerCase();
      const authorized = owner.length > 0 && email === owner && user.emailVerified;

      setState({
        user,
        authorized,
        loading: false,
        error: authorized ? null : 'Ce compte n’a pas accès à cette application.',
      });
    });
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setState((s) => ({ ...s, error: null }));
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
      setState((s) => ({ ...s, error: humanizeAuthError(error) }));
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth());
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signInWithGoogle, logout }),
    [state, signInWithGoogle, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé dans <AuthProvider>.');
  return context;
}
