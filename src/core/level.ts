import { Rng } from './rng';
import type { Terrain } from './terrain';

/**
 * Picks the player's starting cell: a random cell among the lowest quarter of the map,
 * so the climb is part of the challenge. Deterministic per seed.
 */
export function pickStartCell(terrain: Terrain, seed: number): number {
  const rng = new Rng(seed ^ 0x51a27);
  const sorted = [...terrain.heights].sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length / 4)];
  const candidates: number[] = [];
  terrain.heights.forEach((h, i) => {
    if (h <= threshold) candidates.push(i);
  });
  return rng.pick(candidates);
}
