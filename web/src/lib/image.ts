/**
 * Traitement d'image côté client : lecture EXIF puis compression.
 *
 * Enjeu quota : le Free Tier Cloud Storage offre 5 Go. Une photo d'iPhone brute
 * pèse 3 à 5 Mo ; comprimée à 1600 px / WebP 82 %, elle tombe autour de 250 Ko.
 * Sur un voyage de deux semaines à 20 photos par jour, on passe de ~1 Go à
 * ~70 Mo. Tout le travail est fait dans le navigateur : aucune facture de
 * calcul Cloud Run, et l'upload part directement vers Storage.
 *
 * Ordre imposé : l'EXIF est lu AVANT la compression, car le passage par
 * <canvas> supprime toutes les métadonnées (y compris les coordonnées GPS —
 * ce qui est aussi une bonne chose : les fichiers publiés ne trimballent plus
 * la position exacte du logement).
 */

export interface PhotoMetadata {
  /** Coordonnées issues de l'EXIF, si la photo en porte. */
  lat?: number;
  lng?: number;
  /** Date de prise de vue EXIF, sinon date de modification du fichier. */
  takenAt: Date;
}

export interface CompressResult {
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
  /** Rapport de compression, affiché dans l'UI d'upload. */
  ratio: number;
  originalBytes: number;
}

const FULL_MAX_DIM = 1600;
const THUMB_MAX_DIM = 480;
const FULL_QUALITY = 0.82;
const THUMB_QUALITY = 0.7;

// ---------------------------------------------------------------------------
// EXIF
// ---------------------------------------------------------------------------

/** Convertit un triplet degrés/minutes/secondes EXIF en degrés décimaux. */
function dmsToDecimal(dms: number[], ref: string): number {
  const [deg = 0, min = 0, sec = 0] = dms;
  const decimal = deg + min / 60 + sec / 3600;
  return ref === 'S' || ref === 'W' ? -decimal : decimal;
}

/**
 * Lecteur EXIF minimal (JPEG uniquement) : GPS + date de prise de vue.
 * Écrit à la main plutôt qu'importé — une bibliothèque EXIF complète pèse
 * plus lourd que tout le reste du bundle pour deux champs utilisés.
 */
export async function readExif(file: File): Promise<PhotoMetadata> {
  const fallback: PhotoMetadata = { takenAt: new Date(file.lastModified) };
  if (!/jpe?g/i.test(file.type)) return fallback;

  try {
    // 128 Ko suffisent très largement à couvrir le segment APP1.
    const buffer = await file.slice(0, 131072).arrayBuffer();
    const view = new DataView(buffer);
    if (view.getUint16(0) !== 0xffd8) return fallback; // pas un JPEG

    let offset = 2;
    let tiffStart = -1;
    while (offset < view.byteLength - 4) {
      if (view.getUint8(offset) !== 0xff) break;
      const marker = view.getUint8(offset + 1);
      const size = view.getUint16(offset + 2);
      if (marker === 0xe1) {
        // "Exif\0\0"
        if (view.getUint32(offset + 4) === 0x45786966) {
          tiffStart = offset + 10;
          break;
        }
      }
      offset += 2 + size;
    }
    if (tiffStart < 0) return fallback;

    const little = view.getUint16(tiffStart) === 0x4949;
    const readU16 = (p: number) => view.getUint16(p, little);
    const readU32 = (p: number) => view.getUint32(p, little);
    const readRational = (p: number) => readU32(p) / readU32(p + 4);

    const ifd0 = tiffStart + readU32(tiffStart + 4);
    let gpsIfd = -1;
    let exifIfd = -1;

    const entries0 = readU16(ifd0);
    for (let i = 0; i < entries0; i += 1) {
      const entry = ifd0 + 2 + i * 12;
      const tag = readU16(entry);
      if (tag === 0x8825) gpsIfd = tiffStart + readU32(entry + 8);
      if (tag === 0x8769) exifIfd = tiffStart + readU32(entry + 8);
    }

    const result: PhotoMetadata = { ...fallback };

    if (gpsIfd > 0 && gpsIfd < view.byteLength) {
      let latRef = 'N';
      let lngRef = 'E';
      let lat: number | undefined;
      let lng: number | undefined;

      const gpsEntries = readU16(gpsIfd);
      for (let i = 0; i < gpsEntries; i += 1) {
        const entry = gpsIfd + 2 + i * 12;
        const tag = readU16(entry);
        const valueOffset = tiffStart + readU32(entry + 8);
        switch (tag) {
          case 0x0001:
            latRef = String.fromCharCode(view.getUint8(entry + 8));
            break;
          case 0x0003:
            lngRef = String.fromCharCode(view.getUint8(entry + 8));
            break;
          case 0x0002:
            lat = dmsToDecimal(
              [readRational(valueOffset), readRational(valueOffset + 8), readRational(valueOffset + 16)],
              latRef,
            );
            break;
          case 0x0004:
            lng = dmsToDecimal(
              [readRational(valueOffset), readRational(valueOffset + 8), readRational(valueOffset + 16)],
              lngRef,
            );
            break;
          default:
            break;
        }
      }
      // Les refs peuvent arriver après les valeurs dans l'IFD : on réapplique
      // le signe une fois les deux connus.
      if (lat !== undefined && lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng)) {
        result.lat = Math.abs(lat) * (latRef === 'S' ? -1 : 1);
        result.lng = Math.abs(lng) * (lngRef === 'W' ? -1 : 1);
      }
    }

    if (exifIfd > 0 && exifIfd < view.byteLength) {
      const exifEntries = readU16(exifIfd);
      for (let i = 0; i < exifEntries; i += 1) {
        const entry = exifIfd + 2 + i * 12;
        if (readU16(entry) === 0x9003) {
          // DateTimeOriginal : "AAAA:MM:JJ HH:MM:SS"
          const p = tiffStart + readU32(entry + 8);
          let raw = '';
          for (let c = 0; c < 19; c += 1) raw += String.fromCharCode(view.getUint8(p + c));
          const parsed = new Date(raw.replace(/^(\d{4}):(\d{2}):/, '$1-$2-'));
          if (!Number.isNaN(parsed.getTime())) result.takenAt = parsed;
          break;
        }
      }
    }

    return result;
  } catch {
    // EXIF illisible ou tronqué : la photo reste publiable, sans géoloc.
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Compression
// ---------------------------------------------------------------------------

function targetSize(width: number, height: number, maxDim: number): { w: number; h: number } {
  const largest = Math.max(width, height);
  if (largest <= maxDim) return { w: width, h: height };
  const scale = maxDim / largest;
  return { w: Math.round(width * scale), h: Math.round(height * scale) };
}

/** WebP quand le navigateur sait l'encoder (~30 % de moins que JPEG). */
function bestMimeType(): 'image/webp' | 'image/jpeg' {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  return canvas.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
}

async function draw(bitmap: ImageBitmap, maxDim: number, quality: number, mime: string): Promise<Blob> {
  const { w, h } = targetSize(bitmap.width, bitmap.height, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D indisponible.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
  if (!blob) throw new Error("Échec de l'encodage de l'image.");
  return blob;
}

/**
 * Produit une image d'affichage et sa vignette.
 * `imageOrientation: 'from-image'` applique l'orientation EXIF au décodage :
 * plus de photos couchées après compression.
 */
export async function compressImage(file: File): Promise<CompressResult> {
  const mime = bestMimeType();
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

  try {
    const [full, thumb] = await Promise.all([
      draw(bitmap, FULL_MAX_DIM, FULL_QUALITY, mime),
      draw(bitmap, THUMB_MAX_DIM, THUMB_QUALITY, mime),
    ]);
    const { w, h } = targetSize(bitmap.width, bitmap.height, FULL_MAX_DIM);

    return {
      full,
      thumb,
      width: w,
      height: h,
      originalBytes: file.size,
      ratio: file.size > 0 ? full.size / file.size : 1,
    };
  } finally {
    bitmap.close();
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

export const imageExtension = (blob: Blob): string => (blob.type === 'image/webp' ? 'webp' : 'jpg');
