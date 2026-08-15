/**
 * Publication d'une photo (réservé à l'Admin).
 *
 * Chaîne complète : lecture EXIF → compression locale → upload direct vers
 * Cloud Storage → création du document Firestore.
 *
 * L'upload va du téléphone à Storage sans passer par Cloud Run : pas de coût
 * de calcul, pas de limite de taille de requête, et une barre de progression
 * réelle. Le document Firestore n'est écrit qu'une fois les deux fichiers en
 * place — un post ne peut donc jamais s'afficher sans son image.
 */
import { useCallback, useRef, useState } from 'react';
import { collection, doc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { db, storage } from '../../lib/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { compressImage, formatBytes, imageExtension, readExif } from '../../lib/image';
import { NEIGHBORHOODS, nearestNeighborhood } from '../../data/neighborhoods';

type Stage = 'idle' | 'reading' | 'compressing' | 'uploading' | 'saving' | 'done' | 'error';

interface Draft {
  file: File;
  previewUrl: string;
  lat?: number;
  lng?: number;
  takenAt: Date;
  neighborhood: string | null;
  compressedBytes?: number;
}

/**
 * Position courante du navigateur, utilisée quand la photo n'a pas d'EXIF GPS
 * (capture directe par l'appareil photo web, ou photo dont l'app a retiré la
 * localisation).
 */
async function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  if (!('geolocation' in navigator)) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

export function PhotoUploader({ onPublished }: { onPublished?: () => void }): JSX.Element {
  const { user, isAdmin } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [caption, setCaption] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const reset = useCallback(() => {
    setDraft((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setCaption('');
    setStage('idle');
    setProgress(0);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const onFileSelected = useCallback(async (file: File) => {
    setStage('reading');
    setMessage(null);

    const exif = await readExif(file);
    let lat = exif.lat;
    let lng = exif.lng;

    if (lat === undefined || lng === undefined) {
      const position = await currentPosition();
      if (position) {
        lat = position.lat;
        lng = position.lng;
      }
    }

    const zone = lat !== undefined && lng !== undefined ? nearestNeighborhood(lat, lng) : null;

    setDraft({
      file,
      previewUrl: URL.createObjectURL(file),
      lat,
      lng,
      takenAt: exif.takenAt,
      neighborhood: zone?.name ?? null,
    });
    setStage('idle');
  }, []);

  const publish = useCallback(async () => {
    if (!draft || !user || !isAdmin) return;

    try {
      setStage('compressing');
      setProgress(0);
      const compressed = await compressImage(draft.file);
      const extension = imageExtension(compressed.full);

      // L'id est réservé avant l'upload : il structure le chemin Storage, ce
      // qui rend la suppression du post et le ménage des fichiers triviaux.
      const postRef = doc(collection(db(), 'posts'));
      const basePath = `photos/${user.uid}/${postRef.id}`;

      setStage('uploading');

      const uploadOne = (blob: Blob, name: string, weight: number, offset: number) =>
        new Promise<string>((resolve, reject) => {
          const task = uploadBytesResumable(storageRef(storage(), `${basePath}/${name}`), blob, {
            contentType: blob.type,
            cacheControl: 'public, max-age=31536000, immutable',
          });
          task.on(
            'state_changed',
            (snapshot) => {
              const share = snapshot.bytesTransferred / snapshot.totalBytes;
              setProgress(Math.round((offset + share * weight) * 100));
            },
            reject,
            () => {
              void getDownloadURL(task.snapshot.ref).then(resolve).catch(reject);
            },
          );
        });

      // La vignette part d'abord : elle est légère, et sa présence conditionne
      // l'affichage du flux.
      const thumbUrl = await uploadOne(compressed.thumb, `thumb.${extension}`, 0.2, 0);
      const url = await uploadOne(compressed.full, `full.${extension}`, 0.8, 0.2);

      setStage('saving');
      await setDoc(postRef, {
        authorUid: user.uid,
        authorName: user.displayName ?? 'Seb',
        caption: caption.trim().slice(0, 2000),
        storagePath: `${basePath}/full.${extension}`,
        thumbPath: `${basePath}/thumb.${extension}`,
        url,
        thumbUrl,
        width: compressed.width,
        height: compressed.height,
        location:
          draft.lat !== undefined && draft.lng !== undefined
            ? { lat: draft.lat, lng: draft.lng, neighborhood: draft.neighborhood ?? null }
            : null,
        neighborhood: draft.neighborhood,
        takenAt: Timestamp.fromDate(draft.takenAt),
        createdAt: serverTimestamp(),
        tags: [],
      });

      setStage('done');
      setMessage(
        `Publié — ${formatBytes(compressed.originalBytes)} compressés en ${formatBytes(
          compressed.full.size,
        )} (${Math.round((1 - compressed.ratio) * 100)} % de moins).`,
      );
      onPublished?.();
      window.setTimeout(reset, 2500);
    } catch (error) {
      setStage('error');
      setMessage(error instanceof Error ? error.message : 'Publication impossible.');
    }
  }, [draft, user, isAdmin, caption, onPublished, reset]);

  if (!isAdmin) return <></>;

  const busy = stage === 'compressing' || stage === 'uploading' || stage === 'saving';

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      {!draft ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            // `capture` absent volontairement : on veut laisser le choix entre
            // l'appareil photo et la pellicule (les photos de la pellicule
            // portent leur EXIF GPS d'origine).
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFileSelected(file);
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={stage === 'reading'}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-stm py-4 font-medium text-white disabled:opacity-50"
          >
            {stage === 'reading' ? 'Lecture de la photo…' : '📷 Ajouter une photo'}
          </button>
          <p className="mt-2 text-center text-xs text-frost/40">
            Compression automatique avant envoi · géolocalisation depuis l’EXIF ou le GPS
          </p>
        </>
      ) : (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-xl bg-black/40">
            <img src={draft.previewUrl} alt="Aperçu" className="max-h-72 w-full object-contain" />
            {busy && (
              <div className="absolute inset-x-0 bottom-0 bg-black/70 p-3">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
                  <div
                    className="h-full bg-stm transition-all duration-200"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-frost/70">
                  {stage === 'compressing' && 'Compression…'}
                  {stage === 'uploading' && `Envoi ${progress} %`}
                  {stage === 'saving' && 'Enregistrement…'}
                </p>
              </div>
            )}
          </div>

          <textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Raconte : où, avec qui, ce que ça sentait…"
            rows={3}
            maxLength={2000}
            className="w-full resize-none rounded-xl bg-black/25 p-3 text-sm text-frost outline-none placeholder:text-frost/30"
          />

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-frost/70">
              🕒 {draft.takenAt.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
            {draft.lat !== undefined ? (
              <span className="rounded-full bg-mint/15 px-2.5 py-1 text-mint">
                📍 {draft.neighborhood ?? `${draft.lat.toFixed(4)}, ${draft.lng?.toFixed(4)}`}
              </span>
            ) : (
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-frost/40">
                📍 sans localisation
              </span>
            )}
          </div>

          <select
            value={draft.neighborhood ?? ''}
            onChange={(event) =>
              setDraft((d) => (d ? { ...d, neighborhood: event.target.value || null } : d))
            }
            className="w-full rounded-xl bg-black/25 p-3 text-sm text-frost outline-none"
          >
            <option value="">Quartier — non précisé</option>
            {NEIGHBORHOODS.map((zone) => (
              <option key={zone.id} value={zone.name}>
                {zone.name}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="flex-1 rounded-xl bg-white/10 py-3 text-frost/70 disabled:opacity-40"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => void publish()}
              disabled={busy}
              className="flex-[2] rounded-xl bg-stm py-3 font-medium text-white disabled:opacity-50"
            >
              {busy ? 'En cours…' : 'Publier'}
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className={`mt-3 text-sm ${stage === 'error' ? 'text-maple' : 'text-mint'}`}>{message}</p>
      )}
    </div>
  );
}
