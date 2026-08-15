/**
 * Connexion — Google ou e-mail/mot de passe.
 *
 * Les proches se connectent surtout avec Google (aucun mot de passe à retenir,
 * un tap). L'e-mail reste disponible pour ceux qui n'ont pas de compte Google
 * ou qui refusent le lien avec leur identité Google.
 */
import { useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';

type Mode = 'signin' | 'signup' | 'reset';

export function Login(): JSX.Element {
  const { signInWithGoogle, signInWithEmail, registerWithEmail, resetPassword, error } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      if (mode === 'signin') await signInWithEmail(email, password);
      else if (mode === 'signup') await registerWithEmail(email, password, name);
      else {
        await resetPassword(email);
        setNotice('E-mail de réinitialisation envoyé. Pense à vérifier les indésirables.');
      }
    } catch {
      // Le message est déjà exposé par le contexte.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-5xl">🍁</div>
          <h1 className="mt-3 text-2xl font-semibold text-frost">Montréal Compagnon</h1>
          <p className="mt-1 text-sm text-frost/50">
            Le carnet de bord du voyage — et la fenêtre ouverte pour ceux qui restent.
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

        <div className="my-5 flex items-center gap-3 text-xs text-frost/25">
          <div className="h-px flex-1 bg-white/10" />
          ou
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'signup' && (
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ton prénom"
              autoComplete="given-name"
              className="w-full rounded-xl bg-white/5 px-4 py-3 text-frost outline-none placeholder:text-frost/30"
            />
          )}

          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Adresse e-mail"
            autoComplete="email"
            inputMode="email"
            className="w-full rounded-xl bg-white/5 px-4 py-3 text-frost outline-none placeholder:text-frost/30"
          />

          {mode !== 'reset' && (
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Mot de passe"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              className="w-full rounded-xl bg-white/5 px-4 py-3 text-frost outline-none placeholder:text-frost/30"
            />
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-stm py-3.5 font-medium text-white disabled:opacity-50"
          >
            {busy
              ? '…'
              : mode === 'signin'
                ? 'Se connecter'
                : mode === 'signup'
                  ? 'Créer mon compte'
                  : 'Réinitialiser le mot de passe'}
          </button>
        </form>

        {error && <p className="mt-3 text-center text-sm text-maple">{error}</p>}
        {notice && <p className="mt-3 text-center text-sm text-mint">{notice}</p>}

        <div className="mt-6 flex justify-center gap-4 text-sm text-frost/45">
          {mode !== 'signin' && (
            <button type="button" onClick={() => setMode('signin')}>
              J’ai déjà un compte
            </button>
          )}
          {mode !== 'signup' && (
            <button type="button" onClick={() => setMode('signup')}>
              Créer un compte
            </button>
          )}
          {mode !== 'reset' && (
            <button type="button" onClick={() => setMode('reset')}>
              Mot de passe oublié
            </button>
          )}
        </div>

        <p className="mt-8 text-center text-xs leading-relaxed text-frost/25">
          Les comptes créés ont un accès en lecture au journal et aux informations pratiques.
          Seul l’administrateur peut publier.
        </p>
      </div>
    </div>
  );
}
