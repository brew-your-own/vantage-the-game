import { describe, expect, it } from 'vitest';
import { applyIntent } from '../src/core/actions';
import { HexGrid, hexDistance } from '../src/core/hex';
import { BEAM, beamEta, lampVisibleTiles, playerInLampSight, playerLit, step } from '../src/core/keeper';
import { lampPosition, pickKeeperCell, pickStartCell } from '../src/core/level';
import { cellTop } from '../src/core/surface';
import { DEFAULT_TERRAIN, type Terrain, generateTerrain } from '../src/core/terrain';
import { segmentClear } from '../src/core/visibility';
import { type World, createWorld, spawn, totalEnergy } from '../src/core/world';

/**
 * Flat level-1 ground with the Keeper on a level-4 plinth at (0,0) and the player at (3,0),
 * due east of it (bearing 0). The beam starts pointing at the player.
 */
function arena(energy = 5, yaw = 0): World {
  const grid = new HexGrid(5);
  const heights = new Uint8Array(grid.cells.map((c) => (c.q === 0 && c.r === 0 ? 4 : 1)));
  const terrain: Terrain = { grid, heights, params: { seed: 0, radius: 5, maxHeight: 12, maxStep: 12 } };
  const world: World = {
    terrain,
    stacks: grid.cells.map(() => []),
    player: { cell: grid.indexOf(3, 0), energy },
    keeper: { cell: grid.indexOf(0, 0), yaw },
    status: 'playing',
    time: 0,
    drainClock: 0,
    rngState: 99,
    nextId: 1,
  };
  spawn(world, world.player.cell, 'husk');
  return world;
}

const run = (w: World, seconds: number, dt = 0.05) => {
  const events = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) events.push(...step(w, dt));
  return events;
};

/** Hold the beam still while testing drain (rotation is tested separately). */
function frozenBeam<T>(fn: () => T): T {
  const speed = BEAM.speed;
  BEAM.speed = 0;
  try {
    return fn();
  } finally {
    BEAM.speed = speed;
  }
}

describe('placement', () => {
  it('puts the Keeper on the highest tile of the inner map, deterministically', () => {
    for (const seed of [17, 42, 99]) {
      const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed });
      const k = pickKeeperCell(terrain, seed);
      const inner = terrain.grid.cells
        .map((c, i) => ({ i, d: hexDistance(c, { q: 0, r: 0 }) }))
        .filter(({ d }) => d <= terrain.grid.radius * 0.6);
      expect(inner.some(({ i }) => i === k)).toBe(true);
      expect(terrain.heights[k]).toBe(Math.max(...inner.map(({ i }) => terrain.heights[i])));
      expect(pickKeeperCell(terrain, seed)).toBe(k);
    }
  });

  it('starts the player out of the lamp’s sight when possible', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed });
      const world = createWorld(terrain, seed);
      expect(world.player.cell).not.toBe(world.keeper.cell);
      const start = pickStartCell(terrain, seed, world.keeper.cell);
      const t = cellTop(terrain, start);
      const seen = segmentClear(terrain, lampPosition(terrain, world.keeper.cell), { x: t.x, y: t.y + 0.3, z: t.z });
      expect(seen).toBe(false);
      expect(world.stacks[world.keeper.cell]).toHaveLength(0);
    }
  });

  it('nothing can be done on the Keeper’s tile', () => {
    const w = arena(10, Math.PI); // beam pointing away
    expect(applyIntent(w, { type: 'place', cell: w.keeper.cell, kind: 'shard' }).ok).toBe(false);
    expect(applyIntent(w, { type: 'harvest', cell: w.keeper.cell }).ok).toBe(false);
  });
});

describe('the beam', () => {
  it('drains one energy per second while lit, and the energy returns as moss', () => {
    const w = arena(5);
    const total = totalEnergy(w);
    expect(playerLit(w)).toBe(true);
    const events = frozenBeam(() => run(w, 3));
    expect(w.player.energy).toBe(2);
    expect(events.filter((e) => e.type === 'drained')).toHaveLength(3);
    expect(totalEnergy(w)).toBe(total);
  });

  it('does nothing when it points elsewhere', () => {
    const w = arena(5, Math.PI);
    expect(playerLit(w)).toBe(false);
    frozenBeam(() => run(w, 5));
    expect(w.player.energy).toBe(5);
  });

  it('is blocked by a Shard wall (shadow)', () => {
    const w = arena(5);
    const wall = w.terrain.grid.indexOf(2, 0);
    for (let i = 0; i < 4; i++) spawn(w, wall, 'shard');
    expect(playerInLampSight(w)).toBe(false);
    expect(playerLit(w)).toBe(false);
    expect(beamEta(w)).toBeNull();
    frozenBeam(() => run(w, 5));
    expect(w.player.energy).toBe(5);
  });

  it('kills the Wisp when lit with no energy left', () => {
    const w = arena(1);
    const events = frozenBeam(() => run(w, 2.5));
    expect(w.player.energy).toBe(0);
    expect(w.status).toBe('lost');
    expect(events.some((e) => e.type === 'lost')).toBe(true);
    expect(applyIntent(w, { type: 'scatter' }).ok).toBe(false);
  });

  it('predicts when it will arrive, and is right', () => {
    const w = arena(5, -1.0); // beam is 1 rad behind the player
    const eta = beamEta(w)!;
    expect(eta).toBeCloseTo((1.0 - BEAM.halfAngle) / BEAM.speed, 5);
    run(w, eta - 0.1);
    expect(playerLit(w)).toBe(false);
    run(w, 0.2);
    expect(playerLit(w)).toBe(true);
    expect(beamEta(w)).toBe(0);
  });

  it('a lit pass drains about the beam width over the speed', () => {
    const w = arena(50, -0.5);
    run(w, 36); // one full rotation
    const expected = Math.floor((2 * BEAM.halfAngle) / BEAM.speed / BEAM.drainInterval);
    expect(50 - w.player.energy).toBeGreaterThanOrEqual(expected - 1);
    expect(50 - w.player.energy).toBeLessThanOrEqual(expected + 1);
  });

  it('lamp visibility of tiles respects shadows', () => {
    const w = arena();
    // The player's own Husk at (3,0) already shades (4,0) behind it.
    expect(lampVisibleTiles(w)[w.terrain.grid.indexOf(4, 0)]).toBe(0);
    const behind = w.terrain.grid.indexOf(0, 4);
    expect(lampVisibleTiles(w)[behind]).toBe(1);
    for (let i = 0; i < 6; i++) spawn(w, w.terrain.grid.indexOf(0, 2), 'shard');
    expect(lampVisibleTiles(w)[behind]).toBe(0);
  });

  it('is deterministic', () => {
    const play = () => {
      const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed: 9 });
      const w = createWorld(terrain, 9);
      run(w, 60);
      return [w.keeper.yaw, w.player.energy, w.rngState];
    };
    expect(play()).toEqual(play());
  });
});
