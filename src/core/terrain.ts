import { HEX_SIZE } from './constants';
import { HexGrid, hexToWorld } from './hex';
import { fbm } from './noise';
import { Rng } from './rng';

export interface TerrainParams {
  seed: number;
  /** Map radius in hexes. */
  radius: number;
  /** Highest terrain level. */
  maxHeight: number;
  /** Largest height difference allowed between neighbouring tiles. */
  maxStep: number;
}

export const DEFAULT_TERRAIN: Omit<TerrainParams, 'seed'> = {
  radius: 14,
  maxHeight: 12,
  maxStep: 2,
};

export interface Terrain {
  readonly params: TerrainParams;
  readonly grid: HexGrid;
  /** Integer level per cell, indexed like grid.cells. */
  readonly heights: Uint8Array;
}

export function generateTerrain(params: TerrainParams): Terrain {
  const { radius, maxHeight, maxStep } = params;
  const rng = new Rng(params.seed);
  const grid = new HexGrid(radius);
  const n = grid.count;

  // 1. Fractal noise sampled at hex centres.
  const noiseSeed = Math.floor(rng.next() * 4294967296);
  const freq = rng.range(0.05, 0.09);
  const ox = rng.range(-1000, 1000);
  const oz = rng.range(-1000, 1000);
  const raw = new Float64Array(n);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const { q, r } = grid.cells[i];
    const w = hexToWorld(q, r, HEX_SIZE);
    const v = fbm(ox + w.x * freq, oz + w.z * freq, noiseSeed);
    raw[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  // 2. Normalise, shape (deeper valleys), quantise into terraces.
  const exponent = rng.range(1.0, 1.6);
  let heights: Uint8Array = new Uint8Array(n);
  const span = max - min || 1;
  for (let i = 0; i < n; i++) {
    const t = (raw[i] - min) / span;
    heights[i] = Math.round(Math.pow(t, exponent) * maxHeight);
  }

  // 3. Plateau passes: a cell joins a height shared by most of its neighbours,
  //    which grows wider flat terraces.
  for (let pass = 0; pass < 2; pass++) heights = plateauPass(grid, heights);

  // 4. Limit the step between neighbours by lowering the higher side (always terminates).
  clampSteps(grid, heights, maxStep);

  return { params, grid, heights };
}

function plateauPass(grid: HexGrid, heights: Uint8Array): Uint8Array {
  const out = heights.slice();
  const counts = new Map<number, number>();
  for (let i = 0; i < grid.count; i++) {
    counts.clear();
    for (let d = 0; d < 6; d++) {
      const j = grid.neighbor(i, d);
      if (j < 0) continue;
      counts.set(heights[j], (counts.get(heights[j]) ?? 0) + 1);
    }
    for (const [h, c] of counts) {
      if (c >= 4 && h !== heights[i]) {
        out[i] = h;
        break;
      }
    }
  }
  return out;
}

function clampSteps(grid: HexGrid, heights: Uint8Array, maxStep: number): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < grid.count; i++) {
      for (let d = 0; d < 6; d++) {
        const j = grid.neighbor(i, d);
        if (j >= 0 && heights[i] > heights[j] + maxStep) {
          heights[i] = heights[j] + maxStep;
          changed = true;
        }
      }
    }
  }
}
