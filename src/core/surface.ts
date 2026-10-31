import { HEX_SIZE, LEVEL_HEIGHT, TOP_INSET } from './constants';
import { SQRT3, cornerOffset, hexToWorld, worldToHex } from './hex';
import type { Terrain } from './terrain';

/** Distance from a hex centre to the middle of an edge. */
export const APOTHEM = (HEX_SIZE * SQRT3) / 2;

export type SurfaceRegion = 'top' | 'flat' | 'slope';

export interface SurfaceSample {
  /** Cell whose outer hexagon contains the point. */
  cell: number;
  /** World Y of the terrain surface. */
  y: number;
  /** 'top': on the tile's flat top; 'flat': level bevel; 'slope': sloped bevel. */
  region: SurfaceRegion;
}

/**
 * Exact height of the rendered terrain surface at (x, z), or null outside the map.
 * Mirrors the geometry in render/terrainMesh.ts: flat inner hexagons, linear strips
 * between neighbouring tops, and planar triangles where three tiles meet.
 */
export function sampleSurface(terrain: Terrain, x: number, z: number): SurfaceSample | null {
  const { grid, heights } = terrain;
  const hex = worldToHex(x, z, HEX_SIZE);
  const i = grid.indexOf(hex.q, hex.r);
  if (i < 0) return null;

  const hA = heights[i];
  const c = hexToWorld(hex.q, hex.r, HEX_SIZE);
  const dx = x - c.x;
  const dz = z - c.z;

  // Sector e spans angles [60e − 30°, 60e + 30°] and faces edge e.
  const e = (((Math.round(Math.atan2(dz, dx) / (Math.PI / 3)) % 6) + 6) % 6);
  const nx = Math.cos((e * Math.PI) / 3);
  const nz = Math.sin((e * Math.PI) / 3);
  const proj = dx * nx + dz * nz;
  const perp = -dx * nz + dz * nx;

  const innerApothem = TOP_INSET * APOTHEM;
  if (proj <= innerApothem) return { cell: i, y: hA * LEVEL_HEIGHT, region: 'top' };

  const heightOf = (dir: number) => {
    const j = grid.neighbor(i, dir);
    return j < 0 ? hA : heights[j]; // off-map neighbours are treated as level
  };

  // Edge strip: a rectangle of half-width TOP_INSET·size/2 along the edge.
  if (Math.abs(perp) <= (TOP_INSET * HEX_SIZE) / 2) {
    const hB = heightOf(e);
    const t = (proj - innerApothem) / (2 * APOTHEM - 2 * innerApothem);
    return {
      cell: i,
      y: (hA + (hB - hA) * t) * LEVEL_HEIGHT,
      region: hA === hB ? 'flat' : 'slope',
    };
  }

  // Corner triangle around my corner k (k = e when perp < 0, else e + 1).
  // Its vertices: my inner corner k, neighbour-across-edge-k's inner corner k+4,
  // and neighbour-across-edge-(k−1)'s inner corner k+2.
  const k = perp < 0 ? e : (e + 1) % 6;
  const bDir = k;
  const cDir = (k + 5) % 6;
  const hB = heightOf(bDir);
  const hC = heightOf(cDir);
  const p0 = innerCorner(c.x, c.z, k);
  const p1 = innerCorner(c.x + 2 * APOTHEM * dirX(bDir), c.z + 2 * APOTHEM * dirZ(bDir), k + 4);
  const p2 = innerCorner(c.x + 2 * APOTHEM * dirX(cDir), c.z + 2 * APOTHEM * dirZ(cDir), k + 2);
  const [w0, w1, w2] = barycentric(x, z, p0, p1, p2);
  const level = w0 * hA + w1 * hB + w2 * hC;
  const spread = Math.max(hA, hB, hC) - Math.min(hA, hB, hC);
  return { cell: i, y: level * LEVEL_HEIGHT, region: spread === 0 ? 'flat' : 'slope' };
}

/** Unit vector toward the neighbour across edge d. */
const dirX = (d: number) => Math.cos((d * Math.PI) / 3);
const dirZ = (d: number) => Math.sin((d * Math.PI) / 3);

function innerCorner(cx: number, cz: number, k: number): [number, number] {
  const o = cornerOffset(((k % 6) + 6) % 6, HEX_SIZE * TOP_INSET);
  return [cx + o.x, cz + o.z];
}

function barycentric(
  x: number,
  z: number,
  a: [number, number],
  b: [number, number],
  c: [number, number],
): [number, number, number] {
  const v0x = b[0] - a[0], v0z = b[1] - a[1];
  const v1x = c[0] - a[0], v1z = c[1] - a[1];
  const v2x = x - a[0], v2z = z - a[1];
  const den = v0x * v1z - v1x * v0z;
  const w1 = (v2x * v1z - v1x * v2z) / den;
  const w2 = (v0x * v2z - v2x * v0z) / den;
  return [1 - w1 - w2, w1, w2];
}

/** World position of the centre of a cell's top. */
export function cellTop(terrain: Terrain, cell: number): { x: number; y: number; z: number } {
  const { q, r } = terrain.grid.cells[cell];
  const w = hexToWorld(q, r, HEX_SIZE);
  return { x: w.x, y: terrain.heights[cell] * LEVEL_HEIGHT, z: w.z };
}
