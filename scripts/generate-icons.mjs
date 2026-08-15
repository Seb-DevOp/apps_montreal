#!/usr/bin/env node
/**
 * Génère les icônes PNG de la PWA — sans aucune dépendance.
 *
 * Pourquoi écrire un encodeur PNG à la main plutôt qu'installer `sharp` ou
 * `canvas` : ces paquets embarquent des binaires natifs de 30 à 70 Mo qu'il
 * faudrait recompiler sur chaque machine et dans Cloud Build, pour produire
 * quatre aplats de couleur. Un PNG non compressé est un format simple :
 * en-tête, données brutes, CRC. Cent lignes suffisent, et `deploy.sh` reste
 * exécutable sur une machine vierge.
 *
 * Usage : node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public', 'icons');

const NAVY = [0x0b, 0x12, 0x20];
const FROST = [0xe8, 0xee, 0xfc];
const MAPLE = [0xe1, 0x4b, 0x4b];

// ---------------------------------------------------------------------------
// Encodeur PNG minimal (RGB 8 bits, sans entrelacement)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** `pixels` : Uint8Array RGB de taille width*height*3. */
function encodePng(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // profondeur 8 bits
  ihdr.writeUInt8(2, 9); // couleur : RGB
  // 10-12 : compression, filtre, entrelacement — tous à 0.

  // Chaque ligne est préfixée d'un octet de filtre (0 = aucun).
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const source = y * width * 3;
    const target = y * (1 + width * 3);
    raw[target] = 0;
    pixels.copy
      ? pixels.copy(raw, target + 1, source, source + width * 3)
      : Buffer.from(pixels.subarray(source, source + width * 3)).copy(raw, target + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Dessin
// ---------------------------------------------------------------------------

/** Distance d'un point à un segment, en coordonnées normalisées. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Icône : fond nuit, « M » de Montréal en blanc cassé, accent érable.
 * `padding` contrôle la marge — les icônes maskables doivent tenir dans le
 * cercle de sécurité de 80 % imposé par Android.
 */
function drawIcon(size, { padding = 0.18, rounded = true } = {}) {
  const pixels = Buffer.alloc(size * size * 3);
  const stroke = 0.075;

  // Le « M » : deux montants et deux diagonales se rejoignant au centre bas.
  const inner = padding + 0.06;
  const left = inner;
  const right = 1 - inner;
  const top = inner + 0.04;
  const bottom = 1 - inner - 0.04;
  const middleX = 0.5;

  const segments = [
    [left, bottom, left, top],
    [left, top, middleX, bottom - 0.1],
    [middleX, bottom - 0.1, right, top],
    [right, top, right, bottom],
  ];

  const radius = rounded ? size * 0.22 : 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      let color = NAVY;

      // Coins arrondis : hors du rayon, on laisse du noir pur (les icônes
      // « any » sont affichées telles quelles par iOS).
      if (rounded) {
        const cx = Math.min(x, size - 1 - x);
        const cy = Math.min(y, size - 1 - y);
        if (cx < radius && cy < radius) {
          const distance = Math.hypot(radius - cx, radius - cy);
          if (distance > radius) color = [0, 0, 0];
        }
      }

      if (color === NAVY) {
        const inLetter = segments.some(
          ([ax, ay, bx, by]) => distanceToSegment(nx, ny, ax, ay, bx, by) < stroke / 2,
        );
        if (inLetter) color = FROST;

        // Point érable en haut à droite du M.
        if (Math.hypot(nx - (right + 0.055), ny - (top - 0.015)) < 0.042) color = MAPLE;
      }

      const offset = (y * size + x) * 3;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }

  return encodePng(size, size, pixels);
}

// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ['icon-192.png', 192, { padding: 0.18, rounded: true }],
  ['icon-512.png', 512, { padding: 0.18, rounded: true }],
  // Maskable : Android recadre agressivement, d'où la marge doublée et
  // l'absence de coins arrondis (le système applique sa propre forme).
  ['maskable-512.png', 512, { padding: 0.3, rounded: false }],
  // iOS ignore la transparence et applique son propre masque : fond plein.
  ['apple-touch-icon.png', 180, { padding: 0.16, rounded: false }],
];

for (const [name, size, options] of targets) {
  const png = drawIcon(size, options);
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`✓ ${name} (${size}×${size}, ${Math.round(png.length / 1024)} Ko)`);
}

console.log(`\nIcônes écrites dans ${OUT_DIR}`);
