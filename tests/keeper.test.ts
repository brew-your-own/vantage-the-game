import { describe, expect, it } from 'vitest';
import { applyIntent } from '../src/core/actions';
import { HexGrid, hexDistance } from '../src/core/hex';
import {
  BEAM,
  beamEta,
  keeperSeesBodyAt,
  keeperSightTiles,
  lampVisibleTiles,
  playerInLampSight,
  playerLit,
  step,
} from '../src/core/keeper';
import { hiddenFromLamp, pickKeeperCell, pickStartCell } from '../src/core/level';
import { DEFAULT_TERRAIN, type Terrain, generateTerrain } from '../src/core/terrain';
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

  it('starts the player hidden from the Keeper, or with a full beam turn to act', () => {
    for (const seed of [1, 2, 3, 4, 5, 42]) {
      const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed });
      const world = createWorld(terrain, seed);
      expect(world.player.cell).not.toBe(world.keeper.cell);
      expect(world.stacks[world.keeper.cell]).toHaveLength(0);
      if (playerInLampSight(world)) {
        expect(beamEta(world)!).toBeGreaterThan(0.9 * ((2 * Math.PI) / BEAM.speed - (2 * BEAM.halfAngle) / BEAM.speed));
      }
    }
  });

  it('prefers a hidden low start tile when one exists', () => {
    // Seeds 1 and 4 have hidden tiles in their lowest quarter.
    for (const seed of [1, 4]) {
      const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed });
      const world = createWorld(terrain, seed);
      expect(hiddenFromLamp(terrain, world.keeper.cell, world.player.cell)).toBe(true);
      expect(playerInLampSight(world)).toBe(false);
      expect(pickStartCell(terrain, seed, world.keeper.cell)).toBe(world.player.cell);
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

describe("the Keeper's sight overlay", () => {
  it('agrees with the exposure check wherever the player stands', () => {
    const terrain = generateTerrain({ ...DEFAULT_TERRAIN, seed: 42 });
    const w = createWorld(terrain, 42);
    const sight = keeperSightTiles(w);
    const start = w.player.cell;
    expect(sight[start]).toBe(playerInLampSight(w) ? 1 : 0);
    // Move the body to a few other tiles and compare.
    const body = w.stacks[start].pop()!;
    let checked = 0;
    for (let i = 0; i < terrain.grid.count && checked < 40; i += 13) {
      if (w.stacks[i].length || i === w.keeper.cell) continue;
      w.stacks[i].push(body);
      w.player.cell = i;
      expect(playerInLampSight(w)).toBe(keeperSeesBodyAt(w, i));
      w.stacks[i].pop();
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
    // Both kinds of tiles exist on a real level.
    expect(sight.some((v) => v === 1)).toBe(true);
    expect(sight.some((v, i) => v === 0 && i !== w.keeper.cell)).toBe(true);
  });

  it('a Shard wall turns a tile from seen to hidden', () => {
    const w = arena(5, Math.PI);
    const spot = w.terrain.grid.indexOf(0, 3);
    expect(keeperSightTiles(w)[spot]).toBe(1);
    for (let i = 0; i < 4; i++) spawn(w, w.terrain.grid.indexOf(0, 2), 'shard');
    expect(keeperSightTiles(w)[spot]).toBe(0);
  });
});
