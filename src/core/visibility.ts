import { EYE_HEIGHT, LEVEL_HEIGHT, OBJECT_RADIUS } from './constants';
import { type SurfaceSample, cellTop, sampleSurface } from './surface';
import type { Terrain } from './terrain';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Object columns standing on cells. Each is a vertical cylinder of radius OBJECT_RADIUS,
 * centred on the cell, from the tile top up to `columnTop(cell)` (−Infinity for none).
 */
export interface Occluders {
  columnTop(cell: number): number;
  /** Y of the surface where an object on this cell rests; defaults to the tile top. */
  supportY?(cell: number): number;
}

/** Height above a surface at which a target point is placed for line-of-sight checks. */
const TARGET_LIFT = 0.01;
/** Ray-march step for line-of-sight segments (world units). */
const LOS_STEP = 0.08;
/** Ray-march step for picking rays before bisection refines the hit. */
const PICK_STEP = 0.05;

/** Eye position of a viewer standing directly on a cell's tile. */
export function eyeAt(terrain: Terrain, cell: number, extraLevels = 0): Vec3 {
  const top = cellTop(terrain, cell);
  return { x: top.x, y: top.y + extraLevels * LEVEL_HEIGHT + EYE_HEIGHT, z: top.z };
}

/** Is (x, y, z) inside a column of the given top on `cell`? */
function insideColumn(terrain: Terrain, cell: number, top: number, x: number, y: number, z: number): boolean {
  if (y >= top) return false;
  const c = cellTop(terrain, cell);
  return (x - c.x) ** 2 + (z - c.z) ** 2 < OBJECT_RADIUS * OBJECT_RADIUS;
}

/**
 * True if the straight segment from `from` to `to` stays above the terrain and outside
 * object columns. The viewer's own column (`eyeCell`) and `ignoreCell`'s never block.
 * On `targetCell` only the Shards block (up to its support surface), so a stack's top
 * can't be seen from below, while whatever stands on top of it doesn't hide it.
 */
export function segmentClear(
  terrain: Terrain,
  from: Vec3,
  to: Vec3,
  occ?: Occluders,
  eyeCell = -1,
  targetCell = -1,
  ignoreCell = -1,
): boolean {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  const steps = Math.ceil(len / LOS_STEP);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const x = from.x + dx * t, y = from.y + dy * t, z = from.z + dz * t;
    const sample = sampleSurface(terrain, x, z);
    if (!sample) continue;
    if (y < sample.y - 1e-4) return false;
    if (!occ || sample.cell === eyeCell || sample.cell === ignoreCell) continue;
    let top = occ.columnTop(sample.cell);
    if (sample.cell === targetCell && occ.supportY) top = Math.min(top, occ.supportY(sample.cell) - 1e-4);
    if (insideColumn(terrain, sample.cell, top, x, y, z)) return false;
  }
  return true;
}

/**
 * What must be in view to act on a cell:
 * - 'ground': the centre of its tile. The cell's own objects never hide it (needed to harvest).
 * - 'surface': the centre of the surface objects rest on, i.e. the top of its Shards, which
 *   can't be seen from below (needed to build on it or transfer into a Husk there).
 */
export type SightTarget = 'ground' | 'surface';

/** The point that must be visible for the given sight target. */
export function targetPoint(terrain: Terrain, cell: number, occ?: Occluders, sight: SightTarget = 'surface'): Vec3 {
  const top = cellTop(terrain, cell);
  const y = sight === 'surface' && occ?.supportY ? occ.supportY(cell) : top.y;
  return { x: top.x, y: y + TARGET_LIFT, z: top.z };
}

/** Can a viewer at `eye` (standing on `eyeCell`, if any) see `cell`'s ground or surface? */
export function canSeeCell(
  terrain: Terrain,
  eye: Vec3,
  cell: number,
  occ?: Occluders,
  eyeCell = -1,
  sight: SightTarget = 'surface',
): boolean {
  const to = targetPoint(terrain, cell, occ, sight);
  if (sight === 'surface') return segmentClear(terrain, eye, to, occ, eyeCell, cell);
  return segmentClear(terrain, eye, to, occ, eyeCell, -1, cell);
}

/** Visibility of every cell from `eye`, indexed like grid.cells. */
export function visibleCells(
  terrain: Terrain,
  eye: Vec3,
  occ?: Occluders,
  eyeCell = -1,
  sight: SightTarget = 'ground',
): Uint8Array {
  const out = new Uint8Array(terrain.grid.count);
  for (let i = 0; i < out.length; i++) out[i] = canSeeCell(terrain, eye, i, occ, eyeCell, sight) ? 1 : 0;
  return out;
}

export interface RayHit {
  distance: number;
  point: Vec3;
  /** Cell that was hit (terrain cell, or the cell of the object column hit). */
  cell: number;
  /** 'object' if the ray hit an object column; otherwise the terrain region. */
  kind: 'object' | SurfaceSample['region'];
}

/**
 * First intersection of a ray with the terrain or an object column, or null.
 * `dir` must be normalised. Columns on `ignoreCell` (the viewer's own) are skipped.
 */
export function castRay(
  terrain: Terrain,
  origin: Vec3,
  dir: Vec3,
  occ?: Occluders,
  ignoreCell = -1,
  maxDistance = 120,
): RayHit | null {
  const at = (t: number) => ({ x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t });
  /** What is solid at distance t: null (air), or the hit description. */
  const solid = (t: number): RayHit | null => {
    const p = at(t);
    const s = sampleSurface(terrain, p.x, p.z);
    if (!s) return null;
    if (occ && s.cell !== ignoreCell && insideColumn(terrain, s.cell, occ.columnTop(s.cell), p.x, p.y, p.z)) {
      return { distance: t, point: p, cell: s.cell, kind: 'object' };
    }
    if (p.y < s.y) return { distance: t, point: p, cell: s.cell, kind: s.region };
    return null;
  };

  let prev = 0;
  for (let t = PICK_STEP; t <= maxDistance; t += PICK_STEP) {
    if (solid(t)) {
      // Bisect between the last point in air and the first solid point.
      let lo = prev, hi = t;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        if (solid(mid)) hi = mid;
        else lo = mid;
      }
      return solid(hi);
    }
    prev = t;
  }
  return null;
}
