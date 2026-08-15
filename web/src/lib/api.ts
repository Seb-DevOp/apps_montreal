/**
 * Client HTTP vers l'API Cloud Run.
 *
 * L'URL de base vaut `/api` par défaut : le rewrite Firebase Hosting
 * (firebase.json) achemine la requête vers Cloud Run côté serveur. La PWA ne
 * connaît donc JAMAIS l'URL `*.run.app` du service, qui change à chaque
 * migration. Bénéfice secondaire : pas de CORS, pas de préflight, et le cookie
 * de session reste sur la même origine.
 */
import { getConfig } from './runtimeConfig';
import { auth } from './firebase';

export class ApiError extends Error {
  constructor(
    override readonly message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Ajoute le jeton Firebase. Vrai par défaut. */
  authenticated?: boolean;
  timeoutMs?: number;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, authenticated = true, timeoutMs = 15000, headers, ...rest } = options;
  const base = getConfig().apiBaseUrl.replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;

  const finalHeaders = new Headers(headers);
  if (body !== undefined) finalHeaders.set('Content-Type', 'application/json');

  if (authenticated) {
    const user = auth().currentUser;
    if (user) {
      // getIdToken gère seul le rafraîchissement à expiration (1 h).
      finalHeaders.set('Authorization', `Bearer ${await user.getIdToken()}`);
    }
  }

  // Cloud Run démarre à froid après scale-to-zero : le premier appel de la
  // journée peut prendre quelques secondes, d'où un timeout large.
  const response = await fetch(url, {
    ...rest,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    let code: string | undefined;
    let message = `Erreur ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string; message?: string };
      code = payload.error;
      message = payload.message ?? payload.error ?? message;
    } catch {
      /* réponse non JSON */
    }
    throw new ApiError(message, response.status, code);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => apiFetch<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'POST', body }),
  del: <T>(path: string, options?: RequestOptions) => apiFetch<T>(path, { ...options, method: 'DELETE' }),
};
