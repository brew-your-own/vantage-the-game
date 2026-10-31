/**
 * Pointy-top hexagons in axial coordinates (q, r).
 * World mapping lives on the X/Z plane (Y is up).
 *
 * Edge i of a hex faces DIRECTIONS[i]; its midpoint is at angle 60°·i.
 * Corner i is at angle 60°·i − 30°, so edge i spans corners i and i+1.
 * Across edge i, my corner i is the neighbour's corner i+4, and my corner i+1 is its corner i+3.
 */

export interface Hex {
  readonly q: number;
  readonly r: number;
}

export const SQRT3 = Math.sqrt(3);

export const DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

export function hexToWorld(q: number, r: number, size: number): { x: number; z: number } {
  return { x: size * SQRT3 * (q + r / 2), z: size * 1.5 * r };
}

export function hexRound(fq: number, fr: number): Hex {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q: q + 0, r: r + 0 }; // +0 normalises -0
}

export function worldToHex(x: number, z: number, size: number): Hex {
  const fr = z / (1.5 * size);
  const fq = x / (SQRT3 * size) - fr / 2;
  return hexRound(fq, fr);
}

export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Offset of corner i from the hex centre. */
export function cornerOffset(i: number, size: number): { x: number; z: number } {
  const a = (Math.PI / 180) * (60 * i - 30);
  return { x: size * Math.cos(a), z: size * Math.sin(a) };
}

/** A hexagon-shaped map of the given radius, with dense index lookups. */
export class HexGrid {
  readonly cells: readonly Hex[];
  private readonly lookup: Int32Array;
  private readonly side: number;

  constructor(readonly radius: number) {
    this.side = 2 * radius + 1;
    this.lookup = new Int32Array(this.side * this.side).fill(-1);
    const cells: Hex[] = [];
    for (let q = -radius; q <= radius; q++) {
      const rMin = Math.max(-radius, -q - radius);
      const rMax = Math.min(radius, -q + radius);
      for (let r = rMin; r <= rMax; r++) {
        this.lookup[(q + radius) * this.side + (r + radius)] = cells.length;
        cells.push({ q, r });
      }
    }
    this.cells = cells;
  }

  get count(): number {
    return this.cells.length;
  }

  /** Cell index, or -1 if outside the map. */
  indexOf(q: number, r: number): number {
    const R = this.radius;
    if (q < -R || q > R || r < -R || r > R) return -1;
    return this.lookup[(q + R) * this.side + (r + R)];
  }

  /** Index of the neighbour of cell i across edge dir, or -1. */
  neighbor(i: number, dir: number): number {
    const c = this.cells[i];
    const d = DIRECTIONS[dir];
    return this.indexOf(c.q + d.q, c.r + d.r);
  }
}
