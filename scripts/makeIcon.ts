// Draws the browser-tab icon (the Keeper's tower and lamp, its beam sweeping over a moss
// hill) and writes public/favicon.ico with 16, 32, 48 and 64 px images, plus a 180 px
// public/apple-touch-icon.png. No dependencies: shapes are rasterised with 4x4
// supersampling and stored as PNGs inside the ICO. Run with: npx tsx scripts/makeIcon.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

type RGBA = [number, number, number, number];
type Pt = [number, number];

const hex = (h: string, a = 1): RGBA => [
  parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a,
];

function inPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRoundRect(x: number, y: number, r: number): boolean {
  const cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const LAMP: Pt = [0.4, 0.34];

/** Colour of the icon at (x, y) in unit space (0..1, y down), or null where transparent. */
function sample(x: number, y: number): RGBA | null {
  if (!inRoundRect(x, y, 0.18)) return null;
  // Night sky, lighter towards the horizon.
  let c: RGBA = mix(hex('#070915'), hex('#1c2250'), Math.min(1, y / 0.8));
  // Beam: a wedge from the lamp out to the right edge.
  const beam: Pt[] = [LAMP, [1.05, 0.12], [1.05, 0.62]];
  if (inPoly(x, y, beam)) {
    const fade = 1 - Math.min(1, Math.hypot(x - LAMP[0], y - LAMP[1]) / 0.75);
    c = over(c, hex('#ffd36a', 0.25 + 0.45 * fade));
  }
  // Moss hill: a flat-topped hex across the bottom.
  const hill: Pt[] = [[-0.1, 1.1], [-0.1, 0.8], [0.12, 0.7], [0.88, 0.7], [1.1, 0.8], [1.1, 1.1]];
  if (inPoly(x, y, hill)) c = y < 0.76 ? hex('#7fc06a') : hex('#3f7a4a');
  // Tower: a tapering column on the hill, with a cap under the lamp.
  const tower: Pt[] = [[0.3, 0.74], [0.35, 0.44], [0.45, 0.44], [0.5, 0.74]];
  if (inPoly(x, y, tower)) c = x < 0.4 ? hex('#3a4170') : hex('#262b52');
  if (Math.abs(x - LAMP[0]) < 0.11 && Math.abs(y - 0.45) < 0.035) c = hex('#4a5290');
  // Lamp: glow, then a bright core.
  const d = Math.hypot(x - LAMP[0], y - LAMP[1]);
  if (d < 0.17) c = over(c, hex('#ffb347', 0.5 * (1 - d / 0.17)));
  if (d < 0.095) c = d < 0.045 ? hex('#fff6cf') : hex('#ffd36a');
  return c;
}

const mix = (a: RGBA, b: RGBA, t: number): RGBA => a.map((v, i) => v + (b[i] - v) * t) as RGBA;
const over = (dst: RGBA, src: RGBA): RGBA => {
  const a = src[3];
  return [dst[0] * (1 - a) + src[0] * a, dst[1] * (1 - a) + src[1] * a, dst[2] * (1 - a) + src[2] * a, 1];
};

/** Renders the icon at `size` px as straight-alpha RGBA bytes. */
function render(size: number): Buffer {
  const SS = 4, out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const c = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const o = (py * size + px) * 4;
    if (a) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = (255 * a) / (SS * SS); }
  }
  return out;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function png(size: number): Buffer {
  const rgba = render(size), raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ico(sizes: number[]): Buffer {
  const images = sizes.map(png), header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    header[e] = s % 256; header[e + 1] = s % 256; // 0 means 256
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(images[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([header, ...images]);
}

mkdirSync('public', { recursive: true });
writeFileSync('public/favicon.ico', ico([16, 32, 48, 64]));
writeFileSync('public/apple-touch-icon.png', png(180));
console.log('Wrote public/favicon.ico and public/apple-touch-icon.png');
