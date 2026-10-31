import { HexGrid } from '../../src/core/hex';
import type { Terrain } from '../../src/core/terrain';
import { type World, spawn } from '../../src/core/world';

export function flatTerrain(radius = 5, height = 1): Terrain {
  const grid = new HexGrid(radius);
  return {
    grid,
    heights: new Uint8Array(grid.count).fill(height),
    params: { seed: 0, radius, maxHeight: 12, maxStep: 2 },
  };
}

/** A world on flat ground with the player at (0,0), no moss, and the given energy. */
export function flatWorld(energy = 10, terrain = flatTerrain()): World {
  const grid = terrain.grid;
  const world: World = {
    terrain,
    stacks: grid.cells.map(() => []),
    player: { cell: grid.indexOf(0, 0), energy },
    keeper: { cell: grid.indexOf(terrain.grid.radius, -terrain.grid.radius), yaw: 0 },
    moths: [],
    status: 'playing',
    time: 0,
    drainClock: 0,
    rngState: 1234,
    nextId: 1,
  };
  spawn(world, world.player.cell, 'husk');
  return world;
}

export const at = (w: World, q: number, r: number) => w.terrain.grid.indexOf(q, r);

/**
 * Flat level-1 ground with the Keeper on a level-4 plinth at (0,0) and the player at (3,0),
 * due east of it (bearing 0). The beam starts pointing at the player.
 */
export function arena(energy = 5, yaw = 0): World {
  const grid = new HexGrid(5);
  const heights = new Uint8Array(grid.cells.map((c) => (c.q === 0 && c.r === 0 ? 4 : 1)));
  const terrain: Terrain = { grid, heights, params: { seed: 0, radius: 5, maxHeight: 12, maxStep: 12 } };
  const world: World = {
    terrain,
    stacks: grid.cells.map(() => []),
    player: { cell: grid.indexOf(3, 0), energy },
    keeper: { cell: grid.indexOf(0, 0), yaw },
    moths: [],
    status: 'playing',
    time: 0,
    drainClock: 0,
    rngState: 99,
    nextId: 1,
  };
  spawn(world, world.player.cell, 'husk');
  return world;
}

