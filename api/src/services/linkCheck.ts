/**
 * Vérification de la disponibilité d'une annonce immobilière.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE N'EST PAS UN SIMPLE CONTRÔLE DE CODE HTTP
 *
 * Les sites d'annonces ne renvoient presque jamais 404 pour une annonce
 * retirée. Centris, Kijiji et consorts servent un 200 accompagné d'une page
 * « cette annonce n'est plus disponible », ou redirigent vers la recherche.
 * Se fier au seul code de statut donnerait une confiance imméritée.
 *
 * Symétriquement, ces sites bloquent volontiers les requêtes venant d'un
 * datacenter : un 403 signifie « je ne peux pas vérifier », pas « l'annonce a
 * disparu ». Confondre les deux ferait rejeter des logements encore
 * disponibles — l'erreur la plus coûteuse ici, puisqu'elle fait perdre une
 * piste valable sans qu'on s'en aperçoive.
 *
 * D'où TROIS états, et jamais deux.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type LinkStatus =
  /** L'annonce répond et ne porte aucune marque de retrait. */
  | 'live'
  /** Retrait constaté : 404/410, ou mention explicite dans la page. */
  | 'gone'
  /** Blocage anti-robot, délai dépassé, erreur serveur : indécidable. */
  | 'blocked'
  /** Jamais vérifiée. */
  | 'unknown';

export interface LinkCheckResult {
  status: LinkStatus;
  httpStatus: number | null;
  /** Ce qui a motivé la conclusion, affiché tel quel dans l'application. */
  reason: string;
  /** URL finale après redirections, si elle diffère. */
  redirectedTo?: string;
  checkedAt: string;
}

/**
 * Formules signalant une annonce retirée. Volontairement spécifiques : un
 * simple « indisponible » apparaît trop souvent dans des menus ou des
 * bandeaux de cookies pour être fiable.
 */
const REMOVED_MARKERS = [
  "n'est plus disponible",
  '’est plus disponible',
  'annonce retirée',
  'annonce expirée',
  "cette annonce n'existe plus",
  'annonce introuvable',
  'propriété vendue',
  'no longer available',
  'listing has been removed',
  'this ad is no longer',
  'ad has expired',
  'has been rented',
  'page introuvable',
  'page not found',
  'oups! cette page',
];

/** Signes d'une protection anti-robot plutôt que d'un retrait. */
const BLOCKED_MARKERS = [
  'captcha',
  'datadome',
  'cloudflare',
  'access denied',
  'verify you are human',
  'vérifiez que vous êtes',
  'unusual traffic',
  '请稍候',
];

/** Chemins typiques d'une redirection vers l'accueil ou la recherche. */
function looksLikeFallbackPage(originalUrl: string, finalUrl: string): boolean {
  try {
    const original = new URL(originalUrl);
    const final = new URL(finalUrl);

    if (original.hostname !== final.hostname) return false;

    // Une annonce redirigée vers la racine, ou vers une page de recherche
    // générique, a presque toujours été retirée.
    const trimmed = final.pathname.replace(/\/+$/, '');
    if (trimmed === '' || trimmed === '/') return true;
    return /\/(recherche|search|resultats|results|listings)\/?$/i.test(final.pathname);
  } catch {
    return false;
  }
}

/**
 * Vérifie une annonce. Ne lève jamais : toute anomalie devient un statut,
 * puisque l'appelant traite des dizaines d'URL et ne doit pas s'arrêter à la
 * première qui se comporte mal.
 */
export async function checkListing(url: string): Promise<LinkCheckResult> {
  const checkedAt = new Date().toISOString();

  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('protocole');
  } catch {
    return { status: 'unknown', httpStatus: null, reason: 'URL invalide', checkedAt };
  }

  try {
    const response = await fetch(parsed.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      headers: {
        // Un User-Agent de navigateur réduit les blocages triviaux. Ce n'est
        // pas du contournement de protection : le rythme reste de deux
        // requêtes par jour et par annonce.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'fr-CA,fr;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    const httpStatus = response.status;

    if (httpStatus === 404 || httpStatus === 410) {
      return { status: 'gone', httpStatus, reason: `Le site répond ${httpStatus}`, checkedAt };
    }

    if (httpStatus === 403 || httpStatus === 429 || httpStatus >= 500) {
      return {
        status: 'blocked',
        httpStatus,
        reason:
          httpStatus >= 500
            ? 'Le site est en erreur, réessai au prochain passage'
            : 'Le site refuse les vérifications automatiques',
        checkedAt,
      };
    }

    const body = (await response.text()).slice(0, 200_000).toLowerCase();

    const blockedMarker = BLOCKED_MARKERS.find((marker) => body.includes(marker));
    if (blockedMarker) {
      return {
        status: 'blocked',
        httpStatus,
        reason: 'Protection anti-robot détectée',
        checkedAt,
      };
    }

    const removedMarker = REMOVED_MARKERS.find((marker) => body.includes(marker));
    if (removedMarker) {
      return {
        status: 'gone',
        httpStatus,
        reason: `La page indique « ${removedMarker} »`,
        checkedAt,
      };
    }

    if (response.url && response.url !== parsed.toString() && looksLikeFallbackPage(url, response.url)) {
      return {
        status: 'gone',
        httpStatus,
        reason: 'Redirigée vers une page de recherche',
        redirectedTo: response.url,
        checkedAt,
      };
    }

    return { status: 'live', httpStatus, reason: 'Annonce toujours en ligne', checkedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'blocked',
      httpStatus: null,
      reason: /timeout|abort/i.test(message) ? 'Délai dépassé' : 'Site injoignable',
      checkedAt,
    };
  }
}
