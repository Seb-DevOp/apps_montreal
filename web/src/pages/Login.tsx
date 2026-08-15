/**
 * Connexion — Google uniquement.
 *
 * L'application n'a qu'un utilisateur : proposer la création d'un compte par
 * e-mail n'aurait aucun sens, puisqu'aucun compte nouvellement créé ne serait
 * autorisé. Un seul bouton, donc.
 */
import { useAuth } from '../contexts/AuthContext';

export function Login(): JSX.Element {
  const { signInWithGoogle, error } = useAuth();

  return (
    <div className="flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-10 text-center">
          <div className="text-5xl">🍁</div>
          <h1 className="mt-3 text-2xl font-semibold text-frost">Montréal Compagnon</h1>
          <p className="mt-1 text-sm text-frost/50">
            Préparation, repères et suivi du départ.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void signInWithGoogle()}
          className="flex w-full items-center justify-center gap-3 rounded-xl bg-frost py-3.5 font-medium text-ink-900"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M45 24c0-1.6-.1-2.7-.4-4H24v8h12c-.2 2-1.6 5-4.5 7l7 5.4C42.7 36.7 45 31 45 24z"
            />
            <path
              fill="#34A853"
              d="M24 46c6 0 11-2 14.6-5.4l-7-5.4C29.7 36.5 27.2 37.3 24 37.3c-5.8 0-10.7-3.9-12.5-9.1l-7.2 5.6C7.9 41.2 15.3 46 24 46z"
            />
            <path fill="#FBBC05" d="M11.5 28.2c-.5-1.4-.7-2.8-.7-4.2s.3-2.9.7-4.2l-7.2-5.6C2.8 17.1 2 20.4 2 24s.8 6.9 2.3 9.8l7.2-5.6z" />
            <path
              fill="#EA4335"
              d="M24 10.7c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 4.1 30 2 24 2 15.3 2 7.9 6.8 4.3 14.2l7.2 5.6C13.3 14.6 18.2 10.7 24 10.7z"
            />
          </svg>
          Continuer avec Google
        </button>

        {error && <p className="mt-4 text-center text-sm text-maple">{error}</p>}

        <p className="mt-10 text-center text-xs leading-relaxed text-frost/25">
          Application privée, réservée à un seul compte.
        </p>
      </div>
    </div>
  );
}
