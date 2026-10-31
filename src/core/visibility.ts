import { EYE_HEIGHT, LEVEL_HEIGHT } from './constants';
import { type SurfaceSample, cellTop, sampleSurface } from './surface';
import type { Terrain } from './terrain';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Height above a tile top at which a target point is placed for line-of-sight checks. */
const TARGET_LIFT = 0.01;
/** Ray-march step for line-of-sight segments (world units). */
const LOS_STEP = 0.08;
/** Ray-march step for picking rays before bisection refines the hit. */
const PICK_STEP = 0.05;

/** Eye position of a viewer standing on a cell. */
export function eyeAt(terrain: Terrain, cell: number, extraLevels = 0): Vec3 {
  const top = cellTop(terrain, cell);
  return { x: top.x, y: top.y + extraLevels * LEVEL_HEIGHT + EYE_HEIGHT, z: top.z };
}

/** True if the straight segment from `from` to `to` stays above the terrain surface. */
export function segmentClear(terrain: Terrain, from: Vec3, to: Vec3): boolean {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  const steps = Math.ceil(len / LOS_STEP);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const sample = sampleSurface(terrain, from.x + dx * t, from.z + dz * t);
    if (sample && from.y + dy * t < sample.y - 1e-4) return false;
  }
  return true;
}

/** Can a viewer at `eye` see the top of `cell`? (Its centre must be in clear view.) */
export function canSeeCell(terrain: Terrain, eye: Vec3, cell: number): boolean {
  const top = cellTop(terrain, cell);
  return segmentClear(terrain, eye, { x: top.x, y: top.y + TARGET_LIFT, z: top.z });
}

/** Visibility of every cell from `eye`, indexed like grid.cells. */
export function visibleCells(terrain: Terrain, eye: Vec3): Uint8Array {
  const out = new Uint8Array(terrain.grid.count);
  for (let i = 0; i < out.length; i++) out[i] = canSeeCell(terrain, eye, i) ? 1 : 0;
  return out;
}

export interface RayHit {
  distance: number;
  point: Vec3;
  surface: SurfaceSample;
}

/** First intersection of a ray with the terrain surface, or null. `dir` must be normalised. */
export function castRay(terrain: Terrain, origin: Vec3, dir: Vec3, maxDistance = 120): RayHit | null {
  const below = (t: number) => {
    const s = sampleSurface(terrain, origin.x + dir.x * t, origin.z + dir.z * t);
    return s !== null && origin.y + dir.y * t < s.y;
  };
  let prev = 0;
  for (let t = PICK_STEP; t <= maxDistance; t += PICK_STEP) {
    if (below(t)) {
      // Bisect between the last point above and the first point below.
      let lo = prev, hi = t;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        if (below(mid)) hi = mid;
        else lo = mid;
      }
      const point = { x: origin.x + dir.x * hi, y: origin.y + dir.y * hi, z: origin.z + dir.z * hi };
      const surface = sampleSurface(terrain, point.x, point.z)!;
      return { distance: hi, point, surface };
    }
    prev = t;
  }
  return null;
}
