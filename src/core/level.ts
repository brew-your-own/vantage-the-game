import { EYE_HEIGHT, KEEPER_HEIGHT } from './constants';
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

/** Would the lamp see neither the head nor the feet of a Wisp standing on bare `cell`? */
export function hiddenFromLamp(terrain: Terrain, keeperCell: number, cell: number): boolean {
  const lamp = lampPosition(terrain, keeperCell);
  const t = cellTop(terrain, cell);
  return (
    !segmentClear(terrain, lamp, { x: t.x, y: t.y + EYE_HEIGHT, z: t.z }) &&
    !segmentClear(terrain, lamp, { x: t.x, y: t.y + 0.3, z: t.z })
  );
}

/**
 * Picks the player's starting cell, low on the map so the climb is part of the challenge,
 * and hidden from the Keeper when possible: a hidden tile in the lowest quarter, else a
 * hidden tile in the lower half, else any tile in the lowest quarter (createWorld then
 * starts the beam just past the player). Deterministic per seed.
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
  const hiddenLow = low.filter((i) => hiddenFromLamp(terrain, keeperCell, i));
  if (hiddenLow.length > 0) return rng.pick(hiddenLow);
  const median = sorted[Math.floor(sorted.length / 2)];
  const hiddenHalf: number[] = [];
  terrain.heights.forEach((h, i) => {
    if (h <= median && i !== keeperCell && hiddenFromLamp(terrain, keeperCell, i)) hiddenHalf.push(i);
  });
  return rng.pick(hiddenHalf.length > 0 ? hiddenHalf : low);
}
