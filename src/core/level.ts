import { KEEPER_HEIGHT } from './constants';
import { hexDistance } from './hex';
import { Rng } from './rng';
import { cellTop } from './surface';
import type { Terrain } from './terrain';
import { segmentClear } from './visibility';

/** Fraction of the map radius within which the Keeper is placed, so its beam sweeps the land. */
const KEEPER_ZONE = 0.6;

/**
 * The Keeper stands on the highest tile within the inner part of the map
 * (ties broken by seed), so its beam covers land in every direction.
 */
export function pickKeeperCell(terrain: Terrain, seed: number): number {
  const { grid, heights } = terrain;
  const zone: number[] = [];
  grid.cells.forEach((c, i) => {
    if (hexDistance(c, { q: 0, r: 0 }) <= grid.radius * KEEPER_ZONE) zone.push(i);
  });
  const max = Math.max(...zone.map((i) => heights[i]));
  return new Rng(seed ^ 0x7ee9e7).pick(zone.filter((i) => heights[i] === max));
}

/** World position of the Keeper's lamp. */
export function lampPosition(terrain: Terrain, keeperCell: number): { x: number; y: number; z: number } {
  const top = cellTop(terrain, keeperCell);
  return { x: top.x, y: top.y + KEEPER_HEIGHT, z: top.z };
}

/**
 * Picks the player's starting cell: a random cell among the lowest quarter of the map,
 * so the climb is part of the challenge. Cells the Keeper's lamp can see are avoided
 * when possible, so the player isn't drained before getting their bearings.
 * Deterministic per seed.
 */
export function pickStartCell(terrain: Terrain, seed: number, keeperCell = -1): number {
  const rng = new Rng(seed ^ 0x51a27);
  const sorted = [...terrain.heights].sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length / 4)];
  const low: number[] = [];
  terrain.heights.forEach((h, i) => {
    if (h <= threshold && i !== keeperCell) low.push(i);
  });
  if (keeperCell < 0) return rng.pick(low);
  const lamp = lampPosition(terrain, keeperCell);
  const hidden = low.filter((i) => {
    const t = cellTop(terrain, i);
    return !segmentClear(terrain, lamp, { x: t.x, y: t.y + 0.3, z: t.z });
  });
  return rng.pick(hidden.length > 0 ? hidden : low);
}
