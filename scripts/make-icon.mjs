/**
 * Generate the LeakLens Marketplace icon (media/icon.png) with zero dependencies.
 *
 * The activity-bar glyph (media/icon.svg) is monochrome `currentColor` so it adapts to the
 * VS Code theme — which renders as flat black on the Marketplace. The Marketplace needs a
 * self-contained, coloured raster. This script rasterises the same magnifier-over-keyhole
 * mark (white on the brand navy `#0b1220`, rounded square) at 256×256 with 4×4 supersampled
 * anti-aliasing, and encodes a PNG using only Node's built-in `zlib`.
 *
 * Run:  node scripts/make-icon.mjs   (not part of the build; the PNG is committed)
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const N = 256;
const s = N / 24; // design space is the 24×24 viewBox of media/icon.svg

// Geometry mirrors media/icon.svg, scaled into the 256px canvas.
const ringC = { x: 10 * s, y: 10 * s };
const ringR = 6.5 * s;
const ringHW = (1.6 * s) / 2;
const handle = { a: { x: 14.8 * s, y: 14.8 * s }, b: { x: 20 * s, y: 20 * s }, hw: (1.8 * s) / 2 };
const dotC = { x: 10 * s, y: 8.6 * s };
const dotR = 1.6 * s;
const stem = { a: { x: 10 * s, y: 10.1 * s }, b: { x: 10 * s, y: 12.4 * s }, hw: (1.6 * s) / 2 };

const CORNER = 56;
const NAVY = [11, 18, 32]; // #0b1220 — matches galleryBanner.color
const WHITE = [255, 255, 255];

function distSeg(px, py, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
}

function inRoundRect(x, y) {
  const qx = Math.abs(x - N / 2) - (N / 2 - CORNER);
  const qy = Math.abs(y - N / 2) - (N / 2 - CORNER);
  if (qx <= 0 || qy <= 0) return true; // straight-edge band
  return qx * qx + qy * qy <= CORNER * CORNER; // rounded corner
}

function inGlyph(x, y) {
  if (Math.abs(Math.hypot(x - ringC.x, y - ringC.y) - ringR) <= ringHW) return true; // lens ring
  if (distSeg(x, y, handle.a, handle.b) <= handle.hw) return true; // handle
  if (Math.hypot(x - dotC.x, y - dotC.y) <= dotR) return true; // keyhole head
  if (distSeg(x, y, stem.a, stem.b) <= stem.hw) return true; // keyhole stem
  return false;
}

const SS = 4;
const px = Buffer.alloc(N * N * 4);
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    let A = 0;
    let R = 0;
    let G = 0;
    let B = 0;
    for (let j = 0; j < SS; j++) {
      for (let i = 0; i < SS; i++) {
        const sx = x + (i + 0.5) / SS;
        const sy = y + (j + 0.5) / SS;
        if (!inRoundRect(sx, sy)) continue; // outside → transparent
        const [r, g, b] = inGlyph(sx, sy) ? WHITE : NAVY;
        A += 1;
        R += r;
        G += g;
        B += b;
      }
    }
    const o = (y * N + x) * 4;
    px[o] = A ? Math.round(R / A) : 0;
    px[o + 1] = A ? Math.round(G / A) : 0;
    px[o + 2] = A ? Math.round(B / A) : 0;
    px[o + 3] = Math.round((A / (SS * SS)) * 255);
  }
}

// ---- minimal PNG (RGBA, 8-bit) encoder ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const raw = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0; // filter: none
  px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../media/icon.png', import.meta.url), png);
console.log(`wrote media/icon.png (${png.length} bytes, ${N}x${N})`);
